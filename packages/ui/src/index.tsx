import { CaretDown, Check, CheckCircle, WarningCircle, X, XCircle } from "@phosphor-icons/react";
import clsx from "clsx";
import type {
  ButtonHTMLAttributes,
  ChangeEvent,
  HTMLAttributes,
  InputHTMLAttributes,
  OptionHTMLAttributes,
  ReactElement,
  FocusEventHandler as ReactFocusEventHandler,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

export type ButtonVariant = "primary" | "secondary";

export function Button({
  className,
  variant = "primary",
  rightIcon,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; rightIcon?: ReactNode }) {
  return (
    <button className={clsx("ui-button", `ui-button--${variant}`, className)} {...props}>
      {children}
      {rightIcon}
    </button>
  );
}

export function IconButton({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={clsx("ui-icon-button", className)} {...props} />;
}

export interface TabsItem {
  value: string;
  label: ReactNode;
  count?: number;
  disabled?: boolean;
  id?: string;
  panelId?: string;
}

export type TabsSize = "default" | "compact";

export function Tabs({
  className,
  items,
  value,
  onChange,
  size = "default",
  trailingAction,
  "aria-label": ariaLabel = "Tabs",
}: {
  className?: string;
  items: readonly TabsItem[];
  value: string;
  onChange(value: string): void;
  size?: TabsSize;
  trailingAction?: ReactNode;
  "aria-label"?: string;
}) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const enabledIndexes = items.flatMap((item, itemIndex) => (item.disabled ? [] : [itemIndex]));

  function focusTab(index: number) {
    const currentPosition = enabledIndexes.indexOf(index);
    if (currentPosition < 0 || enabledIndexes.length === 0) return;
    const nextIndex = enabledIndexes[(currentPosition + 1) % enabledIndexes.length];
    const nextItem = nextIndex === undefined ? undefined : items[nextIndex];
    if (!nextItem || nextIndex === undefined) return;
    onChange(nextItem.value);
    requestAnimationFrame(() => tabRefs.current[nextIndex]?.focus());
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      focusTab(index);
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      const currentPosition = enabledIndexes.indexOf(index);
      if (currentPosition < 0 || enabledIndexes.length === 0) return;
      const previousIndex =
        enabledIndexes[(currentPosition - 1 + enabledIndexes.length) % enabledIndexes.length];
      const previousItem = previousIndex === undefined ? undefined : items[previousIndex];
      if (!previousItem || previousIndex === undefined) return;
      onChange(previousItem.value);
      requestAnimationFrame(() => tabRefs.current[previousIndex]?.focus());
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const targetIndex = event.key === "Home" ? enabledIndexes[0] : enabledIndexes.at(-1);
      if (targetIndex === undefined) return;
      const targetItem = items[targetIndex];
      if (!targetItem) return;
      onChange(targetItem.value);
      requestAnimationFrame(() => tabRefs.current[targetIndex]?.focus());
    }
  }

  const tabList = (
    <div
      className={clsx("ui-tabs", size === "compact" && "ui-tabs--compact")}
      role="tablist"
      aria-label={ariaLabel}
    >
      {items.map((item, index) => (
        <button
          key={item.value}
          ref={(element) => {
            tabRefs.current[index] = element;
          }}
          type="button"
          role="tab"
          id={item.id}
          aria-selected={item.value === value}
          aria-controls={item.panelId}
          tabIndex={item.value === value ? 0 : -1}
          disabled={item.disabled}
          className="ui-tabs__tab"
          onClick={() => onChange(item.value)}
          onKeyDown={(event) => handleKeyDown(event, index)}
        >
          {item.label}
          {item.count !== undefined ? <CountIndicator value={item.count} /> : null}
        </button>
      ))}
    </div>
  );

  if (!trailingAction) {
    return cloneElement(tabList, { className: clsx(tabList.props.className, className) });
  }

  return (
    <div className={clsx("ui-tabs-shell", className)}>
      {tabList}
      <div className="ui-tabs__action">{trailingAction}</div>
    </div>
  );
}

export function CountIndicator({ value, className }: { value: number; className?: string }) {
  return <span className={clsx("ui-count-indicator", className)}>{value}</span>;
}

export function HoverPopover({
  className,
  trigger,
  children,
}: {
  className?: string;
  trigger: ReactNode;
  children: ReactNode;
}) {
  const contentId = useId();
  return (
    <span className={clsx("ui-popover", className)}>
      <span className="ui-popover__trigger" aria-describedby={contentId}>
        {trigger}
      </span>
      <span className="ui-popover__content" id={contentId} role="tooltip">
        {children}
      </span>
    </span>
  );
}

