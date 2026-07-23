import { describe, expect, it } from "vitest";

import { distanceMeters } from "@/lib/geo/distance";

describe("distanceMeters", () => {
  it("returns zero for identical points", () => {
    const point = { lat: 25.033_964, lon: 121.564_468 };

    expect(distanceMeters(point, point)).toBe(0);
  });

  it("matches a known Taipei distance within tolerance", () => {
    const taipei101 = { lat: 25.033_964, lon: 121.564_468 };
    const taipeiMainStation = { lat: 25.047_8, lon: 121.517 };

    expect(distanceMeters(taipei101, taipeiMainStation)).toBeCloseTo(
      5_000,
      -2,
    );
  });
});
