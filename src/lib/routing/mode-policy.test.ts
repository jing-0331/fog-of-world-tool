import { describe, expect, it } from "vitest";

import {
  GENERAL_ROUTE_MODES,
  PUBLIC_TRANSIT_MODES,
  TRANSPORT_MODES,
} from "@/lib/domain/types";
import {
  modeFamily,
  routePolicy,
} from "@/lib/routing/mode-policy";

describe("mode policy", () => {
  it("classifies every stable transport mode into one family", () => {
    const families = Object.fromEntries(
      TRANSPORT_MODES.map((mode) => [mode, modeFamily(mode)]),
    );

    expect(families).toMatchObject(
      Object.fromEntries(
        GENERAL_ROUTE_MODES.map((mode) => [mode, "general"]),
      ),
    );
    expect(families).toMatchObject(
      Object.fromEntries(
        PUBLIC_TRANSIT_MODES.map((mode) => [
          mode,
          "public-transit",
        ]),
      ),
    );
    expect(families.flying).toBe("flight");
    expect(families.unknown).toBe("general");
    expect(Object.keys(families)).toHaveLength(
      TRANSPORT_MODES.length,
    );
  });

  it.each(PUBLIC_TRANSIT_MODES)(
    "routes %s by endpoints only",
    (mode) => {
      expect(
        routePolicy(
          mode,
          { lat: 25.0478, lon: 121.5319 },
          { lat: 25.033, lon: 121.5654 },
        )?.provider,
      ).toBe("tdx");
      expect(
        routePolicy(
          mode,
          { lat: 25.0478, lon: 121.5319 },
          { lat: 35.6812, lon: 139.7671 },
        )?.provider,
      ).toBe("transitous");
    },
  );

  it.each(GENERAL_ROUTE_MODES)(
    "keeps %s on OpenRouteService regardless of endpoints",
    (mode) => {
      expect(
        routePolicy(
          mode,
          { lat: 25.0478, lon: 121.5319 },
          { lat: 25.033, lon: 121.5654 },
        )?.provider,
      ).toBe("openrouteservice");
      expect(
        routePolicy(
          mode,
          { lat: 35.6812, lon: 139.7671 },
          { lat: 48.8566, lon: 2.3522 },
        )?.provider,
      ).toBe("openrouteservice");
    },
  );
});
