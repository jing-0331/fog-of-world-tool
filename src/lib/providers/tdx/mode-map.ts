import type {
  PublicTransitMode,
  TransportMode,
} from "@/lib/domain/types";

const TRANSIT_CODES: Record<PublicTransitMode, string> = {
  transit: "3,4,5,6,7,8,9",
  train: "3,4",
  rail: "3,4",
  "taiwan-rail": "3",
  "high-speed-rail": "4",
  "long-distance-rail": "3",
  "night-rail": "3",
  "regional-rail": "3",
  "suburban-rail": "3",
  subway: "6",
  bus: "5",
  coach: "5",
  tram: "7",
  ferry: "8",
  funicular: "9",
  "aerial-lift": "9",
  "other-transit": "3,4,5,6,7,8,9",
};
const TRANSIT_CODES_BY_MODE: Partial<
  Record<TransportMode, string>
> = TRANSIT_CODES;

export function tdxTransitCodeFor(
  mode: PublicTransitMode,
): string;
export function tdxTransitCodeFor(
  mode: TransportMode,
): string | null;
export function tdxTransitCodeFor(
  mode: TransportMode,
): string | null {
  return TRANSIT_CODES_BY_MODE[mode] ?? null;
}
