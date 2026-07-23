import { describe, expect, it } from "vitest";

import { activityMode } from "@/lib/timeline/activity-mode";

describe("activityMode", () => {
  it.each([
    ["WALKING", "walking"],
    ["RUNNING", "running"],
    ["CYCLING", "cycling"],
    ["MOTORCYCLING", "motorcycling"],
    ["IN_PASSENGER_VEHICLE", "driving"],
    ["IN_TRAIN", "train"],
    ["IN_SUBWAY", "subway"],
    ["IN_BUS", "bus"],
    ["IN_TRAM", "tram"],
    ["IN_FERRY", "ferry"],
    ["FLYING", "flying"],
    ["SKIING", "unknown"],
  ] as const)("maps %s to %s", (googleType, expected) => {
    expect(activityMode(googleType)).toBe(expected);
  });
});
