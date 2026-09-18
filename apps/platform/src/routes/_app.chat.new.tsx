import type { ModelOption } from "@iom/contracts";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { ChatView } from "@/features/chat-view";
import { apiFetch } from "@/lib/api";
import type { Conversation } from "@/lib/types";

export const Route = createFileRoute("/_app/chat/new")({
  validateSearch: (search) => ({
    scope: search.scope === "HR" ? ("HR" as const) : ("EMPLOYEE" as const),
  }),
  loader: () => apiFetch<{ models: ModelOption[] }>("/ai/models"),
  component: NewConversationPage,
});

function createDraftConversation(
  accessScope: "EMPLOYEE" | "HR",
  models: readonly ModelOption[],
): Conversation {
  const model = models[0];
  return {
    id: globalThis.crypto.randomUUID(),
    title: "Percakapan baru",
    accessScope,
    modelId: model?.id ?? "gpt-5.6-luna",
    reasoningEffort: model?.defaultReasoningEffort ?? "high",
    updatedAt: new Date().toISOString(),
  };
}

function NewConversationPage() {
  const { models } = Route.useLoaderData();
  const { scope } = Route.useSearch();
  const { user } = Route.useRouteContext();
  const accessScope = user.role === "HR_ADMIN" ? scope : "EMPLOYEE";
  const conversation = useMemo(
    () => createDraftConversation(accessScope, models),
    [accessScope, models],
  );
  return <ChatView conversation={conversation} models={models} isDraft />;
}
