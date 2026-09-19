import { expect, test } from "@playwright/test";

const model = {
  id: "gpt-5.6-luna",
  label: "GPT-5.6 Luna",
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

const streamBody = [
  {
    type: "stream_start",
    protocol: "anvia.client.v3",
    streamId: "test-stream",
    eventId: 0,
    resumable: false,
  },
  {
    type: "stream_event",
    streamId: "test-stream",
    eventId: 1,
    event: { type: "run_start", runId: "run-1", source: "agent" },
  },
  {
    type: "stream_event",
    streamId: "test-stream",
    eventId: 2,
    event: {
      type: "message_start",
      runId: "run-1",
      messageId: "assistant-1",
      role: "assistant",
      turn: 1,
    },
  },
  {
    type: "stream_event",
    streamId: "test-stream",
    eventId: 3,
    event: {
      type: "text_start",
      runId: "run-1",
      messageId: "assistant-1",
      partId: "text-1",
      turn: 1,
    },
  },
  {
    type: "stream_event",
    streamId: "test-stream",
    eventId: 4,
    event: {
      type: "text_delta",
      runId: "run-1",
      messageId: "assistant-1",
      partId: "text-1",
      delta: "Jawaban uji.",
      turn: 1,
    },
  },
  {
    type: "stream_event",
    streamId: "test-stream",
    eventId: 5,
    event: {
      type: "text_end",
      runId: "run-1",
      messageId: "assistant-1",
      partId: "text-1",
      turn: 1,
    },
  },
  {
    type: "stream_event",
    streamId: "test-stream",
    eventId: 6,
    event: { type: "message_end", runId: "run-1", messageId: "assistant-1", turn: 1 },
  },
  {
    type: "stream_event",
    streamId: "test-stream",
    eventId: 7,
    event: { type: "run_end", runId: "run-1", status: "completed", turn: 1 },
  },
  { type: "stream_end", streamId: "test-stream", eventId: 7, status: "completed" },
]
  .map((frame) => JSON.stringify(frame))
  .join("\n");

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
    if (pathname.startsWith("/chat/conversations/")) {
      const id = pathname.split("/").at(-1) ?? conversation.id;
      await route.fulfill({ json: { conversation: { ...conversation, id, messages: [] } } });
      return;
    }
    if (pathname === "/chat/stream") {
      if (route.request().method() === "OPTIONS") {
        await route.fulfill({
          status: 204,
          headers: {
            "access-control-allow-headers": "content-type",
            "access-control-allow-methods": "POST, OPTIONS",
            "access-control-allow-origin": "http://localhost:5173",
            "access-control-allow-credentials": "true",
          },
        });
        return;
      }
      const body = JSON.parse(route.request().postData() ?? "{}") as {
        metadata?: { conversationId?: string };
      };
      await route.fulfill({
        status: 200,
        headers: {
          "access-control-allow-credentials": "true",
          "access-control-allow-headers": "content-type",
          "access-control-allow-methods": "POST, OPTIONS",
          "access-control-allow-origin": "http://localhost:5173",
          "access-control-expose-headers": "x-anvia-stream-protocol, x-iom-conversation-id",
          "content-type": "application/x-ndjson",
          "x-anvia-stream-protocol": "anvia.client.v3",
          "x-iom-conversation-id": body.metadata?.conversationId ?? "",
        },
        body: streamBody,
      });
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

  await expect(page.getByRole("combobox", { name: "Model" })).toHaveText("GPT-5.6 Luna");
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

test("new chat stays local until the first message", async ({ page }) => {
  let conversationPostCount = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/chat/conversations")) {
      conversationPostCount += 1;
    }
  });

  await page.goto("/chat");
  await page.getByRole("button", { name: "Start Chat" }).click();

  await expect(page).toHaveURL(/\/chat\/new(?:\?scope=EMPLOYEE)?$/);
  await expect(page.getByRole("textbox", { name: "Pesan" })).toBeVisible();
  expect(conversationPostCount).toBe(0);
});

test("first message replaces the draft URL without a route refresh", async ({ page }) => {
  let detailRequestCount = 0;
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (request.method() === "GET" && pathname.startsWith("/chat/conversations/")) {
      detailRequestCount += 1;
    }
  });

  await page.goto("/chat");
  await page.getByRole("button", { name: "Start Chat" }).click();
  await expect(page).toHaveURL(/\/chat\/new(?:\?scope=EMPLOYEE)?$/);

  await page.getByRole("textbox", { name: "Pesan" }).fill("Apa aturan cuti?");
  const sendButton = page.getByRole("button", { name: "Kirim" });
  await expect(sendButton).toHaveClass(/ui-button--primary/);
  await sendButton.click();

  await expect(page.getByText("Jawaban uji.")).toBeVisible();
  const closeBox = await page.locator(".chat-close").boundingBox();
  const viewportBox = await page.locator(".chat-viewport").boundingBox();
  const bubbleBox = await page.locator('.message[data-author="user"]').boundingBox();
  expect(closeBox).not.toBeNull();
  expect(viewportBox).not.toBeNull();
  expect(bubbleBox).not.toBeNull();
  if (closeBox && viewportBox && bubbleBox) {
    const closeBottom = closeBox.y + closeBox.height;
    expect(viewportBox.y - closeBottom).toBeGreaterThanOrEqual(8);
    expect(bubbleBox.y - closeBottom).toBeGreaterThanOrEqual(8);
  }
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);
  expect(detailRequestCount).toBe(0);
  const persistedPath = new URL(page.url()).pathname;
  await page.reload();
  await expect(page).toHaveURL(new RegExp(`${persistedPath.replaceAll("/", "\\/")}$`));
  await expect(page.getByRole("textbox", { name: "Pesan" })).toBeVisible();
  await page.getByRole("button", { name: "Tutup percakapan" }).click();
  await expect(page).toHaveURL(/\/chat$/);
});
