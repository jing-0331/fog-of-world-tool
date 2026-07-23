import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DateRangeSelector } from "@/components/timeline/date-range-selector";

const available = { min: "2026-01-01", max: "2026-01-03" };

describe("DateRangeSelector", () => {
  it("shows the discovered range and mutually exclusive choices", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <DateRangeSelector available={available} onChange={onChange} />,
    );

    expect(screen.getByText(/2026-01-01.*2026-01-03/)).toBeInTheDocument();
    const all = screen.getByRole("radio", { name: "全部時間" });
    const custom = screen.getByRole("radio", { name: "選取區間" });
    expect(all).not.toBeChecked();
    expect(custom).not.toBeChecked();

    await user.click(all);
    expect(all).toBeChecked();
    expect(custom).not.toBeChecked();
    expect(onChange).toHaveBeenLastCalledWith({
      startDate: "2026-01-01",
      endDate: "2026-01-03",
    });
  });

  it("constrains custom inputs to the file range and accepts inclusive endpoints", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <DateRangeSelector available={available} onChange={onChange} />,
    );

    await user.click(screen.getByRole("radio", { name: "選取區間" }));
    const start = screen.getByLabelText("開始日期");
    const end = screen.getByLabelText("結束日期");
    expect(start).toHaveAttribute("min", available.min);
    expect(start).toHaveAttribute("max", available.max);
    expect(end).toHaveAttribute("min", available.min);
    expect(end).toHaveAttribute("max", available.max);

    await user.clear(start);
    await user.type(start, "2026-01-01");
    await user.clear(end);
    await user.type(end, "2026-01-03");

    expect(onChange).toHaveBeenLastCalledWith({
      startDate: "2026-01-01",
      endDate: "2026-01-03",
    });
  });
});
