import { expect, test } from "@playwright/test";

const model = {
  id: "gpt-5.6-luna",
  label: "GPT 5.6 Luna",
  description: "Model chat IOM",
  supportedReasoningEfforts: ["low", "medium", "high", "xhigh"],
  defaultReasoningEffort: "low",
  supportsStreaming: true,
  supportsTools: true,
  supportsReasoningSummary: false,
};

const conversation = {
  id: "chat-1",
  title: "Percakapan uji",
  accessScope: "EMPLOYEE",
  modelId: model.id,
  reasoningEffort: "low",
  updatedAt: "2026-09-16T00:00:00.000Z",
};

test.beforeEach(async ({ page }) => {
  await page.route("http://localhost:3001/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/auth/me") {
      await route.fulfill({
        json: {
          user: {
            id: "employee-1",
            email: "employee@example.com",
            name: "Employee",
            role: "EMPLOYEE",
          },
        },
      });
      return;
    }
    if (pathname === "/chat/conversations") {
      await route.fulfill({ json: { conversations: [conversation] } });
      return;
    }
    if (pathname === "/chat/conversations/chat-1") {
      await route.fulfill({ json: { conversation: { ...conversation, messages: [] } } });
      return;
    }
    if (pathname === "/ai/models") {
      await route.fulfill({
        json: { models: [model], defaults: { modelId: model.id, reasoningEffort: "low" } },
      });
      return;
    }
    await route.fulfill({ status: 404, json: { error: "Not found" } });
  });
});

test("model and reasoning options can be selected by pointer and keyboard", async ({ page }) => {
  await page.goto("/chat/chat-1");

  await expect(page.getByRole("combobox", { name: "Model" })).toHaveText("GPT 5.6 Luna");
  const reasoning = page.getByRole("combobox", { name: "Reasoning" });
  await expect(reasoning).toHaveText("low");

  await reasoning.click();
  const listbox = page.getByRole("listbox");
  await expect(listbox).toBeVisible();
  const triggerBox = await reasoning.boundingBox();
  const menuBox = await listbox.boundingBox();
  expect(triggerBox).not.toBeNull();
  expect(menuBox).not.toBeNull();
  if (triggerBox && menuBox) {
    expect(Math.abs(menuBox.x - triggerBox.x)).toBeLessThanOrEqual(1);
    const triggerBottom = triggerBox.y + triggerBox.height;
    const menuBottom = menuBox.y + menuBox.height;
    const gap = menuBox.y >= triggerBottom ? menuBox.y - triggerBottom : triggerBox.y - menuBottom;
    expect(gap).toBeLessThanOrEqual(8);
  }
  await page.getByRole("option", { name: "xhigh" }).click();
  await expect(reasoning).toHaveText("xhigh");
  await expect(reasoning).toBeFocused();

  await reasoning.press("Enter");
  await expect(page.getByRole("listbox")).toBeVisible();
  await reasoning.press("Home");
  await reasoning.press("ArrowDown");
  await reasoning.press("Enter");
  await expect(reasoning).toHaveText("medium");

  await page.getByRole("button", { name: "Tutup percakapan" }).click();
  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.getByRole("heading", { name: "Chats" })).toBeVisible();
});
