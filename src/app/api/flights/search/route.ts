import { NextResponse } from "next/server";
import { z } from "zod";

import type { FlightCandidate } from "@/lib/domain/types";
import {
  createAeroDataBoxClient,
  normalizeFlightNumber,
} from "@/lib/providers/aerodatabox/client";
import { readServerEnv } from "@/lib/server/env";
import {
  asProviderError,
  ProviderError,
  serializeProviderError,
} from "@/lib/server/provider-error";

const requestSchema = z.object({
  flightNumber: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9]{2,3}\s*\d{1,4}[A-Za-z]?$/),
  departureDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((value) => {
      const [year, month, day] = value.split("-").map(Number);
      const date = new Date(Date.UTC(year, month - 1, day));
      return (
        date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day
      );
    }),
});

type SearchFlights = (
  flightNumber: string,
  departureDate: string,
) => Promise<FlightCandidate[]>;

function errorStatus(error: ProviderError): number {
  if (error.code === "no_data") return 404;
  if (error.code === "rate_limited") return 429;
  return 503;
}

export function createFlightSearchHandler(searchFlights: SearchFlights) {
  return async function handler(request: Request): Promise<NextResponse> {
    let parsed: z.infer<typeof requestSchema>;
    try {
      parsed = requestSchema.parse(await request.json());
    } catch {
      return NextResponse.json(
        {
          error: {
            code: "invalid_request",
            message: "請提供有效的航班編號與出發日期。",
            retryable: false,
          },
        },
        { status: 400 },
      );
    }

    try {
      const data = await searchFlights(
        normalizeFlightNumber(parsed.flightNumber),
        parsed.departureDate,
      );
      return NextResponse.json({ data });
    } catch (error) {
      const providerError = asProviderError(error);
      return NextResponse.json(serializeProviderError(providerError), {
        status: errorStatus(providerError),
      });
    }
  };
}

async function configuredSearchFlights(
  flightNumber: string,
  departureDate: string,
): Promise<FlightCandidate[]> {
  const env = readServerEnv(process.env);
  if (env.AERODATABOX_RAPIDAPI_KEY === undefined) {
    throw new ProviderError({
      code: "auth",
      message: "尚未設定 AeroDataBox API key。",
      retryable: false,
    });
  }
  return createAeroDataBoxClient({
    apiKey: env.AERODATABOX_RAPIDAPI_KEY,
  }).searchFlights(flightNumber, departureDate);
}

export const POST = createFlightSearchHandler(configuredSearchFlights);
