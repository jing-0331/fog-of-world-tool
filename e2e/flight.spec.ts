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

  await expect(page.getByText("實際軌跡").first()).toBeVisible();
  await expect(page.getByText("OpenSky").first()).toBeVisible();
  await expect(page.getByText("參考日期 2026-01-01").first()).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "下載 GPX" }).click();
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
