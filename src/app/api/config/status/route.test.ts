import { describe, expect, it } from "vitest";

import { getConfigStatus } from "@/app/api/config/status/route";

describe("GET /api/config/status", () => {
  it("reports capabilities without returning provider values", () => {
    const status = getConfigStatus({
      AERODATABOX_RAPIDAPI_KEY: "secret-aerodatabox",
      OPENROUTESERVICE_API_KEY: "secret-ors",
      OPENSKY_CLIENT_ID: "client-id",
      OPENSKY_CLIENT_SECRET: "secret-opensky",
      FLIGHTPLANDB_API_KEY: "",
      TRANSITOUS_CONTACT_URL: "https://github.com/example/fog-tool",
    });
    const serialized = JSON.stringify(status);

    expect(status.aerodatabox.configured).toBe(true);
    expect(status.openrouteservice.configured).toBe(true);
    expect(status.opensky.configured).toBe(true);
    expect(status.flightPlanDatabase.configured).toBe(false);
    expect(status.transitous.configured).toBe(true);
    expect(serialized).not.toContain("secret-aerodatabox");
    expect(serialized).not.toContain("secret-ors");
    expect(serialized).not.toContain("secret-opensky");
  });

  it("keeps the app available with setup messages when keys are absent", () => {
    const status = getConfigStatus({});

    expect(status.aerodatabox).toEqual({
      configured: false,
      message: "設定 AERODATABOX_RAPIDAPI_KEY 以啟用航班搜尋。",
    });
    expect(status.opensky.configured).toBe(false);
    expect(status.transitous.configured).toBe(false);
  });

  it("rejects the placeholder Transitous contact URL", () => {
    const status = getConfigStatus({
      TRANSITOUS_CONTACT_URL:
        "https://github.com/YOUR_ACCOUNT/YOUR_REPOSITORY",
    });

    expect(status.transitous.configured).toBe(false);
    expect(status.transitous.message).toMatch(/聯絡網址/);
  });
});
