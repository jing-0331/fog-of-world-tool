import { describe, expect, it, vi } from "vitest";

import {
  createAeroDataBoxClient,
  normalizeFlightNumber,
} from "@/lib/providers/aerodatabox/client";
import { mapAeroDataBoxFlights } from "@/lib/providers/aerodatabox/map-flight";

const syntheticFlights = [
  {
    number: "ab 123",
    status: "Arrived",
    codeshareStatus: "IsOperator",
    isCargo: false,
    lastUpdatedUtc: "2026-06-01T20:00:00Z",
    departure: {
      airport: {
        name: "Synthetic East Airport",
        municipalityName: "East City",
        iata: "EAS",
        icao: "TEST",
        location: { lat: 10, lon: 20 },
      },
      scheduledTime: {
        local: "2026-06-01T23:30:00+08:00",
        utc: "2026-06-01T15:30:00Z",
      },
      revisedTime: {
        local: "2026-06-01T23:45:00+08:00",
        utc: "2026-06-01T15:45:00Z",
      },
      quality: ["Basic", "Live"],
    },
    arrival: {
      airport: {
        name: "Synthetic North Airport",
        municipalityName: "North City",
        iata: "NOR",
        icao: "TSTN",
        location: { lat: 30, lon: 40 },
      },
      scheduledTime: {
        local: "2026-06-02T03:00:00+09:00",
        utc: "2026-06-01T18:00:00Z",
      },
      revisedTime: {
        local: "2026-06-02T03:10:00+09:00",
        utc: "2026-06-01T18:10:00Z",
      },
      quality: ["Basic", "Live"],
    },
    aircraft: { modeS: "abc123" },
    flightPlan: {
      route: "TEST SYNTH TSTN",
      lastUpdatedUtc: "2026-06-01T14:00:00Z",
    },
  },
  {
    number: "xy 999",
    status: "Canceled",
    codeshareStatus: "IsCodeshared",
    isCargo: false,
    lastUpdatedUtc: "2026-06-01T10:00:00Z",
    departure: {
      airport: {
        name: "Synthetic East Airport",
        municipalityName: "East City",
        iata: "EAS",
        icao: "TEST",
        location: { lat: 10, lon: 20 },
      },
      scheduledTime: {
        local: "2026-06-01T12:00:00+08:00",
        utc: "2026-06-01T04:00:00Z",
      },
      quality: ["Basic"],
    },
    arrival: {
      airport: {
        name: "Synthetic North Airport",
        municipalityName: "North City",
        iata: "NOR",
        icao: "TSTN",
        location: { lat: 30, lon: 40 },
      },
      scheduledTime: {
        local: "2026-06-01T16:00:00+09:00",
        utc: "2026-06-01T07:00:00Z",
      },
      quality: ["Basic"],
    },
  },
  {
    number: "AB123",
    status: "Expected",
    codeshareStatus: "Unknown",
    isCargo: false,
    lastUpdatedUtc: "2026-06-01T10:00:00Z",
    departure: {
      airport: {
        name: "Synthetic East Airport",
        municipalityName: "East City",
        location: { lat: 10, lon: 20 },
      },
      scheduledTime: {
        local: "2026-06-02T09:00:00+08:00",
        utc: "2026-06-02T01:00:00Z",
      },
      quality: ["Basic"],
    },
    arrival: {
      airport: {
        name: "Synthetic North Airport",
        municipalityName: "North City",
        location: { lat: 30, lon: 40 },
      },
      scheduledTime: {
        local: "2026-06-02T13:00:00+09:00",
        utc: "2026-06-02T04:00:00Z",
      },
      quality: ["Basic"],
    },
  },
];

