# AfterBuy implementation progress

Updated 2026-10-24.

## Completed

- Inspected the existing empty frontend/backend folders and applicable instruction locations. Used the existing root; no nested AfterBuy folder.
- Implemented the React/Express application, shared validation/date logic, seven SQL migrations, RLS and private storage, worker recovery, OpenAI adapter, retrieval, exports and all requested screens.
- Completed manual purchases, document review, multi-item confirmation, separate coverage, service cases/outcomes, household roles/invitations, notifications and recorded-cost analytics.
- Added consistent navy/white design, responsive navigation/review, custom PDF controls, lazy page loading, keyboard/focus states, reduced motion and PWA assets/offline fallback.
- Added environment examples, Windows setup instructions, API and architecture documentation. Pinned installed stable dependency versions and generated the npm lockfile.
- Saved the user-supplied Supabase connection only in ignored local environment files. Removed the email-confirmation gate as requested while retaining server-side token verification and invitation-account matching. Hosted Auth confirms automatic email confirmation is enabled.
- Diagnosed the reported connection failure: the local API was stopped. Restarted it and retried the populated sign-in form successfully. Added actionable Auth/API network errors and preserved sessions during transient server-side Auth outages.
- Generated `supabase/setup.sql` from the seven versioned migrations with one transaction, an existing-schema guard and existing-account profile backfill. Tested the exact generated bundle locally, then applied it through the authenticated Supabase SQL Editor to the empty application schema using Run and enable RLS. Initial setup does not record CLI migration history; documented the upgrade boundary.

## Decisions

- User-scoped Supabase requests preserve RLS. Privileged operations are limited to workers, usage reservations and validated assistant history.
- No fake persistence, production demo data, hardcoded model names or invented confidence/financial metrics. Tests with external mocks are explicitly labelled.
- Fixed 1536-dimensional embedding contract with documented reindexing. Manually reviewed documents can be indexed later without changing purchases.
- Calendar anniversary coverage ends are inclusive and clamped at month ends. Missing/ambiguous terms stay unconfirmed. No automatic warranty reset after replacement.
- PostgreSQL owns future schedules; BullMQ is transport. Notification delivery and recurrence are atomic and retry-safe.
- Original multi-product invoices are blocked from support exports; a separately prepared copy is required.
- No deployment, destructive remote reset, personal inbox connection or external messages were performed. The authorised initial hosted schema setup is now applied.

## Verification

- Node 24.17.0/npm 12 used. `npm run check` passed: frontend/backend type checks, lint, 49 local tests, and both production builds.
- Real PostgreSQL/pgvector in PGlite executed all migrations, permission checks, cross-workspace denial, private-storage policies, atomic duplicate confirmation, date changes, overdue/retried/cancelled reminders and recurrence. Auth/Storage service schemas are test stand-ins.
- Actual local PDF/ZIP generation, file signature/page checks and export privacy checks passed. SDK mocks exercise incomplete extraction, provider failure and invalid citations.
- Playwright: eight browser checks passed, covering immediate sign-up, failed-sign-in retry, upload → review → coverage → case → PDF at desktop and Pixel 7 widths, keyboard focus, overflow, axe accessibility, empty/loading/error states and navigation. Auth/API/AI/storage are mocked only in the test harness. Two credential-gated live workflow checks were skipped.
- Screenshots of dashboard, review and package screens were visually inspected at desktop/mobile sizes; generated evidence is in ignored `.local/qa`.
- Dependency installation audit reported zero vulnerabilities. This is not a security audit or production-readiness claim.
- Live checks after setup: API health and readiness 200; all 22 public application tables have RLS enabled; documents bucket has `public=false`; the existing account signs in and reaches onboarding. The user completed onboarding and navigated to document upload during verification. A separate browser tab confirmed the real authenticated dashboard loads without errors; evidence is in `.local/qa/live-dashboard-connected.png`.

## Remaining external setup / not verified

- Confirm Auth site/redirect URLs before testing password recovery. Initial hosted migrations are applied; future updates must apply only pending files.
- Put the service-role/secret key in backend/.env for workers. Add account-available OpenAI model names/key for AI features.
- Start Docker Desktop, Redis and the worker. Docker's engine was unavailable during implementation, so live queue/downtime recovery was not exercised.
- Live new-account sign-up/password reset, hosted Storage upload/download, AI extraction/chat/embeddings and optional Resend delivery need configured isolated integration checks. Existing-account sign-in is verified; no external email was sent.
- See ARCHITECTURE.md for list-size bounds, Latin-font PDF limitation and deployment/operational work outside this local delivery.


## Invoice enhancement — 2026-10-25

- Extended invoice extraction with specifications and structured warranty duration, dates, provider, exclusions and item associations.
- Added editable per-product warranty review, explicit date confirmation, date previews, safe late-result merging and missing-information handling.
- Added migration `202610250001_invoice_product_warranties.sql`, a guarded API entry point, and atomic/idempotent persistence of products, invoice lines and sourced coverage. Existing installations must apply this migration; it has not been applied to the hosted database by this change.
- Product specifications are available in product details/editing and support packages. Narrowed the test coverage ignore rule so the existing backend coverage routes are no longer excluded from Git.
- Verification: 72 local tests passed, including actual PGlite migration execution, warranty linkage, missing dates, rollback and retry checks. Typecheck, lint and production builds passed. The new invoice review passed desktop/mobile browser and accessibility checks with mocked external services.
- Live OCR/provider access remains unverified and requires the missing backend credentials, Redis and worker setup. No credentials were added and no real invoices were sent to an external provider during this work.


## Groq scanner connection — 2026-10-25

- Connected the configured Groq key without exposing it. Verified the account models endpoint and selected `qwen/qwen3.8-27b` for text extraction and vision.
- Added strict validated Chat Completions output, one-page-at-a-time PDF rasterization, bounded image dimensions, provider-specific errors and a scan time limit. OpenAI remains optional for the separate assistant/embedding features.
- Configured local inline scanning with one concurrent job and durable PostgreSQL recovery, so invoice scanning no longer requires Docker/Redis on this machine. The queue/worker option remains supported.
- Live generated scanned PDF test extracted the expected product name, specifications, INR 1500.00 price and 12-month manufacturer warranty. No personal invoice was used for this probe.
- 85 automated tests and four focused desktop/mobile browser checks passed. Production build and lint passed before the final server startup correction; final checks repeated afterward.
- Supabase now exposes the specifications column and confirmation RPC. The RPC probe with invalid IDs returned the expected editor-access denial without creating records. Browser access to the Supabase dashboard was declined; no dashboard change was performed by this agent.
- Restarted the older API and verified `extraction: true` on the running service. The existing frontend remains on port 5173. Users can upload a new invoice or retry extraction for an older failed scan.
- Installation audit reported existing high-severity advisories in body-parser and multer; those package versions were not changed by this feature.
