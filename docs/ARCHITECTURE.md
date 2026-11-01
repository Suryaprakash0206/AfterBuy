# Architecture and operating boundaries

## Application structure

`frontend` is a React/Vite/TypeScript application using React Router, TanStack Query, React Hook Form/Zod, Tailwind and accessible Radix primitives. Navy/white CSS tokens, focus rings, reduced-motion rules, mobile navigation and responsive review layouts are centralised. A PWA manifest and service worker provide an installable shell and an honest offline page. Authenticated API responses and uploaded files are not cached by the service worker.

`backend` is one Express application with feature routes and focused services/repositories. `backend/src/worker.ts` runs BullMQ consumers and a PostgreSQL recovery scanner in a separate process. `shared/domain.ts` contains request contracts, exact-money strings, case transitions and calendar logic. Migrations are the database source of truth; no schema is created at API startup.

```
Browser → Supabase Auth (verified session)
        → Express /api/v1 → user-scoped Supabase client → RLS-protected Postgres/Storage
Worker  → authoritative Postgres work records ↔ BullMQ/Redis
        → private Storage → extraction/chunking → OpenAI adapter → pgvector
```

User requests verify tokens with Supabase `getUser(token)`, not decoded claims. Workspace membership is checked on the server, then RLS applies to the user's client. Privileged clients are confined to worker processing, usage reservations and validated assistant-history writes. Workers recheck uploader membership and job records before reading documents. Backend endpoints do not accept arbitrary external URLs. The optional email adapter uses a fixed provider endpoint.

## Data model and privacy

- Profiles hold currency, IANA timezone and reminder preferences. Workspaces have memberships with owner/editor/viewer roles. Only owners can invite or change other non-owner members. Tokens are random, hashed in storage, expire in seven days and are single-use for the authenticated account matching the intended email. Per the requested configuration, email confirmation is disabled: matching the account email does not independently prove mailbox ownership. Session verification, intended-email matching, token possession, expiry and membership permissions remain enforced.
- Products own coverage, cases, lifecycle history and document links. Composite `(id, workspace_id)` foreign keys prevent cross-workspace associations. Scope is immutable even for direct PostgREST writes.
- Invoices and invoice line items preserve invoice totals independently of product costs. Confirmation locks the document and commits the invoice, all products, links and review in one transaction. A second confirmation returns the same product IDs. File hash uniqueness is workspace-scoped. Possible purchase duplicates are flagged for explicit acknowledgement.
- Documents are private objects. The backend checks access before returning 120-second signed URLs. Storage RLS also checks the matching document and membership. A deletion first tombstones the document, removes chunks, extraction content and cited chat messages, then the worker removes the object and row. Previously issued signed URLs can remain usable until their short expiry.
- A product archive hides it from the active collection and cancels pending reminders; expenditure history still counts it. Hard deletion removes its coverage/cases/history/conversations/links. Invoice accounting records remain, with the product association cleared; separately stored documents remain until explicitly deleted. The UI asks for deletion confirmation.
- Support exports check selected document links server-side. Shared originals and unconfirmed/multi-item invoices are blocked, including after one of their products is deleted. Users prepare a separate copy and upload it as a service document. The app cannot inspect whether a manually prepared copy still contains unrelated information.
- RLS is enabled on every application table. User table grants exclude worker-only writes. Security-definer RPCs validate access explicitly and have narrowly scoped execute grants. The app does not offer public unauthenticated product links.

## Dates and money

Money is PostgreSQL `numeric(16,4)` and decimal strings at API boundaries; SQL performs sums. Product costs are not added to invoice totals again. Different currencies stay separate. UI currency formatting rounds for display only. An unknown product line total remains null even if the invoice has a total.

Coverage start basis is purchase, delivery or explicitly entered. Start dates remain unknown if the chosen source is missing. An explicit end date takes precedence over a duration. A duration uses a calendar anniversary, clamped to the target month's final day (January 31 + one month → February 28/29); the recorded end day is inclusive. Users must adjust/confirm terms that define a different last covered day. JavaScript Temporal logic and SQL trigger calculations are tested against each other. Unconfirmed/ambiguous terms never schedule deadlines. Replacement events never reset warranties.

