import { expect, test } from "@playwright/test";

test("login is readable, keyboard reachable, and has no horizontal overflow", async ({ page }) => {
  await page.goto("/login");
  await expect(
    page.getByRole("heading", { name: "Aturan kantor, tanpa tebak-tebakan." }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Masuk ke ruang kerja" })).toBeVisible();
  await page.getByPlaceholder("nama@perusahaan.id").focus();
  await page.keyboard.press("Tab");
  await expect(page.locator('input[type="password"]')).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
