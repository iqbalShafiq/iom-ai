import type { ModelOption } from "@iom/contracts";
import { createFileRoute } from "@tanstack/react-router";
import { ChatView } from "@/features/chat-view";
import { apiFetch } from "@/lib/api";
import type { Conversation } from "@/lib/types";

export const Route = createFileRoute("/_app/chat/$conversationId")({
  loader: async ({ params }) => {
    const [detail, catalog] = await Promise.all([
      apiFetch<{ conversation: Conversation & { messages: Array<{ content: unknown }> } }>(
        `/chat/conversations/${params.conversationId}`,
      ),
      apiFetch<{ models: ModelOption[] }>("/ai/models"),
    ]);
    return { ...detail, ...catalog };
  },
  component: ConversationPage,
});

function ConversationPage() {
  const { conversation, models } = Route.useLoaderData();
  return (
    <ChatView conversation={conversation} storedMessages={conversation.messages} models={models} />
  );
}
