import { expect, test } from "@playwright/test";

const candidate = {
  id: "candidate-1",
  iomNumber: "IOM-021/2026",
  title: "Ketentuan cuti tahunan baru",
  revision: 2,
  status: "IN_REVIEW",
  effectiveFrom: "2027-01-01T00:00:00.000Z",
  metadataConfirmedAt: "2026-09-12T00:00:00.000Z",
};

const existingVersions = [
  {
    id: "existing-1",
    iomNumber: "IOM-014/2024",
    title: "Ketentuan Cuti Tahunan 2024",
    revision: 1,
    status: "PUBLISHED",
    effectiveFrom: "2024-01-01T00:00:00.000Z",
  },
  {
    id: "existing-2",
    iomNumber: "IOM-008/2025",
    title: "Ketentuan Pengajuan Cuti",
    revision: 1,
    status: "PUBLISHED",
    effectiveFrom: "2025-01-01T00:00:00.000Z",
  },
];

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
      await route.fulfill({ json: { count: 2 } });
      return;
    }
    if (pathname === "/iom") {
      await route.fulfill({ json: { versions: [candidate] } });
      return;
    }
    if (pathname === "/overlap/runs") {
      await route.fulfill({
        json: {
          runs: [
            {
              id: "run-1",
              status: "COMPLETED",
              createdAt: "2026-09-12T07:24:00.000Z",
              candidateVersion: candidate,
              matches: existingVersions.map((existingVersion, index) => ({
                id: `match-${index + 1}`,
                recommendation: index === 0 ? "MANUAL_REVIEW" : "NO_MATERIAL_OVERLAP",
                confidence: index === 0 ? 0.72 : 0.91,
                sharedTopics: ["Pengajuan melalui portal HR"],
                changedRules: [
                  {
                    subject: "Batas waktu pengajuan",
                    previousValue: "Tiga hari kerja sebelumnya",
                    proposedValue: "Lima hari kerja sebelumnya",
                    effectiveFrom: "2027-01-01",
                  },
                ],
                conflicts: ["Tenggat pengajuan berubah dan perlu konfirmasi HR."],
                existingVersion,
                decision: null,
              })),
            },
          ],
        },
      });
      return;
    }
    await route.fulfill({ status: 404, json: { error: "Not found" } });
  });
});

test("overlap review focuses one comparison and confirms an explicit HR decision", async ({
  page,
}) => {
  await page.goto("/hr/documents/overlap");

  await expect(page.getByRole("heading", { name: "Analisis overlap" })).toBeVisible();
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Daftar pemeriksaan" })).toBeVisible();
  await expect(page.getByRole("heading", { name: candidate.iomNumber })).toBeVisible();

  const tabs = page.getByRole("tablist", { name: "Perbandingan dokumen" });
  await expect(tabs).toBeVisible();
  await expect(tabs.getByRole("tab", { name: /Perbandingan 1/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("heading", { name: existingVersions[0].title })).toBeVisible();
  await expect(page.getByRole("heading", { name: existingVersions[1].title })).toHaveCount(0);

  await tabs.getByRole("tab", { name: /Perbandingan 2/ }).click();
  await expect(page.getByRole("heading", { name: existingVersions[1].title })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tidak ditemukan tumpang tindih" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Perubahan aturan" })).toHaveCount(0);
  await expect(page.getByText("Topik yang sama", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Tandai tidak tumpang tindih" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Review manual" })).toBeVisible();
  await expect(page.getByText("Pilih hasil untuk pasangan ini", { exact: true })).toHaveCount(0);
  await expect(
    page.getByText("Keputusan disimpan ke audit log dan tidak langsung mempublikasikan dokumen.", {
      exact: true,
    }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Tandai tidak tumpang tindih" }).click();
  const dialog = page.getByRole("dialog", { name: "Tidak ada tumpang tindih" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(candidate.title);
  await expect(dialog).toContainText(existingVersions[1].title);
  await expect(dialog).toContainText("audit log");
  await dialog.getByRole("button", { name: "Batal" }).click();
  await expect(dialog).not.toBeVisible();
});
