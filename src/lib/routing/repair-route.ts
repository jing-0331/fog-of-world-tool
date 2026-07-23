import type {
  GeoPoint,
  RepairAttempt,
  RouteProvenance,
  TransportMode,
} from "@/lib/domain/types";
import { densifyPoints, interpolateRouteTimes } from "@/lib/geo/densify";
import type { OpenRouteServiceProfile } from "@/lib/providers/openrouteservice/client";
import { routePolicy } from "@/lib/routing/mode-policy";
import { ProviderError } from "@/lib/server/provider-error";

export interface RepairRouteRequest {
  id: string;
  mode: TransportMode;
  startPoint: GeoPoint;
  endPoint: GeoPoint;
  startTime: string;
  endTime: string;
  signal?: AbortSignal;
}

interface RepairRouteDependencies {
  openRouteService: (request: {
    profile: OpenRouteServiceProfile;
    startPoint: GeoPoint;
    endPoint: GeoPoint;
    signal?: AbortSignal;
  }) => Promise<GeoPoint[]>;
  transitous: (request: {
    mode: Extract<
      TransportMode,
      "train" | "subway" | "bus" | "tram" | "ferry"
    >;
    startPoint: GeoPoint;
    endPoint: GeoPoint;
    signal?: AbortSignal;
  }) => Promise<{ points: GeoPoint[]; referenceDate: string }>;
}

export interface RepairRouteResult {
  points: GeoPoint[];
  provenance: RouteProvenance;
  attempts: RepairAttempt[];
}

export async function repairRoute(
  request: RepairRouteRequest,
  dependencies: RepairRouteDependencies,
): Promise<RepairRouteResult> {
  const policy = routePolicy(request.mode);
  if (policy === null) {
    throw new ProviderError({
      code: "no_data",
      message: `交通方式 ${request.mode} 沒有安全的自動路線來源。`,
      retryable: false,
    });
  }

  let rawPoints: GeoPoint[];
  let provenance: RouteProvenance;

  if (policy.provider === "openrouteservice") {
    rawPoints = await dependencies.openRouteService({
      profile: policy.profile,
      startPoint: request.startPoint,
      endPoint: request.endPoint,
      signal: request.signal,
    });
    provenance = {
      kind: "ground-route",
      source: "openrouteservice",
      referenceDate: null,
      approximate: true,
      explanation: "以 OpenRouteService 近似補齊缺少的地面路徑。",
      originalMode: request.mode,
    };
  } else {
    const transitResult = await dependencies.transitous({
      mode: request.mode as Extract<
        TransportMode,
        "train" | "subway" | "bus" | "tram" | "ferry"
      >,
      startPoint: request.startPoint,
      endPoint: request.endPoint,
      signal: request.signal,
    });
    rawPoints = transitResult.points;
    provenance = {
      kind: "transit-route",
      source: "transitous",
      referenceDate: transitResult.referenceDate,
      approximate: true,
      explanation:
        "以 Transitous 目前班表近似補齊歷史大眾運輸路徑；參考日期不是原始行程日期。",
      originalMode: request.mode,
    };
  }

  if (rawPoints.length < 2) {
    throw new ProviderError({
      code: "no_data",
      message: "路線來源沒有回傳足夠的路徑點。",
      retryable: false,
    });
  }

  const timed = interpolateRouteTimes(
    rawPoints,
    request.startTime,
    request.endTime,
  );
  const points = densifyPoints(timed, { maxDistanceMeters: 2_000 });
  return {
    points,
    provenance,
    attempts: [
      {
        source: provenance.source,
        status: "success",
        message: provenance.explanation,
        retryable: false,
      },
    ],
  };
}
