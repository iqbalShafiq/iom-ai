import { CheckCircle, WarningCircle, XCircle } from "@phosphor-icons/react";
import clsx from "clsx";
import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactElement,
  ReactNode,
  TextareaHTMLAttributes,
} from "react";
import { cloneElement, isValidElement, useId } from "react";

export function Button({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={clsx("ui-button", className)} {...props} />;
}

export function IconButton({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={clsx("ui-icon-button", className)} {...props} />;
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={clsx("ui-input", className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={clsx("ui-textarea", className)} {...props} />;
}

export function Field(props: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  const generatedId = useId();
  const messageId = `${generatedId}-message`;
  const childId = isValidElement<{ id?: string }>(props.children)
    ? (props.children.props.id ?? generatedId)
    : generatedId;
  const child = isValidElement<{ id?: string; "aria-describedby"?: string }>(props.children)
    ? cloneElement(props.children as ReactElement<{ id?: string; "aria-describedby"?: string }>, {
        id: childId,
        ...(props.error || props.hint ? { "aria-describedby": messageId } : {}),
      })
    : props.children;
  return (
    <label className="ui-field" htmlFor={childId}>
      <span className="ui-field__label">{props.label}</span>
      {child}
      {props.error ? (
        <span className="ui-field__error" id={messageId}>
          {props.error}
        </span>
      ) : null}
      {!props.error && props.hint ? (
        <span className="ui-field__hint" id={messageId}>
          {props.hint}
        </span>
      ) : null}
    </label>
  );
}

export function StatusStamp({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const Icon =
    normalized.includes("fail") || normalized.includes("error")
      ? XCircle
      : normalized.includes("review") ||
          normalized.includes("queue") ||
          normalized.includes("process")
        ? WarningCircle
        : CheckCircle;
  return (
    <span className={clsx("ui-status", `ui-status--${normalized.replaceAll("_", "-")}`)}>
      <Icon aria-hidden size={15} weight="bold" />
      {status.replaceAll("_", " ")}
    </span>
  );
}

export function ProgressBar({ value, label }: { value: number; label?: string }) {
  const bounded = Math.max(0, Math.min(100, value));
  return (
    <div className="ui-progress">
      {label ? <div className="ui-progress__label">{label}</div> : null}
      <div
        className="ui-progress__track"
        role="progressbar"
        aria-valuenow={bounded}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span style={{ transform: `scaleX(${bounded / 100})` }} />
      </div>
    </div>
  );
}

export function Panel({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={clsx("ui-panel", className)} {...props} />;
}

export function ConfirmDialog(props: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  busy?: boolean;
  onCancel(): void;
  onConfirm(): void;
}) {
  if (!props.open) return null;
  return (
    <dialog aria-labelledby="confirm-dialog-title" className="ui-panel" open>
      <h2 id="confirm-dialog-title">{props.title}</h2>
      <p>{props.description}</p>
      <div className="header-action-group">
        <Button disabled={props.busy} type="button" onClick={props.onCancel}>
          Batal
        </Button>
        <Button disabled={props.busy} type="button" onClick={props.onConfirm}>
          {props.busy ? "Memproses..." : props.confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}

export function EmptyState(props: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="ui-empty">
      <span className="ui-empty__mark" aria-hidden />
      <h2>{props.title}</h2>
      <p>{props.description}</p>
      {props.action}
    </div>
  );
}

export function Metric(props: { label: string; value: ReactNode; detail?: string }) {
  return (
    <div className="ui-metric">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
      {props.detail ? <small>{props.detail}</small> : null}
    </div>
  );
}

export function PageHeader(props: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        {props.eyebrow ? <span className="page-header__eyebrow">{props.eyebrow}</span> : null}
        <h1>{props.title}</h1>
        {props.description ? <p>{props.description}</p> : null}
      </div>
      {props.actions ? <div className="page-header__actions">{props.actions}</div> : null}
    </header>
  );
}
