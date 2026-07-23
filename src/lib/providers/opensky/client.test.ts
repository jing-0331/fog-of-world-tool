import { describe, expect, it, vi } from "vitest";

import { distanceMeters } from "@/lib/geo/distance";
import { createOpenSkyClient } from "@/lib/providers/opensky/client";

describe("OpenSky client", () => {
  it("uses OAuth client credentials and maps the official track tuple", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: "token", expires_in: 1800 }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            icao24: "abc123",
            startTime: 1_769_000_000,
            endTime: 1_769_000_600,
            path: [
              [1_769_000_000, 0, 0, 100, 90, false],
              [1_769_000_600, 0, 0.05, 200, 90, false],
            ],
          }),
          { status: 200 },
        ),
      );
    const client = createOpenSkyClient({
      clientId: "client-id",
      clientSecret: "client-secret",
      fetchFn,
    });

    const points = await client.getTrack({
      icao24: "ABC123",
      timestampSeconds: 1_769_000_300,
      origin: { lat: 0, lon: 0 },
      destination: { lat: 0, lon: 0.05 },
    });

    expect(points[0]).toMatchObject({
      lat: 0,
      lon: 0,
      time: new Date(1_769_000_000_000).toISOString(),
      elevationMeters: 100,
    });
    expect(
      points.some(
        (point) => point.time === new Date(1_769_000_600_000).toISOString(),
      ),
    ).toBe(true);
    for (let index = 1; index < points.length; index += 1) {
      expect(distanceMeters(points[index - 1], points[index])).toBeLessThanOrEqual(
        2_000.001,
      );
    }

    const tokenCall = fetchFn.mock.calls[0];
    expect(String(tokenCall[0])).toContain("/openid-connect/token");
    expect(String(tokenCall[1].body)).toContain("grant_type=client_credentials");
    const trackCall = fetchFn.mock.calls[1];
    expect(String(trackCall[0])).toContain(
      "/api/tracks/all?icao24=abc123&time=1769000300",
    );
    expect(trackCall[1].headers).toMatchObject({
      Authorization: "Bearer token",
    });
  });

  it("rejects a track whose endpoints are implausibly far from confirmed airports", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: "token", expires_in: 1800 }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            icao24: "abc123",
            startTime: 1,
            endTime: 2,
            path: [
              [1, 30, 30, 100, 90, false],
              [2, 31, 31, 100, 90, false],
            ],
          }),
          { status: 200 },
        ),
      );
    const client = createOpenSkyClient({
      clientId: "client-id",
      clientSecret: "client-secret",
      fetchFn,
    });

    await expect(
      client.getTrack({
        icao24: "ABC123",
        timestampSeconds: 1,
        origin: { lat: 0, lon: 0 },
        destination: { lat: 0, lon: 0.05 },
      }),
    ).rejects.toMatchObject({ code: "no_data" });
  });

  it("extracts the matching direction from a combined round-trip track", async () => {
    const origin = { lat: 26.1958, lon: 127.6459 };
    const destination = { lat: 22.5755, lon: 120.3508 };
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: "token", expires_in: 1800 }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            icao24: "89902c",
            startTime: 1_784_599_575,
            endTime: 1_784_615_654,
            path: [
              [1_784_599_575, destination.lat, destination.lon, 0, 0, true],
              [1_784_603_000, 24.5, 124, 10_000, 45, false],
              [1_784_607_000, origin.lat, origin.lon, 0, 90, true],
              [1_784_611_000, 24.5, 124, 10_000, 225, false],
              [1_784_615_654, destination.lat, destination.lon, 0, 270, true],
            ],
          }),
          { status: 200 },
        ),
      );
    const client = createOpenSkyClient({
      clientId: "client-id",
      clientSecret: "client-secret",
      fetchFn,
    });

    const points = await client.getTrack({
      icao24: "89902C",
      timestampSeconds: 1_784_611_000,
      origin,
      destination,
    });

    expect(points[0]).toMatchObject({
      lat: origin.lat,
      lon: origin.lon,
      time: new Date(1_784_607_000_000).toISOString(),
    });
    expect(points.at(-1)).toMatchObject({
      lat: destination.lat,
      lon: destination.lon,
      time: new Date(1_784_615_654_000).toISOString(),
    });
    expect(
      points.some(
        (point) =>
          point.time === new Date(1_784_599_575_000).toISOString(),
      ),
    ).toBe(false);
  });
});
