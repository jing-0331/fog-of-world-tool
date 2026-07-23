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

  it("marks Transitous output approximate with the actual query date", async () => {
    const result = await repairRoute(
      { ...request, mode: "bus" },
      {
        openRouteService: vi.fn(),
        transitous: vi.fn().mockResolvedValue({
          points: [request.startPoint, request.endPoint],
          referenceDate: "2026-07-23",
        }),
      },
    );

    expect(result.provenance).toMatchObject({
      kind: "transit-route",
      source: "transitous",
      referenceDate: "2026-07-23",
      approximate: true,
    });
  });
});
