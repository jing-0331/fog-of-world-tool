import { describe, expect, it, vi } from "vitest";

import { createFlightPlanDatabaseClient } from "@/lib/providers/flightplandb/client";

describe("Flight Plan Database client", () => {
  it("selects the most popular exact route and decodes precision 5", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            id: 1,
            fromICAO: "TORG",
            toICAO: "TDST",
            popularity: 1,
            encodedPolyline: "_p~iF~ps|U_ulLnnqC_mqNvxq`@",
          },
          {
            id: 2,
            fromICAO: "TORG",
            toICAO: "TDST",
            popularity: 9,
            encodedPolyline: "??_ibE_ibE",
          },
        ]),
        { status: 200 },
      ),
    );
    const client = createFlightPlanDatabaseClient({ fetchFn });

    await expect(client.findPopularPlan("TORG", "TDST")).resolves.toEqual([
      { lat: 0, lon: 0 },
      { lat: 1, lon: 1 },
    ]);
    expect(String(fetchFn.mock.calls[0][0])).toContain(
      "/search/plans?fromICAO=TORG&toICAO=TDST",
    );
    expect(fetchFn.mock.calls[0][1].method).toBe("GET");
  });

  it("resolves an exact navaid identifier through the public search endpoint", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          { ident: "OTHER", type: "FIX", lat: 1, lon: 1, name: null },
          { ident: "SYNTH", type: "VOR", lat: 2, lon: 3, name: "Synthetic" },
        ]),
        { status: 200 },
      ),
    );
    const client = createFlightPlanDatabaseClient({ fetchFn });

    await expect(client.findNavaid("synth")).resolves.toEqual({
      lat: 2,
      lon: 3,
    });
    expect(String(fetchFn.mock.calls[0][0])).toContain(
      "/search/nav?q=SYNTH",
    );
    expect(fetchFn.mock.calls[0][1].method).toBe("GET");
  });
});
