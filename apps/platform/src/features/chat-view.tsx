import { createHttpClientTransport, messagesToUIMessages, type UIMessagePart } from "@anvia/client";
import { useChat } from "@anvia/react";
import {
  ChatProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
} from "@anvia/react-ui";
import type { ModelOption } from "@iom/contracts";
import {
  ArrowDown,
  Brain,
  Copy,
  MagnifyingGlass,
  PaperPlaneTilt,
  Stop,
} from "@phosphor-icons/react";
import { useMemo, useState } from "react";
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
  const [modelId, setModelId] = useState(props.conversation.modelId);
  const [effort, setEffort] = useState(props.conversation.reasoningEffort);
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
  return (
    <ChatProvider controller={chat}>
      <div className="chat-layout">
        <header className="chat-header">
          <div>
            <span className="scope-stamp">
              {props.conversation.accessScope === "HR" ? "HR SCOPE" : "EMPLOYEE SAFE"}
            </span>
            <h1>{props.conversation.title}</h1>
          </div>
          <div className="model-controls">
            <label>
              Model
              <select
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
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Reasoning
              <select
                value={effort}
                disabled={isRunning}
                onChange={(event) => setEffort(event.target.value)}
              >
                {model?.supportedReasoningEfforts.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </header>
        <ThreadPrimitive.Root className="chat-thread">
          <ThreadPrimitive.Viewport className="chat-viewport">
            <ThreadPrimitive.Empty className="chat-empty">
              <span className="chat-empty__index">IOM / ASK</span>
              <h2>
                Tanyakan aturan.
                <br />
                Kami cari buktinya.
              </h2>
              <p>Jawaban hanya memakai IOM yang aktif dan sesuai ruang akses percakapan ini.</p>
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
                    : null
              }
            </ThreadPrimitive.Status>
            <ThreadPrimitive.Error className="chat-error" />
            <ThreadPrimitive.ScrollToBottom className="scroll-bottom">
              <ArrowDown /> Ke terbaru
            </ThreadPrimitive.ScrollToBottom>
          </ThreadPrimitive.Viewport>
          <ComposerPrimitive.Root
            className="chat-composer"
            submitMessage={async ({ input, clear }) => {
              if (!input.trim()) return;
              clear();
              await chat.sendMessage({ text: input });
            }}
          >
            <ComposerPrimitive.TextareaInput
              className="chat-composer__input"
              placeholder="Tanyakan IOM, tanggal berlaku, atau perubahan aturan..."
              maxRows={7}
              aria-label="Pesan"
            />
            <div className="chat-composer__footer">
              <span>
                {model?.label} / {effort}
              </span>
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
