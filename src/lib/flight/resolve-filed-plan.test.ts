import { describe, expect, it, vi } from "vitest";

import type { ConfirmedFlight } from "@/lib/domain/types";
import { resolveFiledPlan } from "@/lib/flight/resolve-filed-plan";

describe("resolveFiledPlan", () => {
  it("requires confirmed airport endpoints and a usable intermediate navaid", async () => {
    const findNavaid = vi.fn(async (ident: string) =>
      ident === "FIX" ? { lat: 0.01, lon: 0.025 } : Promise.reject(),
    );

    await expect(resolveFiledPlan(flight(), findNavaid)).resolves.toEqual([
      { lat: 0, lon: 0 },
      { lat: 0.01, lon: 0.025 },
      { lat: 0, lon: 0.05 },
    ]);
    expect(findNavaid).toHaveBeenCalledWith("FIX");
  });

  it("rejects a filed string whose confirmed endpoints differ", async () => {
    const candidate = flight();
    candidate.filedRoute = "WRNG FIX TDST";
    const findNavaid = vi.fn();

    await expect(resolveFiledPlan(candidate, findNavaid)).resolves.toBeNull();
    expect(findNavaid).not.toHaveBeenCalled();
  });

  it("does not label a route filed-plan when no intermediate navaid resolves", async () => {
    const findNavaid = vi.fn().mockRejectedValue(new Error("no data"));

    await expect(resolveFiledPlan(flight(), findNavaid)).resolves.toBeNull();
  });
});

function flight(): ConfirmedFlight {
  return {
    id: "filed-flight",
    flightNumber: "AB123",
    status: "Arrived",
    canceled: false,
    departureAirport: {
      name: "Synthetic Origin",
      city: "Origin City",
      icao: "TORG",
      point: { lat: 0, lon: 0 },
    },
    arrivalAirport: {
      name: "Synthetic Destination",
      city: "Destination City",
      icao: "TDST",
      point: { lat: 0, lon: 0.05 },
    },
    scheduledDeparture: "2026-07-22T10:00:00Z",
    scheduledArrival: "2026-07-22T12:00:00Z",
    actualDeparture: "2026-07-22T10:00:00Z",
    actualArrival: "2026-07-22T12:00:00Z",
    durationMinutes: 120,
    filedRoute: "TORG DCT FIX TDST",
    confirmedAt: "2026-07-22T13:00:00Z",
  };
}
