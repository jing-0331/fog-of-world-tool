import type { Airport, FlightCandidate } from "@/lib/domain/types";
import {
  mapAeroDataBoxAirport,
  mapAeroDataBoxFlights,
} from "@/lib/providers/aerodatabox/map-flight";
import { aeroDataBoxAirportSearchSchema } from "@/lib/providers/aerodatabox/schemas";
import { fetchWithRetry } from "@/lib/server/fetch-with-retry";
import { ProviderError } from "@/lib/server/provider-error";

const RAPID_API_BASE_URL = "https://aerodatabox.p.rapidapi.com";

interface AeroDataBoxClientOptions {
  apiKey: string;
  fetchFn?: typeof fetch;
  baseUrl?: string;
}

export interface AeroDataBoxClient {
  searchFlights(
    flightNumber: string,
    departureDate: string,
  ): Promise<FlightCandidate[]>;
  searchAirports(query: string): Promise<Airport[]>;
}

export function normalizeFlightNumber(flightNumber: string): string {
  return flightNumber.replaceAll(/\s+/g, "").toUpperCase();
}

function noData(message: string): ProviderError {
  return new ProviderError({
    code: "no_data",
    message,
    retryable: false,
  });
}

function invalidPayload(error: unknown): ProviderError {
  return new ProviderError({
    code: "provider_unavailable",
    message: "AeroDataBox returned an unsupported response.",
    retryable: false,
    internalDetail: error instanceof Error ? error.name : undefined,
  });
}

export function createAeroDataBoxClient({
  apiKey,
  fetchFn = fetch,
  baseUrl = RAPID_API_BASE_URL,
}: AeroDataBoxClientOptions): AeroDataBoxClient {
  const headers = {
    Accept: "application/json",
    "X-RapidAPI-Key": apiKey,
    "X-RapidAPI-Host": "aerodatabox.p.rapidapi.com",
  };

  return {
    async searchFlights(flightNumber, departureDate) {
      const normalized = normalizeFlightNumber(flightNumber);
      const url = new URL(
        `/flights/Number/${encodeURIComponent(normalized)}/${departureDate}`,
        baseUrl,
      );
      url.searchParams.set("dateLocalRole", "Departure");
      url.searchParams.set("withLocation", "false");
      url.searchParams.set("withFlightPlan", "true");
      const response = await fetchWithRetry(
        url,
        { headers },
        { fetchFn },
      );
      if (response.status === 204) {
        throw noData("找不到符合條件的航班。");
      }

      let candidates: FlightCandidate[];
      try {
        candidates = mapAeroDataBoxFlights(
          await response.json(),
          departureDate,
        );
      } catch (error) {
        throw invalidPayload(error);
      }
      if (candidates.length === 0) {
        throw noData("找不到符合條件的航班。");
      }
      return candidates;
    },

    async searchAirports(query) {
      const url = new URL("/airports/search/term", baseUrl);
      url.searchParams.set("q", query.trim());
      url.searchParams.set("limit", "10");
      const response = await fetchWithRetry(url, { headers }, { fetchFn });
      if (response.status === 204) {
        throw noData("找不到符合條件的機場。");
      }

      try {
        const providerResult = aeroDataBoxAirportSearchSchema.parse(
          await response.json(),
        );
        const airports = providerResult.items
          .map(mapAeroDataBoxAirport)
          .filter((airport): airport is Airport => airport !== null);
        if (airports.length === 0) {
          throw noData("找不到符合條件的機場。");
        }
        return airports;
      } catch (error) {
        if (error instanceof ProviderError) {
          throw error;
        }
        throw invalidPayload(error);
      }
    },
  };
}
