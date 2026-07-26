import { describe, expect, it } from "vitest";

import { tdxTransitCodeFor } from "@/lib/providers/tdx/mode-map";

describe("TDX mode map", () => {
  it.each([
    ["transit", "3,4,5,6,7,8,9"],
    ["train", "3,4"],
    ["rail", "3,4"],
    ["taiwan-rail", "3"],
    ["high-speed-rail", "4"],
    ["long-distance-rail", "3"],
    ["night-rail", "3"],
    ["regional-rail", "3"],
    ["suburban-rail", "3"],
    ["subway", "6"],
    ["bus", "5"],
    ["coach", "5"],
    ["tram", "7"],
    ["ferry", "8"],
    ["funicular", "9"],
    ["aerial-lift", "9"],
    ["other-transit", "3,4,5,6,7,8,9"],
  ] as const)("maps %s to transit=%s", (mode, expected) => {
    expect(tdxTransitCodeFor(mode)).toBe(expected);
  });

  it("does not map general routes", () => {
    expect(tdxTransitCodeFor("walking")).toBeNull();
  });
});
