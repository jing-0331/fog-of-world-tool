import { describe, expect, it, vi } from "vitest";

import { createAirportSearchHandler } from "@/app/api/airports/search/route";

describe("POST /api/airports/search", () => {
  it("rejects a short query before calling the provider", async () => {
    const searchAirports = vi.fn();
    const response = await createAirportSearchHandler(searchAirports)(
      request({ query: "A" }),
    );

    expect(response.status).toBe(400);
    expect(searchAirports).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON before calling the provider", async () => {
    const searchAirports = vi.fn();
    const response = await createAirportSearchHandler(searchAirports)(
      new Request("http://localhost/api/airports/search", {
        method: "POST",
        body: "{",
      }),
    );

    expect(response.status).toBe(400);
    expect(searchAirports).not.toHaveBeenCalled();
  });

  it("returns airports in the standard data envelope", async () => {
    const airport = {
      name: "Synthetic East Airport",
      city: "East City",
      iata: "EAS",
      icao: "TEST",
      point: { lat: 10, lon: 20 },
    };
    const searchAirports = vi.fn().mockResolvedValue([airport]);

    const response = await createAirportSearchHandler(searchAirports)(
      request({ query: " EAS " }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: [airport] });
    expect(searchAirports).toHaveBeenCalledWith("EAS");
  });
});

function request(body: unknown): Request {
  return new Request("http://localhost/api/airports/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
