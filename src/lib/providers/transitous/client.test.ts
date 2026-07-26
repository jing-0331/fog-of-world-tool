import polyline from "@mapbox/polyline";
import { describe, expect, it, vi } from "vitest";

import { createTransitousClient } from "@/lib/providers/transitous/client";
import { ProviderError } from "@/lib/server/provider-error";

describe("Transitous client", () => {
  it("requires a non-placeholder contact URL", () => {
    expect(() =>
      createTransitousClient({
        contactUrl: "https://github.com/YOUR_ACCOUNT/YOUR_REPOSITORY",
      }),
    ).toThrow(ProviderError);
  });

  it("calls the current production MOTIS endpoint with current time and walking access", async () => {
    const encoded = polyline.encode(
      [
        [25, 121.5],
        [25.1, 121.6],
      ],
      6,
    );
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        itineraries: [
          {
            legs: [
              {
                legGeometry: {
                  points: encoded,
                  precision: 6,
                  length: 2,
                },
              },
            ],
          },
        ],
      }),
    );
    const now = new Date("2026-07-23T03:04:05.000Z");
    const client = createTransitousClient({
      contactUrl: "https://example.test/fog-tool",
      fetchFn,
      now: () => now,
    });

    const result = await client.route({
      mode: "train",
      startPoint: { lat: 25, lon: 121.5 },
      endPoint: { lat: 25.1, lon: 121.6 },
    });

    expect(result.points).toEqual([
      { lat: 25, lon: 121.5 },
      { lat: 25.1, lon: 121.6 },
    ]);
    expect(result.referenceDate).toBe("2026-07-23");
    const [rawUrl, init] = fetchFn.mock.calls[0];
    const url = new URL(String(rawUrl));
    expect(url.origin + url.pathname).toBe(
      "https://api.transitous.org/api/v6/plan",
    );
    expect(url.searchParams.get("fromPlace")).toBe("25,121.5");
    expect(url.searchParams.get("toPlace")).toBe("25.1,121.6");
    expect(url.searchParams.get("time")).toBe(now.toISOString());
    expect(url.searchParams.get("transitModes")).toBe("RAIL");
    expect(url.searchParams.get("preTransitModes")).toBe("WALK");
    expect(url.searchParams.get("postTransitModes")).toBe("WALK");
    expect(url.searchParams.get("directModes")).toBe("");
    expect(init?.headers).toMatchObject({
      "User-Agent":
        "fog-of-world-tool/0.1.0 (+https://example.test/fog-tool)",
    });
  });

  it.each([
    ["transit", "TRANSIT"],
    ["rail", "RAIL"],
    ["high-speed-rail", "HIGHSPEED_RAIL"],
    ["long-distance-rail", "LONG_DISTANCE"],
    ["night-rail", "NIGHT_RAIL"],
    ["regional-rail", "REGIONAL_RAIL"],
    ["suburban-rail", "SUBURBAN"],
    ["subway", "SUBWAY"],
    ["bus", "BUS"],
    ["coach", "COACH"],
    ["tram", "TRAM"],
    ["ferry", "FERRY"],
    ["funicular", "FUNICULAR"],
    ["aerial-lift", "AERIAL_LIFT"],
    ["other-transit", "OTHER"],
  ] as const)(
    "maps international review mode %s to MOTIS %s",
    async (mode, expected) => {
      const encoded = polyline.encode(
        [
          [35.6812, 139.7671],
          [35.6896, 139.7006],
        ],
        6,
      );
      const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          itineraries: [
            {
              legs: [
                {
                  legGeometry: {
                    points: encoded,
                    precision: 6,
                    length: 2,
                  },
                },
              ],
            },
          ],
        }),
      );
      const client = createTransitousClient({
        contactUrl: "https://example.test/fog-tool",
        fetchFn,
        requestLimiter: {
          acquire: vi.fn().mockResolvedValue(undefined),
        },
      });

      await client.route({
        mode,
        startPoint: { lat: 35.6812, lon: 139.7671 },
        endPoint: { lat: 35.6896, lon: 139.7006 },
      });

      expect(
        new URL(String(fetchFn.mock.calls[0][0])).searchParams.get(
          "transitModes",
        ),
      ).toBe(expected);
    },
  );

  it("counts every routing retry against the shared request limiter", async () => {
    const encoded = polyline.encode(
      [
        [25, 121.5],
        [25.1, 121.6],
      ],
      6,
    );
    const payload = {
      itineraries: [
        {
          legs: [
            {
              legGeometry: {
                points: encoded,
                precision: 6,
                length: 2,
              },
            },
          ],
        },
      ],
    };
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 429,
          headers: { "Retry-After": "0" },
        }),
      )
      .mockResolvedValueOnce(Response.json(payload));
    const requestLimiter = {
      acquire: vi.fn().mockResolvedValue(undefined),
    };
    const client = createTransitousClient({
      contactUrl: "https://example.test/fog-tool",
      fetchFn,
      requestLimiter,
    });

    await client.route({
      mode: "bus",
      startPoint: { lat: 25, lon: 121.5 },
      endPoint: { lat: 25.1, lon: 121.6 },
    });

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(requestLimiter.acquire).toHaveBeenCalledTimes(2);
  });
});
