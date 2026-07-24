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
const FLIGHT_DISCOVERY_RADIUS_SECONDS = 6 * 60 * 60;
const MAX_ARRIVAL_TIME_DELTA_SECONDS = 12 * 60 * 60;

const tokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive().optional(),
});

const trackSchema = z.object({
  icao24: z.string(),
  startTime: z.number(),
  endTime: z.number(),
  callsign: z.string().nullable().optional(),
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

const flightSchema = z.object({
  icao24: z.string().min(1),
  firstSeen: z.number(),
  estDepartureAirport: z.string().nullable(),
  lastSeen: z.number(),
  estArrivalAirport: z.string().nullable(),
  callsign: z.string().nullable(),
});

const flightsSchema = z.array(flightSchema);

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
  expectedStartSeconds?: number;
  expectedEndSeconds?: number;
}

interface FlightTrackRequest {
  flightNumber: string;
  icao24?: string;
  departureTimeSeconds: number;
  arrivalTimeSeconds: number;
  originAirportIcao: string;
  destinationAirportIcao: string;
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

function matchingTrackSlice(
  points: GeoPoint[],
  request: TrackRequest,
): GeoPoint[] | null {
  const targetTime = request.timestampSeconds * 1_000;
  let best:
    | {
        startIndex: number;
        endIndex: number;
        containsTargetTime: boolean;
        timeDistance: number;
        endpointDistance: number;
      }
    | undefined;

  for (let startIndex = 0; startIndex < points.length - 1; startIndex += 1) {
    const originDistance = distanceMeters(points[startIndex], request.origin);
    if (originDistance > MAX_ENDPOINT_DISTANCE_METERS) continue;

    for (
      let endIndex = startIndex + 1;
      endIndex < points.length;
      endIndex += 1
    ) {
      const destinationDistance = distanceMeters(
        points[endIndex],
        request.destination,
      );
      if (destinationDistance > MAX_ENDPOINT_DISTANCE_METERS) continue;

      const startTime = Date.parse(points[startIndex].time!);
      const endTime = Date.parse(points[endIndex].time!);
      const containsTargetTime =
        startTime <= targetTime && targetTime <= endTime;
      const timeDistance =
        (request.expectedStartSeconds === undefined
          ? 0
          : Math.abs(
              startTime - request.expectedStartSeconds * 1_000,
            )) +
        (request.expectedEndSeconds === undefined
          ? 0
          : Math.abs(endTime - request.expectedEndSeconds * 1_000));
      const endpointDistance = originDistance + destinationDistance;
      if (
        best === undefined ||
        (containsTargetTime && !best.containsTargetTime) ||
        (containsTargetTime === best.containsTargetTime &&
          (timeDistance < best.timeDistance ||
            (timeDistance === best.timeDistance &&
              endpointDistance < best.endpointDistance)))
      ) {
        best = {
          startIndex,
          endIndex,
          containsTargetTime,
          timeDistance,
          endpointDistance,
        };
      }
    }
  }

  return best
    ? points.slice(best.startIndex, best.endIndex + 1)
    : null;
}

function normalizeFlightIdentifier(value: string): string {
  return value.replaceAll(/[^A-Z0-9]/gi, "").toUpperCase();
}

function callsignMatchesFlightNumber(
  callsign: string | null,
  flightNumber: string,
): boolean {
  if (callsign === null) return false;
  const normalizedCallsign = normalizeFlightIdentifier(callsign);
  const normalizedFlightNumber = normalizeFlightIdentifier(flightNumber);
  if (normalizedCallsign === normalizedFlightNumber) return true;

  const callsignNumber = normalizedCallsign.match(/\d+$/)?.[0];
  const flightNumberPart = normalizedFlightNumber.match(/\d+$/)?.[0];
  return (
    callsignNumber !== undefined &&
    flightNumberPart !== undefined &&
    callsignNumber === flightNumberPart
  );
}

export function createOpenSkyClient({
  clientId,
  clientSecret,
  fetchFn = fetch,
  tokenUrl = TOKEN_URL,
  apiBaseUrl = API_BASE_URL,
}: OpenSkyClientOptions) {
  async function getAccessToken(): Promise<string> {
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
    return tokenSchema.parse(await tokenResponse.json()).access_token;
  }

  async function getTrackWithToken(
    request: TrackRequest,
    accessToken: string,
  ): Promise<GeoPoint[]> {
    const url = new URL(`${apiBaseUrl}/tracks/all`);
    url.searchParams.set("icao24", request.icao24.toLowerCase());
    url.searchParams.set("time", String(Math.trunc(request.timestampSeconds)));
    const response = await fetchWithRetry(
      url,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
      { fetchFn },
    );
    const track = trackSchema.parse(await response.json());
    if (track.icao24.toLowerCase() !== request.icao24.toLowerCase()) {
      throw noTrack("OpenSky 回傳的航空器與已辨識航班不符。");
    }
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
    const matchingPoints = matchingTrackSlice(points, request);
    if (matchingPoints === null) {
      throw noTrack("OpenSky 航跡端點與已確認機場不符。");
    }

    return densifyPoints(matchingPoints, { maxDistanceMeters: 2_000 });
  }

  async function discoverFlight(
    request: FlightTrackRequest,
    accessToken: string,
  ): Promise<z.infer<typeof flightSchema>> {
    const url = new URL(`${apiBaseUrl}/flights/departure`);
    url.searchParams.set("airport", request.originAirportIcao.toUpperCase());
    url.searchParams.set(
      "begin",
      String(
        Math.trunc(
          request.departureTimeSeconds - FLIGHT_DISCOVERY_RADIUS_SECONDS,
        ),
      ),
    );
    url.searchParams.set(
      "end",
      String(
        Math.trunc(
          request.departureTimeSeconds + FLIGHT_DISCOVERY_RADIUS_SECONDS,
        ),
      ),
    );
    const response = await fetchWithRetry(
      url,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
      { fetchFn },
    );
    const origin = request.originAirportIcao.toUpperCase();
    const destination = request.destinationAirportIcao.toUpperCase();
    const suppliedIcao24 = request.icao24?.toLowerCase();
    const candidateIcaoPenalty = (
      candidate: z.infer<typeof flightSchema>,
    ) =>
      suppliedIcao24 !== undefined &&
      candidate.icao24.toLowerCase() !== suppliedIcao24
        ? 1
        : 0;
    const candidateTimeScore = (
      candidate: z.infer<typeof flightSchema>,
    ) =>
      Math.abs(candidate.firstSeen - request.departureTimeSeconds) +
      Math.abs(candidate.lastSeen - request.arrivalTimeSeconds);
    const candidates = flightsSchema
      .parse(await response.json())
      .filter(
        (candidate) =>
          candidate.estDepartureAirport?.toUpperCase() === origin &&
          candidate.estArrivalAirport?.toUpperCase() === destination &&
          callsignMatchesFlightNumber(
            candidate.callsign,
            request.flightNumber,
          ) &&
          Math.abs(
            candidate.firstSeen - request.departureTimeSeconds,
          ) <= FLIGHT_DISCOVERY_RADIUS_SECONDS &&
          Math.abs(candidate.lastSeen - request.arrivalTimeSeconds) <=
            MAX_ARRIVAL_TIME_DELTA_SECONDS,
      )
      .sort(
        (left, right) =>
          candidateIcaoPenalty(left) - candidateIcaoPenalty(right) ||
          candidateTimeScore(left) - candidateTimeScore(right),
      );

    if (candidates.length === 0) {
      throw noTrack(
        "OpenSky 找不到符合航班號、時間窗與起訖機場的已完成航班。",
      );
    }
    if (
      candidates.length > 1 &&
      candidateIcaoPenalty(candidates[0]) ===
        candidateIcaoPenalty(candidates[1]) &&
      candidateTimeScore(candidates[0]) ===
        candidateTimeScore(candidates[1])
    ) {
      throw noTrack("OpenSky 找到多個同樣相符的航班，無法安全辨識航空器。");
    }
    return candidates[0];
  }

  return {
    async getTrack(request: TrackRequest): Promise<GeoPoint[]> {
      return getTrackWithToken(request, await getAccessToken());
    },

    async getFlightTrack(
      request: FlightTrackRequest,
    ): Promise<GeoPoint[]> {
      const accessToken = await getAccessToken();
      const flight = await discoverFlight(request, accessToken);
      return getTrackWithToken(
        {
          icao24: flight.icao24,
          timestampSeconds: (flight.firstSeen + flight.lastSeen) / 2,
          origin: request.origin,
          destination: request.destination,
          expectedStartSeconds: flight.firstSeen,
          expectedEndSeconds: flight.lastSeen,
        },
        accessToken,
      );
    },
  };
}
