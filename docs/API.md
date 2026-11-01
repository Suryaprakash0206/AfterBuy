# REST API v1

Base path: `/api/v1`. All endpoints except `health`, `ready` and `config` require `Authorization: Bearer <Supabase access token>`. The API verifies the token with Supabase Auth; email confirmation is optional. Transient Auth connectivity failures return `503 AUTH_UNAVAILABLE` without signing the user out; invalid sessions return 401. Send JSON except file uploads. The Vite development server proxies `/api` to Express.

Errors use `{ "error": { "code": "...", "message": "...", "requestId": "..." } }`. The request ID is also in `X-Request-Id`. Validation is 400, unauthenticated 401, forbidden 403, missing record 404, state/duplicate conflicts 409, oversized files 413, throttling 429, provider failures 502, and missing service configuration 503. Requests never expose provider error bodies or credentials.

Money is a decimal **string**, for example `"24999.00"`, or null; dates are ISO `YYYY-MM-DD`; timestamps include a timezone. UUIDs are validated. Request schemas are in `shared/domain.ts` and the feature modules. Unknown authoritative properties are rejected or stripped, never spread into database scope/role fields. User/workspace IDs do not themselves authorise an operation.

## Session and workspace endpoints

| Method | Path | Result / body |
| --- | --- | --- |
| GET | `/health` | Process health. No dependencies required. |
| GET | `/ready` | Database reachability/schema probe; 503 when unavailable. Not a worker health claim. |
| GET | `/config` | Boolean configured capabilities and file/page limits, no secrets. |
| GET | `/me` | Profile, current user ID and accessible memberships/workspaces. |
| PATCH | `/me` | Preferences: display_name, currency, timezone, reminder_days, reminders_enabled, email_enabled. |
| POST | `/workspaces` | `{name, kind: "personal" | "household"}` → `{id}`. Personal creation is idempotent. |
| POST | `/invitations/accept` | `{token}` → `{workspace_id}`; authenticated account matching the intended email only. |

Sign up, sign in, password reset and sign out use the official Supabase frontend SDK directly. Hosted Auth's Confirm email setting must be disabled for immediate sign-up sessions. Backend permissions do not depend on client route protection.

## Workspace-scoped endpoints

Prefix every path below with `/workspaces/:workspaceId`. A viewer may read/export authorised data and manage their own preferences/reminders. Product/document/coverage/case writes require editor or owner. Membership and invitation management require owner.

| Method | Path | Behaviour |
| --- | --- | --- |
| GET | `/dashboard` | Actual counts, attention records and upcoming confirmed deadlines. |
| GET | `/analytics` | Exact database aggregates, separate currencies, repeated issues. |
| GET | `/products` | `search`, `category`, `sort=newest|name|purchase_date`, `archived=true|false`, `page`, `limit` (1–100). Returns `{items,total,page,limit}`. |
| POST | `/products` | Full product fields; returns created record. |
| GET | `/products/:id` | Product plus documents, coverage, cases and lifecycle timeline. |
| PATCH | `/products/:id` | Complete editable product form (not a partial merge). |
| POST | `/products/:id/archive` | `{archived: boolean}`. Cancels reminders on archive. |
| DELETE | `/products/:id` | Hard delete with documented cascading relations. |
| GET | `/documents` | Latest 500 non-deleting document records and real processing/index states. |
| POST | `/documents` | Multipart `file`, `kind`, optional `product_id`; real signature, size and page checks. Returns `{document,duplicate}`. |
| GET | `/documents/:id` | `{document,extraction,scanner}` including original suggestions and saved review. Scanner reports `configured`, `available` (connected queue worker), and `reason: configuration|queue|worker|null`; null after completion. Availability does not guarantee provider success. |
| POST | `/documents/:id/download` | Empty body → `{url,expires_in:120}` after permission checks. |
| POST | `/documents/:id/confirm` | Confirm reviewed invoice and create all line-item products atomically; details below. |
| POST | `/documents/:id/complete` | Mark a non-invoice document reviewed. Coverage stays separate. |
| POST | `/documents/:id/retry` | Queue a failed/unconfirmed extraction for another attempt. |
| POST | `/documents/:id/reindex` | Queue existing extracted text for embeddings. |
| DELETE | `/documents/:id` | 202 `{status:"deleting",ok:true}`; content removed and worker cleans object. |
| GET | `/coverage` | Coverage with product label; up to 1,000 records. |
| POST | `/coverage` | Create separate coverage record. |
| PATCH | `/coverage/:id` | Full editable coverage form; recalculates dates and cancels stale schedules. |
| DELETE | `/coverage/:id` | Remove coverage and its schedules. |
| GET/POST | `/cases` | List up to 500 cases / create Draft case. |
| GET | `/cases/:id` | Case, product and chronological events. |
| PATCH | `/cases/:id` | `{support_contact, reference}`, nullable strings. |
| POST | `/cases/:id/events` | Add note, troubleshooting, repair, replacement, refund, maintenance or status event transactionally. |
| POST | `/cases/:id/package/preview` | Selected product/case/coverage/evidence and editable message draft. |
| POST | `/cases/:id/package/export` | Same options plus `format:"pdf"|"zip"`; binary attachment. |
| GET | `/products/:id/assistant` | Current user's conversation/messages, scoped to product/workspace. |
| POST | `/products/:id/assistant` | `{question}` → validated `{answer,sources}` with actual document/page IDs. |
| GET | `/notifications` | Own notifications, schedules and actual delivery records. |
| PATCH | `/notifications/:id` | `{read?:boolean,snooze_until?:ISO timestamp|null}`. |
| POST | `/reminders` | `{product_id,case_id?,kind,title,date,repeat_months?}`; date at 09:00 account timezone. |
| DELETE | `/reminders/:id` | Cancel own schedule; leaves delivery history. |
| GET | `/members` | Members; email addresses returned only to owners. |
| PATCH | `/members/:id` | `{role:"editor"|"viewer"|null}`; null removes. Cannot change self/owner or grant ownership. |
| GET/POST | `/invitations` | Owner-only list / `{email,role}` create expiring manual link token. No email sent. |
| DELETE | `/invitations/:id` | Revoke pending invitation. |