Reminder times are 09:00 in the user's configured timezone. Calendar days remain SQL `date`; events and schedules use `timestamptz`. Maintenance repeats in calendar months from the previous local occurrence, clamping at month end, and skips missed repetitions while delivering one overdue reminder. Coverage reminders use a revision key incorporating the user's preferences. Date/preference edits cancel stale schedules. Insert-time and delivery-time guards reject races with stale revisions.

## Document and AI pipeline

Uploads validate magic bytes, declared type, 20 MB maximum and 40 PDF pages (limits may be lowered by configuration). Digital PDF text is read locally. Scanned pages/images use the configured vision-capable model; OCR output must include all pages. Raw extraction is a suggestion with nulls, quotes, source pages and extracted/inferred labels. Only explicit user review becomes authoritative. Prompts and structured schemas are in `backend/src/modules/ai`.

Chunks preserve document/page/ordinal metadata, with 1,600-character windows and 200-character overlap. Extraction and embedding are distinct durable states. A manually confirmed invoice can be indexed later without changing its confirmed purchase fields; missing chunks are read from the original. Retrieval first uses the authenticated product/workspace scope, then filters model identity and validates returned source IDs against actual retrieved passages. Exact product and coverage facts are queried directly from SQL. Dashboard totals and expiring lists are SQL queries, never semantic calculations. Chat has no tools or write capabilities; documents and history are treated as untrusted data. Prompt instructions reduce document prompt-injection risk but do not guarantee a model's answer is correct: users should inspect citations.

The fixed contract is **1536-dimensional vectors** and one configured `OPENAI_EMBEDDING_MODEL`. Changing the model with the same dimensions requires reindexing all existing documents: pause workers, change API/worker configuration, set eligible documents' `index_status='pending'` in a reviewed database operation, restart workers, and wait for `ready`. Alternatively use each document's **Rebuild assistant index**. Old-model chunks are excluded by the retrieval model filter. To change dimensions, create a new migration replacing the vector column/index and matching RPC argument, update the backend contract and tests, then fully reindex; do not mix dimensions. No model name is hardcoded.

AI request rate limits, input/output limits and a PostgreSQL workspace daily usage budget bound cost. Units are conservatively reserved input characters plus output allowance, not a claim of provider-billed tokens; failed attempts consume reserved units. Vision reservations use a per-page allowance. The SDK also has timeouts and bounded retries. API errors report failure rather than fabricating answers.

## Durable work and delivery

BullMQ jobs use stable IDs, exponential backoff and four attempts. PostgreSQL remains the source of document state and all future reminder schedules. Every 30 seconds the scanner queues pending/due work, recovers 15-minute stale processing leases, retries eligible email deliveries, and performs pending deletions. In-app notification insertion, delivery marking, and the next maintenance recurrence commit atomically; uniqueness prevents notification duplication on retry. Failed extraction/index states remain visible and can be retried from the document screen. An unavailable Redis does not erase schedules.

Completed uploads and explicit extraction retries also attempt immediate dispatch with the same stable document job ID. Dispatch has bounded connection waits; a queue outage leaves the durable queued record for recovery. Authorised document-detail responses report scanner configuration and connected-worker availability, cached for five seconds. A connected worker is not proof of AI provider availability. The review form applies completed extraction results once per extraction run, fills untouched fields, preserves edited item lists as a whole, and resets the confirmation checkbox. Polling errors do not unmount an existing draft.

Optional Resend delivery records distinguish `pending`, `accepted`, `failed`, `disabled` and actual in-app `delivered`. The provider idempotency key limits duplicate sends, subject to the provider's retention period. There is no delivery webhook, so inbox delivery is not claimed. SMTP for Auth is configured independently. Worker logs avoid document contents and key material. Process supervision and operational alerting must be configured by an operator.

## Known limits and verification boundaries

