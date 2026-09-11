import { expect, test } from "@playwright/test";

test("login is readable, keyboard reachable, and has no horizontal overflow", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Masuk ke ruang kerja" })).toBeVisible();
  await expect(page.getByText("Tanya kebijakan internal")).toBeVisible();
  await expect(page.getByText("Upload batches")).toBeVisible({
    timeout: 6_000,
  });
  await page.getByRole("button", { name: "Tampilkan Review confidential" }).click();
  await expect(page.getByText("Keputusan confidentiality")).toBeVisible();
  await page.getByPlaceholder("nama@perusahaan.id").focus();
  await page.keyboard.press("Tab");
  await expect(page.locator('input[type="password"]')).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(
    await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight),
  ).toBe(true);
});
