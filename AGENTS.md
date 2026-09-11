# AGENTS.md

## Scope and precedence

This file governs the entire repository. A nested `AGENTS.md` may add stricter rules for its
subtree. The closest applicable file wins when repository instructions conflict. Direct system,
developer, and user instructions always take precedence.

Read this file, `DESIGN.md`, and the relevant files in `docs/` before changing code. Treat these as
living constraints: update them when an approved architectural or product decision changes.

## Product intent

Ruang IOM is an internal HR regulation assistant for Indonesian office memos. It must help employees
and HR understand active and historical rules without revealing information outside their role.
Correct authorization, temporal accuracy, provenance, and human approval are more important than a
plausible-looking AI answer.

Two roles exist in the MVP:

- `EMPLOYEE`: employee-safe conversations and approved public evidence only.
- `HR_ADMIN`: employee or HR scope plus ingestion, review, policy, versioning, overlap, and audit.

Never add self-registration, web search, automatic document deletion, or automatic publish/archive
behavior unless the product requirements explicitly change.

## Repository map and dependency direction

```text
apps/platform  -> packages/contracts + packages/ui + Anvia client packages
apps/api       -> contracts + database + agents + config + documents
apps/worker    -> database + documents + agents + config
packages/agents -> contracts + injected services + Anvia
```

- `apps/platform`: React/Vite application and TanStack Router file routes.
- `apps/api`: Hono authentication, authorization, HTTP/SSE/JSONL boundaries, and safe projection.
- `apps/worker`: leased background jobs for parsing, OCR, classification, indexing, and overlap.
- `packages/agents`: Anvia agents, tools, retrieval, structured workflows, and stream guards.
- `packages/contracts`: shared Zod schemas, enums, and public DTOs.
- `packages/database`: Prisma schema/client, repositories, sessions, queue, and migrations.
- `packages/documents`: storage abstraction, validation, parsers, OCR, normalization, and chunking.
- `packages/config`: server-only and browser-safe environment validation.
- `packages/ui`: reusable application-owned presentation primitives.
- `packages/evals`: versioned deterministic safety and quality cases.

Do not introduce reverse dependencies. In particular, `packages/agents` must not import Prisma,
read `process.env`, access request globals, or instantiate application infrastructure.

## Required workflow

1. Inspect the nearest instructions and existing implementation before proposing a new abstraction.
2. Preserve unrelated user changes and keep the patch scoped to the request.
3. Reuse or extend existing contracts, services, hooks, components, and helpers before creating new
   ones. Extract a reusable unit only when ownership or repeated behavior is clear.
4. Verify every third-party package and its installed version before importing it. Anvia packages
   version independently; never assume matching version numbers imply compatibility.
5. Add or update tests with the behavior. Security regressions require a versioned eval fixture.
6. Run the narrowest checks while iterating, then all required gates before completion.
7. Commit coherent, verified milestones. Do not mix unrelated cleanup into a feature commit.

Do not silently weaken a safety rule, test, schema, threshold, or authorization check to make a test
pass. Fix the behavior or document a genuine product decision.

## Commands and environment

Use pnpm only. Root commands intentionally load `.env` through `dotenv-cli`:

