import { EmptyState, PageHeader, StatusStamp } from "@iom/ui";
import { ClockCounterClockwise } from "@phosphor-icons/react";
import { createFileRoute } from "@tanstack/react-router";
import { apiFetch } from "@/lib/api";

interface AuditEvent {
  id: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  resultStatus: string;
  modelId?: string | null;
  reasoningEffort?: string | null;
  policyVersion?: number | null;
  correlationId: string;
  createdAt: string;
}

export const Route = createFileRoute("/_app/hr/audit")({
  loader: () => apiFetch<{ events: AuditEvent[] }>("/audit?limit=50"),
  component: AuditPage,
});

function AuditPage() {
  const { events } = Route.useLoaderData();
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="APPEND ONLY / SAFE METADATA"
        title="Audit log"
        description="Jejak aktivitas sensitif"
      />
      {events.length === 0 ? (
        <EmptyState title="Belum ada aktivitas" description="Keputusan HR tercatat" />
      ) : (
        <ol className="audit-timeline">
          {events.map((event) => (
            <li key={event.id}>
              <span className="audit-dot">
                <ClockCounterClockwise />
              </span>
              <div>
                <header>
                  <strong>{event.action.replaceAll("_", " ")}</strong>
                  <StatusStamp status={event.resultStatus} />
                </header>
                <p>
                  {event.entityType} {event.entityId ? `/ ${event.entityId.slice(0, 8)}` : ""}
                </p>
                <footer>
                  <time>{new Date(event.createdAt).toLocaleString("id-ID")}</time>
                  {event.modelId ? (
                    <code>
                      {event.modelId} / {event.reasoningEffort}
                    </code>
                  ) : null}
                  {event.policyVersion ? <code>POLICY V{event.policyVersion}</code> : null}
                  <code>{event.correlationId.slice(0, 8)}</code>
                </footer>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
