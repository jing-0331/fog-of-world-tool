import { join } from "node:path";

import { expect, test } from "@playwright/test";

const fixture = join(
  process.cwd(),
  "src/test/fixtures/timeline/review-sanitized.json",
);

test("raw Timeline JSON and profile fields never leave the browser", async ({
  page,
}) => {
  const requestBodies: string[] = [];
  page.on("request", (request) => {
    const body = request.postData();
    if (body) requestBodies.push(body);
  });
  await page.route("**/api/routes/repair", async (route) => {
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
  });

  await page.goto("/timeline");
  await page
    .getByLabel("選擇 Google 時間軸 JSON")
    .setInputFiles(fixture);
  await expect(page.getByText("上傳完成")).toBeVisible();
  await page.getByRole("radio", { name: "全部時間" }).check();
  await page.getByRole("button", { name: "開始產生 GPX" }).click();
  await expect(page.getByRole("heading", { name: "待人工確認路段" })).toBeVisible();

  const transmitted = requestBodies.join("\n");
  expect(transmitted).not.toContain("semanticSegments");
  expect(transmitted).not.toContain("wifiScan");
  expect(transmitted).not.toContain("userLocationProfile");
  expect(transmitted).not.toContain("raw-profile-marker");
});