export function HoverStat({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
}) {
  return (
    <span className="ui-hover-stat" title={label}>
      <span className="ui-hover-stat__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="ui-hover-stat__label">{label}</span>
      <strong>{value}</strong>
    </span>
  );
}

export function FullscreenDialog({
  open,
  title,
  children,
  onClose,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose(): void;
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [open]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <dialog
      ref={dialogRef}
      className="ui-fullscreen-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="ui-fullscreen-dialog__header">
        <h2 id={titleId}>{title}</h2>
        <IconButton type="button" aria-label="Tutup layar penuh" onClick={onClose}>
          <X weight="bold" />
        </IconButton>
      </header>
      <div className="ui-fullscreen-dialog__body">{open ? children : null}</div>
    </dialog>,
    document.body,
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={clsx("ui-input", className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={clsx("ui-textarea", className)} {...props} />;
}

export function SelectOption({ className, ...props }: OptionHTMLAttributes<HTMLOptionElement>) {
  return <option className={clsx("ui-select__option", className)} {...props} />;
}

interface SelectEntry {
  value: string;
  children: ReactNode;
}

/**
 * Accessible custom select: a trigger button opens a styled option list. The
 * native select stays in the DOM (hidden) and is synced, so form submission
 * via FormData/Field and controlled values keep working.
 */
export function Select({
  className,
  children,
  value,
  defaultValue,
  onChange,
  onBlur,
  disabled,
  required,
  name,
  id,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
}: SelectHTMLAttributes<HTMLSelectElement> & { children?: ReactNode }) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const listboxId = `${controlId}-listbox`;
  const nativeRef = useRef<HTMLSelectElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [anchor, setAnchor] = useState<{ top: number; left: number; width: number } | null>(null);
  const [placement, setPlacement] = useState<"below" | "above">("below");
  // Rendering with visibility:hidden makes the menu measurable before it is
  // positioned, so the gap between trigger and option list stays tight.
  const [positioned, setPositioned] = useState(false);

  const rawOptions = Array.isArray(children)
    ? children
    : isValidElement(children)
      ? [children]
      : [];
  const entries = rawOptions
    .filter(isValidElement<{ value?: unknown; disabled?: boolean; children?: ReactNode }>)
    .filter((option) => !option.props.disabled)
    .map((option) => ({
      value: String(option.props.value ?? ""),
      children: option.props.children,
    }));

  const isControlled = value !== undefined;
  const [uncontrolledValue, setUncontrolledValue] = useState(() =>
    String(defaultValue ?? entries[0]?.value ?? ""),
  );
  const currentValue = isControlled ? String(value) : uncontrolledValue;
  const selectedIndex = Math.max(
    0,
    entries.findIndex((entry) => entry.value === currentValue),
  );

  const close = useCallback(() => {
    setOpen(false);
    setActiveIndex(-1);
    setAnchor(null);
    setPlacement("below");
    setPositioned(false);
  }, []);

  /**
   * Puts the fixed-position menu below the trigger when there is room, or
   * above it (flipped) when the dropdown would leave the viewport bottom.
   * max-height caps both directions so the trigger is never covered.
   */
  const placeMenu = useCallback(() => {
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    const rect = trigger.getBoundingClientRect();
    const viewportBottom = window.innerHeight;
    const menuHeight = Math.min(menu.getBoundingClientRect().height, 260);
    const gap = 4;
    const roomBelow = viewportBottom - rect.bottom - gap;
    const roomAbove = rect.top - gap;
    const flip = roomBelow < menuHeight && roomAbove > menuHeight * 0.4;
    const top = flip ? Math.max(gap, rect.top - menuHeight - gap) : rect.bottom + gap;
    setPlacement(flip ? "above" : "below");
    setPositioned(true);
    setAnchor({ top, left: rect.left, width: rect.width });
  }, []);

  function openMenu() {
    setOpen(true);
    setActiveIndex(selectedIndex);
  }

  // The menu is mounted by the state update above. Position it after that DOM
  // commit, before the browser paints, so an unpositioned fixed menu never
  // flashes at its static fallback position.
  useLayoutEffect(() => {
    if (!open) return;
    placeMenu();
  }, [open, placeMenu]);

  // Keep the menu glued to the trigger while open: the thread can scroll and
  // the window can resize, which would otherwise leave the fixed menu hanging
  // in empty space or overflowing the viewport.
  useEffect(() => {
    if (!open) return;
    const reposition = () => requestAnimationFrame(placeMenu);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open, placeMenu]);

  // Close when the user clicks anywhere outside the control.
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        (rootRef.current?.contains(target) || menuRef.current?.contains(target))
      ) {
        return;
      }
      close();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open, close]);

  function handleNativeChange(event: ChangeEvent<HTMLSelectElement>) {
    if (!isControlled) setUncontrolledValue(event.target.value);
    onChange?.(event);
  }

  function choose(entry: SelectEntry) {
    const native = nativeRef.current;
    if (!native) return;
    native.value = entry.value;
    native.dispatchEvent(new Event("change", { bubbles: true }));
    close();
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        openMenu();
      } else {
        const delta = event.key === "ArrowDown" ? 1 : -1;
        setActiveIndex((current) =>
          Math.min(
            entries.length - 1,
            Math.max(0, (current < 0 ? selectedIndex : current) + delta),
          ),
        );
      }
      return;
    }
    if (open && (event.key === "Home" || event.key === "End")) {
      event.preventDefault();
      setActiveIndex(event.key === "Home" ? 0 : entries.length - 1);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!open) {
        openMenu();
        return;
      }
      const entry = entries[activeIndex >= 0 ? activeIndex : selectedIndex];
      if (entry) choose(entry);
      return;
    }
    if (event.key === "Escape" && open) {
      event.preventDefault();
      close();
    }
  }

  function handleMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) =>
        Math.min(entries.length - 1, Math.max(0, (current < 0 ? selectedIndex : current) + delta)),
      );
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setActiveIndex(event.key === "Home" ? 0 : entries.length - 1);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  }

  return (
    <div ref={rootRef} className={clsx("ui-select", className)}>
      <select
        ref={nativeRef}
        className="ui-select__native"
        name={name}
        id={`${controlId}-native`}
        required={required}
        tabIndex={-1}
        aria-hidden="true"
        {...(isControlled ? { value: currentValue } : { defaultValue: currentValue })}
        onChange={handleNativeChange}
      >
        {children}
      </select>
      <button
        ref={triggerRef}
        id={controlId}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={
          open && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined
        }
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        className="ui-select__trigger"
        disabled={disabled}
        onBlur={onBlur as ReactFocusEventHandler<HTMLButtonElement> | undefined}
        onKeyDown={handleKeyDown}
        onClick={() => (open ? close() : openMenu())}
      >
        <span className="ui-select__value">{entries[selectedIndex]?.children ?? ""}</span>
        <CaretDown aria-hidden weight="bold" className="ui-select__chevron" />
      </button>
      {open && entries.length > 0 && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              id={listboxId}
              role="listbox"
              tabIndex={-1}
              className={clsx("ui-select__menu", `ui-select__menu--${placement}`)}
              style={{
                visibility: positioned ? "visible" : "hidden",
                top: anchor ? `${anchor.top}px` : undefined,
                left: anchor ? `${anchor.left}px` : undefined,
                minWidth: anchor ? `${anchor.width}px` : undefined,
              }}
              onKeyDown={handleMenuKeyDown}
            >
              {entries.map((entry, index) => {
                const selected = index === selectedIndex;
                return (
                  <button
                    key={entry.value}
                    id={`${listboxId}-option-${index}`}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    data-active={activeIndex === index}
                    className="ui-select__option"
                    onClick={() => choose(entry)}
                    onMouseEnter={() => setActiveIndex(index)}
                  >
                    {selected ? (
                      <Check weight="bold" aria-hidden className="ui-select__check" />
                    ) : null}
                    {entry.children}
                  </button>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
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

function statusIconFor(status: string) {
  const normalized = status.toLowerCase();
  return normalized.includes("fail") || normalized.includes("error")
    ? XCircle
    : normalized.includes("review") ||
        normalized.includes("queue") ||
        normalized.includes("process")
      ? WarningCircle
      : CheckCircle;
}

export function StatusIcon({ status, size = 15 }: { status: string; size?: number }) {
  const Icon = statusIconFor(status);
  return <Icon aria-hidden size={size} weight="bold" />;
}

export function StatusStamp({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  return (
    <span className={clsx("ui-status", `ui-status--${normalized.replaceAll("_", "-")}`)}>
      <StatusIcon status={status} />
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
  title: ReactNode;
  titleAdornment?: ReactNode;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        {props.eyebrow ? <span className="page-header__eyebrow">{props.eyebrow}</span> : null}
        <div className="page-header__title-row">
          <h1>{props.title}</h1>
          {props.titleAdornment}
        </div>
        {props.description ? <p>{props.description}</p> : null}
      </div>
      {props.actions ? <div className="page-header__actions">{props.actions}</div> : null}
    </header>
  );
}
