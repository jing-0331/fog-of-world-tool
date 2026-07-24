import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ConfirmedFlightList } from "@/components/flight/confirmed-flight-list";

describe("ConfirmedFlightList", () => {
  it("renders the add action as an outlined button", () => {
    render(
      <ConfirmedFlightList
        flights={[flight()]}
        onAdd={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "＋ 新增下一個航班" }),
    ).toHaveClass("add-flight-button");
  });

  it("shows airport-local details and supports add, edit, and delete", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    render(
      <ConfirmedFlightList
        flights={[flight()]}
        onAdd={onAdd}
        onEdit={onEdit}
        onDelete={onDelete}
      />,
    );

    expect(screen.getByText("Origin City · Synthetic Origin（ORG）")).toBeVisible();
    expect(
      screen.getByText("2026-06-01T10:00:00+08:00"),
    ).toBeVisible();
    expect(screen.getByText("180 分鐘")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "編輯 AB123" }));
    await user.click(screen.getByRole("button", { name: "刪除 AB123" }));
    await user.click(
      screen.getByRole("button", { name: "＋ 新增下一個航班" }),
    );

    expect(onEdit).toHaveBeenCalledWith(flight());
    expect(onDelete).toHaveBeenCalledWith("AB123-synthetic");
    expect(onAdd).toHaveBeenCalled();
  });
});

function flight() {
  return {
    id: "AB123-synthetic",
    flightNumber: "AB123",
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
    confirmedAt: "2026-06-01T15:00:00Z",
  };
}
