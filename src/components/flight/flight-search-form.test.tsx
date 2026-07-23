import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { FlightSearchForm } from "@/components/flight/flight-search-form";

describe("FlightSearchForm", () => {
  it("requires a flight number and native calendar date", () => {
    render(<FlightSearchForm onConfirm={vi.fn()} />);

    expect(screen.getByLabelText("航班編號")).toBeRequired();
    expect(screen.getByLabelText("出發日期")).toHaveAttribute("type", "date");
    expect(screen.getByLabelText("出發日期")).toBeRequired();
  });

  it("asks for explicit confirmation and never auto-confirms a match", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const fetchFn = vi.fn().mockResolvedValue(
      response({
        data: [candidate("AB123"), candidate("XY999")],
      }),
    );
    render(<FlightSearchForm onConfirm={onConfirm} fetchFn={fetchFn} />);

    await user.type(screen.getByLabelText("航班編號"), "ab 123");
    await user.type(screen.getByLabelText("出發日期"), "2026-06-01");
    await user.click(screen.getByRole("button", { name: "搜尋航班" }));

    expect(
      await screen.findByText("你搭乘的是否是這個航班？"),
    ).toBeVisible();
    expect(screen.getAllByRole("button", { name: "是" })).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: "重新輸入" }),
    ).toBeVisible();
    expect(onConfirm).not.toHaveBeenCalled();

    await user.click(screen.getAllByRole("button", { name: "是" })[1]);
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ flightNumber: "XY999" }),
    );
  });

  it("offers manual airport and time fallback after no_data", async () => {
    const user = userEvent.setup();
    const fetchFn = vi.fn().mockResolvedValue(
      response(
        {
          error: {
            code: "no_data",
            message: "找不到航班",
            retryable: false,
          },
        },
        404,
      ),
    );
    render(<FlightSearchForm onConfirm={vi.fn()} fetchFn={fetchFn} />);

    await user.type(screen.getByLabelText("航班編號"), "AB123");
    await user.type(screen.getByLabelText("出發日期"), "2026-06-01");
    await user.click(screen.getByRole("button", { name: "搜尋航班" }));

    expect(await screen.findByText("手動輸入航班資料")).toBeVisible();
    expect(screen.getByLabelText("出發機場代碼")).toBeVisible();
    expect(screen.getByLabelText("抵達機場代碼")).toBeVisible();
    expect(screen.getByLabelText("出發時間")).toHaveAttribute(
      "type",
      "datetime-local",
    );
    expect(screen.getByLabelText("抵達時間")).toHaveAttribute(
      "type",
      "datetime-local",
    );
  });

  it("confirms manually entered airports and offset-aware times", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        response(
          {
            error: {
              code: "no_data",
              message: "找不到航班",
              retryable: false,
            },
          },
          404,
        ),
      )
      .mockResolvedValueOnce(
        response({
          data: [
            {
              name: "Synthetic Origin",
              city: "Origin City",
              iata: "ORG",
              icao: "TORG",
              point: { lat: 0, lon: 0 },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        response({
          data: [
            {
              name: "Synthetic Destination",
              city: "Destination City",
              iata: "DST",
              icao: "TDST",
              point: { lat: 0, lon: 0.05 },
            },
          ],
        }),
      );
    render(
      <FlightSearchForm onConfirm={onConfirm} fetchFn={fetchFn} />,
    );

    await user.type(screen.getByLabelText("航班編號"), "AB123");
    await user.type(screen.getByLabelText("出發日期"), "2026-06-01");
    await user.click(screen.getByRole("button", { name: "搜尋航班" }));
    await screen.findByText("手動輸入航班資料");

    await user.type(screen.getByLabelText("出發機場代碼"), "ORG");
    await user.type(screen.getByLabelText("抵達機場代碼"), "DST");
    await user.type(screen.getByLabelText("出發時間"), "2026-06-01T10:00");
    await user.clear(screen.getByLabelText("出發 UTC 時差"));
    await user.type(screen.getByLabelText("出發 UTC 時差"), "+08:00");
    await user.type(screen.getByLabelText("抵達時間"), "2026-06-01T14:00");
    await user.clear(screen.getByLabelText("抵達 UTC 時差"));
    await user.type(screen.getByLabelText("抵達 UTC 時差"), "+09:00");
    await user.click(screen.getByRole("button", { name: "確認手動資料" }));

    await waitFor(() =>
      expect(onConfirm).toHaveBeenCalledWith(
        expect.objectContaining({
          flightNumber: "AB123",
          scheduledDeparture: "2026-06-01T10:00:00+08:00",
          scheduledArrival: "2026-06-01T14:00:00+09:00",
          departureAirport: expect.objectContaining({ iata: "ORG" }),
          arrivalAirport: expect.objectContaining({ iata: "DST" }),
        }),
      ),
    );
  });

  it("shows a safe provider message without raw response details", async () => {
    const user = userEvent.setup();
    const fetchFn = vi
      .fn()
      .mockResolvedValue(
        response(
          {
            error: {
              code: "auth",
              message: "尚未設定 AeroDataBox API key。",
              retryable: false,
            },
          },
          503,
        ),
      );
    render(<FlightSearchForm onConfirm={vi.fn()} fetchFn={fetchFn} />);

    await user.type(screen.getByLabelText("航班編號"), "AB123");
    await user.type(screen.getByLabelText("出發日期"), "2026-06-01");
    await user.click(screen.getByRole("button", { name: "搜尋航班" }));

    await waitFor(() =>
      expect(
        screen.getByRole("alert"),
      ).toHaveTextContent("尚未設定 AeroDataBox API key。"),
    );
  });
});

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function candidate(flightNumber: string) {
  return {
    id: `${flightNumber}-synthetic`,
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
      point: { lat: 0, lon: 0.05 },
    },
    scheduledDeparture: "2026-06-01T10:00:00+08:00",
    scheduledArrival: "2026-06-01T14:00:00+09:00",
    durationMinutes: 180,
  };
}
