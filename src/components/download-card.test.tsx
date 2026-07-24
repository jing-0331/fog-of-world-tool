import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DownloadCard } from "@/components/download-card";

describe("DownloadCard", () => {
  it("groups file details and exposes a clearly named button-style download", () => {
    render(
      <DownloadCard
        filename="FlightRoute260724.gpx"
        url="blob:synthetic"
        size={1_536}
        warning="部分航班未成功，已產生可下載的部分結果。"
      />,
    );

    const card = screen.getByRole("region", {
      name: "GPX 已準備完成",
    });
    const details = within(card).getByTestId("download-file-details");

    expect(within(details).getByText("FlightRoute260724.gpx")).toBeVisible();
    expect(within(details).getByText("1.5 KB")).toBeVisible();
    expect(within(card).getByRole("status")).toHaveTextContent(
      "部分航班未成功，已產生可下載的部分結果。",
    );

    const download = within(card).getByRole("link", {
      name: "下載 GPX 檔案：FlightRoute260724.gpx",
    });
    expect(download).toHaveAttribute("download", "FlightRoute260724.gpx");
    expect(download).toHaveClass("download-button");
  });
});
