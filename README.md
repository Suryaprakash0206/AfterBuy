# AfterBuy

A purchase, warranty and repair organiser built with React, Express and Supabase. The interface uses only navy (`#142D4E`), white, and their opacity variants. There is no production demo data or fake persistence.

## What is included

- Supabase email/password authentication, immediate sign-up without email confirmation, password recovery, personal onboarding and household invitations with owner/editor/viewer permissions.
- Product search, filtering, sorting, pagination, list/grid views, archive/delete, and five detail tabs.
- Private PDF/JPEG/PNG upload, duplicate detection, background extraction, original-document review, and transactional multi-product confirmation.
- Separate return, manufacturer, extended and repair coverage with deterministic calendar calculations and explicit confirmation.
- Grounded product document chat with page citations and isolated conversation history.
- Service cases, troubleshooting and outcome history, editable support messages, selected-evidence PDF and ZIP exports.
- Persistent reminder schedules, notification read/snooze controls, maintenance recurrence and optional Resend email.
- Actual expenditure, repair/maintenance costs, refunds, deadlines and missing-record analytics, separated by currency.

## Current connection

The supplied Supabase URL and publishable key are saved in local, ignored `.env` files. On 2026-10-24, all seven migrations were applied through the authenticated Supabase SQL Editor to the previously empty application schema. Auth email confirmation is disabled, live sign-in succeeded, onboarding loaded, and API readiness returned 200. The publishable key cannot install migrations or perform worker operations; worker and AI configuration remain separate.

## Run locally — Windows PowerShell

Use Node.js 24 LTS and npm. Docker Desktop with its engine running is required for Redis and for the optional local Supabase stack.

```powershell
Set-Location 'C:\Users\garap\OneDrive\Desktop\Afterbuy'
npm ci

# Only on a fresh checkout; do not overwrite configured local files.
if (!(Test-Path frontend/.env)) { Copy-Item frontend/.env.example frontend/.env }
if (!(Test-Path backend/.env)) { Copy-Item backend/.env.example backend/.env }
```

Choose one database setup:

**Existing hosted Supabase project.** Review `supabase/migrations`, then use the Supabase CLI, installed according to its official Windows instructions:

```powershell
supabase login
supabase link --project-ref YOUR_PROJECT_REFERENCE
supabase db push --dry-run
# Applies the reviewed migrations to the project you linked:
supabase db push
```

Alternatively, for a **new, empty project**, run `npm run db:prepare`, open `supabase/setup.sql`, and paste the entire file into the project's SQL Editor. Choose **Run and enable RLS** if the dashboard prompts. The script includes its own RLS policies, preserves existing Auth accounts, and wraps the seven migrations in one transaction. It refuses to rerun when workspace tables already exist. The connected project is already set up: do not run the initial bundle again there.

For projects installed through the SQL Editor, apply only new migration files in filename order for subsequent upgrades. This path does not populate CLI migration history; reconcile that history before switching to `supabase db push`. Do not use `db reset` against an existing remote project. SQL creates private storage policies as well as tables and backfills profiles for existing Auth users.

**Local Supabase.** With Docker running and the CLI installed:

```powershell
supabase start
supabase migration up --local
supabase status
```

Copy the local URL, publishable/anon key and service-role/secret key from the CLI output into the appropriate `.env` files. Local email confirmation is disabled in `supabase/config.toml`. Password reset messages are visible in the local mail viewer listed by `supabase status`. CLI management credentials are separate from application credentials.

Set Auth's Site URL to `http://127.0.0.1:5173` and allow these redirect URLs in the Supabase dashboard:

- `http://127.0.0.1:5173/auth/callback`
- `http://127.0.0.1:5173/auth/reset`

