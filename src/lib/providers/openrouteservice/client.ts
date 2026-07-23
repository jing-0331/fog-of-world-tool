import { z } from "zod";

import type { GeoPoint } from "@/lib/domain/types";
import { fetchWithRetry } from "@/lib/server/fetch-with-retry";
import { ProviderError } from "@/lib/server/provider-error";

export type OpenRouteServiceProfile =
  | "foot-walking"
  | "cycling-regular"
  | "driving-car";

interface OpenRouteServiceClientOptions {
  apiKey: string;
  fetchFn?: typeof fetch;
}

interface OpenRouteServiceRouteRequest {
  profile: OpenRouteServiceProfile;
  startPoint: GeoPoint;
  endPoint: GeoPoint;
  signal?: AbortSignal;
}

const routeResponseSchema = z.object({
  features: z
    .array(
      z.object({
        geometry: z.object({
          type: z.literal("LineString"),
          coordinates: z.array(
            z.tuple([
              z.number().min(-180).max(180),
              z.number().min(-90).max(90),
            ]),
          ),
        }),
      }),
    )
    .min(1),
});

const reverseResponseSchema = z.object({
  features: z.array(
    z.object({
      properties: z.object({
        label: z.string().min(1),
      }),
    }),
  ),
});

export function createOpenRouteServiceClient({
  apiKey,
  fetchFn = fetch,
}: OpenRouteServiceClientOptions) {
  const headers = {
    Authorization: apiKey,
    "Content-Type": "application/json",
  };

  return {
    async route(request: OpenRouteServiceRouteRequest): Promise<GeoPoint[]> {
      const response = await fetchWithRetry(
        `https://api.openrouteservice.org/v2/directions/${request.profile}/geojson`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            coordinates: [
              [request.startPoint.lon, request.startPoint.lat],
              [request.endPoint.lon, request.endPoint.lat],
            ],
          }),
          signal: request.signal,
        },
        { fetchFn },
      );

      const parsed = routeResponseSchema.safeParse(await response.json());
      if (!parsed.success) {
        throw invalidPayload("OpenRouteService directions payload");
      }
      return parsed.data.features[0].geometry.coordinates.map(([lon, lat]) => ({
        lat,
        lon,
      }));
    },

    async reverseGeocode(
      point: GeoPoint,
      signal?: AbortSignal,
    ): Promise<string | null> {
      const url = new URL("https://api.openrouteservice.org/geocode/reverse");
      url.searchParams.set("point.lat", String(point.lat));
      url.searchParams.set("point.lon", String(point.lon));
      url.searchParams.set("size", "1");

      try {
        const response = await fetchWithRetry(
          url,
          { headers: { Authorization: apiKey }, signal },
          { fetchFn },
        );
        const parsed = reverseResponseSchema.safeParse(await response.json());
        return parsed.success ? (parsed.data.features[0]?.properties.label ?? null) : null;
      } catch {
        return null;
      }
    },
  };
}

function invalidPayload(internalDetail: string): ProviderError {
  return new ProviderError({
    code: "provider_unavailable",
    message: "OpenRouteService 回傳了無法辨識的資料。",
    retryable: false,
    internalDetail,
  });
}
