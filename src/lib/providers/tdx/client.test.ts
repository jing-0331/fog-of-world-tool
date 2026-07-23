import { describe, expect, it, vi } from "vitest";

import { createTdxClient } from "@/lib/providers/tdx/client";
import { ProviderError } from "@/lib/server/provider-error";

const flexiblePolyline = "BFoz5xJ67i1B1B7PzIhaxL7Y";
const routePayload = {
  result: "success",
  data: {
    routes: [
      {
        sections: [
          {
            polyline: flexiblePolyline,
            departure: {
              place: {
                location: { lat: 50.10228, lng: 8.69821 },
              },
            },
            arrival: {
              place: {
                location: { lat: 50.09878, lng: 8.68752 },
              },
            },
          },
        ],
      },
    ],
  },
};

function configuredClient(fetchFn: typeof fetch, now?: () => Date) {
  return createTdxClient({
    clientId: "tdx-client",
    clientSecret: "tdx-secret",
    fetchFn,
    now,
    tokenCache: new Map(),
    requestLimiter: {
      acquire: vi.fn().mockResolvedValue(undefined),
    },
  });
}

function successfulFetch(payload: unknown = routePayload) {
  return vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({ access_token: "access-token", expires_in: 300 }),
    )
    .mockResolvedValueOnce(Response.json(payload));
}