If using `localhost`, allow the equivalent URLs and use that hostname consistently. For a new hosted project, disable **Confirm email** in Authentication → Sign In / Providers to match the requested sign-up flow; this setting is already disabled on the connected project. Supabase documents this in [Auth configuration](https://supabase.com/docs/guides/auth/general-configuration). Password reset still uses email and may require SMTP configuration. Household invitations use a copyable link; the app never reports an invitation email as sent.

Start the application:

```powershell
npm run dev
```

Open **http://127.0.0.1:5173**. Express listens on `127.0.0.1:3001`; Vite proxies `/api` to it. Keep this terminal running while using the app. Sign up and create your personal workspace; no email-verification step is required. Manual products, coverage and cases need only the migrated database and public Supabase configuration.

Start Redis and the worker in a second terminal:

```powershell
docker compose up -d redis
npm run worker
```

The worker needs `SUPABASE_SERVICE_ROLE_KEY` in **backend/.env only**. It processes uploaded documents, removes deleted storage objects, rebuilds document indexes, reconciles coverage reminders, and recovers due work every 30 seconds. Without a worker, an invoice can still be manually confirmed while queued; automatic extraction and reminder delivery will wait. Do not expose Redis to the network.

## Configure AI and optional email

Use the backend example file for the complete settings. No model name is assumed. Set `OPENAI_API_KEY`, `OPENAI_EXTRACTION_MODEL`, `OPENAI_CHAT_MODEL`, and `OPENAI_EMBEDDING_MODEL` to models available to your account. The extraction model must support structured Responses output plus PDF/image input. The chat model must support structured Responses output. Embeddings must support the fixed **1536 dimensions** requested by this app. Verify model capabilities in the [OpenAI model documentation](https://platform.openai.com/docs/models).

Restart the API and worker after changes. API/worker keys never use a `VITE_` prefix. Review source data handling with your chosen provider before uploading sensitive documents. If AI is absent, enter invoice and coverage information manually; the application does not synthesize missing fields.

Automatic receipt scanning needs `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY` and `OPENAI_EXTRACTION_MODEL` in **backend/.env**, plus Redis and `npm run worker`. Upload a PDF or a receipt photo with **Invoice or receipt** selected. Upload completion immediately requests a background scan; PostgreSQL recovery picks up saved uploads after downtime. The review page shows whether the scanner is unconfigured, offline, waiting or processing. Extracted seller, invoice number, date, currency, item details and totals fill the open form automatically, including when results arrive after you opened it. Existing edits are preserved, and recording products still requires confirmation. If you edited product rows, you can explicitly choose **Use scanned product list** after reviewing the replacement warning. A temporary polling failure leaves the draft visible.

The extraction and queue unit tests and browser scan tests use explicitly mocked provider results. They verify the integration logic, not OCR accuracy or live model access. Chat/embedding models are not required just to extract invoice fields.

For optional reminder email, set `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, and a verified `EMAIL_FROM`, then enable email in account preferences. This adapter is independent of Supabase Auth's SMTP setup. `accepted` means the provider accepted the email; there is no webhook integration claiming inbox delivery. No email was sent during implementation or testing.

## Verification commands

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

Browser tests use installed Google Chrome by default. If Chrome is unavailable, install Playwright's Chromium and change `channel: "chrome"` in `playwright.config.ts` to the installed browser. Browser fixtures explicitly mock Auth/API/AI/storage and run a separate frontend on port 5174; they do not touch the configured project. PostgreSQL tests execute the real migrations and pgvector queries in PGlite, with stand-in Auth/Storage schemas. PDF/ZIP tests generate actual files locally.

The separate live E2E test is skipped unless `E2E_LIVE_URL`, `E2E_EMAIL`, and `E2E_PASSWORD` are explicitly set. Use an account in an isolated test workspace: it creates records. Live test data is not automatically deleted. Never point it at production.

For built local execution: `npm run build`, then `npm run start -w backend`, `npm run worker:start -w backend`, and `npm run preview -w frontend`. Vite's preview retains the API proxy; allow its port (4173) in `FRONTEND_ORIGIN` and Supabase Auth redirects if signing in there. A real deployment needs HTTPS and a same-origin reverse proxy serving the frontend and `/api`; deployment is outside this delivery.

## Troubleshooting

| Symptom | Resolution |
| --- | --- |
| `MIGRATIONS_REQUIRED` / `PGRST205` | Apply all migrations to the correct Supabase project. |
| Could not reach the sign-in service / Failed to fetch | Check the internet connection and Supabase project availability, then retry Sign in. The app retains the form for retry. |
| AfterBuy server unavailable | Keep `npm run dev` running from the root. Check `/api/v1/health`; a frontend left open in a browser does not keep the API process alive. |
| Reset link expired | Request a fresh link on the sign-in screen. Check hostname and redirect configuration. |
| Document stays queued | Start Redis and the worker; configure its privileged Supabase key. |
| `AI_NOT_CONFIGURED` | Use manual review or configure key/models and retry document processing. |
| Assistant index failed/unavailable | Check model dimensions/quota, then use **Rebuild assistant index**. Scanned documents first require successful transcription. |
| Shared invoice blocked in export | Confirm a single-product invoice or upload a separately prepared copy as a service document. Do not attach an original containing other items. |
| Notification has no email | Inspect actual delivery state; email is opt-in and requires provider configuration. |
| Docker named-pipe error | Start Docker Desktop and wait for the engine before starting Redis/Supabase. |
| API fails to start after env edit | Check variable types and embedding dimensions; restart from the project root using the provided scripts. |

`GET /api/v1/health` reports the API process; `GET /api/v1/ready` checks the database endpoint, and `/api/v1/config` reports configured capabilities without revealing credentials. Structured logs include request/job identifiers, not tokens or receipt contents. Keep `.env`, `.local`, and generated build/test output out of Git.

See [architecture and boundaries](docs/ARCHITECTURE.md), [REST API](docs/API.md), and [progress and verification](docs/PROGRESS.md) for implementation details and genuine limitations.


## Invoice product and warranty review (2026-10-25)

Invoice scanning now extracts product specifications and structured warranty terms in addition to purchase details. The review screen lets the user correct these fields, assign each warranty to its product, inspect calculated dates, and explicitly confirm coverage. Unknown providers, dates and terms are not invented. Incomplete warranties can be saved unconfirmed; no warranty is created when none is stated or entered. Product rows and warranty mappings are preserved together when a scan arrives after manual edits.

Confirmation saves products, specifications, invoice lines, document links and warranties in one database transaction. Retrying confirmation returns the original products without duplicating coverage. Specifications appear on the product page and in support summaries. The existing quantity and unit-price fields remain stored on invoice lines; product cost is the line total, never the whole invoice total.

**Existing installations must apply only `supabase/migrations/202610250001_invoice_product_warranties.sql` before starting the updated app.** The regenerated `supabase/setup.sql` is for fresh installations only. This code change does not apply migrations to a hosted project or configure credentials. Live scanning still requires the backend service-role key, extraction model/API key, Redis, and the worker. Tests use mocked provider responses and local PostgreSQL; they do not establish live OCR accuracy.


## Groq invoice scanning (2026-10-25)

For Groq scanning, set `GROQ_API_KEY`, `EXTRACTION_PROVIDER=groq`, `GROQ_EXTRACTION_MODEL=qwen/qwen3.8-27b`, and `GROQ_VISION_MODEL=qwen/qwen3.8-27b` in **backend/.env**. These model IDs were checked against the account's live models endpoint. Groq requests use its Chat Completions endpoint with strict schema output and local validation. Digital PDF text is extracted locally; photographs and scanned PDF pages use vision. PDF pages are rendered locally into bounded JPEG images and sent one at a time, preserving page numbers. No OpenAI API key is needed for invoice extraction in this mode.

`DOCUMENT_PROCESSING_MODE=inline` runs bounded invoice scans in the API process and recovers queued uploads every 10 seconds. Start `npm run dev` and keep it running; Redis and the separate worker are not needed for **invoice scanning** in this mode. The Supabase service-role credential is still required. Interrupted processing leases are recovered after 15 minutes; failed scans remain visible for explicit retry. The local configuration uses one concurrent scan to reduce free-tier rate-limit pressure. Changing to `DOCUMENT_PROCESSING_MODE=queue` retains the existing Redis/worker deployment path.

Groq quota errors are shown on the review page. Configuration does not guarantee remaining quota. Assistant embeddings/chat, reminder delivery and storage cleanup retain their separate worker/provider requirements. Apply the pending invoice database migration before confirming products and warranties.

Verification included a real Groq call using a generated, non-personal scanned invoice: product name, specifications, price and 12-month warranty were extracted successfully. Automated tests use mocked Groq responses and real local PDF rendering.
