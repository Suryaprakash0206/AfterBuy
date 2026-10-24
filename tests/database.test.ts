import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { vector } from "@electric-sql/pglite-pgvector";
import { buildDatabaseSetup } from "../scripts/database-setup.mjs";
import { randomUUID } from "node:crypto";
import { coverageDates } from "../shared/domain.js";
// Real PostgreSQL engine and pgvector in WASM. Only Supabase's auth/storage schemas are test stand-ins.
let db: PGlite;
const owner = randomUUID(),
  editor = randomUUID(),
  viewer = randomUUID(),
  outsider = randomUUID(),
  invitee = randomUUID(),
  unconfirmed = randomUUID();
let w: string,
  w2: string,
  p: string,
  p2: string,
  doc: string,
  cov: string,
  c: string;
async function as(user: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec("set role authenticated");
}
async function admin() {
  await db.exec("reset role");
}
async function row(sql: string, args: unknown[] = []) {
  return (await db.query<any>(sql, args)).rows[0];
}
beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto, vector } });
  await db.exec(`create schema auth;create schema storage;create schema extensions;create role anon;create role authenticated;create role service_role bypassrls;grant usage on schema public,auth,storage,extensions to anon,authenticated,service_role;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,unique(bucket_id,name));
 alter table storage.objects enable row level security;grant select,insert,delete on storage.objects to authenticated;grant all on storage.objects,storage.buckets to service_role;`);
  await db.query(
    "insert into auth.users(id,email) values($1,'unconfirmed@example.test')",
    [unconfirmed],
  );
  await db.exec(await buildDatabaseSetup());
  for (const [id, email] of [
    [owner, "owner@example.test"],
    [editor, "editor@example.test"],
    [viewer, "viewer@example.test"],
    [outsider, "outsider@example.test"],
    [invitee, "invitee@example.test"],
  ])
    await db.query(
      "insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())",
      [id, email],
    );
  await as(owner);
  w = (await row("select create_workspace('Test household','household') id"))
    .id;
  await as(outsider);
  w2 = (await row("select create_workspace('Other household','household') id"))
    .id;
  await admin();
  await db.query(
    "insert into memberships(workspace_id,user_id,role) values($1,$2,'editor'),($1,$3,'viewer')",
    [w, editor, viewer],
  );
  await as(owner);
  p = (
    await row(
      "insert into products(workspace_id,name,currency,purchase_date,price) values($1,'Washer','INR','2024-01-31',123456789012.1234) returning id",
      [w],
    )
  ).id;
  await as(outsider);
  p2 = (
    await row(
      "insert into products(workspace_id,name,currency) values($1,'Private laptop','USD') returning id",
      [w2],
    )
  ).id;
});
afterAll(async () => {
  await db?.close();
});
describe("schema and actual RLS", () => {
  it("backfills an existing account and allows onboarding without email confirmation", async () => {
    await as(unconfirmed);
    expect(
      (await db.query("select * from profiles where id=$1", [unconfirmed]))
        .rows,
    ).toHaveLength(1);
    const personal = (
      await row("select create_workspace('Personal','personal') id")
    ).id;
    expect((await row("select workspace_role($1) role", [personal])).role).toBe(
      "owner",
    );
  });
  it("enables RLS on every public application table", async () => {
    await admin();
    const r = await row(
      "select count(*)::int n from pg_tables t join pg_class c on c.relname=t.tablename join pg_namespace ns on ns.oid=c.relnamespace where t.schemaname='public' and ns.nspname='public' and not c.relrowsecurity",
    );
    expect(r.n).toBe(0);
  });
  it("allows shared reads but denies viewer writes and elevation", async () => {
    await as(viewer);
    expect(
      (await db.query("select * from products where id=$1", [p])).rows,
    ).toHaveLength(1);
    await expect(
      db.query(
        "insert into products(workspace_id,name,currency) values($1,'Denied','INR')",
        [w],
      ),
    ).rejects.toThrow();
    await expect(
      db.query("update memberships set role='owner' where user_id=$1", [
        viewer,
      ]),
    ).rejects.toThrow();
    await expect(
      db.query("select manage_member($1,$2,'owner')", [w, viewer]),
    ).rejects.toThrow();
  });
  it("blocks cross-user and cross-workspace reads and writes", async () => {
    await as(outsider);
    expect(
      (await db.query("select * from products where id=$1", [p])).rows,
    ).toHaveLength(0);
    await expect(
      db.query(
        "insert into products(workspace_id,name,currency) values($1,'Attack','USD')",
        [w],
      ),
    ).rejects.toThrow();
    await as(owner);
    await expect(
      db.query(
        "insert into service_cases(workspace_id,product_id,title,description,occurred_on) values($1,$2,'Attack','x',current_date)",
        [w, p2],
      ),
    ).rejects.toThrow();
    await expect(
      db.query("update products set workspace_id=$1 where id=$2", [w2, p]),
    ).rejects.toThrow();
  });
  it("keeps exact money in SQL", async () => {
    await as(owner);
    expect(
      (await row("select price::text amount from products where id=$1", [p]))
        .amount,
    ).toBe("123456789012.1234");
  });
  it("supports intended-account, expiring, single-use invites", async () => {
    await admin();
    await db.query(
      "update auth.users set email_confirmed_at=null where id=$1",
      [invitee],
    );
    await as(owner);
    const token = (
      await row(
        "select create_invitation($1,'invitee@example.test','editor') token",
        [w],
      )
    ).token;
    await as(outsider);
    await expect(
      db.query("select accept_invitation($1)", [token]),
    ).rejects.toThrow();
    await as(invitee);
    expect((await row("select accept_invitation($1) id", [token])).id).toBe(w);
    await expect(
      db.query("select accept_invitation($1)", [token]),
    ).rejects.toThrow();
    await as(owner);
    const expired = (
      await row(
        "select create_invitation($1,'invitee@example.test','viewer') token",
        [w],
      )
    ).token;
    await admin();
    await db.query(
      "update invitations set expires_at=now()-interval '1 minute' where accepted_at is null",
    );
    await as(invitee);
    await expect(
      db.query("select accept_invitation($1)", [expired]),
    ).rejects.toThrow();
  });
});
describe("document privacy and transactional confirmation", () => {
  it("registers once per workspace hash and protects private objects", async () => {
    await as(owner);
    const args = [
      w,
      randomUUID(),
      "invoice.pdf",
      "application/pdf",
      100,
      1,
      "a".repeat(64),
      "invoice",
      null,
    ];
    const d = await row(
      "select register_document($1,$2,$3,$4,$5,$6,$7,$8,$9) value",
      args,
    );
    doc = d.value.document.id;
    const again = await row(
      "select register_document($1,$2,$3,$4,$5,$6,$7,$8,$9) value",
      [...args.slice(0, 1), randomUUID(), ...args.slice(2)],
    );
    expect(again.value.duplicate).toBe(true);
    expect(again.value.document.id).toBe(doc);
    await db.query(
      "insert into storage.objects(bucket_id,name) values('documents',$1)",
      [`${w}/${doc}`],
    );
    await db.query("select finish_upload($1,$2)", [w, doc]);
    await as(outsider);
    expect(
      (await db.query("select * from documents where id=$1", [doc])).rows,
    ).toHaveLength(0);
    expect(
      (
        await db.query("select * from storage.objects where name=$1", [
          `${w}/${doc}`,
        ])
      ).rows,
    ).toHaveLength(0);
    await expect(
      db.query(
        "insert into storage.objects(bucket_id,name) values('documents',$1)",
        [`${w}/attack`],
      ),
    ).rejects.toThrow();
  });
  const review = {
    seller: "Store",
    invoice_number: "TEST-001",
    purchase_date: "2025-03-10",
    currency: "INR",
    subtotal: "100",
    tax: "10",
    total: "110",
    items: [
      { name: "Toaster", quantity: "1", unit_price: "60", line_total: "60" },
      { name: "Kettle", quantity: "1", unit_price: "40", line_total: "40" },
    ],
  };
  it("confirms all invoice items atomically and is safe on retries", async () => {
    await as(owner);
    const first = (
      await row("select confirm_extraction($1,$2,$3) ids", [
        w,
        doc,
        JSON.stringify(review),
      ])
    ).ids;
    const retry = (
      await row("select confirm_extraction($1,$2,$3) ids", [
        w,
        doc,
        JSON.stringify(review),
      ])
    ).ids;
    expect(first).toEqual(retry);
    expect(first).toHaveLength(2);
    expect(
      (
        await row(
          "select count(*)::int n from invoice_items where invoice_id=(select id from invoices where document_id=$1)",
          [doc],
        )
      ).n,
    ).toBe(2);
    expect(
      (
        await row(
          "select sum(price)::text total from products where id=any($1::uuid[])",
          [first],
        )
      ).total,
    ).toBe("100.0000");
  });
  it("rolls back a partially invalid confirmation", async () => {
    await as(owner);
    const d = (
      await row("select register_document($1,$2,$3,$4,$5,$6,$7,$8,$9) value", [
        w,
        randomUUID(),
        "invalid.pdf",
        "application/pdf",
        100,
        1,
        "b".repeat(64),
        "invoice",
        null,
      ])
    ).value.document;
    await admin();
    await db.query(
      "update documents set status='needs_review',upload_complete=true where id=$1",
      [d.id],
    );
    await as(owner);
    await expect(
      db.query("select confirm_extraction($1,$2,$3)", [
        w,
        d.id,
        JSON.stringify({
          ...review,
          items: [review.items[0], { name: "Invalid", quantity: "0" }],
        }),
      ]),
    ).rejects.toThrow();
    expect(
      (
        await row("select count(*)::int n from invoices where document_id=$1", [
          d.id,
        ])
      ).n,
    ).toBe(0);
  });
});
describe("coverage and durable reminder delivery", () => {
  it("matches tested calendar-month logic and blocks ungrounded source links", async () => {
    await as(owner);
    cov = (
      await row(
        "insert into coverage(workspace_id,product_id,kind,provider,basis,duration_months,confirmed) values($1,$2,'manufacturer','Maker','purchase',1,true) returning id",
        [w, p],
      )
    ).id;
    const d = await row(
      "select start_date::text,end_date::text from coverage where id=$1",
      [cov],
    );
    expect(d).toEqual(
      coverageDates(
        { basis: "purchase", duration_months: 1 },
        { purchase_date: "2024-01-31" },
      ),
    );
    await expect(
      db.query("update coverage set source_document_id=$1 where id=$2", [
        doc,
        cov,
      ]),
    ).rejects.toThrow();
  });
  it("delivers overdue schedules after downtime exactly once on repeated execution", async () => {
    await admin();
    const r = (
      await row(
        "insert into reminders(workspace_id,user_id,product_id,coverage_id,kind,title,due_at,source_key,source_revision) values($1,$2,$3,$4,'coverage','Deadline',now()-interval '2 days','test-due','1-1') returning id",
        [w, owner, p, cov],
      )
    ).id;
    await db.query("select deliver_reminder($1)", [r]);
    await db.query("select deliver_reminder($1)", [r]);
    expect(
      (
        await row(
          "select count(*)::int n from notifications where reminder_id=$1",
          [r],
        )
      ).n,
    ).toBe(1);
    expect(
      (
        await row(
          "select state from deliveries where reminder_id=$1 and channel='in_app'",
          [r],
        )
      ).state,
    ).toBe("delivered");
  });
  it("cancels stale schedules on date edits and rejects already queued stale delivery", async () => {
    await admin();
    const r = (
      await row(
        "insert into reminders(workspace_id,user_id,product_id,coverage_id,kind,title,due_at,source_key,source_revision) values($1,$2,$3,$4,'coverage','Old',now()-interval '1 day','test-stale','1-1') returning id",
        [w, owner, p, cov],
      )
    ).id;
    await as(editor);
    await db.query(
      "update products set purchase_date='2024-02-29' where id=$1",
      [p],
    );
    await admin();
    await db.query("select deliver_reminder($1)", [r]);
    expect(
      (await row("select status from reminders where id=$1", [r])).status,
    ).toBe("cancelled");
    expect(
      (
        await row(
          "select count(*)::int n from notifications where reminder_id=$1",
          [r],
        )
      ).n,
    ).toBe(0);
  });
  it("rejects stale reconciliation inserts and unconfirmed coverage", async () => {
    await admin();
    expect(
      (
        await db.query(
          "insert into reminders(workspace_id,user_id,product_id,coverage_id,kind,title,due_at,source_key,source_revision) values($1,$2,$3,$4,'coverage','Stale scan',now(),'test-raced','1-1') returning id",
          [w, owner, p, cov],
        )
      ).rows,
    ).toHaveLength(0);
    await as(owner);
    await db.query("update coverage set confirmed=false where id=$1", [cov]);
    await admin();
    const r = await db.query(
      "insert into reminders(workspace_id,user_id,product_id,coverage_id,kind,title,due_at,source_key,source_revision) values($1,$2,$3,$4,'coverage','Unconfirmed',now()-interval '1 day','test-unconfirmed','3-1') returning id",
      [w, owner, p, cov],
    );
    expect(r.rows).toHaveLength(0);
  });
  it("commits one future recurrence with delivery and preserves the local hour", async () => {
    await as(owner);
    await db.query(
      "update profiles set timezone='America/New_York' where id=$1",
      [owner],
    );
    const r = (
      await row(
        "select create_reminder($1,$2,null,'maintenance','Filter clean',now()-interval '2 days',1) id",
        [w, p],
      )
    ).id;
    await admin();
    await db.query("select deliver_reminder($1)", [r]);
    await db.query("select deliver_reminder($1)", [r]);
    const next = await db.query<any>(
      "select id,status,due_at>now() future,extract(hour from due_at at time zone 'America/New_York')::int as local_hour from reminders where source_key=$1",
      [`recurrence-${r}`],
    );
    expect(next.rows).toHaveLength(1);
    expect(next.rows[0].future).toBe(true);
    const old = await row(
      "select extract(hour from due_at at time zone 'America/New_York')::int as local_hour from reminders where id=$1",
      [r],
    );
    expect(next.rows[0].local_hour).toBe(old.local_hour);
    await db.query("select deliver_reminder($1)", [next.rows[0].id]);
    expect(
      (await row("select status from reminders where id=$1", [next.rows[0].id]))
        .status,
    ).toBe("scheduled");
  });
});
describe("cases, retrieval and deletion", () => {
  it("enforces case transitions transactionally without resetting warranty", async () => {
    await as(editor);
    c = (
      await row(
        "insert into service_cases(workspace_id,product_id,title,description,occurred_on) values($1,$2,'Fault','Door leak',current_date) returning id",
        [w, p],
      )
    ).id;
    const event = {
      kind: "status",
      note: "Submitted to provider",
      occurred_on: "2026-10-21",
      currency: "INR",
      status: "Submitted",
    };
    await db.query("select add_case_event($1,$2,$3)", [
      w,
      c,
      JSON.stringify(event),
    ]);
    expect(
      (await row("select status from service_cases where id=$1", [c])).status,
    ).toBe("Submitted");
    await expect(
      db.query("update service_cases set status='Draft' where id=$1", [c]),
    ).rejects.toThrow();
    const before = await row(
      "select end_date::text,revision from coverage where id=$1",
      [cov],
    );
    await db.query("select add_case_event($1,$2,$3)", [
      w,
      c,
      JSON.stringify({
        kind: "replacement",
        note: "Provider sent replacement",
        occurred_on: "2026-10-21",
        currency: "INR",
      }),
    ]);
    expect(
      await row("select end_date::text,revision from coverage where id=$1", [
        cov,
      ]),
    ).toEqual(before);
  });
  it("filters pgvector retrieval by product and workspace before returning passages", async () => {
    await as(owner);
    await db.query("select link_document($1,$2,$3)", [w, doc, p]);
    await admin();
    const embedding = JSON.stringify(
      Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0)),
    );
    await db.query(
      "insert into document_chunks(workspace_id,document_id,page,ordinal,content,embedding,embedding_model) values($1,$2,1,0,'Only product-linked evidence',$3,'test-model')",
      [w, doc, embedding],
    );
    await as(owner);
    expect(
      (
        await db.query(
          "select * from match_product_chunks($1,$2,$3,'test-model',8)",
          [w, p, embedding],
        )
      ).rows,
    ).toHaveLength(1);
    expect(
      (
        await db.query(
          "select * from match_product_chunks($1,$2,$3,'test-model',8)",
          [w, p2, embedding],
        )
      ).rows,
    ).toHaveLength(0);
    await as(outsider);
    expect(
      (
        await db.query(
          "select * from match_product_chunks($1,$2,$3,'test-model',8)",
          [w, p, embedding],
        )
      ).rows,
    ).toHaveLength(0);
  });
  it("isolates assistant conversations by user", async () => {
    await admin();
    await db.query("select save_assistant_exchange($1,$2,$3,$4,$5,$6)", [
      w,
      owner,
      p,
      "Question",
      "Answer",
      "[]",
    ]);
    await as(viewer);
    expect((await db.query("select * from messages")).rows).toHaveLength(0);
    await as(owner);
    expect((await db.query("select * from messages")).rows).toHaveLength(2);
  });
  it("rejects an unavailable citation again when committing an assistant exchange", async () => {
    await admin();
    await expect(
      db.query("select save_assistant_exchange($1,$2,$3,$4,$5,$6)", [
        w,
        owner,
        p,
        "Question",
        "Untrusted answer",
        JSON.stringify([
          { id: randomUUID(), document_id: doc, page: 1, name: "Invoice" },
        ]),
      ]),
    ).rejects.toThrow("Source is no longer available");
  });
  it("removes extraction and embeddings and revokes file access when deleting", async () => {
    await as(owner);
    await db.query("select mark_document_deleting($1,$2)", [w, doc]);
    expect(
      (
        await db.query("select * from document_chunks where document_id=$1", [
          doc,
        ])
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await db.query("select * from extraction_runs where document_id=$1", [
          doc,
        ])
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await db.query("select * from storage.objects where name=$1", [
          `${w}/${doc}`,
        ])
      ).rows,
    ).toHaveLength(0);
  });
});
