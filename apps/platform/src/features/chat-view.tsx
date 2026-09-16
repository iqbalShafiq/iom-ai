import {
  createHttpClientTransport,
  messagesToUIMessages,
  type UIMessage,
  type UIMessagePart,
} from "@anvia/client";
import { useChat } from "@anvia/react";
import {
  ChatProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
} from "@anvia/react-ui";
import type { ModelOption } from "@iom/contracts";
import { Select, SelectOption } from "@iom/ui";
import {
  ArrowDown,
  Brain,
  Copy,
  MagnifyingGlass,
  PaperPlaneTilt,
  Stop,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiUrl } from "@/lib/api";
import type { Conversation } from "@/lib/types";
import { reconcileModelPreference } from "./model-preference";

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

function ChatPart({ part }: { part: UIMessagePart }) {
  if (part.type === "text") return <MessagePrimitive.Markdown />;
  if (part.type === "reasoning") {
    return (
      <MessagePrimitive.Reasoning className="reasoning-card">
        <summary>
          <Brain weight="bold" /> Ringkasan penalaran model
        </summary>
        <MessagePrimitive.Markdown />
      </MessagePrimitive.Reasoning>
    );
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
}) {
  const initialMessages = useMemo(() => {
    const latest = props.storedMessages?.[0]?.content;
    return Array.isArray(latest) ? messagesToUIMessages(latest as never) : [];
  }, [props.storedMessages]);
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
  const transport = useMemo(
    () =>
      createHttpClientTransport({
        endpoint: apiUrl("/chat/stream"),
        format: "jsonl",
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
  const isRunning = chat.status === "submitted" || chat.status === "streaming";
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
      <div className="chat-layout">
        <header className="chat-header">
          <div>
            <span className="scope-stamp">
              {props.conversation.accessScope === "HR" ? "HR SCOPE" : "EMPLOYEE SAFE"}
            </span>
            <h1>Percakapan IOM</h1>
          </div>
        </header>
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
                      {(part) => <ChatPart part={part} />}
                    </MessagePrimitive.Parts>
                  </MessagePrimitive.Content>
                  <MessagePrimitive.Actions className="message__actions">
                    <MessagePrimitive.Copy aria-label="Salin jawaban">
                      <Copy />
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
                <ComposerPrimitive.Submit className="composer-action">
                  <PaperPlaneTilt weight="bold" /> Kirim
                </ComposerPrimitive.Submit>
              )}
            </div>
          </ComposerPrimitive.Root>
        </ThreadPrimitive.Root>
      </div>
    </ChatProvider>
  );
}
