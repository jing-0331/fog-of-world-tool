import { describe, expect, it, vi } from "vitest";

import {
  createResolveRouteHandler,
  getOpenSkyTrackForFlight,
} from "@/app/api/flights/resolve-route/route";

describe("POST /api/flights/resolve-route", () => {
  it("asks OpenSky to identify a recent completed flight when ICAO24 is absent", async () => {
    const flight = validFlight();
    flight.flightNumber = "IT288";
    const getFlightTrack = vi.fn().mockResolvedValue([
      flight.departureAirport.point,
      flight.arrivalAirport.point,
    ]);

    await getOpenSkyTrackForFlight({ getFlightTrack }, flight);

    expect(getFlightTrack).toHaveBeenCalledWith({
      flightNumber: "IT288",
      departureTimeSeconds: Date.parse(flight.actualDeparture) / 1_000,
      arrivalTimeSeconds: Date.parse(flight.actualArrival) / 1_000,
      originAirportIcao: "TORG",
      destinationAirportIcao: "TDST",
      origin: flight.departureAirport.point,
      destination: flight.arrivalAirport.point,
    });
  });

  it("rejects invalid flight input before resolution", async () => {
    const resolve = vi.fn();
    const response = await createResolveRouteHandler(resolve)(
      request({ flight: { flightNumber: "AB123" } }),
    );

    expect(response.status).toBe(400);
    expect(resolve).not.toHaveBeenCalled();
  });

  it("returns the normalized route and safe attempts", async () => {
    const resolved = {
      segment: {
        id: "flight-route",
        name: "AB123",
        mode: "flying",
        points: [
          { lat: 0, lon: 0 },
          { lat: 0, lon: 0.01 },
        ],
        provenance: {
          kind: "direct-line",
          source: "local-calculation",
          referenceDate: null,
          approximate: true,
          explanation: "Direct fallback",
        },
      },
      attempts: [],
    };
    const resolve = vi.fn().mockResolvedValue(resolved);

    const response = await createResolveRouteHandler(resolve)(
      request({ flight: validFlight() }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: resolved });
  });
});

function request(body: unknown): Request {
  return new Request("http://localhost/api/flights/resolve-route", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function validFlight() {
  return {
    id: "flight",
    flightNumber: "AB123",
    status: "Arrived",
    canceled: false,
    departureAirport: {
      name: "Synthetic Origin",
      city: "Origin City",
      icao: "TORG",
      point: { lat: 0, lon: 0 },
    },
    arrivalAirport: {
      name: "Synthetic Destination",
      city: "Destination City",
      icao: "TDST",
      point: { lat: 0, lon: 0.05 },
    },
    scheduledDeparture: "2026-07-22T10:00:00Z",
    scheduledArrival: "2026-07-22T12:00:00Z",
    actualDeparture: "2026-07-22T10:00:00Z",
    actualArrival: "2026-07-22T12:00:00Z",
    durationMinutes: 120,
    confirmedAt: "2026-07-22T13:00:00Z",
  };
}
