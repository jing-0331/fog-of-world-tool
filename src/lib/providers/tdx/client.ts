import { z } from "zod";

import type { GeoPoint, TransportMode } from "@/lib/domain/types";
import { decodeFlexiblePolyline } from "@/lib/geo/flexible-polyline";
import {
  createSlidingWindowRateLimiter,
  type RequestRateLimiter,
} from "@/lib/server/sliding-window-rate-limiter";
import { fetchWithRetry } from "@/lib/server/fetch-with-retry";
import { ProviderError } from "@/lib/server/provider-error";

interface TdxClientOptions {
  clientId: string | undefined;
  clientSecret: string | undefined;
  fetchFn?: typeof fetch;
  now?: () => Date;
  tokenCache?: Map<string, CachedToken>;
  requestLimiter?: RequestRateLimiter;
}

interface TdxRouteRequest {
  mode: Extract<
    TransportMode,
    "train" | "subway" | "bus" | "tram" | "ferry"
  >;
  startPoint: GeoPoint;
  endPoint: GeoPoint;
  signal?: AbortSignal;
}

interface CachedToken {
  value: string;
  expiresAtMilliseconds: number;
}

const TOKEN_URL =
  "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token";
const ROUTING_URL = "https://tdx.transportdata.tw/api/maas/routing";
const TOKEN_REFRESH_BUFFER_MILLISECONDS = 60_000;
const TAIPEI_OFFSET_MILLISECONDS = 8 * 60 * 60 * 1_000;
const sharedTokenCache = new Map<string, CachedToken>();
const sharedRequestLimiter = createSlidingWindowRateLimiter({
  limit: 5,
  windowMilliseconds: 60_000,
});

const TRANSIT_CODES = {
  train: "3,4",
  subway: "6",
  bus: "5",
  tram: "7",
  ferry: "8",
} as const satisfies Record<TdxRouteRequest["mode"], string>;

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
});

const locationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const endpointSchema = z.object({
  place: z
    .object({
      location: locationSchema.nullish(),
    })
    .nullish(),
});

const sectionSchema = z.object({
  polyline: z.string().nullish(),
  departure: endpointSchema.nullish(),
  arrival: endpointSchema.nullish(),
});

const sectionsSchema = z
  .union([
    z.array(sectionSchema),
    z.record(z.string(), sectionSchema),
  ])
  .transform((sections) =>
    Array.isArray(sections) ? sections : Object.values(sections),
  );

const routeResponseSchema = z.object({
  result: z.string().optional(),
  data: z.object({
    routes: z.array(
      z.object({
        sections: sectionsSchema,
      }),
    ),
  }),
});

export function createTdxClient({
  clientId,
  clientSecret,
  fetchFn = fetch,
  now = () => new Date(),
  tokenCache = sharedTokenCache,
  requestLimiter = sharedRequestLimiter,
}: TdxClientOptions) {
  if (!clientId || !clientSecret) {
    throw new ProviderError({
      code: "provider_unavailable",
      message: "請設定 TDX_CLIENT_ID 與 TDX_CLIENT_SECRET 以查詢台灣大眾運輸。",
      retryable: false,
    });
  }

  const rateLimitedFetch: typeof fetch = async (input, init) => {
    await requestLimiter.acquire(init?.signal ?? undefined);
    return fetchFn(input, init);
  };

  const accessToken = async (signal?: AbortSignal): Promise<string> => {
    const nowMilliseconds = now().getTime();
    const cachedToken = tokenCache.get(clientId);
    if (
      cachedToken &&
      cachedToken.expiresAtMilliseconds - TOKEN_REFRESH_BUFFER_MILLISECONDS >
        nowMilliseconds
    ) {
      return cachedToken.value;
    }

    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    });
    const response = await fetchWithRetry(
      TOKEN_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
        signal,
      },
      { fetchFn },
    );
    const parsed = tokenResponseSchema.safeParse(await responseJson(response));
    if (!parsed.success) {
      throw invalidPayload();
    }
    const nextToken = {
      value: parsed.data.access_token,
      expiresAtMilliseconds:
        nowMilliseconds + parsed.data.expires_in * 1_000,
    };
    tokenCache.set(clientId, nextToken);
    return nextToken.value;
  };

  return {
    async route(request: TdxRouteRequest): Promise<{
      points: GeoPoint[];
      referenceDate: string;
    }> {
      const queryTime = now();
      const token = await accessToken(request.signal);
      const url = new URL(ROUTING_URL);
      url.searchParams.set(
        "origin",
        `${request.startPoint.lat},${request.startPoint.lon}`,
      );
      url.searchParams.set(
        "destination",
        `${request.endPoint.lat},${request.endPoint.lon}`,
      );
      url.searchParams.set("gc", "1");
      url.searchParams.set("top", "1");
      url.searchParams.set("transit", TRANSIT_CODES[request.mode]);
      url.searchParams.set("transfer_time", "0,60");
      url.searchParams.set("first_mile_mode", "0");
      url.searchParams.set("first_mile_time", "60");
      url.searchParams.set("last_mile_mode", "0");
      url.searchParams.set("last_mile_time", "60");

      const response = await fetchWithRetry(
        url,
        {
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
          },
          signal: request.signal,
        },
        { fetchFn: rateLimitedFetch },
      );
      const parsed = routeResponseSchema.safeParse(
        await responseJson(response),
      );
      if (!parsed.success) {
        throw invalidPayload();
      }
      const route = parsed.data.data.routes[0];
      if (!route) {
        throw noData();
      }

      const points = route.sections
        .flatMap(sectionPoints)
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
        referenceDate: new Date(
          queryTime.getTime() + TAIPEI_OFFSET_MILLISECONDS,
        )
          .toISOString()
          .slice(0, 10),
      };
    },
  };
}

function sectionPoints(section: z.infer<typeof sectionSchema>): GeoPoint[] {
  if (section.polyline) {
    const decoded = decodeFlexiblePolyline(section.polyline);
    if (decoded && decoded.length >= 2) {
      return decoded;
    }
  }

  const start = section.departure?.place?.location;
  const end = section.arrival?.place?.location;
  return start && end
    ? [
        { lat: start.lat, lon: start.lng },
        { lat: end.lat, lon: end.lng },
      ]
    : [];
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw invalidPayload();
  }
}

function noData(): ProviderError {
  return new ProviderError({
    code: "no_data",
    message: "TDX 找不到可用的台灣大眾運輸路線。",
    retryable: false,
  });
}

function invalidPayload(): ProviderError {
  return new ProviderError({
    code: "provider_unavailable",
    message: "TDX 回傳了無法辨識的資料。",
    retryable: false,
  });
}
