import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import DataSourcesPage from "@/app/data-sources/page";

describe("data sources page", () => {
  it("mirrors essential attribution and provider limitations", () => {
    render(<DataSourcesPage />);

    expect(
      screen.getByRole("heading", { name: "資料來源與使用限制" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/實際軌跡、申報航路、模擬航路與近似路線/)).toBeInTheDocument();
    expect(screen.getByText(/歷史大眾運輸路線使用目前可用的路網/)).toBeInTheDocument();
    expect(screen.getByText(/原始 Timeline JSON 不會離開瀏覽器/)).toBeInTheDocument();
    expect(screen.getByText(/僅供飛行模擬/)).toBeInTheDocument();
    expect(screen.getByText(/best-effort/i)).toBeInTheDocument();

    expect(
      screen.getByRole("link", { name: "AeroDataBox" }),
    ).toHaveAttribute("href", "https://doc.aerodatabox.com/");
    expect(screen.getByRole("link", { name: "OpenSky" })).toHaveAttribute(
      "href",
      "https://opensky-network.org/data/api",
    );
    expect(
      screen.getByRole("link", { name: "Flight Plan Database" }),
    ).toHaveAttribute("href", "https://flightplandatabase.com/dev/api");
    expect(
      screen.getByRole("link", { name: "OpenRouteService" }),
    ).toHaveAttribute(
      "href",
      "https://giscience.github.io/openrouteservice/frequently-asked-questions.html#when-and-how-does-my-quota-reset",
    );
    expect(
      screen.getByText(/rolling 60 秒最多 40 次/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/rolling 24 小時 2,000 次/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/單一 server process 內排隊 Directions/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/多實例部署需要共享 limiter/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/dashboard.*x-ratelimit-remaining.*x-ratelimit-reset/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "OpenStreetMap" })).toHaveAttribute(
      "href",
      "https://www.openstreetmap.org/copyright",
    );
    expect(screen.getByRole("link", { name: "Transitous" })).toHaveAttribute(
      "href",
      "https://transitous.org/api/",
    );
    expect(screen.getByRole("link", { name: "TDX" })).toHaveAttribute(
      "href",
      "https://tdx.transportdata.tw/api-service/swagger/maas/4513f9d6-caae-4cf7-a50c-e7887bec804e",
    );
    expect(screen.getByText(/台灣境內的大眾運輸路線/)).toBeInTheDocument();
    expect(
      screen.getByText(/免付費方案每分鐘最多 5 次請求/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Google Timeline 匯出說明" }),
    ).toHaveAttribute("href", "https://support.google.com/maps/answer/6258979");
  });
});
