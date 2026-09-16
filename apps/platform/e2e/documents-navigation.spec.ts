import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("http://localhost:3001/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/auth/me") {
      await route.fulfill({
        json: { user: { id: "hr-1", name: "HR Admin", role: "HR_ADMIN" } },
      });
      return;
    }
    if (pathname === "/uploads/batches") {
      await route.fulfill({ json: { batches: [] } });
      return;
    }
    if (pathname === "/iom") {
      await route.fulfill({ json: { versions: [] } });
      return;
    }
    if (pathname === "/overlap/runs") {
      await route.fulfill({ json: { runs: [] } });
      return;
    }
    await route.fulfill({ status: 404, json: { error: "Not found" } });
  });
});

test("document tools use nested navigation and routes", async ({ page }) => {
  await page.goto("/hr");

  const navigation = page.getByRole("navigation", { name: "Navigasi utama" });
  await expect(navigation.getByRole("link", { name: "Documents" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Upload", exact: true })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Confidentiality" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Overlap" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Upload batches" })).toHaveCount(0);

  await navigation.getByRole("link", { name: "Upload", exact: true }).click();
  await expect(page).toHaveURL(/\/hr\/documents\/upload$/);
  await expect(page.getByRole("heading", { name: "Upload dokumen" })).toBeVisible();

  await navigation.getByRole("link", { name: "Confidentiality" }).click();
  await expect(page).toHaveURL(/\/hr\/documents\/confidentiality$/);
  await expect(page.getByRole("heading", { name: "Review kerahasiaan" })).toBeVisible();

  await navigation.getByRole("link", { name: "Overlap" }).click();
  await expect(page).toHaveURL(/\/hr\/documents\/overlap$/);
  await expect(page.getByRole("heading", { name: "Analisis overlap" })).toBeVisible();
});
