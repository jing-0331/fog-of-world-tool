import { NextResponse } from "next/server";
import { z } from "zod";

import type { GeoPoint } from "@/lib/domain/types";
import { createOpenRouteServiceClient } from "@/lib/providers/openrouteservice/client";
import { readServerEnv } from "@/lib/server/env";

const querySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
});

type ReverseGeocode = (
  point: GeoPoint,
  signal?: AbortSignal,
) => Promise<string | null>;

export function createReverseGeocodeHandler(reverseGeocode: ReverseGeocode) {
  return async function handler(request: Request): Promise<NextResponse> {
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      lat: url.searchParams.get("lat"),
      lon: url.searchParams.get("lon"),
    });
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_request",
            message: "座標格式無效。",
            retryable: false,
          },
        },
        { status: 400 },
      );
    }

    const point = parsed.data;
    try {
      const label = await reverseGeocode(point, request.signal);
      if (label) {
        return NextResponse.json({
          data: { label, coordinatesOnly: false },
        });
      }
    } catch {
      // Coordinate fallback is intentionally returned below.
    }

    return NextResponse.json({
      data: {
        label: coordinateLabel(point),
        coordinatesOnly: true,
      },
    });
  };
}

async function reverseConfigured(
  point: GeoPoint,
  signal?: AbortSignal,
): Promise<string | null> {
  const env = readServerEnv(process.env);
  return env.OPENROUTESERVICE_API_KEY
    ? createOpenRouteServiceClient({
        apiKey: env.OPENROUTESERVICE_API_KEY,
      }).reverseGeocode(point, signal)
    : null;
}

function coordinateLabel(point: GeoPoint): string {
  return `${point.lat.toFixed(5)}, ${point.lon.toFixed(5)}`;
}

export const GET = createReverseGeocodeHandler(reverseConfigured);
