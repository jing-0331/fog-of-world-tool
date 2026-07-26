import { describe, expect, it } from "vitest";

import {
  routeKindLabel,
  routeSourceLabel,
  transportModeLabel,
} from "@/lib/domain/provenance";
import { TRANSPORT_MODES } from "@/lib/domain/types";

describe("routeKindLabel", () => {
  it("uses the exact Traditional Chinese flight route labels", () => {
    expect(routeKindLabel("actual-track")).toBe("實際軌跡");
    expect(routeKindLabel("filed-plan")).toBe("申報航路");
    expect(routeKindLabel("simulated-plan")).toBe("模擬航路");
    expect(routeKindLabel("direct-line")).toBe("直接連線");
  });

  it("labels Timeline and repaired route kinds", () => {
    expect(routeKindLabel("recorded-timeline")).toBe("時間軸記錄");
    expect(routeKindLabel("ground-route")).toBe("地面路線");
    expect(routeKindLabel("transit-route")).toBe("大眾運輸近似");
  });
});

describe("routeSourceLabel", () => {
  it("keeps provider names distinct from route kinds", () => {
    expect(routeSourceLabel("opensky")).toBe("OpenSky");
    expect(routeSourceLabel("aerodatabox")).toBe("AeroDataBox");
    expect(routeSourceLabel("flight-plan-database")).toBe(
      "Flight Plan Database",
    );
    expect(routeSourceLabel("google-timeline")).toBe("Google 時間軸");
    expect(routeSourceLabel("local-calculation")).toBe("本機計算");
    expect(routeSourceLabel("tdx" as never)).toBe("TDX");
  });
});

describe("transportModeLabel", () => {
  it("labels every stable transport mode", () => {
    for (const mode of TRANSPORT_MODES) {
      expect(transportModeLabel(mode)).toEqual(expect.any(String));
      expect(transportModeLabel(mode).length).toBeGreaterThan(0);
    }
  });

  it("labels unknown transport explicitly", () => {
    expect(transportModeLabel("unknown")).toBe("未知");
  });
});
