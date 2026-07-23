import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useFlightSession } from "@/lib/flight/use-flight-session";

describe("useFlightSession", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("persists only a versioned confirmed-flight list", async () => {
    const { result } = renderHook(() => useFlightSession());

    act(() => result.current.addFlight(flight()));

    await waitFor(() =>
      expect(
        JSON.parse(
          sessionStorage.getItem("fog-of-world:confirmed-flights") ?? "{}",
        ),
      ).toEqual({ version: 1, flights: [flight()] }),
    );
  });

  it("discards invalid stored versions", async () => {
    sessionStorage.setItem(
      "fog-of-world:confirmed-flights",
      JSON.stringify({ version: 99, flights: [{ secret: "bad" }] }),
    );

    const { result } = renderHook(() => useFlightSession());

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.flights).toEqual([]);
    expect(
      sessionStorage.getItem("fog-of-world:confirmed-flights"),
    ).toBeNull();
  });
});

function flight() {
  return {
    id: "AB123-synthetic",
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
    scheduledDeparture: "2026-06-01T10:00:00+08:00",
    scheduledArrival: "2026-06-01T14:00:00+09:00",
    durationMinutes: 180,
    confirmedAt: "2026-06-01T15:00:00Z",
  };
}
