import {
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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

  it("passes one abort signal to every resolve request", async () => {
    const controller = new AbortController();
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            segment: routeSegment("resolved"),
            attempts: [],
          },
        }),
        { status: 200 },
      ),
    );

    await resolveFlightsForExport(
      [flight("first", "AB123"), flight("second", "XY999")],
      { fetchFn, signal: controller.signal },
    );

    expect(fetchFn).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchFn.mock.calls) {
      expect(init?.signal).toBe(controller.signal);
    }
  });

  it("treats abort as cancellation and does not start remaining flights", async () => {
    const controller = new AbortController();
    const abortError = () =>
      new DOMException("The operation was aborted.", "AbortError");
    const fetchFn = vi.fn(
      () =>
        new Promise<Response>((_resolve, reject) => {
          if (controller.signal.aborted) {
            reject(abortError());
            return;
          }
          controller.signal.addEventListener(
            "abort",
            () => reject(abortError()),
            { once: true },
          );
        }),
    );

    const pending = resolveFlightsForExport(
      [flight("first", "AB123"), flight("second", "XY999")],
      { fetchFn, signal: controller.signal },
    );
    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));

    controller.abort();
    const result = await pending;

    expect(result).toMatchObject({
      canceled: true,
      segments: [],
      failures: [],
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("treats a plain Error named AbortError as cancellation", async () => {
    const abortError = new Error("The operation was aborted.");
    abortError.name = "AbortError";
    const fetchFn = vi.fn().mockRejectedValue(abortError);

    const result = await resolveFlightsForExport(
      [flight("first", "AB123")],
      { fetchFn },
    );

    expect(result).toMatchObject({
      canceled: true,
      routes: [],
      segments: [],
      failures: [],
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
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

  it("hides export while processing and restores it after cancellation", async () => {
    sessionStorage.setItem(
      "fog-of-world:confirmed-flights",
      JSON.stringify({
        version: 1,
        flights: [flight("first", "AB123"), flight("second", "XY999")],
      }),
    );
    let observedSignal: AbortSignal | undefined;
    const fetchFn = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          observedSignal = init?.signal ?? undefined;
          observedSignal?.addEventListener(
            "abort",
            () =>
              reject(
                new DOMException(
                  "The operation was aborted.",
                  "AbortError",
                ),
              ),
            { once: true },
          );
        }),
    );
    vi.stubGlobal("fetch", fetchFn);
    const user = userEvent.setup();
    render(<FlightPage />);
    await screen.findByText("AB123");

    await user.click(screen.getByRole("button", { name: "匯出 GPX" }));
    await user.click(
      screen.getByRole("button", { name: "確認並開始匯出" }),
    );

    expect(
      screen.queryByRole("button", { name: "匯出 GPX" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "取消處理" }),
    ).toBeVisible();

    await user.click(screen.getByRole("button", { name: "取消處理" }));

    expect(observedSignal?.aborted).toBe(true);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "匯出 GPX" }),
      ).toBeVisible(),
    );
    expect(
      screen.queryByRole("button", { name: "取消處理" }),
    ).not.toBeInTheDocument();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("heading", { name: "未匯出的航班" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /下載 GPX 檔案/ }),
    ).not.toBeInTheDocument();
  });

  it("restores the idle controls after a completed export", async () => {
    sessionStorage.setItem(
      "fog-of-world:confirmed-flights",
      JSON.stringify({
        version: 1,
        flights: [flight("first", "AB123")],
      }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: {
              segment: routeSegment("first"),
              attempts: [],
            },
          }),
          { status: 200 },
        ),
      ),
    );
    const user = userEvent.setup();
    render(<FlightPage />);
    await screen.findByText("AB123");

    await user.click(screen.getByRole("button", { name: "匯出 GPX" }));
    await user.click(
      screen.getByRole("button", { name: "確認並開始匯出" }),
    );

    expect(
      await screen.findByRole("link", { name: /下載 GPX 檔案/ }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "匯出 GPX" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "取消處理" }),
    ).not.toBeInTheDocument();
  });

  it("keeps one source row matched to each successful flight", async () => {
    const flights = [
      flight("failed", "AB123", "2026-06-01"),
      flight("actual", "XY200", "2026-06-02"),
      flight("filed", "CD300", "2026-06-03"),
      flight("simulated", "EF400", "2026-06-04"),
      flight("direct", "GH500", "2026-06-05"),
    ];
    sessionStorage.setItem(
      "fog-of-world:confirmed-flights",
      JSON.stringify({ version: 1, flights }),
    );
    vi.stubGlobal(
      "fetch",
      vi
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
          routeResponse(
            "actual",
            "actual-track",
            "opensky",
            "2026-07-20",
          ),
        )
        .mockResolvedValueOnce(
          routeResponse(
            "filed",
            "filed-plan",
            "flight-plan-database",
            "2026-07-19",
          ),
        )
        .mockResolvedValueOnce(
          routeResponse(
            "simulated",
            "simulated-plan",
            "aerodatabox",
            "2026-07-18",
          ),
        )
        .mockResolvedValueOnce(
          routeResponse(
            "direct",
            "direct-line",
            "local-calculation",
            "2026-07-17",
          ),
        ),
    );
    const user = userEvent.setup();
    render(<FlightPage />);
    await screen.findByText("AB123");

    await user.click(screen.getByRole("button", { name: "匯出 GPX" }));
    await user.click(
      screen.getByRole("button", { name: "確認並開始匯出" }),
    );

    const list = await screen.findByRole("list", {
      name: "各航班路線來源",
    });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(4);
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringMatching(
        /XY200.*2026-06-02.*OpenSky.*實際軌跡/,
      ),
      expect.stringMatching(
        /CD300.*2026-06-03.*Flight Plan Database.*申報航路.*參考日期2026-07-19/,
      ),
      expect.stringMatching(
        /EF400.*2026-06-04.*AeroDataBox.*模擬航路.*參考日期2026-07-18/,
      ),
      expect.stringMatching(
        /GH500.*2026-06-05.*本機計算.*直接連線/,
      ),
    ]);
    expect(rows[0]).not.toHaveTextContent("參考日期");
    expect(rows[3]).not.toHaveTextContent("參考日期");
    expect(rows.map((row) => row.textContent).join(" ")).not.toContain(
      "AB123",
    );
    expect(
      within(
        screen.getByRole("region", { name: "未匯出的航班" }),
      ).getByText(/AB123.*No route/),
    ).toBeVisible();
  });
});

function flight(
  id: string,
  flightNumber: string,
  departureDate = "2026-06-01",
) {
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
    scheduledDeparture: `${departureDate}T10:00:00Z`,
    scheduledArrival: `${departureDate}T11:00:00Z`,
    durationMinutes: 60,
    confirmedAt: "2026-06-01T12:00:00Z",
  };
}

function routeResponse(
  id: string,
  kind: string,
  source: string,
  referenceDate: string,
) {
  return new Response(
    JSON.stringify({
      data: {
        segment: {
          ...routeSegment(id),
          provenance: {
            kind,
            source,
            referenceDate,
            approximate: kind !== "actual-track",
            explanation: "Synthetic",
          },
        },
        attempts: [],
      },
    }),
    { status: 200 },
  );
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
