# DESIGN.md — Ruang IOM

## Design contract

Ruang IOM is a serious internal operations tool. It should feel direct, legible, trustworthy, and
distinct—not playful, futuristic, or generically “AI.” The visual language is controlled
neobrutalism: hard structure, warm paper, crisp ink, one signal accent, and tactile controls.

Every UI change must preserve the privacy boundary, information hierarchy, responsive behavior,
and complete product states described here. Anvia headless primitives own chat semantics and
behavior; the application design system owns appearance and composition.

## Experience principles

1. **Evidence before confidence.** Sources, temporal scope, access scope, and unresolved ambiguity
   must be visible near the answer or decision they qualify.
2. **Human authority is explicit.** Label AI output as “Rekomendasi sistem” or “Alasan AI.” Label
   publish, archive, override, and overlap outcomes as HR actions.
3. **Progress without captivity.** Upload, OCR, reclassification, indexing, and overlap work occur in
   the background. Users may navigate away and return to durable progress.
4. **Density follows the task.** Chat stays calm and readable. Review and operations screens may be
   denser but use rules, alignment, and whitespace instead of nested cards.
5. **No hidden state.** Loading, queued, partial, cancelled, blocked, failed, stale, and empty states
   must be distinguishable in text, not color alone.
6. **Motion explains change.** Motion may acknowledge input, reveal state, or preserve spatial
   continuity. Decorative perpetual animation is not appropriate for this product.

## Design tokens

Use the existing CSS custom properties as the source of truth. New colors require a semantic role,
contrast verification, and reuse across more than one relevant state.

```text
Canvas / warm paper     #F3EFE6
Raised paper            #FFFDF7
Ink / off-black         #20201E
Primary signal orange   #E85D3F
Muted text              warm neutral derived from ink
Border                  2px solid ink for primary structure
Offset shadow           4px 4px 0 ink for interactive/elevated elements only
Corner radius           2–6px
```

- Do not use pure black, gradients, neon, glow, glassmorphism, AI purple, or mixed warm/cool grays.
- Success, warning, and error colors are semantic accents, not decoration.
- Never rely on color alone; pair state colors with labels, icons, shape, or pattern.
- Shadows communicate elevation or interactivity. Static data groups normally use rules and space.

## Typography and icons

- UI and display: `Geist Variable` or the existing approved Satoshi equivalent.
- IDs, IOM numbers, timestamps, model names, metrics: `JetBrains Mono Variable`.
- No serif type in the product application.
- Headings use tight tracking and compact leading, but must not sacrifice Indonesian readability.
- Body copy targets a comfortable 45–75 character line length where practical.
- Use sentence case for titles and actions. Use uppercase monospace only for short operational labels.
- Use `@phosphor-icons/react` at one consistent weight. Icons supplement text; destructive or obscure
  actions cannot be icon-only without an accessible name and tooltip.
- Do not use emoji in interface copy, markup, icons, or empty states.

## Layout system

- Desktop content has a deliberate maximum width near 1400px and asymmetric composition where it
  improves prioritization.
- Prefer CSS Grid for page structure and split views. Use flex for one-dimensional alignment.
- HR Overview is an operational board: primary queue/progress column plus a narrower decision and
  health rail. Do not replace it with three equal metric cards.
- Document review is a split workspace: source/preview left, decisions/evidence right.
- Chat uses the available viewport with a stable header, scrollable thread, and anchored composer.
- At widths below 768px, all asymmetric grids collapse to one column with no horizontal page scroll.
- Sticky elements must not obscure keyboard focus. Respect safe areas and use dynamic viewport units
  when full-height behavior is required.
- At 200% zoom, content must reflow without lost actions or clipped status text.

## Component ownership

Reusable visual primitives live in `packages/ui`; product-specific orchestration stays with the
owning app feature or route.

Before creating a component, check for an existing primitive or composition:

```text
Button / IconButton / Input / Textarea / Select
Field / FormError / HelperText
Dialog / Drawer / Popover / Tooltip
Table / Pagination / Tabs
Badge / StatusStamp / ProgressBar
EmptyState / ErrorState / Skeleton
FileDropzone / UploadQueue
DocumentPreview / TextMarker / PageNavigator
SourceCard / CitationMarker
ModelSelector / ReasoningSelector / ReasoningDisclosure
ToolCallCard / VersionTimeline / OverlapComparison / AuditTimeline
```

- Primitives accept semantic HTML props and remain domain-agnostic.
- Do not create a wrapper that only renames an existing component.
- Avoid deeply nested card-on-card composition. Use headings, rules, grids, and negative space.
- Forms use a visible label above the control, helper or error below, and stable layout while loading.

## Interaction states

Every interactive component must define:

- default, hover, active, focus-visible, disabled, and busy behavior;
- a stable hit area of at least 44×44px for primary controls where layout permits, never below the
  WCAG 2.2 minimum of 24×24px without sufficient spacing or an equivalent target;
- a visible focus indicator equivalent to a solid 2px perimeter with at least 3:1 contrast;
- an accessible name that matches or contains the visible label;
- focus restoration after dialog/popover close.

Buttons may move by one pixel on `:active`. Animate only `transform` and `opacity`; do not animate
layout dimensions or scroll position for decoration. All non-essential motion must stop under
`prefers-reduced-motion: reduce`.

Drag-and-drop upload must always have a normal file-picker alternative. Marker/highlight workflows
must have keyboard-operable controls and must not require precise dragging.

## Async and error UX

- Use skeletons shaped like the destination layout for initial loading; do not use a spinner as the
  only page state.
- Preserve control dimensions while submitting to prevent layout shift.
- Show per-file upload progress and errors. One failed file cannot visually invalidate successful
  siblings.
