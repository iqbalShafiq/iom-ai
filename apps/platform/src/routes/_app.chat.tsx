import { Button, EmptyState, PageHeader } from "@iom/ui";
import { Plus } from "@phosphor-icons/react";
import {
  createFileRoute,
  Outlet,
  useNavigate,
  useRouteContext,
  useRouterState,
} from "@tanstack/react-router";
import { useState } from "react";
import { apiFetch } from "@/lib/api";
import type { Conversation } from "@/lib/types";

export const Route = createFileRoute("/_app/chat")({
  loader: () => apiFetch<{ conversations: Conversation[] }>("/chat/conversations"),
  component: ChatLanding,
});

function ChatLanding() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { conversations } = Route.useLoaderData();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const { user } = useRouteContext({ from: "/_app" });
  if (pathname !== "/chat") return <Outlet />;
  async function create(scope: "EMPLOYEE" | "HR" = "EMPLOYEE") {
    setBusy(true);
    try {
      const { conversation } = await apiFetch<{ conversation: Conversation }>(
        "/chat/conversations",
        {
          method: "POST",
          body: JSON.stringify({
            accessScope: scope,
            modelId: "gpt-5.6-luna",
            reasoningEffort: "low",
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
        title="Chats"
        actions={
          <div className="header-action-group">
            <Button variant="secondary" disabled={busy} onClick={() => create("EMPLOYEE")}>
              <Plus weight="bold" /> {user.role === "HR_ADMIN" ? "Chat as Employee" : "Start Chat"}
            </Button>
            {user.role === "HR_ADMIN" ? (
              <Button variant="primary" disabled={busy} onClick={() => create("HR")}>
                <Plus weight="bold" /> Chat as HR
              </Button>
            ) : null}
          </div>
        }
      />
      {conversations.length === 0 ? (
        <EmptyState title="Belum ada chat" description="Mulai percakapan baru" />
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
