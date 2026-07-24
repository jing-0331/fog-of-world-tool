import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  FlightRouteSourceList,
  type ResolvedFlightRoute,
} from "@/components/flight/flight-route-source-list";

describe("FlightRouteSourceList", () => {
  it("renders the reference label once followed by the date only", () => {
    render(<FlightRouteSourceList routes={[filedRoute()]} />);

    const row = screen.getByRole("listitem");
    const reference = row.querySelector('[data-field="reference"]');

    expect(reference).not.toBeNull();
    expect(reference).toHaveTextContent(/^參考日期2026-07-19$/);
    expect(reference?.textContent?.match(/參考日期/g)).toHaveLength(1);
  });
});

function filedRoute(): ResolvedFlightRoute {
  return {
    flight: {
      id: "filed",
      flightNumber: "CD300",
      status: "Arrived",
      canceled: false,
      departureAirport: {
        name: "Synthetic Origin",
        city: "Origin City",
        iata: "ORG",
        point: { lat: 0, lon: 0 },
      },
      arrivalAirport: {
        name: "Synthetic Destination",
        city: "Destination City",
        iata: "DST",
        point: { lat: 0, lon: 0.01 },
      },
      scheduledDeparture: "2026-06-03T10:00:00Z",
      scheduledArrival: "2026-06-03T11:00:00Z",
      durationMinutes: 60,
      confirmedAt: "2026-06-03T12:00:00Z",
    },
    segment: {
      id: "filed-route",
      name: "CD300",
      mode: "flying",
      points: [
        { lat: 0, lon: 0, time: "2026-06-03T10:00:00Z" },
        { lat: 0, lon: 0.01, time: "2026-06-03T11:00:00Z" },
      ],
      provenance: {
        kind: "filed-plan",
        source: "flight-plan-database",
        referenceDate: "2026-07-19",
        approximate: true,
        explanation: "Synthetic",
      },
    },
  };
}
