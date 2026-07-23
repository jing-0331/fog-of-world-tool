import { describe, expect, it, vi } from "vitest";

import type { FlightCandidate } from "@/lib/domain/types";
import { createFlightSearchHandler } from "@/app/api/flights/search/route";

describe("POST /api/flights/search", () => {
  it.each([
    { flightNumber: "", departureDate: "2026-06-01" },
    { flightNumber: "not a flight", departureDate: "2026-06-01" },
    { flightNumber: "AB123", departureDate: "2026-02-30" },
    { flightNumber: "AB123", departureDate: "06/01/2026" },
  ])("rejects malformed input before provider calls", async (body) => {
    const searchFlights = vi.fn();
    const handler = createFlightSearchHandler(searchFlights);

    const response = await handler(request(body));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "invalid_request", retryable: false },
    });
    expect(searchFlights).not.toHaveBeenCalled();
  });

  it("returns normalized candidates in a data envelope", async () => {
    const candidate = syntheticCandidate();
    const searchFlights = vi.fn().mockResolvedValue([candidate]);
    const handler = createFlightSearchHandler(searchFlights);

    const response = await handler(
      request({ flightNumber: "ab 123", departureDate: "2026-06-01" }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: [candidate] });
    expect(searchFlights).toHaveBeenCalledWith("AB123", "2026-06-01");
  });

  it("uses the safe provider error envelope", async () => {
    const searchFlights = vi.fn().mockRejectedValue(
      Object.assign(new Error("No matching flights"), {
        code: "no_data",
        retryable: false,
      }),
    );
    const handler = createFlightSearchHandler(searchFlights);

    const response = await handler(
      request({ flightNumber: "AB123", departureDate: "2026-06-01" }),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: {
        code: "no_data",
        message: "No matching flights",
        retryable: false,
      },
    });
  });
});

function request(body: unknown): Request {
  return new Request("http://localhost/api/flights/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function syntheticCandidate(): FlightCandidate {
  return {
    id: "AB123-20260601",
    flightNumber: "AB123",
    status: "Arrived",
    canceled: false,
    departureAirport: {
      name: "Synthetic East",
      city: "East City",
      iata: "EAS",
      icao: "TEST",
      point: { lat: 10, lon: 20 },
    },
    arrivalAirport: {
      name: "Synthetic North",
      city: "North City",
      iata: "NOR",
      icao: "TSTN",
      point: { lat: 30, lon: 40 },
    },
    scheduledDeparture: "2026-06-01T10:00:00+08:00",
    scheduledArrival: "2026-06-01T14:00:00+09:00",
    durationMinutes: 180,
  };
}
