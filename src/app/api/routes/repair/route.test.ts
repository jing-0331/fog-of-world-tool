import { describe, expect, it, vi } from "vitest";

import { createRepairRouteHandler } from "@/app/api/routes/repair/route";

describe("POST /api/routes/repair", () => {
  it("rejects invalid coordinates and modes", async () => {
    const handler = createRepairRouteHandler(vi.fn());
    const response = await handler(
      new Request("http://local.test/api/routes/repair", {
        method: "POST",
        body: JSON.stringify({
          id: "bad",
          mode: "unknown",
          startPoint: { lat: 91, lon: 0 },
        }),
      }),
    );

    expect(response.status).toBe(400);
  });

  it("returns normalized repair data", async () => {
    const repair = vi.fn().mockResolvedValue({
      points: [
        { lat: 0, lon: 0, time: "2026-01-01T00:00:00.000Z" },
        { lat: 0.01, lon: 0.01, time: "2026-01-01T01:00:00.000Z" },
      ],
      provenance: {
        kind: "ground-route",
        source: "openrouteservice",
        referenceDate: null,
        approximate: true,
        explanation: "合成測試",
      },
      attempts: [],
    });
    const handler = createRepairRouteHandler(repair);
    const response = await handler(
      new Request("http://local.test/api/routes/repair", {
        method: "POST",
        body: JSON.stringify({
          id: "gap-1",
          mode: "walking",
          startPoint: { lat: 0, lon: 0 },
          endPoint: { lat: 0.01, lon: 0.01 },
          startTime: "2026-01-01T00:00:00Z",
          endTime: "2026-01-01T01:00:00Z",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: expect.objectContaining({
        provenance: expect.objectContaining({ source: "openrouteservice" }),
      }),
    });
  });
});
