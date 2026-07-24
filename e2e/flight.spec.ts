import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

test("confirms multiple flights and exports source-labelled GPX", async ({
  page,
}) => {
  let searchCount = 0;
  await page.route("**/api/flights/search", async (route) => {
    const body = route.request().postDataJSON() as {
      flightNumber: string;
      departureDate: string;
    };
    searchCount += 1;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: [candidate(body.flightNumber.replaceAll(" ", ""), searchCount)],
      }),
    });
  });
  await page.route("**/api/flights/resolve-route", async (route) => {
    const body = route.request().postDataJSON() as {
      flight: { id: string; flightNumber: string };
    };
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          segment: {
            id: `route:${body.flight.id}`,
            name: body.flight.flightNumber,
            mode: "flying",
            points: [
              { lat: 0, lon: 0, time: "2026-01-01T00:00:00Z" },
              { lat: 0.005, lon: 0.005, time: "2026-01-01T00:10:00Z" },
            ],
            provenance: {
              kind: "actual-track",
              source: "opensky",
              referenceDate: "2026-01-01",
              approximate: false,
              explanation: "合成測試軌跡",
            },
          },
          attempts: [],
        },
      }),
    });
  });

  await page.goto("/flight");
  await confirmFlight(page, "AB 101");
  await page.getByRole("button", { name: "＋ 新增下一個航班" }).click();
  await confirmFlight(page, "CD 202");

  await expect(page.getByText("第 1 段")).toBeVisible();
  await expect(page.getByText("第 2 段")).toBeVisible();
  await page.getByRole("button", { name: "匯出 GPX" }).click();
  await page
    .getByRole("button", { name: "確認並開始匯出" })
    .click();

  const sourceRows = page
    .getByRole("list", { name: "各航班路線來源" })
    .getByRole("listitem");
  await expect(sourceRows).toHaveCount(2);
  await expect(sourceRows.nth(0)).toContainText(
    /AB101.*2026-01-01.*OpenSky.*實際軌跡/,
  );
  await expect(sourceRows.nth(1)).toContainText(
    /CD202.*2026-01-01.*OpenSky.*實際軌跡/,
  );
  await expect(page.getByText("參考日期 2026-01-01")).toHaveCount(0);
  await expect
    .poll(() =>
      sourceRows
        .nth(0)
        .evaluate((row) =>
          getComputedStyle(row).gridTemplateColumns.split(" "),
        ),
    )
    .toHaveLength(5);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      sourceRows
        .nth(0)
        .evaluate((row) =>
          getComputedStyle(row).gridTemplateColumns.split(" "),
        ),
    )
    .toHaveLength(2);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: /下載 GPX 檔案/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^FlightRoute\d{6}\.gpx$/);
  const path = await download.path();
  expect(path).not.toBeNull();
  const gpx = await readFile(path!, "utf8");
  expect(gpx).toContain("<fowt:kind>actual-track</fowt:kind>");
  expect(gpx).toContain("<fowt:source>opensky</fowt:source>");
  expect(gpx).toContain(
    "<fowt:referenceDate>2026-01-01</fowt:referenceDate>",
  );
});

test("cancels the active request without resolving remaining flights", async ({
  page,
}) => {
  let searchCount = 0;
  await page.route("**/api/flights/search", async (route) => {
    const body = route.request().postDataJSON() as {
      flightNumber: string;
    };
    searchCount += 1;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: [candidate(body.flightNumber.replaceAll(" ", ""), searchCount)],
      }),
    });
  });

  let releaseRoute!: () => void;
  let markRouteStarted!: () => void;
  const routeStarted = new Promise<void>((resolve) => {
    markRouteStarted = resolve;
  });
  const routeHold = new Promise<void>((resolve) => {
    releaseRoute = resolve;
  });
  let resolveCount = 0;
  await page.route("**/api/flights/resolve-route", async (route) => {
    resolveCount += 1;
    markRouteStarted();
    await routeHold;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          segment: {
            id: "too-late",
            name: "Too late",
            mode: "flying",
            points: [
              { lat: 0, lon: 0, time: "2026-01-01T00:00:00Z" },
              { lat: 0.005, lon: 0.005, time: "2026-01-01T00:10:00Z" },
            ],
            provenance: {
              kind: "actual-track",
              source: "opensky",
              referenceDate: "2026-01-01",
              approximate: false,
              explanation: "不應下載",
            },
          },
          attempts: [],
        },
      }),
    });
  });

  await page.goto("/flight");
  await confirmFlight(page, "AB 101");
  await page.getByRole("button", { name: "＋ 新增下一個航班" }).click();
  await confirmFlight(page, "CD 202");
  await page.getByRole("button", { name: "匯出 GPX" }).click();
  await page
    .getByRole("button", { name: "確認並開始匯出" })
    .click();
  await routeStarted;

  await expect(page.getByRole("button", { name: "匯出 GPX" })).toHaveCount(0);
  const cancel = page.getByRole("button", { name: "取消處理" });
  await expect(cancel).toBeVisible();
  const actionStack = cancel.locator("..");
  const desktopGap = await actionStack.evaluate(
    (element) => getComputedStyle(element).rowGap,
  );
  expect(desktopGap).not.toBe("0px");

  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await actionStack.evaluate((element) => getComputedStyle(element).rowGap),
  ).toBe(desktopGap);
  await cancel.click();
  releaseRoute();

  await expect(page.getByRole("button", { name: "匯出 GPX" })).toBeVisible();
  await expect(page.getByRole("button", { name: "取消處理" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /下載 GPX 檔案/ })).toHaveCount(
    0,
  );
  expect(resolveCount).toBe(1);
});

async function confirmFlight(
  page: import("@playwright/test").Page,
  flightNumber: string,
) {
  await page.getByLabel("航班編號").fill(flightNumber);
  await page.getByLabel("出發日期").fill("2026-01-01");
  await page.getByRole("button", { name: "搜尋航班" }).click();
  await page.getByRole("button", { name: "是" }).click();
}

function candidate(flightNumber: string, index: number) {
  return {
    id: `candidate-${index}`,
    flightNumber,
    status: "Scheduled",
    canceled: false,
    departureAirport: {
      name: "Synthetic Origin",
      city: "Origin",
      iata: `A${index}A`,
      point: { lat: 0, lon: 0 },
    },
    arrivalAirport: {
      name: "Synthetic Destination",
      city: "Destination",
      iata: `B${index}B`,
      point: { lat: 1, lon: 1 },
    },
    scheduledDeparture: "2026-01-01T00:00:00Z",
    scheduledArrival: "2026-01-01T01:00:00Z",
    durationMinutes: 60,
  };
}