describe("mapAeroDataBoxFlights", () => {
  it("normalizes numbers and filters by departure-local date", () => {
    const candidates = mapAeroDataBoxFlights(syntheticFlights, "2026-06-01");

    expect(candidates.map((candidate) => candidate.flightNumber)).toEqual([
      "AB123",
      "XY999",
    ]);
  });

  it("preserves airport identity, local offsets, and distinct actual times", () => {
    const [candidate] = mapAeroDataBoxFlights(
      syntheticFlights,
      "2026-06-01",
    );

    expect(candidate.departureAirport).toEqual({
      name: "Synthetic East Airport",
      city: "East City",
      iata: "EAS",
      icao: "TEST",
      point: { lat: 10, lon: 20 },
    });
    expect(candidate.scheduledDeparture).toBe(
      "2026-06-01T23:30:00+08:00",
    );
    expect(candidate.actualDeparture).toBe("2026-06-01T23:45:00+08:00");
    expect(candidate.actualArrival).toBe("2026-06-02T03:10:00+09:00");
    expect(candidate.durationMinutes).toBe(145);
    expect(candidate.aircraftIcao24).toBe("ABC123");
    expect(candidate.filedRoute).toBe("TEST SYNTH TSTN");
  });

  it("uses scheduled times when actual times are incomplete and marks cancellations", () => {
    const candidate = mapAeroDataBoxFlights(
      syntheticFlights,
      "2026-06-01",
    )[1];

    expect(candidate.canceled).toBe(true);
    expect(candidate.actualDeparture).toBeUndefined();
    expect(candidate.durationMinutes).toBe(180);
  });

  it("allows local-offset times to convert to UTC for GPX", () => {
    const [candidate] = mapAeroDataBoxFlights(
      syntheticFlights,
      "2026-06-01",
    );

    expect(new Date(candidate.actualDeparture!).toISOString()).toBe(
      "2026-06-01T15:45:00.000Z",
    );
  });
});

describe("AeroDataBox client", () => {
  it("calls the official specific-date endpoint with departure-local role", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(syntheticFlights), { status: 200 }),
      );
    const client = createAeroDataBoxClient({
      apiKey: "test-key",
      fetchFn,
    });

    const candidates = await client.searchFlights("ab 123", "2026-06-01");

    expect(candidates).toHaveLength(2);
    const [url, init] = fetchFn.mock.calls[0];
    expect(String(url)).toContain(
      "/flights/Number/AB123/2026-06-01?dateLocalRole=Departure",
    );
    expect(init.headers).toMatchObject({
      "X-RapidAPI-Key": "test-key",
      "X-RapidAPI-Host": "aerodatabox.p.rapidapi.com",
    });
  });

  it("returns no_data when the provider has no candidates", async () => {
    const client = createAeroDataBoxClient({
      apiKey: "test-key",
      fetchFn: vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify([]), { status: 200 })),
    });

    await expect(client.searchFlights("AB123", "2026-06-01")).rejects.toMatchObject(
      { code: "no_data" },
    );
  });

  it("searches airports by code or name and maps only usable locations", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          searchBy: "east",
          count: 2,
          items: [
            {
              name: "Synthetic East Airport",
              municipalityName: "East City",
              iata: "EAS",
              icao: "TEST",
              location: { lat: 10, lon: 20 },
            },
            {
              name: "No Coordinate Airport",
              municipalityName: "Nowhere",
              iata: "NON",
              icao: "NONE",
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const client = createAeroDataBoxClient({
      apiKey: "test-key",
      fetchFn,
    });

    await expect(client.searchAirports(" EAS ")).resolves.toEqual([
      {
        name: "Synthetic East Airport",
        city: "East City",
        iata: "EAS",
        icao: "TEST",
        point: { lat: 10, lon: 20 },
      },
    ]);
    expect(String(fetchFn.mock.calls[0][0])).toContain(
      "/airports/search/term?q=EAS&limit=10",
    );
  });

  it("searches a date range for representative same-number flights", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(syntheticFlights), { status: 200 }),
      );
    const client = createAeroDataBoxClient({
      apiKey: "test-key",
      fetchFn,
    });

    const candidates = await client.searchFlightHistory(
      "AB123",
      "2026-06-01",
      "2026-07-23",
    );

    expect(candidates).toHaveLength(3);
    expect(String(fetchFn.mock.calls[0][0])).toContain(
      "/flights/Number/AB123/2026-06-01/2026-07-23?dateLocalRole=Departure",
    );
  });
});

describe("normalizeFlightNumber", () => {
  it("uppercases and removes whitespace", () => {
    expect(normalizeFlightNumber(" ab  123 ")).toBe("AB123");
  });
});
