import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Home from "@/app/page";

describe("home page", () => {
  it("offers the two exact Traditional Chinese workflows", () => {
    render(<Home />);

    expect(screen.getByRole("link", { name: "航班" })).toHaveAttribute(
      "href",
      "/flight",
    );
    expect(screen.getByRole("link", { name: "時間軸" })).toHaveAttribute(
      "href",
      "/timeline",
    );
    expect(screen.queryByText("Flight")).not.toBeInTheDocument();
    expect(screen.queryByText("Timeline")).not.toBeInTheDocument();
  });

  it("links visibly to data-source information", () => {
    render(<Home />);

    expect(screen.getByRole("link", { name: "資料來源" })).toHaveAttribute(
      "href",
      "/data-sources",
    );
  });
});
