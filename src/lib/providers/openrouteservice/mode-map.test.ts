import { describe, expect, it } from "vitest";

import {
  openRouteServiceProfileFor,
} from "@/lib/providers/openrouteservice/mode-map";

describe("OpenRouteService mode map", () => {
  it.each([
    ["walking", "foot-walking"],
    ["running", "foot-walking"],
    ["cycling", "cycling-regular"],
    ["motorcycling", "driving-car"],
    ["driving", "driving-car"],
  ] as const)("maps %s to %s", (mode, expected) => {
    expect(openRouteServiceProfileFor(mode)).toBe(expected);
  });

  it("does not map public transit", () => {
    expect(openRouteServiceProfileFor("bus")).toBeNull();
  });
});
