import { NextResponse } from "next/server";
import { z } from "zod";

import type { Airport } from "@/lib/domain/types";
import { createAeroDataBoxClient } from "@/lib/providers/aerodatabox/client";
import { readServerEnv } from "@/lib/server/env";
import {
  asProviderError,
  ProviderError,
  serializeProviderError,
} from "@/lib/server/provider-error";

const airportSearchRequestSchema = z.object({
  query: z.string().trim().min(2).max(80),
});

type AirportSearch = (query: string) => Promise<Airport[]>;

export function createAirportSearchHandler(searchAirports: AirportSearch) {
  return async function handler(request: Request): Promise<NextResponse> {
    let parsed: z.infer<typeof airportSearchRequestSchema>;
    try {
      parsed = airportSearchRequestSchema.parse(await request.json());
    } catch {
      return NextResponse.json(
        {
          error: {
            code: "invalid_request",
            message: "請提供有效的機場代碼或名稱。",
            retryable: false,
          },
        },
        { status: 400 },
      );
    }

    try {
      return NextResponse.json({
        data: await searchAirports(parsed.query),
      });
    } catch (error) {
      const providerError = asProviderError(error);
      return NextResponse.json(serializeProviderError(providerError), {
        status: providerError.code === "no_data" ? 404 : 503,
      });
    }
  };
}

async function configuredAirportSearch(query: string): Promise<Airport[]> {
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
  }).searchAirports(query);
}

export const POST = createAirportSearchHandler(configuredAirportSearch);
