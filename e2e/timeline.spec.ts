import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

const fixture = join(
  process.cwd(),
  "src/test/fixtures/timeline/new-format-sanitized.json",
);
const reviewFixture = join(
  process.cwd(),
  "src/test/fixtures/timeline/review-sanitized.json",
);

test("uploads a synthetic Timeline and exports source-labelled GPX", async ({
  page,
}) => {
  await page.goto("/timeline");
  await page
    .getByLabel("選擇 Google 時間軸 JSON")
    .setInputFiles(fixture);
  await expect(page.getByText("上傳完成")).toBeVisible();
  await expect(page.getByText(/2026-01-01.*2026-01-03/)).toBeVisible();
  await page.getByRole("radio", { name: "全部時間" }).check();
  await page.getByRole("button", { name: "開始產生 GPX" }).click();

  await expect(
    page.getByRole("heading", { name: "處理報告" }),
  ).toHaveCount(0);
  await expect(page.getByText("時間軸記錄")).toHaveCount(0);
  await expect(page.getByTestId("source-badge")).toHaveCount(0);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "下載 GPX" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^TimelineRoute\d{6}\.gpx$/);
  const path = await download.path();
  expect(path).not.toBeNull();
  const gpx = await readFile(path!, "utf8");
  expect(gpx).toContain("<fowt:kind>recorded-timeline</fowt:kind>");
  expect(gpx).toContain("<fowt:source>google-timeline</fowt:source>");
  expect(gpx).toContain(
    "<fowt:skippedFlightCount>1</fowt:skippedFlightCount>",
  );
});

test("review queue can correct, exclude, and postpone unresolved gaps", async ({
  page,
}) => {
  await page.route("**/api/routes/repair", async (route) => {
    const body = route.request().postDataJSON() as {
      id: string;
      mode: string;
      startPoint: { lat: number; lon: number };
      endPoint: { lat: number; lon: number };
      startTime: string;
      endTime: string;
    };
    if (body.mode !== "bus") {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "no_data",
            message: "合成來源皆失敗",
            retryable: false,
          },
        }),
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          points: [
            { ...body.startPoint, time: body.startTime },
            { ...body.endPoint, time: body.endTime },
          ],
          provenance: {
            kind: "transit-route",
            source: "transitous",
            referenceDate: "2026-07-23",
            approximate: true,
            explanation: "合成修正路線",
          },
          attempts: [
            {
              source: "transitous",
              status: "success",
              message: "合成修正路線",
              retryable: false,
            },
          ],
        },
      }),
    });
  });

  await page.goto("/timeline");
  await page
    .getByLabel("選擇 Google 時間軸 JSON")
    .setInputFiles(reviewFixture);
  await expect(page.getByText("上傳完成")).toBeVisible();
  await page.getByRole("radio", { name: "全部時間" }).check();
  await page.getByRole("button", { name: "開始產生 GPX" }).click();
  await expect(page.getByRole("heading", { name: "待人工確認路段" })).toBeVisible();

  await page.getByLabel("修正交通方式").selectOption("bus");
  await page.getByRole("button", { name: "重新查詢" }).click();
  await expect(page.getByText(/1 \/ 2/)).toBeVisible();

  await page.getByRole("button", { name: "此路段不存在" }).click();
  await expect(page.getByText(/1 \/ 1/)).toBeVisible();

  await page.getByRole("button", { name: "暫時略過" }).click();
  await expect(page.getByText(/1 \/ 1/)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "處理報告" }),
  ).toHaveCount(0);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "下載 GPX" }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).not.toBeNull();
  const gpx = await readFile(path!, "utf8");
  expect(gpx).toContain("<fowt:userOverride>true</fowt:userOverride>");
});
