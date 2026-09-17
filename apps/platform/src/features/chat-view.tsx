import { createHttpClientTransport, type UIMessage, type UIMessagePart } from "@anvia/client";
import { useChat } from "@anvia/react";
import {
  ChatProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useMessage,
  useMessagePart,
} from "@anvia/react-ui";
import type { ModelOption } from "@iom/contracts";
import { Button, IconButton, Select, SelectOption } from "@iom/ui";
import {
  ArrowDown,
  Brain,
  Copy,
  MagnifyingGlass,
  PaperPlaneTilt,
  Stop,
  X,
} from "@phosphor-icons/react";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiUrl } from "@/lib/api";
import type { Conversation } from "@/lib/types";
import { hydrateStoredChatMessages } from "./hydrate-chat-messages";
import { reconcileModelPreference } from "./model-preference";
import { thinkingStatusLabel } from "./thinking-label";

interface StoredMessage {
  content: unknown;
}

function ToolPart() {
  return (
    <MessagePrimitive.Tool className="tool-card">
      <div className="tool-card__header">
        <MagnifyingGlass weight="bold" />
        <MessagePrimitive.ToolName />
        <MessagePrimitive.ToolStatus />
      </div>
      <details>
        <summary>Detail pencarian</summary>
        <span>Parameter</span>
        <MessagePrimitive.ToolInput />
        <span>Evidence terotorisasi</span>
        <MessagePrimitive.ToolOutput />
        <MessagePrimitive.ToolError />
      </details>
    </MessagePrimitive.Tool>
  );
}

function finalizePendingChatMessages(messages: readonly UIMessage[]): readonly UIMessage[] {
  return messages.flatMap((message) => {
    const parts = (message as { parts?: readonly unknown[] }).parts;
    if (!Array.isArray(parts)) return [message];
    // Drop tool calls that were still streaming when the run failed: they have
    // no complete input and cannot be replayed, and rendering them as errors
    // crashes the react-ui ToolError primitive.
    const kept = parts.filter(
      (part) =>
        !(
          (part as { type?: string; state?: string }).type === "tool" &&
          (part as { state?: string }).state === "input-streaming"
        ),
    );
    if (kept.length === parts.length) return [message];
    if (kept.length === 0) return [];
    return [{ ...message, parts: kept }];
  });
}

function ReasoningPart({ isStreamingMessage }: { isStreamingMessage: boolean }) {
  const { part } = useMessagePart();
  const { message } = useMessage();
  const startedAtRef = useRef<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const partIndex = message.parts.findIndex((item) => item.id === part.id);
  const hasFollowUp = message.parts
    .slice(partIndex + 1)
    .some((item) => item.type === "tool" || item.type === "text" || item.type === "reasoning");
  const isLive = isStreamingMessage && !hasFollowUp;
  const summaryText = part.type === "reasoning" ? part.text.trim() : "";
  const hasSummary = summaryText.length > 0;
  const label = thinkingStatusLabel({ isLive, elapsedMs });

  useEffect(() => {
    if (part.type !== "reasoning") return;
    if (isLive) {
      startedAtRef.current ??= Date.now();
      const timer = window.setInterval(() => {
        if (startedAtRef.current !== null) setElapsedMs(Date.now() - startedAtRef.current);
      }, 250);
      return () => window.clearInterval(timer);
    }
    if (startedAtRef.current !== null) {
      setElapsedMs(Date.now() - startedAtRef.current);
    }
    return undefined;
  }, [isLive, part.type]);

  if (part.type !== "reasoning") return null;
  const heading = (
    <>
      <Brain weight="bold" /> {label}
    </>
  );
  if (!hasSummary) {
    return (
      <div className="reasoning-status" data-reasoning-state={isLive ? "live" : "done"}>
        {heading}
      </div>
    );
  }
  return (
    <MessagePrimitive.Reasoning className="reasoning-card" {...(isLive ? { open: true } : {})}>
      <summary>{heading}</summary>
      <MessagePrimitive.Markdown />
    </MessagePrimitive.Reasoning>
  );
}

