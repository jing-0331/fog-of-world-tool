import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SourceBadge } from "@/components/source-badge";

describe("SourceBadge", () => {
  it("uses text and styling to communicate route kind and source", () => {
    render(
      <SourceBadge
        kind="actual-track"
        source="opensky"
        referenceDate="2026-07-20"
      />,
    );

    expect(screen.getByText("實際軌跡")).toBeVisible();
    expect(screen.getByText("OpenSky")).toBeVisible();
    expect(screen.queryByText("參考日期 2026-07-20")).not.toBeInTheDocument();
    expect(screen.getByTestId("source-badge")).toHaveAttribute(
      "data-route-kind",
      "actual-track",
    );
  });

  it("identifies approximate routes in text", () => {
    render(
      <SourceBadge
        kind="great-circle"
        source="local-calculation"
        approximate
      />,
    );

    expect(screen.getByText("近似路線")).toBeVisible();
  });

  it("shows reference dates for filed routes but not direct lines", () => {
    const { rerender } = render(
      <SourceBadge
        kind="filed-plan"
        source="flight-plan-database"
        referenceDate="2026-07-20"
      />,
    );

    expect(screen.getByText("參考日期 2026-07-20")).toBeVisible();

    rerender(
      <SourceBadge
        kind="direct-line"
        source="local-calculation"
        referenceDate="2026-07-20"
      />,
    );
    expect(screen.queryByText("參考日期 2026-07-20")).not.toBeInTheDocument();
  });
});
