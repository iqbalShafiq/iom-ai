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
    if (pathname === "/iom/review-count") {
      await route.fulfill({ json: { count: 1 } });
      return;
    }
    if (pathname === "/iom/reviews") {
      await route.fulfill({
        json: {
          versions: [
            {
              id: "pending-version",
              iomNumber: "IOM-030/2026",
              title: "Masih perlu konfirmasi",
              revision: 1,
              status: "IN_REVIEW",
              effectiveFrom: "2026-09-17T00:00:00.000Z",
            },
          ],
        },
      });
      return;
    }
    if (pathname === "/iom") {
      await route.fulfill({ json: { versions: [] } });
      return;
    }
    await route.fulfill({ status: 404, json: { error: `Not found: ${pathname}` } });
  });
});

test("shows only versions returned by the confidentiality review queue", async ({ page }) => {
  await page.goto("/hr/documents/confidentiality");

  await expect(page.getByRole("heading", { name: "Review kerahasiaan" })).toBeVisible();
  await expect(page.getByText("Masih perlu konfirmasi")).toBeVisible();
  await expect(page.getByText("Sudah dikonfirmasi")).toHaveCount(0);
});
