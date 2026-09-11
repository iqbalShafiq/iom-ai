import { Button, EmptyState, PageHeader } from "@iom/ui";
import { Plus } from "@phosphor-icons/react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { apiFetch } from "@/lib/api";
import type { Conversation } from "@/lib/types";

export const Route = createFileRoute("/_app/chat")({
  loader: () => apiFetch<{ conversations: Conversation[] }>("/chat/conversations"),
  component: ChatLanding,
});

function ChatLanding() {
  const { conversations } = Route.useLoaderData();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  async function create(scope: "EMPLOYEE" | "HR" = "EMPLOYEE") {
    setBusy(true);
    try {
      const { conversation } = await apiFetch<{ conversation: Conversation }>(
        "/chat/conversations",
        {
          method: "POST",
          body: JSON.stringify({
            accessScope: scope,
            modelId: "gpt-5.6-terra",
            reasoningEffort: "medium",
          }),
        },
      );
      await navigate({ to: "/chat/$conversationId", params: { conversationId: conversation.id } });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="KNOWLEDGE / CHAT"
        title="Chat regulasi"
        description="Setiap jawaban ditelusuri ke IOM yang sesuai scope dan tanggal."
        actions={
          <Button disabled={busy} onClick={() => create()}>
            <Plus /> Percakapan baru
          </Button>
        }
      />
      {conversations.length === 0 ? (
        <EmptyState
          title="Belum ada percakapan"
          description="Mulai dari pertanyaan yang benar-benar Anda perlukan."
        />
      ) : (
        <div className="conversation-list">
          {conversations.map((conversation, index) => (
            <button
              key={conversation.id}
              type="button"
              onClick={() =>
                navigate({
                  to: "/chat/$conversationId",
                  params: { conversationId: conversation.id },
                })
              }
            >
              <span className="row-index">{String(index + 1).padStart(2, "0")}</span>
              <span>
                <strong>{conversation.title}</strong>
                <small>
                  {conversation.accessScope} / {conversation.modelId}
                </small>
              </span>
              <time>{new Date(conversation.updatedAt).toLocaleDateString("id-ID")}</time>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
