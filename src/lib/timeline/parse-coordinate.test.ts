import { describe, expect, it } from "vitest";

import { parseCoordinate } from "@/lib/timeline/parse-coordinate";

describe("parseCoordinate", () => {
  it("parses degree-formatted Timeline points", () => {
    expect(parseCoordinate("25.1234567°, 121.7654321°")).toEqual({
      lat: 25.1234567,
      lon: 121.7654321,
    });
  });

  it("parses latLng geo values", () => {
    expect(parseCoordinate({ latLng: "geo:-12.5,179.75" })).toEqual({
      lat: -12.5,
      lon: 179.75,
    });
  });

  it.each([
    "not-a-coordinate",
    "91.0°, 0.0°",
    { latLng: "geo:0,181" },
    null,
  ])("rejects invalid coordinates", (value) => {
    expect(parseCoordinate(value)).toBeNull();
  });
});
