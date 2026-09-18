import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

test("upload declares its batch size, transfers a file, and seals the batch", async ({ page }) => {
  const fixturePath = resolve(
    import.meta.dirname,
    "../../../test-fixtures/e2e/iom-033-2026-keamanan-informasi.pdf",
  );
  let declaredFiles = 0;
  let fileUploadRequested = false;
  let batchSealed = false;

  await page.route("http://localhost:3001/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === "/auth/me") {
      await route.fulfill({
        json: { user: { id: "hr-1", name: "HR Admin", role: "HR_ADMIN" } },
      });
      return;
    }
    if (pathname === "/uploads/batches" && request.method() === "GET") {
      await route.fulfill({ json: { batches: [] } });
      return;
    }
    if (pathname === "/iom") {
      await route.fulfill({ json: { versions: [] } });
      return;
    }
    if (pathname === "/uploads/batches" && request.method() === "POST") {
      declaredFiles = (request.postDataJSON() as { expectedFiles: number }).expectedFiles;
      await route.fulfill({ status: 201, json: { batch: { id: "batch-1" } } });
      return;
    }
    if (pathname === "/uploads/batches/batch-1/events") {
      await route.fulfill({
        contentType: "text/event-stream",
        body: 'data: {"type":"batch_progress","batchId":"batch-1","files":[]}\n\n',
      });
      return;
    }
    if (pathname === "/uploads/batches/batch-1/files") {
      fileUploadRequested = request.method() === "POST";
      await route.fulfill({ status: 201, json: { file: { id: "file-1" } } });
      return;
    }
    if (pathname === "/uploads/batches/batch-1/seal") {
      batchSealed = true;
      await route.fulfill({ json: { batch: { id: "batch-1" }, acceptedFiles: 1 } });
      return;
    }
    await route.fulfill({ status: 404, json: { error: "Not found" } });
  });

  await page.goto("/hr/documents/upload");
  await page.locator('input[type="file"]').setInputFiles(fixturePath);
  await page.getByRole("button", { name: "Mulai upload" }).click();

  await expect(page.getByText("iom-033-2026-keamanan-informasi.pdf")).toBeVisible();
  await expect.poll(() => batchSealed).toBe(true);
  expect(declaredFiles).toBe(1);
  expect(fileUploadRequested).toBe(true);
});