describe("TDX client", () => {
  it.each([
    { clientId: undefined, clientSecret: undefined },
    { clientId: "client", clientSecret: undefined },
    { clientId: undefined, clientSecret: "secret" },
  ])("requires both client credentials", (credentials) => {
    expect(() => createTdxClient(credentials)).toThrow(ProviderError);
  });

  it("authenticates, plans the route, and decodes section geometry", async () => {
    const fetchFn = successfulFetch();
    const now = new Date("2026-07-23T16:30:00.000Z");
    const client = configuredClient(fetchFn, () => now);

    const result = await client.route({
      mode: "train",
      startPoint: { lat: 25.0478, lon: 121.5319 },
      endPoint: { lat: 22.6273, lon: 120.3014 },
    });

    expect(result).toEqual({
      points: [
        { lat: 50.10228, lon: 8.69821 },
        { lat: 50.10201, lon: 8.69567 },
        { lat: 50.10063, lon: 8.6915 },
        { lat: 50.09878, lon: 8.68752 },
      ],
      referenceDate: "2026-07-24",
    });

    const [tokenUrl, tokenInit] = fetchFn.mock.calls[0];
    expect(String(tokenUrl)).toBe(
      "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token",
    );
    expect(tokenInit).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    const tokenBody = new URLSearchParams(String(tokenInit?.body));
    expect(Object.fromEntries(tokenBody)).toEqual({
      grant_type: "client_credentials",
      client_id: "tdx-client",
      client_secret: "tdx-secret",
    });

    const [routeUrl, routeInit] = fetchFn.mock.calls[1];
    const parsedRouteUrl = new URL(String(routeUrl));
    expect(parsedRouteUrl.origin + parsedRouteUrl.pathname).toBe(
      "https://tdx.transportdata.tw/api/maas/routing",
    );
    expect(parsedRouteUrl.searchParams.get("origin")).toBe(
      "25.0478,121.5319",
    );
    expect(parsedRouteUrl.searchParams.get("destination")).toBe(
      "22.6273,120.3014",
    );
    expect(parsedRouteUrl.searchParams.get("gc")).toBe("1");
    expect(parsedRouteUrl.searchParams.get("top")).toBe("1");
    expect(parsedRouteUrl.searchParams.get("transit")).toBe("3,4");
    expect(parsedRouteUrl.searchParams.get("first_mile_mode")).toBe("0");
    expect(parsedRouteUrl.searchParams.get("last_mile_mode")).toBe("0");
    expect(routeInit?.headers).toMatchObject({
      Accept: "application/json",
      Authorization: "Bearer access-token",
    });
  });

  it.each([
    ["train", "3,4"],
    ["subway", "6"],
    ["bus", "5"],
    ["tram", "7"],
    ["ferry", "8"],
  ] as const)("maps %s to TDX transit code %s", async (mode, expected) => {
    const fetchFn = successfulFetch();
    const client = configuredClient(fetchFn);

    await client.route({
      mode,
      startPoint: { lat: 25, lon: 121.5 },
      endPoint: { lat: 25.1, lon: 121.6 },
    });

    expect(new URL(String(fetchFn.mock.calls[1][0])).searchParams.get("transit"))
      .toBe(expected);
  });

  it("falls back to section endpoints when no valid polyline is available", async () => {
    const fetchFn = successfulFetch({
      result: "success",
      data: {
        routes: [
          {
            sections: [
              {
                polyline: "invalid",
                departure: {
                  place: { location: { lat: 25, lng: 121.5 } },
                },
                arrival: {
                  place: { location: { lat: 25.1, lng: 121.6 } },
                },
              },
            ],
          },
        ],
      },
    });

    await expect(
      configuredClient(fetchFn).route({
        mode: "bus",
        startPoint: { lat: 25, lon: 121.5 },
        endPoint: { lat: 25.1, lon: 121.6 },
      }),
    ).resolves.toMatchObject({
      points: [
        { lat: 25, lon: 121.5 },
        { lat: 25.1, lon: 121.6 },
      ],
    });
  });

  it("accepts a null polyline when section endpoints are present", async () => {
    const fetchFn = successfulFetch({
      result: "success",
      data: {
        routes: [
          {
            sections: [
              {
                polyline: null,
                departure: {
                  place: { location: { lat: 25, lng: 121.5 } },
                },
                arrival: {
                  place: { location: { lat: 25.1, lng: 121.6 } },
                },
              },
            ],
          },
        ],
      },
    });

    await expect(
      configuredClient(fetchFn).route({
        mode: "bus",
        startPoint: { lat: 25, lon: 121.5 },
        endPoint: { lat: 25.1, lon: 121.6 },
      }),
    ).resolves.toMatchObject({
      points: [
        { lat: 25, lon: 121.5 },
        { lat: 25.1, lon: 121.6 },
      ],
    });
  });

  it("reuses a token while it remains valid", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ access_token: "access-token", expires_in: 300 }),
      )
      .mockImplementation(() => Promise.resolve(Response.json(routePayload)));
    const now = new Date("2026-07-24T00:00:00.000Z");
    const client = configuredClient(fetchFn, () => now);
    const request = {
      mode: "bus" as const,
      startPoint: { lat: 25, lon: 121.5 },
      endPoint: { lat: 25.1, lon: 121.6 },
    };

    await client.route(request);
    await client.route(request);

    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(
      fetchFn.mock.calls.filter(([url]) =>
        String(url).includes("/protocol/openid-connect/token"),
      ),
    ).toHaveLength(1);
  });

  it("counts every routing retry against the request limit", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ access_token: "access-token", expires_in: 300 }),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 429,
          headers: { "Retry-After": "0" },
        }),
      )
      .mockResolvedValueOnce(Response.json(routePayload));
    const requestLimiter = {
      acquire: vi.fn().mockResolvedValue(undefined),
    };
    const client = createTdxClient({
      clientId: "tdx-client",
      clientSecret: "tdx-secret",
      fetchFn,
      tokenCache: new Map(),
      requestLimiter,
    });

    await client.route({
      mode: "bus",
      startPoint: { lat: 25, lon: 121.5 },
      endPoint: { lat: 25.1, lon: 121.6 },
    });

    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(requestLimiter.acquire).toHaveBeenCalledTimes(2);
  });

  it("can reuse a token across client instances", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ access_token: "access-token", expires_in: 300 }),
      )
      .mockImplementation(() => Promise.resolve(Response.json(routePayload)));
    const tokenCache = new Map();
    const options = {
      clientId: "shared-client",
      clientSecret: "shared-secret",
      fetchFn,
      now: () => new Date("2026-07-24T00:00:00.000Z"),
      tokenCache,
      requestLimiter: {
        acquire: vi.fn().mockResolvedValue(undefined),
      },
    };
    const request = {
      mode: "bus" as const,
      startPoint: { lat: 25, lon: 121.5 },
      endPoint: { lat: 25.1, lon: 121.6 },
    };

    await createTdxClient(options).route(request);
    await createTdxClient(options).route(request);

    expect(
      fetchFn.mock.calls.filter(([url]) =>
        String(url).includes("/protocol/openid-connect/token"),
      ),
    ).toHaveLength(1);
  });

  it("reports no data when TDX returns no route", async () => {
    const fetchFn = successfulFetch({
      result: "success",
      data: { routes: [] },
    });

    await expect(
      configuredClient(fetchFn).route({
        mode: "bus",
        startPoint: { lat: 25, lon: 121.5 },
        endPoint: { lat: 25.1, lon: 121.6 },
      }),
    ).rejects.toMatchObject({ code: "no_data" });
  });

  it("rejects an unrecognizable response without exposing its contents", async () => {
    const fetchFn = successfulFetch({ unexpected: "credential-like-value" });

    await expect(
      configuredClient(fetchFn).route({
        mode: "bus",
        startPoint: { lat: 25, lon: 121.5 },
        endPoint: { lat: 25.1, lon: 121.6 },
      }),
    ).rejects.toMatchObject({
      code: "provider_unavailable",
      message: expect.not.stringContaining("credential-like-value"),
    });
  });
});
