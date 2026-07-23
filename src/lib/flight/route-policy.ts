import type { ConfirmedFlight } from "@/lib/domain/types";

const DAY_MILLISECONDS = 86_400_000;
const COMPLETED_STATUSES = new Set(["Arrived"]);

export interface FlightRoutePolicy {
  ageDays: number;
  completed: boolean;
  tryOpenSky: boolean;
  useRepresentative: boolean;
}

function routeEndpoint(flight: ConfirmedFlight, side: "departure" | "arrival") {
  const airport =
    side === "departure" ? flight.departureAirport : flight.arrivalAirport;
  return (airport.icao ?? airport.iata ?? "").toUpperCase();
}

export function flightRoutePolicy(
  flight: ConfirmedFlight,
  now = new Date(),
): FlightRoutePolicy {
  const arrivalTime = Date.parse(
    flight.actualArrival ?? flight.scheduledArrival,
  );
  const ageDays = Math.floor((now.getTime() - arrivalTime) / DAY_MILLISECONDS);
  const completed =
    COMPLETED_STATUSES.has(flight.status) &&
    Number.isFinite(arrivalTime) &&
    ageDays >= 0;

  return {
    ageDays,
    completed,
    tryOpenSky:
      completed &&
      ageDays <= 30 &&
      flight.aircraftIcao24 !== undefined,
    useRepresentative: completed && ageDays > 100,
  };
}

export function selectRepresentativeFlight(
  original: ConfirmedFlight,
  candidates: ConfirmedFlight[],
): ConfirmedFlight | null {
  const number = original.flightNumber.replaceAll(/\s+/g, "").toUpperCase();
  const origin = routeEndpoint(original, "departure");
  const destination = routeEndpoint(original, "arrival");

  return (
    candidates
      .filter(
        (candidate) =>
          candidate.flightNumber.replaceAll(/\s+/g, "").toUpperCase() ===
            number &&
          routeEndpoint(candidate, "departure") === origin &&
          routeEndpoint(candidate, "arrival") === destination,
      )
      .sort(
        (a, b) =>
          Date.parse(b.actualDeparture ?? b.scheduledDeparture) -
          Date.parse(a.actualDeparture ?? a.scheduledDeparture),
      )[0] ?? null
  );
}
