import { describe, expect, it } from "vitest";

import { decodeFlexiblePolyline } from "@/lib/geo/flexible-polyline";

describe("decodeFlexiblePolyline", () => {
  it("decodes HERE's published two-dimensional example", () => {
    expect(decodeFlexiblePolyline("BFoz5xJ67i1B1B7PzIhaxL7Y")).toEqual([
      { lat: 50.10228, lon: 8.69821 },
      { lat: 50.10201, lon: 8.69567 },
      { lat: 50.10063, lon: 8.6915 },
      { lat: 50.09878, lon: 8.68752 },
    ]);
  });

  it.each(["", "A", "CFD", "B!invalid"])(
    "rejects malformed input %j",
    (encoded) => {
      expect(decodeFlexiblePolyline(encoded)).toBeNull();
    },
  );
});
