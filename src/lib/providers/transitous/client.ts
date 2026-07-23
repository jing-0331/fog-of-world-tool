import { z } from "zod";

import type { GeoPoint, TransportMode } from "@/lib/domain/types";
import { decodePolyline } from "@/lib/geo/polyline";
import { isTransitousContactConfigured } from "@/lib/server/env";
import { fetchWithRetry } from "@/lib/server/fetch-with-retry";
import { ProviderError } from "@/lib/server/provider-error";

interface TransitousClientOptions {
  contactUrl: string | undefined;
  fetchFn?: typeof fetch;
  now?: () => Date;
}

interface TransitousRouteRequest {
  mode: Extract<
    TransportMode,
    "train" | "subway" | "bus" | "tram" | "ferry"
  >;
  startPoint: GeoPoint;
  endPoint: GeoPoint;
  signal?: AbortSignal;
}

const TRANSIT_MODE = {
  train: "RAIL",
  subway: "SUBWAY",
  bus: "BUS",
  tram: "TRAM",
  ferry: "FERRY",
} as const satisfies Record<TransitousRouteRequest["mode"], string>;

const responseSchema = z.object({
  itineraries: z.array(
    z.object({
      legs: z.array(
        z.object({
          legGeometry: z.object({
            points: z.string(),
            precision: z.literal(6),
            length: z.number().int().nonnegative(),
          }),
        }),
      ),
    }),
  ),
});

export function createTransitousClient({
  contactUrl,
  fetchFn = fetch,
  now = () => new Date(),
}: TransitousClientOptions) {
  if (!isTransitousContactConfigured(contactUrl)) {
    throw new ProviderError({
      code: "provider_unavailable",
      message:
        "請設定有效且非範例值的 TRANSITOUS_CONTACT_URL 後再查詢大眾運輸。",
      retryable: false,
    });
  }

  return {
    async route(request: TransitousRouteRequest): Promise<{
      points: GeoPoint[];
      referenceDate: string;
    }> {
      const queryTime = now();
      const url = new URL("https://api.transitous.org/api/v6/plan");
      url.searchParams.set(
        "fromPlace",
        `${request.startPoint.lat},${request.startPoint.lon}`,
      );
      url.searchParams.set(
        "toPlace",
        `${request.endPoint.lat},${request.endPoint.lon}`,
      );
      url.searchParams.set("time", queryTime.toISOString());
      url.searchParams.set("transitModes", TRANSIT_MODE[request.mode]);
      url.searchParams.set("directModes", "");
      url.searchParams.set("preTransitModes", "WALK");
      url.searchParams.set("postTransitModes", "WALK");
      url.searchParams.set("detailedLegs", "true");
      url.searchParams.set("numItineraries", "1");

      const response = await fetchWithRetry(
        url,
        {
          headers: {
            "User-Agent": `fog-of-world-tool/0.1.0 (+${contactUrl})`,
          },
          signal: request.signal,
        },
        { fetchFn },
      );
      const parsed = responseSchema.safeParse(await response.json());
      if (!parsed.success) {
        throw invalidPayload();
      }
      const itinerary = parsed.data.itineraries[0];
      if (!itinerary) {
        throw noData();
      }

      const points = itinerary.legs
        .flatMap((leg) => decodePolyline(leg.legGeometry.points, 6))
        .filter(
          (point, index, all) =>
            index === 0 ||
            point.lat !== all[index - 1].lat ||
            point.lon !== all[index - 1].lon,
        );
      if (points.length < 2) {
        throw noData();
      }

      return {
        points,
        referenceDate: queryTime.toISOString().slice(0, 10),
      };
    },
  };
}

function noData(): ProviderError {
  return new ProviderError({
    code: "no_data",
    message: "Transitous 找不到可用的大眾運輸路線。",
    retryable: false,
  });
}

function invalidPayload(): ProviderError {
  return new ProviderError({
    code: "provider_unavailable",
    message: "Transitous 回傳了無法辨識的資料。",
    retryable: false,
  });
}
