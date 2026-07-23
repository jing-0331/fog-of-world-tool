import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import FlightPage, {
  resolveFlightsForExport,
} from "@/app/flight/page";

describe("resolveFlightsForExport", () => {
  it("continues after one failed flight and reports deterministic progress", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: "no_data",
              message: "No route",
              retryable: false,
            },
          }),
          { status: 404 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              segment: routeSegment("second"),
              attempts: [],
            },
          }),
          { status: 200 },
        ),
      );
    const progress: string[] = [];

    const result = await resolveFlightsForExport(
      [flight("first", "AB123"), flight("second", "XY999")],
      {
        fetchFn,
        onProgress: (message) => progress.push(message),
      },
    );

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(result.segments).toHaveLength(1);
    expect(result.failures).toEqual([
      { flightNumber: "AB123", message: "No route" },
    ]);
    expect(progress).toEqual([
      "正在搜索第 1 個航班的路線",
      "正在搜索第 2 個航班的路線",
      "正在將第 2 個航班轉換為 GPX 檔",
    ]);
  });
});

describe("FlightPage", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.stubGlobal("fetch", vi.fn());
    vi.stubGlobal(
      "URL",
      Object.assign(URL, {
        createObjectURL: vi.fn(() => "blob:synthetic"),
        revokeObjectURL: vi.fn(),
      }),
    );
  });

  it("asks for final confirmation before exporting", async () => {
    sessionStorage.setItem(
      "fog-of-world:confirmed-flights",
      JSON.stringify({
        version: 1,
        flights: [flight("first", "AB123")],
      }),
    );
    const user = userEvent.setup();
    render(<FlightPage />);

    await waitFor(() =>
      expect(screen.getByText("AB123")).toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: "匯出 GPX" }));

    expect(screen.getByText("航班資訊是否無誤？")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "確認並開始匯出" }),
    ).toBeVisible();
  });
});

function flight(id: string, flightNumber: string) {
  return {
    id,
    flightNumber,
    status: "Arrived",
    canceled: false,
    departureAirport: {
      name: "Synthetic Origin",
      city: "Origin City",
      iata: "ORG",
      icao: "TORG",
      point: { lat: 0, lon: 0 },
    },
    arrivalAirport: {
      name: "Synthetic Destination",
      city: "Destination City",
      iata: "DST",
      icao: "TDST",
      point: { lat: 0, lon: 0.01 },
    },
    scheduledDeparture: "2026-06-01T10:00:00Z",
    scheduledArrival: "2026-06-01T11:00:00Z",
    durationMinutes: 60,
    confirmedAt: "2026-06-01T12:00:00Z",
  };
}

function routeSegment(id: string) {
  return {
    id,
    name: "XY999",
    mode: "flying",
    points: [
      { lat: 0, lon: 0, time: "2026-06-01T10:00:00Z" },
      { lat: 0, lon: 0.01, time: "2026-06-01T11:00:00Z" },
    ],
    provenance: {
      kind: "great-circle",
      source: "local-calculation",
      referenceDate: "2026-06-01",
      approximate: true,
      explanation: "Synthetic",
    },
  };
}
