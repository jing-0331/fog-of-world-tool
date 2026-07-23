import { describe, expect, it } from "vitest";

import { densifyPoints, interpolateRouteTimes } from "@/lib/geo/densify";
import { distanceMeters } from "@/lib/geo/distance";
import { decodePolyline } from "@/lib/geo/polyline";

describe("densifyPoints", () => {
  it("takes the short path across the antimeridian", () => {
    const result = densifyPoints(
      [
        { lat: 0, lon: 179.99 },
        { lat: 0, lon: -179.99 },
      ],
      { maxDistanceMeters: 1_000 },
    );

    expect(result.length).toBeGreaterThan(2);
    expect(result.slice(1, -1).every((point) => Math.abs(point.lon) > 179)).toBe(
      true,
    );
  });

  it("splits a roughly 5 km pair into at least four points", () => {
    const result = densifyPoints(
      [
        { lat: 25.033_964, lon: 121.564_468 },
        { lat: 25.047_8, lon: 121.517 },
      ],
      { maxDistanceMeters: 2_000 },
    );

    expect(result.length).toBeGreaterThanOrEqual(4);
  });

  it("keeps every adjacent pair within the requested limit", () => {
    const result = densifyPoints(
      [
        { lat: 25.033_964, lon: 121.564_468 },
        { lat: 25.047_8, lon: 121.517 },
      ],
      { maxDistanceMeters: 2_000 },
    );

    for (let index = 1; index < result.length; index += 1) {
      expect(distanceMeters(result[index - 1], result[index])).toBeLessThanOrEqual(
        2_000.5,
      );
    }
  });

  it("interpolates time and elevation for inserted points", () => {
    const result = densifyPoints(
      [
        {
          lat: 0,
          lon: 0,
          time: "2026-01-01T00:00:00.000Z",
          elevationMeters: 10,
        },
        {
          lat: 0,
          lon: 0.05,
          time: "2026-01-01T00:10:00.000Z",
          elevationMeters: 20,
        },
      ],
      { maxDistanceMeters: 2_000 },
    );

    expect(result).toHaveLength(4);
    expect(result[1].time).toBe("2026-01-01T00:03:20.000Z");
    expect(result[2].time).toBe("2026-01-01T00:06:40.000Z");
    expect(result[1].elevationMeters).toBeCloseTo(13.333_333, 5);
    expect(result[2].elevationMeters).toBeCloseTo(16.666_667, 5);
  });

  it("retains timestamps on existing actual-track points", () => {
    const retainedTime = "2026-01-01T00:04:00.000Z";
    const result = densifyPoints(
      [
        { lat: 0, lon: 0, time: "2026-01-01T00:00:00.000Z" },
        { lat: 0, lon: 0.03, time: retainedTime },
        { lat: 0, lon: 0.06, time: "2026-01-01T00:08:00.000Z" },
      ],
      { maxDistanceMeters: 2_000 },
    );

    expect(result.some((point) => point.time === retainedTime)).toBe(true);
  });
});

describe("interpolateRouteTimes", () => {
  it("allocates missing timestamps by cumulative route distance", () => {
    const result = interpolateRouteTimes(
      [
        { lat: 0, lon: 0 },
        { lat: 0, lon: 0.01 },
        { lat: 0, lon: 0.03 },
      ],
      "2026-01-01T00:00:00Z",
      "2026-01-01T00:30:00Z",
    );

    expect(result[0].time).toBe("2026-01-01T00:00:00.000Z");
    expect(result[1].time).toBe("2026-01-01T00:10:00.000Z");
    expect(result[2].time).toBe("2026-01-01T00:30:00.000Z");
  });
});

describe("decodePolyline", () => {
  it("decodes an encoded route using the requested precision", () => {
    expect(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@", 5)).toEqual([
      { lat: 38.5, lon: -120.2 },
      { lat: 40.7, lon: -120.95 },
      { lat: 43.252, lon: -126.453 },
    ]);
  });
});
