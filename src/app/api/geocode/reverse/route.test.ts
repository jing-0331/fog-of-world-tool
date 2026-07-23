import { describe, expect, it, vi } from "vitest";

import { createReverseGeocodeHandler } from "@/app/api/geocode/reverse/route";

describe("GET /api/geocode/reverse", () => {
  it("returns a human-readable label when available", async () => {
    const handler = createReverseGeocodeHandler(
      vi.fn().mockResolvedValue("合成地點"),
    );
    const response = await handler(
      new Request(
        "http://local.test/api/geocode/reverse?lat=25&lon=121.5",
      ),
    );

    expect(await response.json()).toEqual({
      data: { label: "合成地點", coordinatesOnly: false },
    });
  });

  it("falls back to coordinates if reverse geocoding fails", async () => {
    const handler = createReverseGeocodeHandler(
      vi.fn().mockRejectedValue(new Error("offline")),
    );
    const response = await handler(
      new Request(
        "http://local.test/api/geocode/reverse?lat=-12.5&lon=179.75",
      ),
    );

    expect(await response.json()).toEqual({
      data: { label: "-12.50000, 179.75000", coordinatesOnly: true },
    });
  });
});
