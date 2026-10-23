# AfterBuy implementation progress

Updated 2026-10-23.

## Completed

- Inspected the existing empty frontend/backend folders and applicable instruction locations. Used the existing root; no nested AfterBuy folder.
- Implemented the React/Express application, shared validation/date logic, six SQL migrations, RLS and private storage, worker recovery, OpenAI adapter, retrieval, exports and all requested screens.
- Completed manual purchases, document review, multi-item confirmation, separate coverage, service cases/outcomes, household roles/invitations, notifications and recorded-cost analytics.
- Added consistent navy/white design, responsive navigation/review, custom PDF controls, lazy page loading, keyboard/focus states, reduced motion and PWA assets/offline fallback.
- Added environment examples, Windows setup instructions, API and architecture documentation. Pinned installed stable dependency versions and generated the npm lockfile.
- Saved the user-supplied Supabase connection only in ignored local environment files. Auth settings respond successfully. API reports the missing hosted schema honestly.

## Decisions

- User-scoped Supabase requests preserve RLS. Privileged operations are limited to workers, usage reservations and validated assistant history.
- No fake persistence, production demo data, hardcoded model names or invented confidence/financial metrics. Tests with external mocks are explicitly labelled.
- Fixed 1536-dimensional embedding contract with documented reindexing. Manually reviewed documents can be indexed later without changing purchases.
- Calendar anniversary coverage ends are inclusive and clamped at month ends. Missing/ambiguous terms stay unconfirmed. No automatic warranty reset after replacement.
- PostgreSQL owns future schedules; BullMQ is transport. Notification delivery and recurrence are atomic and retry-safe.
- Original multi-product invoices are blocked from support exports; a separately prepared copy is required.
- No deployment, hosted migrations, personal inbox connection or external messages were performed.

## Verification

- Node 24.17.0/npm 12 used. `npm run typecheck`, `npm run lint`, `npm test` (45 tests) and both production builds passed.
- Real PostgreSQL/pgvector in PGlite executed all migrations, permission checks, cross-workspace denial, private-storage policies, atomic duplicate confirmation, date changes, overdue/retried/cancelled reminders and recurrence. Auth/Storage service schemas are test stand-ins.
- Actual local PDF/ZIP generation, file signature/page checks and export privacy checks passed. SDK mocks exercise incomplete extraction, provider failure and invalid citations.
- Playwright: four browser checks passed, covering the upload → review → coverage → case → PDF workflow at desktop and Pixel 7 widths, keyboard focus, overflow, axe accessibility, empty/loading/error states and navigation. Auth/API/AI/storage are mocked only in the test harness. Two credential-gated live browser checks were skipped.
- Screenshots of dashboard, review and package screens were visually inspected at desktop/mobile sizes; generated evidence is in ignored `.local/qa`.
- Dependency installation audit reported zero vulnerabilities. This is not a security audit or production-readiness claim.
- Live read-only checks: Supabase Auth settings 200; database `workspaces` missing (`PGRST205`); local API config recognises the connection and readiness reports `not_ready`.

## Remaining external setup / not verified

- Apply the reviewed migrations to the intended Supabase project and configure Auth site/redirect URLs. No remote changes were attempted.
- Put the service-role/secret key in backend/.env for workers. Add account-available OpenAI model names/key for AI features.
- Start Docker Desktop, Redis and the worker. Docker's engine was unavailable during implementation, so live queue/downtime recovery was not exercised.
- Live Auth sign-in/verification/reset, hosted Storage, AI extraction/chat/embeddings and optional Resend delivery need configured isolated integration checks. No external email was sent.
- See ARCHITECTURE.md for list-size bounds, Latin-font PDF limitation and deployment/operational work outside this local delivery.
