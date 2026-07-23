import type {
  Airport,
  FlightCandidate,
} from "@/lib/domain/types";
import {
  aeroDataBoxFlightListSchema,
  type AeroDataBoxAirport,
  type AeroDataBoxFlight,
} from "@/lib/providers/aerodatabox/schemas";

function normalizeCode(value: string | null | undefined): string | undefined {
  const normalized = value?.trim().toUpperCase();
  return normalized ? normalized : undefined;
}

export function mapAeroDataBoxAirport(
  airport: AeroDataBoxAirport,
): Airport | null {
  if (airport.location === undefined) {
    return null;
  }

  return {
    name: airport.name,
    city: airport.municipalityName?.trim() || airport.name,
    ...(normalizeCode(airport.iata)
      ? { iata: normalizeCode(airport.iata) }
      : {}),
    ...(normalizeCode(airport.icao)
      ? { icao: normalizeCode(airport.icao) }
      : {}),
    point: {
      lat: airport.location.lat,
      lon: airport.location.lon,
    },
  };
}

function durationMinutes(start: string, end: string): number | null {
  const difference = Date.parse(end) - Date.parse(start);
  return Number.isFinite(difference) && difference >= 0
    ? Math.round(difference / 60_000)
    : null;
}

function mapFlight(
  flight: AeroDataBoxFlight,
  departureDate?: string,
): FlightCandidate | null {
  const scheduledDeparture = flight.departure.scheduledTime?.local;
  const scheduledArrival = flight.arrival.scheduledTime?.local;
  if (
    scheduledDeparture === undefined ||
    scheduledArrival === undefined ||
    (departureDate !== undefined &&
      scheduledDeparture.slice(0, 10) !== departureDate)
  ) {
    return null;
  }

  const departureAirport = mapAeroDataBoxAirport(flight.departure.airport);
  const arrivalAirport = mapAeroDataBoxAirport(flight.arrival.airport);
  if (departureAirport === null || arrivalAirport === null) {
    return null;
  }

  const actualDeparture =
    flight.departure.runwayTime?.local ?? flight.departure.revisedTime?.local;
  const actualArrival =
    flight.arrival.runwayTime?.local ?? flight.arrival.revisedTime?.local;
  const actualDuration =
    actualDeparture !== undefined && actualArrival !== undefined
      ? durationMinutes(actualDeparture, actualArrival)
      : null;
  const scheduledDuration = durationMinutes(
    scheduledDeparture,
    scheduledArrival,
  );
  if (actualDuration === null && scheduledDuration === null) {
    return null;
  }

  const flightNumber = flight.number.replaceAll(/\s+/g, "").toUpperCase();
  const departureCode =
    departureAirport.icao ?? departureAirport.iata ?? departureAirport.name;
  const arrivalCode =
    arrivalAirport.icao ?? arrivalAirport.iata ?? arrivalAirport.name;

  return {
    id: [
      flightNumber,
      flight.departure.scheduledTime?.utc,
      departureCode,
      arrivalCode,
    ].join(":"),
    flightNumber,
    status: flight.status,
    canceled:
      flight.status === "Canceled" || flight.status === "CanceledUncertain",
    departureAirport,
    arrivalAirport,
    scheduledDeparture,
    scheduledArrival,
    ...(actualDeparture ? { actualDeparture } : {}),
    ...(actualArrival ? { actualArrival } : {}),
    durationMinutes: actualDuration ?? scheduledDuration!,
    ...(flight.aircraft?.modeS
      ? { aircraftIcao24: flight.aircraft.modeS.toUpperCase() }
      : {}),
    ...(flight.flightPlan?.route
      ? { filedRoute: flight.flightPlan.route }
      : {}),
  };
}

export function mapAeroDataBoxFlights(
  raw: unknown,
  departureDate: string,
): FlightCandidate[] {
  return aeroDataBoxFlightListSchema
    .parse(raw)
    .map((flight) => mapFlight(flight, departureDate))
    .filter((flight): flight is FlightCandidate => flight !== null);
}

export function mapAeroDataBoxFlightHistory(raw: unknown): FlightCandidate[] {
  return aeroDataBoxFlightListSchema
    .parse(raw)
    .map((flight) => mapFlight(flight))
    .filter((flight): flight is FlightCandidate => flight !== null);
}
