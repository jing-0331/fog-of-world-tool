import { describe, expect, it } from "vitest";

import {
  transitousModeFor,
} from "@/lib/providers/transitous/mode-map";

describe("Transitous mode map", () => {
  it.each([
    ["transit", "TRANSIT"],
    ["train", "RAIL"],
    ["rail", "RAIL"],
    ["taiwan-rail", "RAIL"],
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
  ] as const)("maps %s to %s", (mode, expected) => {
    expect(transitousModeFor(mode)).toBe(expected);
  });

  it("does not map general routes", () => {
    expect(transitousModeFor("driving")).toBeNull();
  });
});
