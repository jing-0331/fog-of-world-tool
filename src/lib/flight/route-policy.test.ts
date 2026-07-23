import { describe, expect, it } from "vitest";

import type { ConfirmedFlight } from "@/lib/domain/types";
import {
  flightRoutePolicy,
  selectRepresentativeFlight,
} from "@/lib/flight/route-policy";

const now = new Date("2026-07-23T12:00:00Z");

describe("flightRoutePolicy", () => {
  it.each([
    [30, true, false],
    [31, false, false],
    [100, false, false],
    [101, false, true],
  ])(
    "applies the exact boundary at age %s days",
    (ageDays, tryOpenSky, useRepresentative) => {
      const flight = flightAtAge(ageDays);

      expect(flightRoutePolicy(flight, now)).toMatchObject({
        ageDays,
        tryOpenSky,
        useRepresentative,
      });
    },
  );

  it("never tries OpenSky for a future flight", () => {
    const flight = flightAtAge(-1);
    flight.status = "Expected";

    expect(flightRoutePolicy(flight, now).tryOpenSky).toBe(false);
  });

  it("requires a completed flight and ICAO24 for OpenSky", () => {
    const incomplete = flightAtAge(1);
    incomplete.status = "EnRoute";
    const noAircraft = flightAtAge(1);
    delete noAircraft.aircraftIcao24;

    expect(flightRoutePolicy(incomplete, now).tryOpenSky).toBe(false);
    expect(flightRoutePolicy(noAircraft, now).tryOpenSky).toBe(false);
  });

  it("tries OpenSky for a departed flight after its scheduled arrival", () => {
    const flight = flightAtAge(3);
    flight.flightNumber = "IT289";
    flight.status = "Departed";
    delete flight.actualDeparture;
    delete flight.actualArrival;

    expect(flightRoutePolicy(flight, now)).toMatchObject({
      ageDays: 3,
      completed: true,
      tryOpenSky: true,
    });
  });
});

describe("selectRepresentativeFlight", () => {
  it("chooses the newest same-number route with identical endpoints", () => {
    const original = flightAtAge(120);
    const wrongDestination = {
      ...flightAtAge(5),
      id: "wrong-destination",
      arrivalAirport: {
        ...original.arrivalAirport,
        icao: "WRNG",
      },
    };
    const olderMatch = {
      ...flightAtAge(8),
      id: "older-match",
    };
    const newestMatch = {
      ...flightAtAge(3),
      id: "newest-match",
    };

    expect(
      selectRepresentativeFlight(original, [
        wrongDestination,
        olderMatch,
        newestMatch,
      ])?.id,
    ).toBe("newest-match");
  });
});

function flightAtAge(ageDays: number): ConfirmedFlight {
  const arrival = new Date(now.getTime() - ageDays * 86_400_000);
  const departure = new Date(arrival.getTime() - 2 * 3_600_000);
  return {
    id: `flight-${ageDays}`,
    flightNumber: "AB123",
    status: "Arrived",
    canceled: false,
    departureAirport: {
      name: "Synthetic Origin",
      city: "Origin City",
      iata: "ORG",
      icao: "TORG",
      point: { lat: 0, lon: 0 },
    },
    arrivalAirport: {
      name: "Synthetic Destination",
      city: "Destination City",
      iata: "DST",
      icao: "TDST",
      point: { lat: 0, lon: 0.05 },
    },
    scheduledDeparture: departure.toISOString(),
    scheduledArrival: arrival.toISOString(),
    actualDeparture: departure.toISOString(),
    actualArrival: arrival.toISOString(),
    durationMinutes: 120,
    aircraftIcao24: "ABC123",
    filedRoute: "TORG FIX TDST",
    confirmedAt: now.toISOString(),
  };
}
