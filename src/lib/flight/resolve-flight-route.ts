import type {
  ConfirmedFlight,
  GeoPoint,
  RepairAttempt,
  RouteKind,
  RouteSegment,
  RouteSource,
} from "@/lib/domain/types";
import { densifyPoints, interpolateRouteTimes } from "@/lib/geo/densify";
import {
  flightRoutePolicy,
  selectRepresentativeFlight,
} from "@/lib/flight/route-policy";
import { asProviderError } from "@/lib/server/provider-error";

export interface ResolveFlightRouteDependencies {
  getOpenSkyTrack: (flight: ConfirmedFlight) => Promise<GeoPoint[] | null>;
  resolveFiledPlan: (flight: ConfirmedFlight) => Promise<GeoPoint[] | null>;
  findSimulatedPlan: (flight: ConfirmedFlight) => Promise<GeoPoint[] | null>;
  findRepresentativeFlights?: (
    flight: ConfirmedFlight,
  ) => Promise<ConfirmedFlight[]>;
}

export interface ResolveFlightRouteResult {
  segment: RouteSegment;
  attempts: RepairAttempt[];
  referenceFlightId?: string;
}

interface SuccessfulRoute {
  points: GeoPoint[];
  kind: RouteKind;
  source: RouteSource;
  approximate: boolean;
  explanation: string;
}

function datePart(timestamp: string): string {
  return timestamp.slice(0, 10);
}

function successAttempt(
  source: RouteSource,
  message: string,
): RepairAttempt {
  return {
    source,
    status: "success",
    message,
    retryable: false,
  };
}

async function attemptRoute(
  source: RouteSource,
  operation: () => Promise<GeoPoint[] | null>,
  attempts: RepairAttempt[],
): Promise<GeoPoint[] | null> {
  try {
    const points = await operation();
    if (points === null || points.length < 2) {
      attempts.push({
        source,
        status: "failed",
        code: "no_data",
        message: "此來源沒有可用路線。",
        retryable: false,
      });
      return null;
    }
    attempts.push(successAttempt(source, "已取得路線。"));
    return points;
  } catch (error) {
    const providerError = asProviderError(error);
    attempts.push({
      source,
      status: "failed",
      code: providerError.code,
      message: providerError.message,
      retryable: providerError.retryable,
    });
    return null;
  }
}

function timedAndDense(
  points: GeoPoint[],
  flight: ConfirmedFlight,
  preserveTimes: boolean,
): GeoPoint[] {
  const dense = densifyPoints(points, { maxDistanceMeters: 2_000 });
  if (preserveTimes && dense.every((point) => point.time !== undefined)) {
    return dense;
  }
  return interpolateRouteTimes(
    dense,
    flight.actualDeparture ?? flight.scheduledDeparture,
    flight.actualArrival ?? flight.scheduledArrival,
  );
}

export async function resolveFlightRoute(
  originalFlight: ConfirmedFlight,
  dependencies: ResolveFlightRouteDependencies,
  now = new Date(),
): Promise<ResolveFlightRouteResult> {
  const attempts: RepairAttempt[] = [];
  const originalPolicy = flightRoutePolicy(originalFlight, now);
  let routeFlight = originalFlight;

  if (
    originalPolicy.useRepresentative &&
    dependencies.findRepresentativeFlights
  ) {
    try {
      const candidates =
        await dependencies.findRepresentativeFlights(originalFlight);
      routeFlight =
        selectRepresentativeFlight(originalFlight, candidates) ??
        originalFlight;
    } catch {
      routeFlight = originalFlight;
    }
  }

  const policy = flightRoutePolicy(routeFlight, now);
  let route: SuccessfulRoute | null = null;

  if (policy.tryOpenSky) {
    const points = await attemptRoute(
      "opensky",
      () => dependencies.getOpenSkyTrack(routeFlight),
      attempts,
    );
    if (points) {
      route = {
        points,
        kind: "actual-track",
        source: "opensky",
        approximate: false,
        explanation: "OpenSky 提供的實際航跡。",
      };
    }
  }

  if (route === null) {
    const points = await attemptRoute(
      "aerodatabox",
      () => dependencies.resolveFiledPlan(routeFlight),
      attempts,
    );
    if (points) {
      route = {
        points,
        kind: "filed-plan",
        source: "aerodatabox",
        approximate: true,
        explanation: "依 AeroDataBox 申報航路還原的近似路線。",
      };
    }
  }

  if (route === null) {
    const points = await attemptRoute(
      "flight-plan-database",
      () => dependencies.findSimulatedPlan(routeFlight),
      attempts,
    );
    if (points) {
      route = {
        points,
        kind: "simulated-plan",
        source: "flight-plan-database",
        approximate: true,
        explanation: "Flight Plan Database 的模擬航路，不能用於導航。",
      };
    }
  }

  if (route === null) {
    route = {
      points: [
        routeFlight.departureAirport.point,
        routeFlight.arrivalAirport.point,
      ],
      kind: "great-circle",
      source: "local-calculation",
      approximate: true,
      explanation: "所有航路來源皆無資料，使用本機大圓近似。",
    };
    attempts.push(successAttempt("local-calculation", "已建立本機大圓近似。"));
  }

  const segment: RouteSegment = {
    id: `flight-route:${originalFlight.id}`,
    name: originalFlight.flightNumber,
    mode: "flying",
    points: timedAndDense(
      route.points,
      routeFlight,
      route.kind === "actual-track",
    ),
    provenance: {
      kind: route.kind,
      source: route.source,
      referenceDate: datePart(routeFlight.scheduledDeparture),
      approximate: route.approximate,
      explanation: route.explanation,
    },
  };

  return {
    segment,
    attempts,
    ...(routeFlight.id === originalFlight.id
      ? {}
      : { referenceFlightId: routeFlight.id }),
  };
}
