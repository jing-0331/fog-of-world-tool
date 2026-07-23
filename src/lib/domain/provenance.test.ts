import { describe, expect, it } from "vitest";

import {
  routeKindLabel,
  routeSourceLabel,
  transportModeLabel,
} from "@/lib/domain/provenance";

describe("routeKindLabel", () => {
  it("uses the exact Traditional Chinese flight route labels", () => {
    expect(routeKindLabel("actual-track")).toBe("實際軌跡");
    expect(routeKindLabel("filed-plan")).toBe("申報航路");
    expect(routeKindLabel("simulated-plan")).toBe("模擬航路");
    expect(routeKindLabel("great-circle")).toBe("大圓近似");
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
  });
});

describe("transportModeLabel", () => {
  it("labels unknown transport explicitly", () => {
    expect(transportModeLabel("unknown")).toBe("未知");
  });
});
