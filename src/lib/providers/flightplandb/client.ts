import { z } from "zod";

import type { GeoPoint } from "@/lib/domain/types";
import { decodePolyline } from "@/lib/geo/polyline";
import { fetchWithRetry } from "@/lib/server/fetch-with-retry";
import { ProviderError } from "@/lib/server/provider-error";

const API_BASE_URL = "https://api.flightplandatabase.com";

const planSchema = z.object({
  id: z.number(),
  fromICAO: z.string().nullable(),
  toICAO: z.string().nullable(),
  popularity: z.number(),
  encodedPolyline: z.string().min(1),
});

const navaidSchema = z.object({
  ident: z.string(),
  type: z.string(),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  name: z.string().nullable().optional(),
});

interface FlightPlanDatabaseClientOptions {
  apiKey?: string;
  fetchFn?: typeof fetch;
  baseUrl?: string;
}

function noData(message: string): ProviderError {
  return new ProviderError({
    code: "no_data",
    message,
    retryable: false,
  });
}

export function createFlightPlanDatabaseClient({
  apiKey,
  fetchFn = fetch,
  baseUrl = API_BASE_URL,
}: FlightPlanDatabaseClientOptions = {}) {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-Units": "METRIC",
  };
  if (apiKey) {
    headers.Authorization = `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`;
  }

  return {
    async findPopularPlan(
      fromIcao: string,
      toIcao: string,
    ): Promise<GeoPoint[]> {
      const normalizedFrom = fromIcao.toUpperCase();
      const normalizedTo = toIcao.toUpperCase();
      const url = new URL("/search/plans", baseUrl);
      url.searchParams.set("fromICAO", normalizedFrom);
      url.searchParams.set("toICAO", normalizedTo);
      url.searchParams.set("limit", "20");
      url.searchParams.set("sort", "popularity");
      const response = await fetchWithRetry(
        url,
        { method: "GET", headers },
        { fetchFn },
      );
      const plans = z.array(planSchema).parse(await response.json());
      const plan = plans
        .filter(
          (candidate) =>
            candidate.fromICAO?.toUpperCase() === normalizedFrom &&
            candidate.toICAO?.toUpperCase() === normalizedTo,
        )
        .sort((a, b) => b.popularity - a.popularity)[0];
      if (plan === undefined) {
        throw noData("Flight Plan Database 找不到相同機場的模擬航路。");
      }
      return decodePolyline(plan.encodedPolyline, 5);
    },

    async findNavaid(ident: string): Promise<GeoPoint> {
      const normalized = ident.toUpperCase();
      const url = new URL("/search/nav", baseUrl);
      url.searchParams.set("q", normalized);
      const response = await fetchWithRetry(
        url,
        { method: "GET", headers },
        { fetchFn },
      );
      const navaids = z.array(navaidSchema).parse(await response.json());
      const match = navaids.find(
        (candidate) => candidate.ident.toUpperCase() === normalized,
      );
      if (match === undefined) {
        throw noData(`找不到航點 ${normalized}。`);
      }
      return { lat: match.lat, lon: match.lon };
    },
  };
}
