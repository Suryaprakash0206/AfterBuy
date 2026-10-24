import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { mkdir } from "node:fs/promises";
const w = "00000000-0000-4000-8000-000000000001",
  u = "00000000-0000-4000-8000-000000000002",
  p = "00000000-0000-4000-8000-000000000003",
  d = "00000000-0000-4000-8000-000000000004",
  c = "00000000-0000-4000-8000-000000000005";
// MOCK INTEGRATIONS ONLY: auth, storage, extraction, and API responses are isolated browser fixtures.
// Production code never imports this file. SQL and export functionality have separate real local tests.
async function fixtures(page: Page) {
  const now = new Date().toISOString();
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf
    .addPage([595, 842])
    .drawText(
      "TEST FIXTURE - Store receipt\nWasher W1\n2026-01-31\nINR 24000.00",
      { x: 50, y: 760, size: 15, font },
    );
  const bytes = Buffer.from(await pdf.save());
  let product: any = null;
  const coverage: any[] = [];
  let serviceCase: any = null;
  let doc: any = null;
  const events: any[] = [];
  const token = `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: u, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600, iss: "http://127.0.0.1:54321/auth/v1" })).toString("base64url")}.test-only-invalid-signature`;
  const user = {
    id: u,
    aud: "authenticated",
    role: "authenticated",
    email: "owner@example.test",
    email_confirmed_at: now,
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    created_at: now,
  };
  await page.route("http://127.0.0.1:54321/**", async (route) => {
    await route.fulfill({
      json: {
        access_token: token,
        refresh_token: "test-refresh-token",
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        token_type: "bearer",
        user,
      },
    });
  });
  await page.route("**/test-original.pdf", (route) =>
    route.fulfill({ contentType: "application/pdf", body: bytes }),
  );
  await page.route("**/api/v1/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace("/api/v1", "");
    const method = req.method();
    const json = () => {
      try {
        return req.postDataJSON();
      } catch {
        return {};
      }
    };
    let output: any;
    if (path === "/me")
      output = {
        user_id: u,
        profile: {
          display_name: "Alex",
          currency: "INR",
          timezone: "Asia/Kolkata",
          reminder_days: [30, 7, 1],
          reminders_enabled: true,
          email_enabled: false,
        },
        memberships: [
          {
            role: "owner",
            workspace: { id: w, name: "My household", kind: "household" },
          },
        ],
      };
    else if (path === "/config")
      output = {
        database: true,
        extraction: true,
        assistant: true,
        email: false,
      };
    else if (path.endsWith("/dashboard"))
      output = {
        summary: {
          products: product ? 1 : 0,
          open_cases: serviceCase ? 1 : 0,
          missing_receipts: 0,
          unconfirmed_coverage: 0,
        },
        deadlines: coverage.map((v) => ({
          ...v,
          product: { id: p, name: "Washer" },
        })),
        review: doc && doc.status !== "completed" ? [doc] : [],
        cases: serviceCase ? [serviceCase] : [],
      };
    else if (path.endsWith("/products") && method === "GET")
      output = {
        items: product ? [product] : [],
        total: product ? 1 : 0,
        page: 1,
        limit: 12,
      };
    else if (path.endsWith("/documents") && method === "POST") {
      doc = {
        id: d,
        name: "test-receipt.pdf",
        mime: "application/pdf",
        size_bytes: bytes.length,
        page_count: 1,
        kind: "invoice",
        status: "needs_review",
        upload_complete: true,
        index_status: "ready",
        created_at: now,
      };
      output = { document: doc, duplicate: false };
    } else if (path.endsWith(`/documents/${d}/download`))
      output = {
        url: "http://127.0.0.1:5174/test-original.pdf",
        expires_in: 120,
      };
    else if (path.endsWith(`/documents/${d}/confirm`)) {
      const b = json();
      product = {
        ...b.items[0],
        id: p,
        workspace_id: w,
        name: b.items[0].name,
        price: b.items[0].line_total,
        currency: b.currency,
        seller: b.seller,
        purchase_date: b.purchase_date,
        category: "Appliances",
        location: null,
        delivery_date: null,
        notes: null,
        created_at: now,
        archived_at: null,
      };
      doc.status = "completed";
      doc.accepted_product_ids = [p];
      output = { product_ids: [p] };
    } else if (path.endsWith(`/documents/${d}`))
      output = {
        document: doc,
        extraction: {
          id: "fixture-extraction",
          result: {
            seller: "Test Store",
            invoice_number: "TEST-001",
            purchase_date: "2026-01-31",
            currency: "INR",
            subtotal: "24000",
            tax: null,
            total: "24000",
            items: [
              {
                name: "Washer",
                category: "Appliances",
                brand: "Maker",
                model: "W1",
                serial_number: null,
                quantity: "1",
                unit_price: "24000",
                line_total: "24000",
              },
            ],
            evidence: [
              {
                field: "items.0.name",
                quote: "Washer W1",
                page: 1,
                origin: "extracted",
              },
            ],
            warranties: [],
            warnings: [],
          },
        },
      };
    else if (path.endsWith(`/products/${p}/assistant`)) output = [];
    else if (path.endsWith(`/products/${p}`))
      output = {
        ...product,
        documents: doc ? [doc] : [],
        coverage,
        cases: serviceCase ? [serviceCase] : [],
        timeline: [
          {
            id: "event-1",
            kind: "purchase",
            description: "Purchase recorded",
            occurred_at: now,
          },
        ],
      };
    else if (path.endsWith("/coverage") && method === "POST") {
      const b = json();
      const record = {
        ...b,
        id: "00000000-0000-4000-8000-000000000006",
        start_date: b.explicit_start,
        end_date: "2027-01-31",
      };
      coverage.push(record);
      output = record;
    } else if (path.endsWith("/cases") && method === "POST") {
      serviceCase = { ...json(), id: c, status: "Draft", created_at: now };
      output = serviceCase;
    } else if (path.endsWith(`/cases/${c}/events`)) {
      events.push({ ...json(), id: "case-event-1" });
      output = { id: "case-event-1" };
    } else if (path.endsWith(`/cases/${c}/package/preview`)) {
      const b = json();
      output = {
        product: {
          name: product.name,
          brand: product.brand,
          model: product.model,
          seller: product.seller,
          purchase_date: product.purchase_date,
          price: product.price,
          currency: "INR",
        },
        case: serviceCase,
        coverage,
        timeline: events,
        documents: b.document_ids.includes(d) ? [doc] : [],
        draft:
          "Hello, I am requesting assistance with my Washer. The door is leaking.",
        notice:
          "Recorded coverage dates do not establish whether this issue is covered.",
      };
    } else if (path.endsWith(`/cases/${c}/package/export`)) {
      await route.fulfill({
        contentType: "application/pdf",
        body: bytes,
        headers: {
          "Content-Disposition": 'attachment; filename="support.pdf"',
        },
      });
      return;
    } else if (path.endsWith(`/cases/${c}`))
      output = { ...serviceCase, product, events };
    else if (path.endsWith("/documents")) output = doc ? [doc] : [];
    else if (path.endsWith("/coverage")) output = coverage;
    else if (path.endsWith("/cases"))
      output = serviceCase ? [{ ...serviceCase, product }] : [];
    else if (path.endsWith("/notifications"))
      output = { notifications: [], reminders: [], deliveries: [] };
    else if (path.endsWith("/members"))
      output = [
        {
          user_id: u,
          role: "owner",
          display_name: "Alex",
          email: "owner@example.test",
        },
      ];
    else if (path.endsWith("/invitations")) output = [];
    else if (path.endsWith("/analytics"))
      output = {
        products: product ? 1 : 0,
        open_cases: serviceCase ? 1 : 0,
        missing_receipts: 0,
        unconfirmed_coverage: 0,
        expenditure: product
          ? [{ currency: "INR", amount: product.price }]
          : [],
        costs: [],
        repeated_issues: [],
      };
    else {
      await route.fulfill({
        status: 404,
        json: {
          error: {
            code: "TEST_UNHANDLED",
            message: `Unmocked test route ${method} ${path}`,
          },
        },
      });
      return;
    }
    await route.fulfill({ json: output });
  });
  return { bytes };
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}
async function accessibility(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
}
test("MOCK integrations: sign-up opens the app without an email-verification step", async ({
  page,
}) => {
  await fixtures(page);
  await page.goto("/auth");
  await page
    .getByRole("button", { name: "New here? Create an account" })
    .click();
  await page.getByLabel("Email address").fill("owner@example.test");
  await page.getByLabel("Password", { exact: true }).fill("test-password");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Welcome home, Alex." }),
  ).toBeVisible();
});
test("MOCK integrations: interrupted sign-in shows a useful error and can be retried", async ({
  page,
}) => {
  await fixtures(page);
  const url = "http://127.0.0.1:54321/auth/v1/token**";
  await page.route(url, (route) => route.abort("connectionfailed"));
  await page.goto("/auth");
  await page.getByLabel("Email address").fill("owner@example.test");
  await page.getByLabel("Password", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByText(/Could not reach the sign-in service/),
  ).toBeVisible();
  await page.unroute(url);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome home, Alex." }),
  ).toBeVisible();
});
test("MOCK integrations: sign in → upload → review → coverage → case → PDF export", async ({
  page,
}, info) => {
  const { bytes } = await fixtures(page);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/auth");
  await page.getByLabel("Email address").fill("owner@example.test");
  await page.getByLabel("Password", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome home, Alex." }),
  ).toBeVisible();
  await noOverflow(page);
  await accessibility(page);
  await mkdir(".local/qa", { recursive: true });
  await page.screenshot({
    path: `.local/qa/dashboard-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("link", { name: "Add a purchase" }).click();
  await page.getByLabel("Choose document file").setInputFiles({
    name: "test-receipt.pdf",
    mimeType: "application/pdf",
    buffer: bytes,
  });
  await page.getByRole("button", { name: "Upload & continue" }).click();
  await expect(
    page.getByRole("heading", { name: "Review your document" }),
  ).toBeVisible();
  await expect(page.getByLabel("Seller", { exact: true })).toHaveValue(
    "Test Store",
  );
  await expect(page.getByText("Page 1 of 1", { exact: true })).toBeVisible();
  await expect(page.locator(".pdf-page")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator('.document-preview [role="alert"]')).toHaveCount(0);
  await noOverflow(page);
  await accessibility(page);
  await page.screenshot({
    path: `.local/qa/review-${info.project.name}.png`,
    fullPage: true,
  });
  await page
    .getByLabel("I checked these details against the original document.")
    .check();
  await page.getByRole("button", { name: "Confirm & create products" }).click();
  await expect(
    page.getByRole("heading", { name: "Washer", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Coverage", exact: true }).click();
  await page.getByRole("button", { name: "Add coverage", exact: true }).click();
  await page.getByLabel("Provider", { exact: true }).fill("Maker");
  await page
    .getByLabel("Explicit start date", { exact: true })
    .fill("2026-01-31");
  await page
    .getByLabel("Duration in calendar months", { exact: true })
    .fill("12");
  await page.getByLabel("I checked these terms and confirm the dates.").check();
  await page.getByRole("button", { name: "Save coverage" }).click();
  await expect(
    page.getByRole("heading", { name: "Maker", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Report an issue", exact: true })
    .click();
  await page.getByLabel("Issue summary").fill("Water leaking from the door");
  await page
    .getByLabel("What happened?")
    .fill("The door is leaking during the rinse cycle.");
  await page.getByRole("button", { name: "Create service case" }).click();
  await expect(
    page.getByRole("heading", {
      name: "Water leaking from the door",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Prepare support package" }).click();
  await page.getByLabel("test-receipt.pdf", { exact: true }).check();
  await page.getByRole("button", { name: "Preview package" }).click();
  await expect(
    page.getByRole("heading", { name: "Draft support message" }),
  ).toBeVisible();
  await noOverflow(page);
  await accessibility(page);
  await page.screenshot({
    path: `.local/qa/package-${info.project.name}.png`,
    fullPage: true,
  });
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PDF", exact: true }).click();
  const file = await downloadPromise;
  expect(file.suggestedFilename()).toMatch(/\.pdf$/);
  expect(errors).toEqual([]);
});
test("MOCK integrations: keyboard navigation, loading, errors and empty screens", async ({
  page,
}) => {
  await fixtures(page);
  await page.goto("/auth");
  await expect(page.getByLabel("Email address")).toBeVisible();
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe(
    "BODY",
  );
  await page.getByLabel("Email address").fill("owner@example.test");
  await page.getByLabel("Password", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome home, Alex." }),
  ).toBeVisible();
  for (const path of [
    "/products",
    "/documents",
    "/coverage",
    "/cases",
    "/notifications",
    "/household",
    "/analytics",
    "/settings",
  ]) {
    await page.goto(path);
    await expect(page.locator("main h1")).toBeVisible();
    await noOverflow(page);
    await accessibility(page);
  }
  await page.route("**/api/v1/workspaces/*/dashboard", async (route) => {
    await new Promise((r) => setTimeout(r, 500));
    await route.fulfill({
      status: 503,
      json: {
        error: {
          message: "Test fixture: database unavailable",
          code: "TEST_FAILURE",
          requestId: "mock-request",
        },
      },
    });
  });
  await page.goto("/");
  await expect(page.locator("main .loading")).toBeVisible();
  await expect(
    page.getByText("Test fixture: database unavailable"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Try again" }).click();
});
