import { NextResponse } from "next/server";
import { z } from "zod";

import type { ConfirmedFlight } from "@/lib/domain/types";
import { resolveFiledPlan } from "@/lib/flight/resolve-filed-plan";
import {
  resolveFlightRoute,
  type ResolveFlightRouteResult,
} from "@/lib/flight/resolve-flight-route";
import { createAeroDataBoxClient } from "@/lib/providers/aerodatabox/client";
import { createFlightPlanDatabaseClient } from "@/lib/providers/flightplandb/client";
import { createOpenSkyClient } from "@/lib/providers/opensky/client";
import { readServerEnv } from "@/lib/server/env";
import {
  asProviderError,
  serializeProviderError,
} from "@/lib/server/provider-error";

const pointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});

const airportSchema = z.object({
  name: z.string().min(1),
  city: z.string().min(1),
  iata: z.string().optional(),
  icao: z.string().optional(),
  point: pointSchema,
});

const flightSchema = z.object({
  id: z.string().min(1),
  flightNumber: z.string().min(2),
  status: z.string().min(1),
  canceled: z.boolean(),
  departureAirport: airportSchema,
  arrivalAirport: airportSchema,
  scheduledDeparture: z.string().refine((value) => Number.isFinite(Date.parse(value))),
  scheduledArrival: z.string().refine((value) => Number.isFinite(Date.parse(value))),
  actualDeparture: z.string().optional(),
  actualArrival: z.string().optional(),
  durationMinutes: z.number().nonnegative(),
  aircraftIcao24: z.string().optional(),
  filedRoute: z.string().optional(),
  confirmedAt: z.string().refine((value) => Number.isFinite(Date.parse(value))),
});

const requestSchema = z.object({ flight: flightSchema });
type Resolve = (flight: ConfirmedFlight) => Promise<ResolveFlightRouteResult>;

export function createResolveRouteHandler(resolve: Resolve) {
  return async function handler(request: Request): Promise<NextResponse> {
    let flight: ConfirmedFlight;
    try {
      flight = requestSchema.parse(await request.json()).flight;
    } catch {
      return NextResponse.json(
        {
          error: {
            code: "invalid_request",
            message: "航班資料格式無效。",
            retryable: false,
          },
        },
        { status: 400 },
      );
    }

    try {
      return NextResponse.json({ data: await resolve(flight) });
    } catch (error) {
      const providerError = asProviderError(error);
      return NextResponse.json(serializeProviderError(providerError), {
        status: providerError.code === "rate_limited" ? 429 : 503,
      });
    }
  };
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function resolveConfiguredFlight(
  flight: ConfirmedFlight,
): Promise<ResolveFlightRouteResult> {
  const env = readServerEnv(process.env);
  const flightPlanDatabase = createFlightPlanDatabaseClient({
    ...(env.FLIGHTPLANDB_API_KEY
      ? { apiKey: env.FLIGHTPLANDB_API_KEY }
      : {}),
  });
  const openSky =
    env.OPENSKY_CLIENT_ID && env.OPENSKY_CLIENT_SECRET
      ? createOpenSkyClient({
          clientId: env.OPENSKY_CLIENT_ID,
          clientSecret: env.OPENSKY_CLIENT_SECRET,
        })
      : null;
  const aeroDataBox = env.AERODATABOX_RAPIDAPI_KEY
    ? createAeroDataBoxClient({ apiKey: env.AERODATABOX_RAPIDAPI_KEY })
    : null;

  return resolveFlightRoute(flight, {
    async getOpenSkyTrack(referenceFlight) {
      if (!openSky || !referenceFlight.aircraftIcao24) return null;
      const start = Date.parse(
        referenceFlight.actualDeparture ??
          referenceFlight.scheduledDeparture,
      );
      const end = Date.parse(
        referenceFlight.actualArrival ?? referenceFlight.scheduledArrival,
      );
      return openSky.getTrack({
        icao24: referenceFlight.aircraftIcao24,
        timestampSeconds: Math.trunc((start + end) / 2_000),
        origin: referenceFlight.departureAirport.point,
        destination: referenceFlight.arrivalAirport.point,
      });
    },

    async resolveFiledPlan(referenceFlight) {
      return resolveFiledPlan(
        referenceFlight,
        (ident) => flightPlanDatabase.findNavaid(ident),
      );
    },

    async findSimulatedPlan(referenceFlight) {
      const origin = referenceFlight.departureAirport.icao;
      const destination = referenceFlight.arrivalAirport.icao;
      return origin && destination
        ? flightPlanDatabase.findPopularPlan(origin, destination)
        : null;
    },

    async findRepresentativeFlights(referenceFlight) {
      if (!aeroDataBox) return [];
      const now = new Date();
      const from = new Date(now.getTime() - 100 * 86_400_000);
      const candidates = await aeroDataBox.searchFlightHistory(
        referenceFlight.flightNumber,
        isoDate(from),
        isoDate(now),
      );
      return candidates.map((candidate) => ({
        ...candidate,
        confirmedAt: now.toISOString(),
      }));
    },
  });
}

export const POST = createResolveRouteHandler(resolveConfiguredFlight);