## Core request examples

Manual product (optional descriptive fields default to null):

```json
{"name":"Washing machine","category":"Appliances","brand":"Maker","model":"W1","serial_number":null,"seller":"Store","purchase_date":"2026-10-01","delivery_date":"2026-10-03","price":"24000.00","currency":"INR","location":"Utility room","notes":null}
```

Invoice review preserves null values; quantities and prices are strings. `line_total` is the full cost assigned to that product record, including its quantity. Invoice totals are retained separately.

```json
{
  "seller":"Store","invoice_number":"AB-104","purchase_date":"2026-10-01","currency":"INR",
  "subtotal":"24000.00","tax":null,"total":"24000.00",
  "items":[{"name":"Washing machine","category":"Appliances","brand":"Maker","model":"W1","serial_number":null,"quantity":"1","unit_price":"24000.00","line_total":"24000.00"}],
  "duplicate_acknowledged":false
}
```

`confirm` returns `{product_ids:[...]}`. Repeating it returns the same IDs. A possible existing purchase returns `POSSIBLE_DUPLICATE` and matching products; only set `duplicate_acknowledged:true` after the user confirms they are distinct. File hashes prevent duplicate document rows independently.

Coverage:

```json
{"product_id":"PRODUCT_UUID","kind":"manufacturer","provider":"Maker","source_document_id":null,"components":"Appliance","basis":"delivery","explicit_start":null,"duration_months":12,"duration_days":null,"explicit_end":null,"exclusions":null,"conditions":null,"uncertainty":null,"confirmed":true}
```

Kinds: `return`, `manufacturer`, `extended`, `repair`. Basis: `purchase`, `delivery`, `explicit`. A confirmed record needs known start and end; months and days are mutually exclusive. The API and SQL derive dates. Source documents must be linked to the same product.

Case creation:

```json
{"product_id":"PRODUCT_UUID","title":"Water leaking","description":"Water escapes from the door during a cycle.","occurred_on":"2026-10-20","support_contact":null,"reference":null}
```

Event:

```json
{"kind":"status","note":"Submitted through the provider portal","occurred_on":"2026-10-21","amount":null,"currency":"INR","status":"Submitted","replacement_details":null}
```

Cases begin in Draft. Allowed transitions are enforced in SQL: Draft → Submitted/Cancelled; Submitted → Awaiting response/Inspection/Resolved/Rejected/Cancelled; Awaiting response → Submitted/Inspection/Resolved/Rejected/Cancelled; Inspection → Awaiting response/Resolved/Rejected/Cancelled; Rejected → Submitted/Cancelled. Resolved and Cancelled are terminal. Repairs/replacements/refunds are separate recorded events.

Support package:

```json
{"document_ids":[],"include_serial":false,"include_cost":true,"include_contact":false,"include_timeline":true,"message":"Hello, please assist with this issue.","format":"zip"}
```

Omit `format` for preview and omit `message` to generate the deterministic draft. ZIP includes the summary PDF, UTF-8 draft and structured JSON plus selected original files. Only documents belonging exclusively to the product are eligible. No route sends a support message.

## Operational limits

The API applies 180 requests/minute per IP, six uploads/minute per authenticated user, and configurable AI requests/minute per user. AI usage reservations are durable and workspace-scoped. Limits are local to one API process except the database budget. HTTP bodies are capped at 1 MB; uploads at configurable maximum 20 MB/40 pages. Respect `Retry-After` when returned and surface actionable errors to the user. AI/worker credential configuration never belongs in the frontend.


### Invoice confirmation additions

`POST /workspaces/:workspaceId/documents/:id/confirm` accepts nullable `items[].specifications` and an optional `warranties` array (default `[]` for older callers). Each warranty contains `item_index` (zero-based reviewed product index), `kind`, nullable `provider`, `basis`, nullable `explicit_start`, `explicit_end`, `duration_months`, `duration_days`, `conditions`, `exclusions`, `uncertainty`, and boolean `confirmed`. Only one duration unit may be supplied. A confirmed warranty requires a provider and resolvable start/end dates; incomplete terms remain unconfirmed. Invalid product associations are rejected. The server saves warranties with their product and source invoice in the same idempotent confirmation transaction. Apply migration `202610250001_invoice_product_warranties.sql` first.
