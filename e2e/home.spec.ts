import { expect, test } from "@playwright/test";

test("home exposes flight and Timeline workflows", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("link", { name: /航班/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /時間軸/ })).toBeVisible();
  await expect(page.getByText(/原始時間軸留在瀏覽器內/)).toBeVisible();
});
