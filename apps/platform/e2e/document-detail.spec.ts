import { expect, test } from "@playwright/test";

const versionId = "7d5fd2f2-dff0-413a-bd46-2b0783432c77";

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
    if (pathname === `/iom/${versionId}` && route.request().method() === "GET") {
      await route.fulfill({
        json: {
          version: {
            id: versionId,
            iomNumber: "IOM-2026-01",
            title: "Judul internal",
            revision: 3,
            status: "IN_REVIEW",
            effectiveFrom: "2026-09-12T00:00:00.000Z",
            chunks: [
              {
                id: "chunk-1",
                ordinal: 0,
                pageStart: 1,
                text: "Informasi prosedur yang sedang ditinjau.",
                visibility: "EMPLOYEE_SAFE",
                classificationConfidence: 0.99,
                decisions: [
                  {
                    id: "decision-1",
                    rationale: "Aman untuk employee.",
                    reviewedAt: null,
                    categories: [],
                    sensitiveSpans: [],
                  },
                ],
              },
            ],
            uploadedFile: {
              id: "file-1",
              originalName: "kebijakan-operasional-super-panjang.pdf",
              mimeType: "application/pdf",
              stage: "COMPLETED",
              progress: 100,
            },
          },
        },
      });
      return;
    }
    if (pathname === "/iom") {
      await route.fulfill({ json: { versions: [] } });
      return;
    }
    if (pathname === `/iom/${versionId}/file`) {
      await route.fulfill({
        status: 200,
        contentType: "application/pdf",
        body: "%PDF-1.4\n% test fixture",
      });
      return;
    }
    await route.fulfill({ status: 404, json: { error: "Not found" } });
  });
});

test("document detail uses compact metadata header and fullscreen review workspace", async ({
  page,
}) => {
  await page.goto(`/hr/documents/${versionId}`);

  await expect(
    page.getByRole("heading", { name: /kebijakan-operasional-super-panjang .*\.pdf/ }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Status dokumen: IN REVIEW" })).toBeVisible();
  await expect(page.locator(".ui-hover-stat").nth(0)).toContainText("12 Sep 2026");
  await expect(page.locator(".ui-hover-stat").nth(1)).toContainText("R3");
  await expect(page.getByRole("tablist", { name: "Bagian dokumen" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Review 1" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator(".document-preview iframe")).toHaveCount(1);

  await page.getByRole("button", { name: "Buka preview layar penuh" }).click();
  const dialog = page.getByRole("dialog", { name: "Preview dan review dokumen" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("AI + HR REVIEW")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Tutup layar penuh" })).toBeVisible();
  await dialog.getByRole("button", { name: "Tutup layar penuh" }).click();
  await expect(dialog).not.toBeVisible();
});