- All seven migrations were applied to the connected hosted project on 2026-10-24. Live Auth sign-in and onboarding loaded, API readiness returned 200, and the documents bucket was verified private. Live Storage upload/download, BullMQ/Redis, OpenAI and Resend still need integration checks and the remaining worker/provider configuration.
- PGlite runs actual PostgreSQL constraints/RLS/functions/pgvector but replaces Supabase-managed Auth/Storage schemas. It is not a hosted Storage HTTP test.
- Browser workflow tests use clearly labelled fixture Auth/API/AI responses. Real local PDF/ZIP generation is tested separately. A credential-gated live workflow is provided and skipped by default.
- The app is intended for individual/household scale. Product collection is paginated; document/case lists cap at 500, coverage at 1,000, notifications/deliveries at 200, and some selectors at 100. Large-scale operations need additional pagination. Upload/export buffers are bounded but held in memory; maximum ZIP evidence is 15 files / 80 MB.
- PDF summaries use the built-in Latin font. Unsupported characters are substituted; the ZIP also contains UTF-8 JSON and the full draft message. Full multilingual PDF font embedding is not included.
- No automatic receipt redaction, inbox ingestion, external support sending, currency conversion, app push notifications, warranty eligibility determination or public sharing. Support drafts and downloads work independently of email.
- Local deployments listen on loopback. Production TLS, backups, secret rotation, monitoring, abuse controls across multiple API replicas, restore drills, antivirus/content scanning and provider legal/data-retention review have not been performed. This implementation is not a production-readiness certification.

## Official references checked

- [Supabase JavaScript getUser](https://supabase.com/docs/reference/javascript/auth-getuser) and [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control)
- [OpenAI structured outputs](https://platform.openai.com/docs/guides/structured-outputs) and [PDF inputs](https://platform.openai.com/docs/guides/pdf-files)
- [BullMQ retry/backoff](https://docs.bullmq.io/guide/retrying-failing-jobs)
- [Tailwind Vite integration](https://tailwindcss.com/docs/installation/using-vite) and [Vite getting started](https://vite.dev/guide/)


## Invoice specifications and warranty confirmation

Migration `202610250001_invoice_product_warranties.sql` adds nullable product specifications and extends the transactional invoice confirmation to create per-product coverage with the original invoice as its source. The API uses the new `confirm_invoice_details` entry point so an unmigrated database returns a setup error instead of silently dropping warranty/specification fields. The existing `confirm_extraction` RPC remains compatible with old callers that omit warranties.

AI results identify a zero-based invoice item for each warranty. Ambiguous associations require the reviewer to choose a product; removal of a product unassigns its warranty and shifts later indices. Product and warranty edits are preserved together during late scan updates. All saved coverage starts unconfirmed unless the reviewer explicitly confirms its provider and resolvable dates. Missing providers are stored as an empty value and displayed as not provided; missing start bases use an explicit, blank start rather than assuming purchase date. No coverage is manufactured for invoices without warranty terms.


## Groq and local invoice execution

`EXTRACTION_PROVIDER` selects the extraction adapter; `auto` prefers a configured Groq key. Groq receives strict Chat Completions JSON schemas with validated responses. The PDF rasterizer uses an explicit native canvas dependency, yields pages sequentially and caps the longest edge at 2,000 pixels. Each request uses at most one image. Groq scan calls share a ten-minute deadline, shorter than the 15-minute processing lease recovery threshold. Rate-limit, invalid credential, incomplete output and model-access failures are stored as safe error codes rather than raw provider responses.

`DOCUMENT_PROCESSING_MODE=inline` starts a bounded scheduler only after the API successfully binds its port. Uploaded document rows remain authoritative. A ten-second scanner rediscovers queued records, deduplicates active IDs, limits concurrency and recovers stale processing leases. A failed scan remains failed until retried by the user; a saturated process leaves work queued for a later recovery pass. Shutdown stops discovery and drains active scans. Inline mode supplies invoice extraction only; reminder delivery, storage deletion and assistant indexing retain the existing separate worker requirements. Queue mode remains available for deployments using Redis.
