import { z } from "zod";

import type {
  GeoPoint,
  PublicTransitMode,
} from "@/lib/domain/types";
import { decodePolyline } from "@/lib/geo/polyline";
import { transitousModeFor } from "@/lib/providers/transitous/mode-map";
import { isTransitousContactConfigured } from "@/lib/server/env";
import { fetchWithRetry } from "@/lib/server/fetch-with-retry";
import { ProviderError } from "@/lib/server/provider-error";
import { createRateLimitedFetch } from "@/lib/server/rate-limited-fetch";
import type { RequestRateLimiter } from "@/lib/server/request-rate-limiter";
import { createSlidingWindowRateLimiter } from "@/lib/server/sliding-window-rate-limiter";

interface TransitousClientOptions {
  contactUrl: string | undefined;
  fetchFn?: typeof fetch;
  now?: () => Date;
  minimumIntervalMilliseconds?: number;
  requestLimiter?: RequestRateLimiter;
}

interface TransitousRouteRequest {
  mode: PublicTransitMode;
  startPoint: GeoPoint;
  endPoint: GeoPoint;
  signal?: AbortSignal;
}

const sharedRequestLimiters = new Map<number, RequestRateLimiter>();

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
  minimumIntervalMilliseconds = 5_000,
  requestLimiter = sharedTransitousLimiterFor(
    minimumIntervalMilliseconds,
  ),
}: TransitousClientOptions) {
  if (!isTransitousContactConfigured(contactUrl)) {
    throw new ProviderError({
      code: "provider_unavailable",
      message:
        "請設定有效且非範例值的 TRANSITOUS_CONTACT_URL 後再查詢大眾運輸。",
      retryable: false,
    });
  }
  const rateLimitedFetch = createRateLimitedFetch(
    fetchFn,
    requestLimiter,
  );

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
      url.searchParams.set(
        "transitModes",
        transitousModeFor(request.mode),
      );
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
        { fetchFn: rateLimitedFetch },
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

function sharedTransitousLimiterFor(
  minimumIntervalMilliseconds: number,
): RequestRateLimiter {
  const existing = sharedRequestLimiters.get(
    minimumIntervalMilliseconds,
  );
  if (existing) {
    return existing;
  }
  const limiter = createSlidingWindowRateLimiter({
    limit: 1,
    windowMilliseconds: minimumIntervalMilliseconds,
  });
  sharedRequestLimiters.set(minimumIntervalMilliseconds, limiter);
  return limiter;
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
