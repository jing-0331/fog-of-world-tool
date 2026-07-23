import { z } from "zod";

import type { GeoPoint } from "@/lib/domain/types";
import { densifyPoints } from "@/lib/geo/densify";
import { distanceMeters } from "@/lib/geo/distance";
import { fetchWithRetry } from "@/lib/server/fetch-with-retry";
import { ProviderError } from "@/lib/server/provider-error";

const TOKEN_URL =
  "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";
const API_BASE_URL = "https://opensky-network.org/api";
const MAX_ENDPOINT_DISTANCE_METERS = 200_000;

const tokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive().optional(),
});

const trackSchema = z.object({
  icao24: z.string(),
  startTime: z.number(),
  endTime: z.number(),
  path: z.array(
    z.tuple([
      z.number(),
      z.number().nullable(),
      z.number().nullable(),
      z.number().nullable(),
      z.number().nullable(),
      z.boolean(),
    ]),
  ),
});

interface OpenSkyClientOptions {
  clientId: string;
  clientSecret: string;
  fetchFn?: typeof fetch;
  tokenUrl?: string;
  apiBaseUrl?: string;
}

interface TrackRequest {
  icao24: string;
  timestampSeconds: number;
  origin: Pick<GeoPoint, "lat" | "lon">;
  destination: Pick<GeoPoint, "lat" | "lon">;
}

function noTrack(message: string): ProviderError {
  return new ProviderError({
    code: "no_data",
    message,
    retryable: false,
  });
}

export function createOpenSkyClient({
  clientId,
  clientSecret,
  fetchFn = fetch,
  tokenUrl = TOKEN_URL,
  apiBaseUrl = API_BASE_URL,
}: OpenSkyClientOptions) {
  return {
    async getTrack(request: TrackRequest): Promise<GeoPoint[]> {
      const tokenBody = new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      });
      const tokenResponse = await fetchWithRetry(
        tokenUrl,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: tokenBody,
        },
        { fetchFn },
      );
      const token = tokenSchema.parse(await tokenResponse.json());

      const url = new URL(`${apiBaseUrl}/tracks/all`);
      url.searchParams.set("icao24", request.icao24.toLowerCase());
      url.searchParams.set("time", String(Math.trunc(request.timestampSeconds)));
      const response = await fetchWithRetry(
        url,
        {
          headers: { Authorization: `Bearer ${token.access_token}` },
        },
        { fetchFn },
      );
      const track = trackSchema.parse(await response.json());
      const points = track.path.flatMap(
        ([time, lat, lon, elevationMeters]) => {
          if (lat === null || lon === null) {
            return [];
          }
          return [
            {
              lat,
              lon,
              time: new Date(time * 1_000).toISOString(),
              ...(elevationMeters === null ? {} : { elevationMeters }),
            },
          ];
        },
      );
      if (points.length < 2) {
        throw noTrack("OpenSky 航跡缺少足夠的定位點。");
      }
      if (
        distanceMeters(points[0], request.origin) >
          MAX_ENDPOINT_DISTANCE_METERS ||
        distanceMeters(points.at(-1)!, request.destination) >
          MAX_ENDPOINT_DISTANCE_METERS
      ) {
        throw noTrack("OpenSky 航跡端點與已確認機場不符。");
      }

      return densifyPoints(points, { maxDistanceMeters: 2_000 });
    },
  };
}
