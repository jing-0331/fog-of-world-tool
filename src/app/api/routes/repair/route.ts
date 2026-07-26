import { NextResponse } from "next/server";

import { createOpenRouteServiceClient } from "@/lib/providers/openrouteservice/client";
import { createTdxClient } from "@/lib/providers/tdx/client";
import { createTransitousClient } from "@/lib/providers/transitous/client";
import {
  repairRoute,
  type RepairRouteRequest,
  type RepairRouteResult,
} from "@/lib/routing/repair-route";
import { repairRequestSchema } from "@/lib/routing/repair-request-schema";
import { readServerEnv } from "@/lib/server/env";
import {
  asProviderError,
  ProviderError,
  serializeProviderError,
} from "@/lib/server/provider-error";

type Repair = (request: RepairRouteRequest) => Promise<RepairRouteResult>;

export function createRepairRouteHandler(repair: Repair) {
  return async function handler(request: Request): Promise<NextResponse> {
    let input: RepairRouteRequest;
    try {
      input = {
        ...repairRequestSchema.parse(await request.json()),
        signal: request.signal,
      };
    } catch {
      return NextResponse.json(
        {
          error: {
            code: "invalid_request",
            message: "路線修補資料格式無效。",
            retryable: false,
          },
        },
        { status: 400 },
      );
    }

    try {
      return NextResponse.json({ data: await repair(input) });
    } catch (error) {
      const providerError = asProviderError(error);
      return NextResponse.json(serializeProviderError(providerError), {
        status: providerError.code === "rate_limited" ? 429 : 503,
      });
    }
  };
}

async function repairConfiguredRoute(
  request: RepairRouteRequest,
): Promise<RepairRouteResult> {
  const env = readServerEnv(process.env);
  return repairRoute(request, {
    async openRouteService(input) {
      if (!env.OPENROUTESERVICE_API_KEY) {
        throw configurationError("OPENROUTESERVICE_API_KEY");
      }
      return createOpenRouteServiceClient({
        apiKey: env.OPENROUTESERVICE_API_KEY,
      }).route(input);
    },
    async transitous(input) {
      return createTransitousClient({
        contactUrl: env.TRANSITOUS_CONTACT_URL,
        minimumIntervalMilliseconds:
          env.TRANSITOUS_MIN_INTERVAL_MS,
      }).route(input);
    },
    async tdx(input) {
      return createTdxClient({
        clientId: env.TDX_CLIENT_ID,
        clientSecret: env.TDX_CLIENT_SECRET,
        requestsPerMinute: env.TDX_REQUESTS_PER_MINUTE,
      }).route(input);
    },
  });
}

function configurationError(name: string): ProviderError {
  return new ProviderError({
    code: "auth",
    message: `請先設定 ${name}。`,
    retryable: false,
  });
}

export const POST = createRepairRouteHandler(repairConfiguredRoute);
