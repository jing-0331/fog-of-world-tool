import { describe, expect, it, vi } from "vitest";

import type { ConfirmedFlight, GeoPoint } from "@/lib/domain/types";
import { resolveFlightRoute } from "@/lib/flight/resolve-flight-route";
import { distanceMeters } from "@/lib/geo/distance";
import { buildGpx } from "@/lib/gpx/build-gpx";
import { validateGpx } from "@/lib/gpx/validate-gpx";

const now = new Date("2026-07-23T12:00:00Z");
const route: GeoPoint[] = [
  { lat: 0, lon: 0 },
  { lat: 0.01, lon: 0.025 },
  { lat: 0, lon: 0.05 },
];

describe("resolveFlightRoute", () => {
  it.each([
    {
      winner: "openSky" as const,
      kind: "actual-track",
      source: "opensky",
      approximate: false,
    },
    {
      winner: "filedPlan" as const,
      kind: "filed-plan",
      source: "aerodatabox",
      approximate: true,
    },
    {
      winner: "simulatedPlan" as const,
      kind: "simulated-plan",
      source: "flight-plan-database",
      approximate: true,
    },
  ])(
    "returns provenance when $winner wins the cascade",
    async ({ winner, kind, source, approximate }) => {
      const calls: string[] = [];
      const dependencies = {
        getOpenSkyTrack: vi.fn(async () => {
          calls.push("openSky");
          return winner === "openSky" ? route : null;
        }),
        resolveFiledPlan: vi.fn(async () => {
          calls.push("filedPlan");
          return winner === "filedPlan" ? route : null;
        }),
        findSimulatedPlan: vi.fn(async () => {
          calls.push("simulatedPlan");
          return winner === "simulatedPlan" ? route : null;
        }),
      };

      const result = await resolveFlightRoute(recentFlight(), dependencies, now);

      expect(result.segment.provenance).toMatchObject({
        kind,
        source,
        referenceDate: "2026-07-22",
        approximate,
      });
      expect(result.segment.provenance.explanation.length).toBeGreaterThan(0);
      expect(calls).toEqual(
        ["openSky", "filedPlan", "simulatedPlan"].slice(
          0,
          ["openSky", "filedPlan", "simulatedPlan"].indexOf(winner) + 1,
        ),
      );
    },
  );

  it("falls back to a densified direct line in the exact provider order", async () => {
    const calls: string[] = [];
    const flight = recentFlight();
    flight.departureAirport.point = { lat: 60, lon: 0 };
    flight.arrivalAirport.point = { lat: 60, lon: 0.1 };
    const result = await resolveFlightRoute(
      flight,
      {
        getOpenSkyTrack: vi.fn(async () => {
          calls.push("openSky");
          return null;
        }),
        resolveFiledPlan: vi.fn(async () => {
          calls.push("filedPlan");
          return null;
        }),
        findSimulatedPlan: vi.fn(async () => {
          calls.push("simulatedPlan");
          return null;
        }),
      },
      now,
    );

    expect(calls).toEqual(["openSky", "filedPlan", "simulatedPlan"]);
    expect(result.segment.provenance).toMatchObject({
      kind: "direct-line",
      source: "local-calculation",
      referenceDate: null,
      approximate: true,
    });
    expect(result.segment.points.length).toBeGreaterThan(2);
    expect(
      result.segment.points.every((point) => point.lat === 60),
    ).toBe(true);
    for (let index = 1; index < result.segment.points.length; index += 1) {
      expect(
        distanceMeters(
          result.segment.points[index - 1],
          result.segment.points[index],
        ),
      ).toBeLessThanOrEqual(2_000.001);
    }
    expect(result.attempts.map((attempt) => attempt.source)).toEqual([
      "opensky",
      "aerodatabox",
      "flight-plan-database",
      "local-calculation",
    ]);
  });

  it("keeps a long linear airport fallback valid after GPX serialization", async () => {
    const flight = recentFlight();
    flight.departureAirport.point = { lat: 25.0797, lon: 121.2342 };
    flight.arrivalAirport.point = { lat: 34.4347, lon: 135.244 };
    const result = await resolveFlightRoute(
      flight,
      {
        getOpenSkyTrack: vi.fn().mockResolvedValue(null),
        resolveFiledPlan: vi.fn().mockResolvedValue(null),
        findSimulatedPlan: vi.fn().mockResolvedValue(null),
      },
      now,
    );

    const validation = validateGpx(
      buildGpx({
        name: "Long direct fallback",
        segments: [result.segment],
      }),
    );

    expect(result.segment.provenance.kind).toBe("direct-line");
    expect(validation).toEqual({ valid: true, errors: [] });
  });

  it("skips OpenSky outside the 30-day window", async () => {
    const flight = recentFlight();
    flight.actualArrival = "2026-06-01T12:00:00Z";
    flight.scheduledArrival = flight.actualArrival;
    flight.actualDeparture = "2026-06-01T10:00:00Z";
    flight.scheduledDeparture = flight.actualDeparture;
    const getOpenSkyTrack = vi.fn();

    await resolveFlightRoute(
      flight,
      {
        getOpenSkyTrack,
        resolveFiledPlan: vi.fn().mockResolvedValue(route),
        findSimulatedPlan: vi.fn(),
      },
      now,
    );

    expect(getOpenSkyTrack).not.toHaveBeenCalled();
  });

  it("uses a matching recent representative route after 100 days and shows its date", async () => {
    const original = recentFlight();
    original.actualArrival = "2026-01-01T12:00:00Z";
    original.scheduledArrival = original.actualArrival;
    original.actualDeparture = "2026-01-01T10:00:00Z";
    original.scheduledDeparture = original.actualDeparture;
    const representative = {
      ...recentFlight(),
      id: "representative",
      scheduledDeparture: "2026-07-10T10:00:00Z",
      actualDeparture: "2026-07-10T10:00:00Z",
    };

    const result = await resolveFlightRoute(
      original,
      {
        findRepresentativeFlights: vi.fn().mockResolvedValue([representative]),
        getOpenSkyTrack: vi.fn(),
        resolveFiledPlan: vi.fn().mockResolvedValue(route),
        findSimulatedPlan: vi.fn(),
      },
      now,
    );

    expect(result.segment.provenance.referenceDate).toBe("2026-07-10");
    expect(result.referenceFlightId).toBe("representative");
  });
});

function recentFlight(): ConfirmedFlight {
  return {
    id: "recent-flight",
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
    scheduledDeparture: "2026-07-22T10:00:00Z",
    scheduledArrival: "2026-07-22T12:00:00Z",
    actualDeparture: "2026-07-22T10:00:00Z",
    actualArrival: "2026-07-22T12:00:00Z",
    durationMinutes: 120,
    aircraftIcao24: "ABC123",
    filedRoute: "TORG FIX TDST",
    confirmedAt: "2026-07-22T13:00:00Z",
  };
}
