import type {
  PublicTransitMode,
  TransportMode,
} from "@/lib/domain/types";

export type TransitousMode =
  | "TRANSIT"
  | "TRAM"
  | "SUBWAY"
  | "FERRY"
  | "BUS"
  | "COACH"
  | "RAIL"
  | "HIGHSPEED_RAIL"
  | "LONG_DISTANCE"
  | "NIGHT_RAIL"
  | "REGIONAL_RAIL"
  | "SUBURBAN"
  | "FUNICULAR"
  | "AERIAL_LIFT"
  | "OTHER";

const TRANSIT_MODES: Record<
  PublicTransitMode,
  TransitousMode
> = {
  transit: "TRANSIT",
  train: "RAIL",
  rail: "RAIL",
  "taiwan-rail": "RAIL",
  "high-speed-rail": "HIGHSPEED_RAIL",
  "long-distance-rail": "LONG_DISTANCE",
  "night-rail": "NIGHT_RAIL",
  "regional-rail": "REGIONAL_RAIL",
  "suburban-rail": "SUBURBAN",
  subway: "SUBWAY",
  bus: "BUS",
  coach: "COACH",
  tram: "TRAM",
  ferry: "FERRY",
  funicular: "FUNICULAR",
  "aerial-lift": "AERIAL_LIFT",
  "other-transit": "OTHER",
};
const TRANSIT_MODES_BY_MODE: Partial<
  Record<TransportMode, TransitousMode>
> = TRANSIT_MODES;

export function transitousModeFor(
  mode: PublicTransitMode,
): TransitousMode;
export function transitousModeFor(
  mode: TransportMode,
): TransitousMode | null;
export function transitousModeFor(
  mode: TransportMode,
): TransitousMode | null {
  return TRANSIT_MODES_BY_MODE[mode] ?? null;
}
