import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test, type Route } from "@playwright/test";

const fixture = join(
  process.cwd(),
  "src/test/fixtures/timeline/new-format-sanitized.json",
);
const reviewFixture = join(
  process.cwd(),
  "src/test/fixtures/timeline/live-review-sanitized.json",
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
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: /下載 GPX 檔案/ }).click();
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

test("live review queue prioritizes a persisted manual repair before queued automatic work", async ({
  page,
}) => {
  const secondOrsGate = deferred<void>();
  const tdxGate = deferred<void>();
  const requestOrder: string[] = [];
  let tdxFinished = false;

  await page.route("**/api/routes/repair", async (route) => {
    const body = route.request().postDataJSON() as {
      id: string;
      mode: string;
      startPoint: { lat: number; lon: number };
      endPoint: { lat: number; lon: number };
      startTime: string;
      endTime: string;
    };
    const startLat = body.startPoint.lat;

    if (startLat === 10 && body.mode === "walking") {
      requestOrder.push("first-automatic");
      await fulfillFailure(route);
      return;
    }
    if (startLat === 10 && body.mode === "driving") {
      requestOrder.push("first-manual");
      await fulfillSuccess(route, body, "openrouteservice");
      return;
    }
    if (startLat === 11) {
      requestOrder.push("second-automatic");
      await secondOrsGate.promise;
      await fulfillSuccess(route, body, "openrouteservice");
      return;
    }
    if (startLat === 12) {
      requestOrder.push("third-automatic");
      await fulfillFailure(route);
      return;
    }
    if (startLat === 25) {
      requestOrder.push("tdx-automatic");
      await tdxGate.promise;
      tdxFinished = true;
      await fulfillFailure(route);
      return;
    }
    throw new Error(`Unexpected synthetic request: ${JSON.stringify(body)}`);
  });

  await page.goto("/timeline");
  await page
    .getByLabel("選擇 Google 時間軸 JSON")
    .setInputFiles(reviewFixture);
  await expect(page.getByText("上傳完成")).toBeVisible();
  await page.getByRole("radio", { name: "全部時間" }).check();
  await page.getByRole("button", { name: "開始產生 GPX" }).click();
  await expect(
    page.getByRole("heading", { name: "待人工確認路段" }),
  ).toBeVisible();
  await expect(page.getByText("10.00000, 10.00000")).toBeVisible();
  await expect(page.getByRole("button", { name: "取消處理" }))
    .toBeVisible();
  await expect.poll(() => requestOrder).toEqual(
    expect.arrayContaining([
      "first-automatic",
      "second-automatic",
      "tdx-automatic",
    ]),
  );
  expect(tdxFinished).toBe(false);

  tdxGate.resolve();
  await expect(page.getByText("1 / 2")).toBeVisible();
  await expect(page.getByText("10.00000, 10.00000")).toBeVisible();

  await page.getByLabel("修正交通方式").selectOption("driving");
  await page.getByRole("button", { name: "重新查詢" }).click();
  await expect(page.getByRole("button", { name: "查詢中…" }))
    .toBeVisible();
  expect(requestOrder).not.toContain("first-manual");
  expect(requestOrder).not.toContain("third-automatic");

  secondOrsGate.resolve();
  await expect.poll(() => requestOrder).toContain("third-automatic");
  expect(requestOrder.indexOf("first-manual")).toBeGreaterThan(
    requestOrder.indexOf("second-automatic"),
  );
  expect(requestOrder.indexOf("first-manual")).toBeLessThan(
    requestOrder.indexOf("third-automatic"),
  );
  await expect(
    page.getByText("路段查詢成功，已加入輸出路線。"),
  ).toBeVisible();
  await expect(page.getByText("10.00000, 10.00000")).toBeVisible();

  await expect(page.getByText("25.00000, 121.00000")).toBeVisible();
  await expect(
    page.getByRole("link", { name: /下載 GPX 檔案/ }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "此路段不存在" }).click();
  await expect(page.getByText("12.00000, 12.00000")).toBeVisible();
  await expect(
    page.getByRole("link", { name: /下載 GPX 檔案/ }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "此路段不存在" }).click();
  await expect(page.getByRole("progressbar")).toHaveAttribute("value", "4");
  await expect(page.getByRole("progressbar")).toHaveAttribute("max", "4");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: /下載 GPX 檔案/ }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).not.toBeNull();
  const gpx = await readFile(path!, "utf8");
  expect(gpx).toContain("<fowt:userOverride>true</fowt:userOverride>");
});

async function fulfillFailure(
  route: Route,
) {
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
}

async function fulfillSuccess(
  route: Route,
  body: {
    startPoint: { lat: number; lon: number };
    endPoint: { lat: number; lon: number };
    startTime: string;
    endTime: string;
  },
  source: "openrouteservice" | "tdx" | "transitous",
) {
  await route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      data: {
        points: [
          { ...body.startPoint, time: body.startTime },
          { ...body.endPoint, time: body.endTime },
        ],
        provenance: {
          kind:
            source === "openrouteservice"
              ? "ground-route"
              : "transit-route",
          source,
          referenceDate:
            source === "openrouteservice" ? null : "2026-07-23",
          approximate: true,
          explanation: "合成修正路線",
        },
        attempts: [
          {
            source,
            status: "success",
            message: "合成修正路線",
            retryable: false,
          },
        ],
      },
    }),
  });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