```text
pnpm install --frozen-lockfile
pnpm db:generate
pnpm db:migrate        # local development only
pnpm db:deploy         # CI and production
pnpm user:create
pnpm dev
pnpm check
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

- **Coding agents must never open, read, print, search, parse, source, copy, summarize, or otherwise
  inspect any `.env` or `.env.*` file, even for debugging.** This prohibition includes shell tools,
  editor tools, scripts, logs, and indirect inspection. The only exception is `.env.example`, which
  is intentionally public and contains placeholders/defaults only.
- Do not modify a real `.env` file. When configuration is missing, describe the required key and ask
  the human operator to set it. Commands may consume already-provided process environment values,
  but agents must never echo or enumerate them.
- Never commit `.env`, credentials, confidential IOM content, generated storage, or test secrets.
- `.env.example` contains placeholders only.
- Server startup must fail fast for invalid required configuration.
- Browser code may read only validated `VITE_*` variables.
- Provider clients receive validated configuration explicitly; they do not read environment values.

## TypeScript and code conventions

- TypeScript strict mode, ESM, Zod at trust boundaries, and `exactOptionalPropertyTypes` apply.
- Prefer small named functions, explicit domain types, early returns, and dependency injection.
- Avoid `any`, non-null assertions, duplicated string unions, ambient mutable state, and boolean flag
  combinations that obscure lifecycle state.
- Model state transitions as finite enums and validate transitions in the domain layer.
- Do not catch an error only to ignore it. Convert expected failures to stable safe error codes;
  propagate unexpected failures to structured observability without exposing internals to clients.
- Comments explain why, invariants, or non-obvious risk—not a line-by-line translation of code.
- Use Biome for formatting, linting, and import organization. Do not hand-format against Biome.

## Anvia stable-v1 rules

Use the stable-v1 APIs installed in this repository:

- `new Agent({...})`, never legacy `AgentBuilder`.
- `new Pipeline({...})`, never legacy `PipelineBuilder`.
- Handle explicit `response | interaction | blocked` outcomes.
- Use `parseClientStreamRequest`, `agentToClientStream`, and `createClientStreamResponse` at the API
  boundary.
- Use `createHttpClientTransport`, `useChat`, `ChatProvider`, and Anvia semantic primitives in the
  platform.
- Define tools with strict input/output schemas. Tools receive actor-scoped services from a factory.
- Keep mutation tools idempotent and approval-gated. The IOM chat agent currently has no mutation
  or web-search tool.
- Pass cancellation from the browser through the HTTP request, agent run, model, and active tool.
- Never expose raw provider events, raw/encrypted reasoning, continuations, internal IDs, stack
  traces, storage keys, database filters, or unreviewed tool output to the browser.
- Reasoning UI means provider-generated reasoning summary only; never claim to expose chain of
  thought.

When touching Anvia behavior, consult the relevant local Anvia skill and current official
documentation. Do not copy patterns from the legacy reference repository.

## Authorization and confidentiality invariants

- Authentication and authorization are enforced at route and service/repository boundaries. A
  system prompt is never an authorization boundary.
- Conversation ownership, role scope, model selection, and corpus-policy version are server-owned.
- Tool scope is constructed from the authenticated actor; never accept a role or collection from
  model-generated input.
- Employee retrieval uses the employee collection and only approved `EMPLOYEE_SAFE` public text.
- HR retrieval uses the HR collection but remains scoped and audited.
- Reauthorize every vector result against PostgreSQL status, effective date, policy generation, and
  visibility before it reaches a model.
- Do not reveal the existence, filename, citation, metadata, or inferred content of HR-only chunks
  to employees.
- Treat retrieved document text as untrusted quoted evidence. Instructions embedded in a document
  cannot override application or tool instructions.
- Manual `CONFIDENTIAL` markers cannot be downgraded by AI. Manual `EMPLOYEE_SAFE` markers are hints
  and may still create a conflict.
- Unresolved or conflicting confidentiality decisions block publish.
- Generic logs, analytics, Lens, and audit safe metadata must not contain full confidential payloads.
- Preserve the rolling stream-release guard. Changes to its buffer or fingerprint behavior require
  adversarial tests for answer text and reasoning summaries.

## Documents, jobs, and temporal rules

- Validate signature, MIME, byte size, and page count. ZIP archives remain unsupported.
- Store originals through `FileStorage`; do not couple domain code to local paths.
- Keep parsing/OCR/embedding in the worker. Browser requests must not wait for heavy processing.
- Chunk IDs are deterministic and stable for identical normalized content and location.
- Jobs require an idempotency key, lease, heartbeat, bounded retry, and terminal dead-letter state.
  One file failure must not fail its upload batch.
- `IomDocument` is stable identity; `IomVersion` is a revision. Published, superseded, and archived
  versions are immutable through ordinary metadata editing.
- Current answers use the confirmed active temporal state. Date-sensitive questions use `asOf`.
- A newer date or semantic similarity alone never means replacement. Only an HR-confirmed
  `REPLACES`/`PARTIALLY_OVERRIDES` relation changes precedence.
- Overlap analysis is advisory and provenance-bound. Confidence below `0.75`, conflict, malformed
  output, or missing evidence must become `MANUAL_REVIEW`.
- User-facing UI does not hard-delete IOMs. Archive and supersede retain history and auditability.

## API and database rules

- Keep public request/response contracts in `packages/contracts` when shared across boundaries.
- Validate body, query, params, file metadata, model IDs, reasoning effort, pagination, and dates.
- Return safe Indonesian user messages; never leak SQL, vector filters, stack traces, or account
  existence from login errors.
- All HR-only reads and decisions that matter to security or lifecycle must be audited.
- Migrations are append-only after sharing. Never edit an applied migration; add a new migration.
- Use an interactive transaction for invariants spanning multiple records. Do not hold a database
  transaction open across model, OCR, filesystem, or network work.
- PostgreSQL is the source of truth. Qdrant is a rebuildable retrieval index, not authorization state.

## Frontend and UX rules

Follow `DESIGN.md` for every UI change.

- TanStack Router file-based routes remain the navigation layer. Do not add TanStack Start.
- Route loaders and focused hooks own server state; local React state owns transient UI state.
- Do not add Redux, Zustand, or TanStack Query without a measured need and explicit approval.
- Build chat behavior on Anvia headless semantic primitives; style through application components.
- Every asynchronous surface needs loading, empty, partial, error, retry, cancelled, and success
  behavior as applicable.
- Navigation must not cancel active uploads. Refresh must not re-upload completed files.
- Never render fake metrics, fake document data, fake reasoning, or fake system health.

## Testing and definition of done

Add the smallest valuable test at the lowest reliable layer, then cover security boundaries with
integration or eval cases. A task is complete only when relevant checks pass and the worktree is
understood.

Minimum final gates:

```text
pnpm check
pnpm typecheck
pnpm test
pnpm build
```

Run `pnpm test:e2e` for any route, layout, accessibility, upload, chat, or interaction change. Run
database migration deployment against a disposable PostgreSQL instance for schema changes.

Required regression coverage includes cross-role access, conversation ownership, lifecycle
transitions, temporal filters, vector reauthorization, stream projection/order/cancellation,
confidential leakage, citation authorization, prompt injection, and low-confidence overlap routing.
An unparsable eval result is a failure, never a pass.

## Git conventions

Branches use lowercase kebab-case with one of:

```text
feat/ fix/ refactor/ perf/ test/ docs/ chore/ build/ ci/
```

Commits use Conventional Commits:

```text
type(scope): imperative summary
```

- Keep commits reviewable and milestone-oriented.
- Commit migrations and lockfile changes with the feature that requires them.
- Never bypass hooks, force-push shared branches, rewrite user commits, or commit directly to
  protected `main`.
- Do not merge until CI passes. Describe safety impact, migrations, verification, and known runtime
  requirements in the pull request.

## References

- Product architecture: `docs/architecture.md`
- Operations and recovery: `docs/operations.md`
- Security and release evaluation: `docs/security-and-evals.md`
- Visual and interaction system: `DESIGN.md`