- Background states use explicit stage labels: queued, extracting, OCR, classifying, reviewing,
  indexing, completed, and failed.
- Retry acts only on the failed operation and must not duplicate a completed upload, message, tool
  mutation, or job.
- Inline errors explain what the user can do next and never expose account existence, stack traces,
  storage paths, provider payloads, or confidential values.
- Empty states state why the surface is empty and provide one relevant next action when authorized.
- Warn about unsaved review changes before navigation.

## Chat experience

Chat renders these as distinct semantic parts, in this order when available:

1. actual model and reasoning effort;
2. collapsible provider-generated “Ringkasan penalaran model”;
3. tool name and live status;
4. parsed tool parameters;
5. authorized, scope-safe tool evidence;
6. streaming final answer;
7. authorized source cards;
8. usage, duration, cancellation, blocked, or completion status.

- Never display or imply raw chain of thought.
- Reasoning and tool panels are secondary disclosure, not visually louder than the final answer.
- A source card opens the exact authorized document, page, or section when available.
- Employee UI always shows an `EMPLOYEE SAFE` scope label. HR chat shows `HR SCOPE`.
- A blocked release is a deliberate safe state, not a generic network error.
- The composer supports Enter to submit, Shift+Enter for newline, a visible Stop action during a run,
  and a keyboard shortcut to focus it.
- Model and reasoning selectors show only server-provided capabilities. Unsupported efforts remain
  unavailable and include concise helper text.
- Screen-reader live regions distinguish search/tool progress from final-answer announcements.

## Document and confidentiality review

- Batch upload presents one durable row per file with stage, progress, retry, and safe error detail.
- Review uses source context and AI evidence together. Never show confidence without rationale and
  policy/marker context.
- Sensitive highlights must preserve text readability and expose their reason without hover-only UI.
- High-confidence groups may be bulk-confirmed. Conflict and low-confidence items require individual
  review and cannot be visually collapsed into a bulk-success state.
- Manual confidential and employee-safe controls must use explicit labels and a written reason.
- The publish action summarizes which corpus becomes available. Archive/supersede confirmations
  state the retrieval impact and historical preservation.

## Version and overlap views

- Timelines distinguish upcoming, current, superseded, and archived by text/icon/structure, not only
  hue.
- Always show IOM number, revision, effective range, and confirmed relationship near comparisons.
- Change-over-time views present previous value, proposed/current value, and effective date.
- Overlap evidence is side-by-side and traceable to both documents. HR sees every final outcome
  (replace, partial override with topic scope, complement, or no material overlap) plus a separate
  pending-review state; AI recommendations are never silently saved as decisions.
- Recommendation cards say “Rekomendasi sistem”; action controls say “Keputusan HR.” Recording a
  decision and changing document lifecycle remain separate explicit actions.
- Confidence below threshold or missing provenance is visually routed to manual review.

## Content language

- Application chrome is concise Indonesian. Agent answers follow the question language.
- Prefer concrete operational copy: “Simpan keputusan,” “2 bagian perlu review,” “OCR gagal pada
  halaman 14.” Avoid marketing phrases such as “seamless,” “next-gen,” or “revolutionary.”
- Explain IOM on first-use surfaces as memo internal kantor; do not assume every employee knows the
  acronym.
- Dates shown to users use Indonesian locale and an unambiguous full format when they affect rules.
- Numbers and statuses come from real data. Never fabricate metrics or sample users in production UI.

## Accessibility acceptance

Target WCAG 2.2 AA, with the stronger focus appearance and 44px target guidance where practical.
Every UI milestone is checked at:

```text
1440×900 desktop
1280×720 laptop
768×1024 tablet
390×844 mobile
200% browser zoom
keyboard-only
reduced motion
long Indonesian and English content
large reasoning/tool output
empty, loading, failure, blocked, and partial-processing states
```

Automated checks do not replace keyboard and visual inspection. Playwright assertions should cover
landmarks, accessible names, focus order/restoration, live regions, non-overflow, and the critical
task path.

## Forbidden design regressions

- Generic three-card dashboard layouts or fake KPI grids.
- Gradient text, neon glow, glass panels, excessive pills, oversized centered hero copy, or AI-purple.
- Decorative stock imagery, generic avatars, fake employee names, emojis, or filler statistics.
- Persistent motion, parallax, scroll hijacking, custom cursors, or animations that delay work.
- Icon-only critical actions, color-only statuses, invisible focus, inaccessible drag-only controls.
- Modal stacking, nested scroll traps, horizontal page overflow, or sticky controls hiding content.
- Exposing internal identifiers, raw tool payloads, denied evidence, or security implementation details
  merely to make the AI experience appear more technical.

## Pre-flight checklist

- Does the screen make access scope and source provenance clear?
- Are loading, empty, error, partial, cancelled, and blocked states handled where relevant?
- Can the complete task be performed with keyboard and at 200% zoom?
- Is focus visible and unobscured, and are targets appropriately sized?
- Does mobile collapse cleanly without horizontal overflow?
- Are metrics and statuses real and server-derived?
- Are semantic Anvia primitives preserved for chat behavior?
- Did we reuse an existing primitive or justify the new one?
- Does motion explain state and respect reduced motion?
- Did Playwright and visual QA cover every changed viewport or interaction?

## Standards consulted

- AGENTS.md open format: https://agents.md/
- OpenAI Codex instruction precedence and verification behavior:
  https://openai.com/index/introducing-codex/
- W3C Web Content Accessibility Guidelines 2.2: https://www.w3.org/TR/WCAG22/
- W3C Understanding Focus Appearance:
  https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html
