import type { TransportMode } from "@/lib/domain/types";

const MIN_PROBABLE_FLIGHT_DISTANCE_METERS = 100_000;
const MIN_PROBABLE_FLIGHT_SPEED_KPH = 250;

export type FlightDetection = "explicit" | "probable" | "none";

export interface FlightDetectionInput {
  mode: TransportMode;
  distanceMeters: number;
  elapsedMilliseconds: number;
  landOrTransitRoutingFailed: boolean;
}

export function detectFlight(input: FlightDetectionInput): FlightDetection {
  if (input.mode === "flying") {
    return "explicit";
  }
  if (
    !input.landOrTransitRoutingFailed ||
    input.distanceMeters < MIN_PROBABLE_FLIGHT_DISTANCE_METERS ||
    input.elapsedMilliseconds <= 0
  ) {
    return "none";
  }

  const speedKph =
    input.distanceMeters / 1_000 / (input.elapsedMilliseconds / 3_600_000);
  return speedKph >= MIN_PROBABLE_FLIGHT_SPEED_KPH ? "probable" : "none";
}
