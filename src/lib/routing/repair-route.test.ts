import { describe, expect, it, vi } from "vitest";

import { distanceMeters } from "@/lib/geo/distance";
import { routePolicy } from "@/lib/routing/mode-policy";
import { repairRoute } from "@/lib/routing/repair-route";

describe("routePolicy", () => {
  it.each([
    ["walking", { provider: "openrouteservice", profile: "foot-walking" }],
    ["running", { provider: "openrouteservice", profile: "foot-walking" }],
    ["cycling", { provider: "openrouteservice", profile: "cycling-regular" }],
    ["motorcycling", { provider: "openrouteservice", profile: "driving-car" }],
    ["driving", { provider: "openrouteservice", profile: "driving-car" }],
    ["train", { provider: "transitous", transitMode: "RAIL" }],
    ["subway", { provider: "transitous", transitMode: "SUBWAY" }],
    ["bus", { provider: "transitous", transitMode: "BUS" }],
    ["tram", { provider: "transitous", transitMode: "TRAM" }],
    ["ferry", { provider: "transitous", transitMode: "FERRY" }],
  ] as const)("routes %s with its intended provider", (mode, expected) => {
    expect(routePolicy(mode)).toEqual(expected);
  });

  it("does not silently treat an unknown mode as driving", () => {
    expect(routePolicy("unknown")).toBeNull();
  });
});

describe("repairRoute", () => {
  const request = {
    id: "synthetic-gap",
    mode: "walking" as const,
    startPoint: { lat: 0, lon: 0 },
    endPoint: { lat: 0.1, lon: 0.1 },
    startTime: "2026-01-01T00:00:00Z",
    endTime: "2026-01-01T01:00:00Z",
  };

  it("uses ORS, densifies the result, and records approximate provenance", async () => {
    const openRouteService = vi.fn().mockResolvedValue([
      request.startPoint,
      request.endPoint,
    ]);

    const result = await repairRoute(request, {
      openRouteService,
      tdx: vi.fn(),
      transitous: vi.fn(),
    });

    expect(openRouteService).toHaveBeenCalledWith(
      expect.objectContaining({ profile: "foot-walking" }),
    );
    expect(result.provenance).toMatchObject({
      kind: "ground-route",
      source: "openrouteservice",
      referenceDate: null,
      approximate: true,
    });
    expect(result.attempts).toEqual([
      expect.objectContaining({
        source: "openrouteservice",
        status: "success",
      }),
    ]);
    for (let index = 1; index < result.points.length; index += 1) {
      expect(
        distanceMeters(result.points[index - 1], result.points[index]),
      ).toBeLessThanOrEqual(2_000.01);
    }
  });

  it("uses TDX for a public-transport route wholly inside Taiwan", async () => {
    const tdx = vi.fn().mockResolvedValue({
      points: [
        { lat: 25.0478, lon: 121.5319 },
        { lat: 22.6273, lon: 120.3014 },
      ],
      referenceDate: "2026-07-24",
    });
    const transitous = vi.fn().mockResolvedValue({
      points: [request.startPoint, request.endPoint],
      referenceDate: "2026-07-24",
    });

    const result = await repairRoute(
      {
        ...request,
        mode: "bus",
        startPoint: { lat: 25.0478, lon: 121.5319 },
        endPoint: { lat: 22.6273, lon: 120.3014 },
      },
      {
        openRouteService: vi.fn(),
        tdx,
        transitous,
      },
    );

    expect(tdx).toHaveBeenCalledOnce();
    expect(transitous).not.toHaveBeenCalled();
    expect(result.provenance).toMatchObject({
      kind: "transit-route",
      source: "tdx",
      referenceDate: "2026-07-24",
      approximate: true,
    });
    expect(result.attempts).toEqual([
      expect.objectContaining({ source: "tdx", status: "success" }),
    ]);
  });

  it("keeps overseas public transport on Transitous", async () => {
    const transitous = vi.fn().mockResolvedValue({
      points: [request.startPoint, request.endPoint],
      referenceDate: "2026-07-23",
    });
    const tdx = vi.fn();
    const result = await repairRoute(
      { ...request, mode: "bus" },
      {
        openRouteService: vi.fn(),
        tdx,
        transitous,
      },
    );

    expect(transitous).toHaveBeenCalledOnce();
    expect(tdx).not.toHaveBeenCalled();
    expect(result.provenance).toMatchObject({
      kind: "transit-route",
      source: "transitous",
      referenceDate: "2026-07-23",
      approximate: true,
    });
  });
});
