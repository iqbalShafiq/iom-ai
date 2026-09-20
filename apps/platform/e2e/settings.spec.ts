import { expect, test } from "@playwright/test";

const latestInstructions =
  "Preferensi HR terakhir: data personal, evaluasi individu, dan nominal gaji hanya boleh diakses HR.";

test.beforeEach(async ({ page }) => {
  await page.route("http://localhost:3001/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/auth/me") {
      await route.fulfill({
        json: { user: { id: "hr-1", name: "HR Admin", role: "HR_ADMIN" } },
      });
      return;
    }
    if (pathname === "/iom/review-count") {
      await route.fulfill({ json: { count: 2 } });
      return;
    }
    if (pathname === "/confidentiality/policies") {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 201,
          json: {
            policy: {
              id: "33333333-3333-4333-8333-333333333333",
              version: 5,
              name: "2026-09-17 09:45 WIB",
              instructions: latestInstructions,
              status: "DRAFT",
              createdAt: "2026-09-17T02:45:00.000Z",
            },
          },
        });
        return;
      }
      await route.fulfill({
        json: {
          policies: [
            {
              id: "11111111-1111-4111-8111-111111111111",
              version: 4,
              name: "2026-09-16 08:00 WIB",
              instructions: latestInstructions,
              status: "ACTIVE",
              createdAt: "2026-09-16T01:00:00.000Z",
              _count: { decisions: 8 },
              decisions: [],
            },
            {
              id: "22222222-2222-4222-8222-222222222222",
              version: 3,
              name: "2026-08-01 09:15 WIB",
              instructions: "Kebijakan lama untuk riwayat pengaturan HR.",
              status: "RETIRED",
              createdAt: "2026-08-01T02:15:00.000Z",
              _count: { decisions: 3 },
              decisions: [],
            },
          ],
        },
      });
      return;
    }
    await route.fulfill({ status: 404, json: { error: "Not found" } });
  });
});

test("settings uses tabs and pre-fills the latest HR preference", async ({ page }) => {
  await page.goto("/hr/settings");

  await expect(page.getByRole("heading", { name: "Pengaturan" })).toBeVisible();
  const tabs = page.getByRole("tablist", { name: "Bagian pengaturan kebijakan" });
  const draftTab = tabs.getByRole("tab", { name: "Draft kebijakan" });
  const historyTab = tabs.getByRole("tab", { name: "Riwayat kebijakan" });
  await expect(draftTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("Preferensi akses dokumen")).toHaveValue(latestInstructions);
  await expect(page.getByLabel("Nama policy")).toHaveCount(0);
  await expect(page.locator(".policy-editor__source small")).toHaveText("Terakhir diupdate pada");
  await expect(page.locator(".policy-editor__source time")).toHaveText("2026-09-16 08:00 WIB");
  await expect(page.getByText(/Nama policy dibuat otomatis/)).toHaveCount(0);

  const createRequestPromise = page.waitForRequest(
    (request) => request.url().endsWith("/confidentiality/policies") && request.method() === "POST",
  );
  await page.getByRole("button", { name: "Simpan draft" }).click();
  const createRequest = await createRequestPromise;
  const requestBody = createRequest.postDataJSON() as { name: string; instructions: string };
  expect(requestBody.name).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} WIB$/);
  expect(requestBody.instructions).toBe(latestInstructions);

  await historyTab.click();
  await expect(historyTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Riwayat kebijakan" })).toBeVisible();
  await expect(page.getByText("V4")).toBeVisible();
  await expect(page.getByText("2026-09-16 08:00 WIB")).toBeVisible();

  await draftTab.click();
  await expect(draftTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("Preferensi akses dokumen")).toHaveValue(latestInstructions);
});
