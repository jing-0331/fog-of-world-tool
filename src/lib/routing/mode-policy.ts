import {
  GENERAL_ROUTE_MODES,
  PUBLIC_TRANSIT_MODES,
  type GeneralRouteMode,
  type GeoPoint,
  type PublicTransitMode,
  type TransportMode,
} from "@/lib/domain/types";
import { isTaiwanPoint } from "@/lib/geo/taiwan";
import {
  openRouteServiceProfileFor,
  type OpenRouteServiceProfile,
} from "@/lib/providers/openrouteservice/mode-map";
import {
  transitousModeFor,
  type TransitousMode,
} from "@/lib/providers/transitous/mode-map";

export type RoutePolicy =
  | {
      provider: "openrouteservice";
      profile: OpenRouteServiceProfile;
    }
  | {
      provider: "tdx" | "transitous";
      transitMode: TransitousMode;
    };

export type ModeFamily =
  | "general"
  | "public-transit"
  | "flight";

export function modeFamily(mode: TransportMode): ModeFamily {
  if (mode === "flying") {
    return "flight";
  }
  return isPublicTransitMode(mode)
    ? "public-transit"
    : "general";
}

export function isPublicTransitMode(
  mode: TransportMode,
): mode is PublicTransitMode {
  return PUBLIC_TRANSIT_MODES.some(
    (candidate) => candidate === mode,
  );
}

function isGeneralRouteMode(
  mode: TransportMode,
): mode is GeneralRouteMode {
  return GENERAL_ROUTE_MODES.some(
    (candidate) => candidate === mode,
  );
}

export function routePolicy(
  mode: TransportMode,
  startPoint?: GeoPoint,
  endPoint?: GeoPoint,
): RoutePolicy | null {
  if (isGeneralRouteMode(mode)) {
    return {
      provider: "openrouteservice",
      profile: openRouteServiceProfileFor(mode),
    };
  }
  const transitMode = transitousModeFor(mode);
  if (transitMode === null) {
    return null;
  }
  if (
    startPoint !== undefined &&
    endPoint !== undefined &&
    isTaiwanPoint(startPoint) &&
    isTaiwanPoint(endPoint)
  ) {
    return { provider: "tdx", transitMode };
  }
  return { provider: "transitous", transitMode };
}
