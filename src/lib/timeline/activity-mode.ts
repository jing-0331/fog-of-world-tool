import type { TransportMode } from "@/lib/domain/types";

const GOOGLE_ACTIVITY_MODES = {
  WALKING: "walking",
  RUNNING: "running",
  CYCLING: "cycling",
  MOTORCYCLING: "motorcycling",
  IN_PASSENGER_VEHICLE: "driving",
  IN_TRAIN: "train",
  IN_SUBWAY: "subway",
  IN_BUS: "bus",
  IN_TRAM: "tram",
  IN_FERRY: "ferry",
  FLYING: "flying",
} as const satisfies Record<string, TransportMode>;

export function activityMode(googleType: string | undefined): TransportMode {
  if (googleType && googleType in GOOGLE_ACTIVITY_MODES) {
    return GOOGLE_ACTIVITY_MODES[
      googleType as keyof typeof GOOGLE_ACTIVITY_MODES
    ];
  }
  return "unknown";
}