function ChatPart({
  part,
  isStreamingMessage,
}: {
  part: UIMessagePart;
  isStreamingMessage: boolean;
}) {
  if (part.type === "text") return <MessagePrimitive.Markdown />;
  if (part.type === "reasoning") {
    return <ReasoningPart key={part.id} isStreamingMessage={isStreamingMessage} />;
  }
  if (part.type === "tool") return <ToolPart />;
  if (part.type === "error") return null;
  if (part.type === "source") {
    return (
      <a className="source-card" href={part.source.url ?? "#"} target="_blank" rel="noreferrer">
        <span>SUMBER IOM</span>
        <strong>{part.source.title ?? "Dokumen terotorisasi"}</strong>
      </a>
    );
  }
  if (part.type === "data" && part.name === "stream_guard") {
    const data = part.data as { status?: string };
    return (
      <div className={`stream-guard stream-guard--${data.status}`}>
        Pemeriksaan stream: {data.status}
      </div>
    );
  }
  return <MessagePrimitive.Part />;
}

export function ChatView(props: {
  conversation: Conversation;
  storedMessages?: StoredMessage[];
  models: readonly ModelOption[];
  isDraft?: boolean;
}) {
  const initialMessages = useMemo(
    () => hydrateStoredChatMessages(props.storedMessages?.[0]?.content),
    [props.storedMessages],
  );
  const initialPreference = reconcileModelPreference(
    props.models,
    props.conversation.modelId,
    props.conversation.reasoningEffort,
  );
  const [modelId, setModelId] = useState(initialPreference?.model.id ?? props.conversation.modelId);
  const [effort, setEffort] = useState(
    initialPreference?.effort ?? props.conversation.reasoningEffort,
  );
  const latestRunFailedRef = useRef(false);
  const draftUrlReplacedRef = useRef(false);
  const pendingDraftConversationIdRef = useRef<string | null>(null);
  const navigate = useNavigate();
  const [isClosing, setIsClosing] = useState(false);
  // The "Ke terbaru" action is a viewport-level affordance: it appears only
  // while the newest content is out of view (scrolled up) and sits at the
  // bottom center, above the composer. Auto-scroll during streaming keeps the
  // newest delta visible, which also hides the action.
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [scrolledUp, setScrolledUp] = useState(false);
  // Whether the user is "following" the bottom of the thread. Stays true while
  // new content keeps the view pinned; flips false as soon as the user scrolls
  // away and true again once they return to the bottom.
  const followRef = useRef(true);
  const updateScrollState = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const distance = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    setScrolledUp(distance > 64);
    if (followRef.current) {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: "auto" });
    }
  }, []);
  const handleViewportScroll = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const distance = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    followRef.current = distance <= 64;
    setScrolledUp(distance > 64);
  }, []);
  const scrollToBottom = () => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    // Instant, not smooth: while content is still streaming, a smooth
    // animation never catches a moving bottom and the user feels stuck.
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: "auto" });
    followRef.current = true;
    setScrolledUp(false);
  };
  // Track scroll state for the whole lifetime of the view (not only during
  // streaming): after a run finishes the interval keeps the "Ke terbaru"
  // affordance accurate instead of leaving a stale visibility state.
  useEffect(() => {
    const interval = setInterval(updateScrollState, 400);
    return () => clearInterval(interval);
  }, [updateScrollState]);
  const model = props.models.find((item) => item.id === modelId) ?? props.models[0];
  const metadata = useMemo(
    () => ({
      conversationId: props.conversation.id,
      accessScope: props.conversation.accessScope,
      modelId,
      reasoningEffort: effort,
    }),
    [props.conversation.id, props.conversation.accessScope, modelId, effort],
  );
  const replaceDraftUrl = useCallback(
    (conversationId: string) => {
      if (!props.isDraft || draftUrlReplacedRef.current) return;
      if (conversationId !== props.conversation.id) return;
      const location = new URL(window.location.href);
      location.pathname = `/chat/${conversationId}`;
      location.search = "";
      // TanStack History wraps the instance method and treats direct calls as
      // navigations. Call the native prototype method so only the address bar
      // changes; the in-flight draft controller must not remount or reload.
      History.prototype.replaceState.call(
        window.history,
        window.history.state,
        "",
        `${location.pathname}${location.search}${location.hash}`,
      );
      draftUrlReplacedRef.current = true;
    },
    [props.conversation.id, props.isDraft],
  );
  const transport = useMemo(
    () =>
      createHttpClientTransport({
        endpoint: apiUrl("/chat/stream"),
        format: "jsonl",
        fetch: async (input, init) => {
          const response = await globalThis.fetch(input, init);
          if (response.ok) {
            pendingDraftConversationIdRef.current = response.headers.get("x-iom-conversation-id");
          }
          return response;
        },
        init: { credentials: "include" },
        body: ({ request, headers }) => {
          headers.set("content-type", "application/json");
          return JSON.stringify({ ...request, metadata });
        },
      }),
    [metadata],
  );
  const chat = useChat({
    transport,
    initialMessages,
    suggestions: [
      {
        id: "current",
        prompt: "Apa ketentuan cuti yang berlaku saat ini?",
        label: "Ketentuan cuti aktif",
      },
      {
        id: "change",
        prompt: "Apa perubahan aturan yang berlaku tahun ini?",
        label: "Perubahan terbaru",
      },
    ],
  });
  useEffect(() => {
    if (!props.isDraft) return;
    if (chat.status !== "ready" && chat.status !== "error") return;
    const conversationId = pendingDraftConversationIdRef.current;
    if (!conversationId) return;
    pendingDraftConversationIdRef.current = null;
    replaceDraftUrl(conversationId);
  }, [chat.status, props.isDraft, replaceDraftUrl]);
  const isRunning = chat.status === "submitted" || chat.status === "streaming";
  const closeConversation = () => {
    if (isClosing) return;
    setIsClosing(true);
    window.setTimeout(() => void navigate({ to: "/chat" }), 180);
  };
  const submit = async (input: string): Promise<void> => {
    if (!input.trim() || isRunning) return;
    if (latestRunFailedRef.current) {
      latestRunFailedRef.current = false;
      chat.setMessages((messages) => finalizePendingChatMessages(messages));
    }
    await chat.sendMessage({ text: input });
  };
  const handleStatusChange = (status: string) => {
    if (status === "error" || status === "ready") {
      latestRunFailedRef.current = status === "error";
      if (status === "error") {
        chat.setMessages((messages) => finalizePendingChatMessages(messages));
      }
    }
  };
  // Finalize tool parts that are still streaming when a run errors, so the next
  // submit does not crash converting them into a replayable model message.
  const previousStatusRef = useRef(chat.status);
  if (previousStatusRef.current !== chat.status) {
    previousStatusRef.current = chat.status;
    handleStatusChange(chat.status);
  }
  return (
    <ChatProvider controller={chat}>
      <div className="chat-layout" data-closing={isClosing ? "true" : undefined}>
        <IconButton
          className="chat-close"
          variant="primary"
          size="lg"
          type="button"
          aria-label="Tutup percakapan"
          title="Tutup percakapan"
          disabled={isClosing}
          onClick={closeConversation}
        >
          <X size={20} weight="bold" aria-hidden />
        </IconButton>
        <ThreadPrimitive.Root className="chat-thread">
          <ThreadPrimitive.Viewport
            className="chat-viewport"
            ref={viewportRef}
            onScroll={handleViewportScroll}
            autoScroll={false}
          >
            <ThreadPrimitive.Empty className="chat-empty">
              <span className="chat-empty__index">IOM / ASK</span>
              <h2>Tanyakan aturan IOM</h2>
              <p>Bukti sesuai akses.</p>
              <ThreadPrimitive.Suggestions className="suggestion-list">
                {(suggestion) => (
                  <ThreadPrimitive.Suggestion suggestion={suggestion}>
                    {suggestion.label}
                  </ThreadPrimitive.Suggestion>
                )}
              </ThreadPrimitive.Suggestions>
            </ThreadPrimitive.Empty>
            <ThreadPrimitive.Messages className="message-list">
              {(message) => (
                <MessagePrimitive.Root className="message" data-author={message.role}>
                  <div className="message__label">
                    {message.role === "user" ? "ANDA" : "RUANG IOM"}
                  </div>
                  <MessagePrimitive.Content>
                    <MessagePrimitive.Parts
                      stream={{
                        isStreaming:
                          isRunning &&
                          message.role === "assistant" &&
                          chat.messages.at(-1)?.id === message.id,
                        resetKey: message.id,
                        flushImmediately: chat.status === "error",
                      }}
                    >
                      {(part) => (
                        <ChatPart
                          part={part}
                          isStreamingMessage={
                            isRunning &&
                            message.role === "assistant" &&
                            chat.messages.at(-1)?.id === message.id
                          }
                        />
                      )}
                    </MessagePrimitive.Parts>
                  </MessagePrimitive.Content>
                  <MessagePrimitive.Actions className="message__actions">
                    <MessagePrimitive.Copy asChild>
                      <IconButton
                        variant="ghost"
                        size="sm"
                        aria-label="Salin jawaban"
                        title="Salin jawaban"
                      >
                        <Copy aria-hidden />
                      </IconButton>
                    </MessagePrimitive.Copy>
                  </MessagePrimitive.Actions>
                </MessagePrimitive.Root>
              )}
            </ThreadPrimitive.Messages>
            <ThreadPrimitive.Status className="chat-live-status">
              {(status) =>
                status === "streaming"
                  ? "Jawaban sedang dialirkan..."
                  : status === "submitted"
                    ? "Menyiapkan pencarian..."
                    : ""
              }
            </ThreadPrimitive.Status>
            <ThreadPrimitive.Error className="chat-error" />
            {scrolledUp ? (
              <ThreadPrimitive.ScrollToBottom className="scroll-bottom" onClick={scrollToBottom}>
                <ArrowDown /> Ke terbaru
              </ThreadPrimitive.ScrollToBottom>
            ) : null}
          </ThreadPrimitive.Viewport>
          <ComposerPrimitive.Root
            className="chat-composer"
            submitMessage={async ({ input, clear }) => {
              if (!input.trim()) return;
              clear();
              await submit(input);
            }}
          >
            <ComposerPrimitive.TextareaInput
              className="chat-composer__input"
              placeholder="Tanyakan IOM, tanggal berlaku, atau perubahan aturan..."
              maxRows={7}
              aria-label="Pesan"
            />
            <div className="chat-composer__footer">
              <div className="composer-model-controls">
                <Select
                  aria-label="Model"
                  value={modelId}
                  disabled={isRunning}
                  onChange={(event) => {
                    const preference = reconcileModelPreference(
                      props.models,
                      event.target.value,
                      effort,
                    );
                    if (!preference) return;
                    setModelId(preference.model.id);
                    setEffort(preference.effort);
                  }}
                >
                  {props.models.map((option) => (
                    <SelectOption key={option.id} value={option.id}>
                      {option.label}
                    </SelectOption>
                  ))}
                </Select>
                <Select
                  aria-label="Reasoning"
                  value={effort}
                  disabled={isRunning}
                  onChange={(event) => setEffort(event.target.value)}
                >
                  {model?.supportedReasoningEfforts.map((option) => (
                    <SelectOption key={option} value={option}>
                      {option}
                    </SelectOption>
                  ))}
                </Select>
              </div>
              {isRunning ? (
                <ComposerPrimitive.Stop className="composer-action composer-action--stop">
                  <Stop weight="fill" /> Hentikan
                </ComposerPrimitive.Stop>
              ) : (
                <ComposerPrimitive.Submit asChild>
                  <Button type="submit" variant="primary" className="composer-action">
                    <PaperPlaneTilt weight="bold" /> Kirim
                  </Button>
                </ComposerPrimitive.Submit>
              )}
            </div>
          </ComposerPrimitive.Root>
        </ThreadPrimitive.Root>
      </div>
    </ChatProvider>
  );
}
