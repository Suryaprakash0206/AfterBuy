# AfterBuy

A purchase, warranty and repair organiser built with React, Express and Supabase. The interface uses only navy (`#142D4E`), white, and their opacity variants. There is no production demo data or fake persistence.

## What is included

- Supabase email/password authentication, verification, password recovery, personal onboarding and household invitations with owner/editor/viewer permissions.
- Product search, filtering, sorting, pagination, list/grid views, archive/delete, and five detail tabs.
- Private PDF/JPEG/PNG upload, duplicate detection, background extraction, original-document review, and transactional multi-product confirmation.
- Separate return, manufacturer, extended and repair coverage with deterministic calendar calculations and explicit confirmation.
- Grounded product document chat with page citations and isolated conversation history.
- Service cases, troubleshooting and outcome history, editable support messages, selected-evidence PDF and ZIP exports.
- Persistent reminder schedules, notification read/snooze controls, maintenance recurrence and optional Resend email.
- Actual expenditure, repair/maintenance costs, refunds, deadlines and missing-record analytics, separated by currency.

## Current connection

The supplied Supabase URL and publishable key have been saved in the local, ignored `.env` files. The read-only Auth settings check succeeded. The hosted database currently has **no AfterBuy schema** (`PGRST205` for `workspaces`). No hosted migrations or data writes were performed. The publishable key cannot install migrations or perform worker operations.

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

Alternatively, run each migration in filename order in the project's SQL editor. Use an empty, dedicated project. Do not use `db reset` against an existing remote project. SQL creates private storage policies as well as tables. Existing Auth users are backfilled into profiles by the final migration.

**Local Supabase.** With Docker running and the CLI installed:

```powershell
supabase start
supabase migration up --local
supabase status
```

Copy the local URL, publishable/anon key and service-role/secret key from the CLI output into the appropriate `.env` files. Local verification messages are visible in the local mail viewer listed by `supabase status`. CLI management credentials are separate from application credentials.

Set Auth's Site URL to `http://127.0.0.1:5173` and allow these redirect URLs in the Supabase dashboard:

- `http://127.0.0.1:5173/auth/callback`
- `http://127.0.0.1:5173/auth/reset`

If using `localhost`, allow the equivalent URLs and use that hostname consistently. Supabase's hosted default email service has restrictions; configure its SMTP settings if verification mail cannot reach your intended users. The app never reports an invitation email as sent: household invitations use a copyable link.

Start the application:

```powershell
npm run dev
```

Open **http://127.0.0.1:5173**. Express listens on `127.0.0.1:3001`; Vite proxies `/api` to it. Sign up, verify the account, sign in, and create your personal workspace. Manual products, coverage and cases need only the migrated database and public Supabase configuration.

Start Redis and the worker in a second terminal:

```powershell
docker compose up -d redis
npm run worker
```

The worker needs `SUPABASE_SERVICE_ROLE_KEY` in **backend/.env only**. It processes uploaded documents, removes deleted storage objects, rebuilds document indexes, reconciles coverage reminders, and recovers due work every 30 seconds. Without a worker, an invoice can still be manually confirmed while queued; automatic extraction and reminder delivery will wait. Do not expose Redis to the network.

## Configure AI and optional email

Use the backend example file for the complete settings. No model name is assumed. Set `OPENAI_API_KEY`, `OPENAI_EXTRACTION_MODEL`, `OPENAI_CHAT_MODEL`, and `OPENAI_EMBEDDING_MODEL` to models available to your account. The extraction model must support structured Responses output plus PDF/image input. The chat model must support structured Responses output. Embeddings must support the fixed **1536 dimensions** requested by this app. Verify model capabilities in the [OpenAI model documentation](https://platform.openai.com/docs/models).

Restart the API and worker after changes. API/worker keys never use a `VITE_` prefix. Review source data handling with your chosen provider before uploading sensitive documents. If AI is absent, enter invoice and coverage information manually; the application does not synthesize missing fields.

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

The separate live E2E test is skipped unless `E2E_LIVE_URL`, `E2E_EMAIL`, and `E2E_PASSWORD` are explicitly set. Use a verified account in an isolated test workspace: it creates records. Live test data is not automatically deleted. Never point it at production.

For built local execution: `npm run build`, then `npm run start -w backend`, `npm run worker:start -w backend`, and `npm run preview -w frontend`. Vite's preview retains the API proxy; allow its port (4173) in `FRONTEND_ORIGIN` and Supabase Auth redirects if signing in there. A real deployment needs HTTPS and a same-origin reverse proxy serving the frontend and `/api`; deployment is outside this delivery.

## Troubleshooting

| Symptom | Resolution |
| --- | --- |
| `MIGRATIONS_REQUIRED` / `PGRST205` | Apply all migrations to the correct Supabase project. |
| Verification/reset link expired | Request a fresh link on the sign-in screen. Check hostname and redirect configuration. |
| Document stays queued | Start Redis and the worker; configure its privileged Supabase key. |
| `AI_NOT_CONFIGURED` | Use manual review or configure key/models and retry document processing. |
| Assistant index failed/unavailable | Check model dimensions/quota, then use **Rebuild assistant index**. Scanned documents first require successful transcription. |
| Shared invoice blocked in export | Confirm a single-product invoice or upload a separately prepared copy as a service document. Do not attach an original containing other items. |
| Notification has no email | Inspect actual delivery state; email is opt-in and requires provider configuration. |
| Docker named-pipe error | Start Docker Desktop and wait for the engine before starting Redis/Supabase. |
| API fails to start after env edit | Check variable types and embedding dimensions; restart from the project root using the provided scripts. |

`GET /api/v1/health` reports the API process; `GET /api/v1/ready` checks the database endpoint, and `/api/v1/config` reports configured capabilities without revealing credentials. Structured logs include request/job identifiers, not tokens or receipt contents. Keep `.env`, `.local`, and generated build/test output out of Git.

See [architecture and boundaries](docs/ARCHITECTURE.md), [REST API](docs/API.md), and [progress and verification](docs/PROGRESS.md) for implementation details and genuine limitations.
