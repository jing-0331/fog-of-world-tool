import { describe, expect, it, vi } from "vitest";

import { createOpenRouteServiceClient } from "@/lib/providers/openrouteservice/client";

const syntheticRoutePayload = {
  features: [
    {
      geometry: {
        type: "LineString",
        coordinates: [
          [121.5, 25],
          [121.6, 25.1],
        ],
      },
    },
  ],
};

const syntheticDrivingRequest = {
  profile: "driving-car" as const,
  startPoint: { lat: 25, lon: 121.5 },
  endPoint: { lat: 25.1, lon: 121.6 },
};

describe("OpenRouteService client", () => {
  it("posts [lon, lat] coordinates to the selected GeoJSON profile", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        features: [
          {
            geometry: {
              type: "LineString",
              coordinates: [
                [121.5, 25],
                [121.6, 25.1],
              ],
            },
          },
        ],
      }),
    );
    const client = createOpenRouteServiceClient({
      apiKey: "ors-secret",
      fetchFn,
    });

    await expect(
      client.route({
        profile: "foot-walking",
        startPoint: { lat: 25, lon: 121.5 },
        endPoint: { lat: 25.1, lon: 121.6 },
      }),
    ).resolves.toEqual([
      { lat: 25, lon: 121.5 },
      { lat: 25.1, lon: 121.6 },
    ]);

    const [url, init] = fetchFn.mock.calls[0];
    expect(String(url)).toBe(
      "https://api.openrouteservice.org/v2/directions/foot-walking/geojson",
    );
    expect(init?.headers).toMatchObject({
      Authorization: "ors-secret",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      coordinates: [
        [121.5, 25],
        [121.6, 25.1],
      ],
    });
  });

  it("returns a reverse-geocoded label and degrades to null on failure", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          features: [{ properties: { label: "合成測試地點" } }],
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    const client = createOpenRouteServiceClient({
      apiKey: "ors-secret",
      fetchFn,
    });

    await expect(
      client.reverseGeocode({ lat: 25, lon: 121.5 }),
    ).resolves.toBe("合成測試地點");
    await expect(
      client.reverseGeocode({ lat: 24, lon: 120.5 }),
    ).resolves.toBeNull();

    const url = new URL(String(fetchFn.mock.calls[0][0]));
    expect(url.pathname).toBe("/geocode/reverse");
    expect(url.searchParams.get("point.lat")).toBe("25");
    expect(url.searchParams.get("point.lon")).toBe("121.5");
  });

  it("acquires a limiter slot for every Directions fetch", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(syntheticRoutePayload));
    const requestLimiter = {
      acquire: vi.fn().mockResolvedValue(undefined),
    };
    const client = createOpenRouteServiceClient({
      apiKey: "ors-secret",
      fetchFn,
      requestLimiter,
    });

    await client.route(syntheticDrivingRequest);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(requestLimiter.acquire).toHaveBeenCalledTimes(1);
  });

  it("counts every Directions retry against the limiter", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 429,
          headers: { "Retry-After": "0" },
        }),
      )
      .mockResolvedValueOnce(Response.json(syntheticRoutePayload));
    const requestLimiter = {
      acquire: vi.fn().mockResolvedValue(undefined),
    };
    const client = createOpenRouteServiceClient({
      apiKey: "ors-secret",
      fetchFn,
      requestLimiter,
    });

    await client.route(syntheticDrivingRequest);

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(requestLimiter.acquire).toHaveBeenCalledTimes(2);
  });

  it("does not use the Directions limiter for reverse geocoding", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        features: [{ properties: { label: "Synthetic place" } }],
      }),
    );
    const requestLimiter = {
      acquire: vi.fn().mockResolvedValue(undefined),
    };
    const client = createOpenRouteServiceClient({
      apiKey: "ors-secret",
      fetchFn,
      requestLimiter,
    });

    await expect(
      client.reverseGeocode({ lat: 25, lon: 121.5 }),
    ).resolves.toBe("Synthetic place");

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(requestLimiter.acquire).not.toHaveBeenCalled();
  });
});
