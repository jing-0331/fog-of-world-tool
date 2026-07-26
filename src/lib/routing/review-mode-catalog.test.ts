import { describe, expect, it } from "vitest";

import type { GeoPoint, TransportMode } from "@/lib/domain/types";
import { openRouteServiceProfileFor } from "@/lib/providers/openrouteservice/mode-map";
import { tdxTransitCodeFor } from "@/lib/providers/tdx/mode-map";
import { transitousModeFor } from "@/lib/providers/transitous/mode-map";
import { routePolicy } from "@/lib/routing/mode-policy";
import {
  reviewModeOptions,
  reviewRegion,
} from "@/lib/routing/review-mode-catalog";

const taipei: GeoPoint = { lat: 25.0478, lon: 121.5319 };
const kaohsiung: GeoPoint = { lat: 22.6273, lon: 120.3014 };
const tokyo: GeoPoint = { lat: 35.6812, lon: 139.7671 };

const GENERAL_OPTIONS = [
  ["walking", "步行"],
  ["running", "跑步"],
  ["cycling", "自行車"],
  ["motorcycling", "機車"],
  ["driving", "開車"],
] as const satisfies readonly (readonly [TransportMode, string])[];

const TAIWAN_TRANSIT_OPTIONS = [
  ["train", "鐵路（台鐵／高鐵，不限）"],
  ["taiwan-rail", "台鐵"],
  ["high-speed-rail", "高鐵"],
  ["bus", "公車／公路客運"],
  ["subway", "捷運"],
  ["tram", "輕軌"],
  ["ferry", "渡輪"],
  ["funicular", "纜車"],
] as const satisfies readonly (readonly [TransportMode, string])[];

const INTERNATIONAL_TRANSIT_OPTIONS = [
  ["transit", "大眾運輸（不限）"],
  ["rail", "鐵路（不限）"],
  ["high-speed-rail", "高速鐵路"],
  ["long-distance-rail", "長途鐵路"],
  ["night-rail", "夜行列車"],
  ["regional-rail", "區域鐵路"],
  ["suburban-rail", "市郊鐵路"],
  ["subway", "地鐵"],
  ["bus", "市區／短途公車"],
  ["coach", "長途客運"],
  ["tram", "路面電車"],
  ["ferry", "渡輪"],
  ["funicular", "登山纜車"],
  ["aerial-lift", "空中纜車"],
  ["other-transit", "其他大眾運輸"],
] as const satisfies readonly (readonly [TransportMode, string])[];

describe("reviewRegion", () => {
  it("uses Taiwan only when both endpoints are in Taiwan", () => {
    expect(reviewRegion(taipei, kaohsiung)).toBe("taiwan");
    expect(reviewRegion(taipei, tokyo)).toBe("international");
    expect(reviewRegion(tokyo, taipei)).toBe("international");
    expect(reviewRegion(tokyo, tokyo)).toBe("international");
  });

  it("is unaffected by original mode or display metadata", () => {
    const candidates = [
      { mode: "walking", name: "步行" },
      { mode: "bus", name: "公車" },
      { mode: "flying", name: "飛行" },
    ] as const;

    expect(
      candidates.map(() => reviewRegion(taipei, kaohsiung)),
    ).toEqual(["taiwan", "taiwan", "taiwan"]);
  });
});

describe("reviewModeOptions", () => {
  it.each([
    ["taiwan", TAIWAN_TRANSIT_OPTIONS],
    ["international", INTERNATIONAL_TRANSIT_OPTIONS],
  ] as const)(
    "returns the exact provider-aware %s catalog",
    (region, transitOptions) => {
      expect(
        reviewModeOptions(region).map(({ value, label, group }) => [
          value,
          label,
          group,
        ]),
      ).toEqual([
        ...GENERAL_OPTIONS.map(([value, label]) => [
          value,
          label,
          "general",
        ]),
        ...transitOptions.map(([value, label]) => [
          value,
          label,
          "transit",
        ]),
      ]);
    },
  );

  it("keeps provider-specific precise modes in the intended region", () => {
    const taiwan = values("taiwan");
    const international = values("international");

    expect(taiwan).toContain("taiwan-rail");
    expect(taiwan).not.toContain("long-distance-rail");
    expect(taiwan).not.toContain("night-rail");
    expect(taiwan).not.toContain("regional-rail");
    expect(taiwan).not.toContain("suburban-rail");
    expect(taiwan).not.toContain("aerial-lift");
    expect(taiwan).not.toContain("other-transit");

    expect(international).not.toContain("taiwan-rail");
    expect(international).toContain("long-distance-rail");
    expect(international).toContain("night-rail");
    expect(international).toContain("regional-rail");
    expect(international).toContain("suburban-rail");
    expect(international).toContain("aerial-lift");
    expect(international).toContain("other-transit");
  });

  it("never offers flight or experimental MOTIS modes", () => {
    for (const region of ["taiwan", "international"] as const) {
      expect(values(region)).not.toEqual(
        expect.arrayContaining([
          "flying",
          "AIRPLANE",
          "ODM",
          "FLEX",
          "RIDE_SHARING",
        ]),
      );
    }
  });

  it.each([
    ["taiwan", taipei, kaohsiung, "tdx"],
    ["international", tokyo, taipei, "transitous"],
  ] as const)(
    "routes every %s option through its frozen provider mapping",
    (region, startPoint, endPoint, transitProvider) => {
      for (const option of reviewModeOptions(region)) {
        const policy = routePolicy(option.value, startPoint, endPoint);

        if (option.group === "general") {
          expect(policy?.provider, option.value).toBe("openrouteservice");
          expect(openRouteServiceProfileFor(option.value), option.value)
            .not.toBeNull();
          continue;
        }

        expect(policy?.provider, option.value).toBe(transitProvider);
        expect(tdxTransitCodeFor(option.value), option.value).not.toBeNull();
        expect(transitousModeFor(option.value), option.value).not.toBeNull();
      }
    },
  );
});

function values(region: "taiwan" | "international"): string[] {
  return reviewModeOptions(region).map(({ value }) => value);
}
