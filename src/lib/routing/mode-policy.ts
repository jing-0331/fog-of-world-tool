import type { TransportMode } from "@/lib/domain/types";
import type { OpenRouteServiceProfile } from "@/lib/providers/openrouteservice/client";

export type RoutePolicy =
  | {
      provider: "openrouteservice";
      profile: OpenRouteServiceProfile;
    }
  | {
      provider: "transitous";
      transitMode: "RAIL" | "SUBWAY" | "BUS" | "TRAM" | "FERRY";
    };

const POLICIES = {
  walking: { provider: "openrouteservice", profile: "foot-walking" },
  running: { provider: "openrouteservice", profile: "foot-walking" },
  cycling: { provider: "openrouteservice", profile: "cycling-regular" },
  motorcycling: { provider: "openrouteservice", profile: "driving-car" },
  driving: { provider: "openrouteservice", profile: "driving-car" },
  train: { provider: "transitous", transitMode: "RAIL" },
  subway: { provider: "transitous", transitMode: "SUBWAY" },
  bus: { provider: "transitous", transitMode: "BUS" },
  tram: { provider: "transitous", transitMode: "TRAM" },
  ferry: { provider: "transitous", transitMode: "FERRY" },
} as const satisfies Partial<Record<TransportMode, RoutePolicy>>;

export function routePolicy(mode: TransportMode): RoutePolicy | null {
  return mode in POLICIES
    ? POLICIES[mode as keyof typeof POLICIES]
    : null;
}
