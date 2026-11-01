import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { mkdir } from "node:fs/promises";
import { productSchema } from "../../shared/domain";
const w = "00000000-0000-4000-8000-000000000001",
  u = "00000000-0000-4000-8000-000000000002",
  p = "00000000-0000-4000-8000-000000000003",
  d = "00000000-0000-4000-8000-000000000004",
  c = "00000000-0000-4000-8000-000000000005";
// MOCK INTEGRATIONS ONLY: auth, storage, extraction, and API responses are isolated browser fixtures.
// Production code never imports this file. SQL and export functionality have separate real local tests.
async function fixtures(
  page: Page,
  options: {
    scanStatus?: () => string;
    scannerConfigured?: boolean;
    invoiceWarranty?: boolean;
  } = {},
) {
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
    } else if (path.endsWith(`/documents/${d}`) && method === "DELETE") {
      if (json().delete_created_products) {
        product = null;
        coverage.length = 0;
        serviceCase = null;
      }
      doc = null;
      output = { ok: true, status: "deleted" };
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
                specifications: options.invoiceWarranty
                  ? "8 kg, 1200 rpm"
                  : null,
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
            warranties: options.invoiceWarranty
              ? [
                  {
                    item_index: 0,
                    product_name: "Washer",
                    kind: "manufacturer",
                    provider: "Maker",
                    start_basis: "purchase",
                    duration_months: 12,
                    duration_days: null,
                    explicit_start: null,
                    explicit_end: null,
                    terms: "Manufacturing defects only",
                    quote: "12 months from purchase",
                    page: 1,
                  },
                ]
              : [],
            warnings: [],
          },
        },
      };
    else if (path.endsWith(`/products/${p}/assistant`)) output = [];
    else if (path.endsWith(`/products/${p}`) && method === "PATCH") {
      const edits = productSchema.parse(json());
      product = { ...product, ...edits, updated_at: now };
      output = product;
    } else if (path.endsWith(`/products/${p}`))
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
    if (path.endsWith(`/documents/${d}`) && method === "GET") {
      const status = options.scanStatus?.() ?? "needs_review";
      output.document = { ...output.document, status };
      output.scanner = {
        configured: options.scannerConfigured ?? true,
        available: options.scannerConfigured ?? true,
        reason: options.scannerConfigured === false ? "configuration" : null,
      };
      if (status === "queued") output.extraction = null;
      if (status === "processing")
        output.extraction = {
          id: "fixture-extraction",
          status: "processing",
          result: null,
        };
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
test("MOCK integrations: queued scan fills the open form and keeps edits through polling errors", async ({
  page,
}, info) => {
  let scanStatus = "queued";
  const { bytes } = await fixtures(page, { scanStatus: () => scanStatus });
  await page.goto("/auth");
  await page.getByLabel("Email address").fill("owner@example.test");
  await page.getByLabel("Password", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("link", { name: "Add a purchase" }).click();
  await page.getByLabel("Choose document file").setInputFiles({
    name: "test-receipt.pdf",
    mimeType: "application/pdf",
    buffer: bytes,
  });
  await page.getByRole("button", { name: "Upload & continue" }).click();
  await expect(page.getByText(/Waiting to scan/)).toBeVisible();
  await page.getByLabel("Seller", { exact: true }).fill("My corrected seller");
  await page
    .getByRole("button", { name: "Discard edits", exact: true })
    .click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByLabel("Seller", { exact: true })).toHaveValue(
    "My corrected seller",
  );
  await page
    .getByLabel("I checked these details against the original document.")
    .check();
  scanStatus = "processing";
  await expect(page.getByText(/Scanning your document/)).toBeVisible();
  await expect(page.getByLabel("Seller", { exact: true })).toHaveValue(
    "My corrected seller",
  );
  const documentUrl = `**/api/v1/workspaces/*/documents/${d}`;
  await page.route(documentUrl, (route) =>
    route.fulfill({
      status: 503,
      json: {
        error: {
          message: "Mock temporary scan connection failure",
          code: "TEST_FAILURE",
        },
      },
    }),
  );
  await expect(
    page.getByText("Mock temporary scan connection failure"),
  ).toBeVisible();
  await expect(page.getByLabel("Seller", { exact: true })).toHaveValue(
    "My corrected seller",
  );
  await page.unroute(documentUrl);
  scanStatus = "needs_review";
  await expect(page.getByLabel("Product name", { exact: true })).toHaveValue(
    "Washer",
  );
  await expect(page.getByLabel("Model", { exact: true })).toHaveValue("W1");
  await expect(page.getByLabel("Invoice number", { exact: true })).toHaveValue(
    "TEST-001",
  );
  await expect(page.getByLabel("Seller", { exact: true })).toHaveValue(
    "My corrected seller",
  );
  await expect(
    page.getByLabel("I checked these details against the original document."),
  ).not.toBeChecked();
  await expect(
    page.getByRole("button", { name: "Confirm & create products" }),
  ).toBeDisabled();
  await noOverflow(page);
  await accessibility(page);
  await mkdir(".local/qa", { recursive: true });
  await page.screenshot({
    path: `.local/qa/autofilled-review-${info.project.name}.png`,
    fullPage: true,
  });
});
test("MOCK integrations: missing scanner configuration is explicit", async ({
  page,
}) => {
  const { bytes } = await fixtures(page, {
    scanStatus: () => "queued",
    scannerConfigured: false,
  });
  await page.goto("/auth");
  await page.getByLabel("Email address").fill("owner@example.test");
  await page.getByLabel("Password", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("link", { name: "Add a purchase" }).click();
  await page.getByLabel("Choose document file").setInputFiles({
    name: "test-receipt.pdf",
    mimeType: "application/pdf",
    buffer: bytes,
  });
  await page.getByRole("button", { name: "Upload & continue" }).click();
  await expect(page.getByText("Automatic scanning needs setup.")).toBeVisible();
  await expect(page.getByLabel("Seller", { exact: true })).toHaveValue("");
  await expect(page.getByText(/Waiting to scan/)).not.toBeVisible();
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

test("MOCK integrations: invoice specifications and warranty are reviewed and submitted together", async ({
  page,
}) => {
  const { bytes } = await fixtures(page, { invoiceWarranty: true });
  await page.goto("/auth");
  await page.getByLabel("Email address").fill("owner@example.test");
  await page.getByLabel("Password", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("link", { name: "Add a purchase" }).click();
  await page.getByLabel("Choose document file").setInputFiles({
    name: "invoice.pdf",
    mimeType: "application/pdf",
    buffer: bytes,
  });
  await page.getByRole("button", { name: "Upload & continue" }).click();
  await expect(page.getByLabel("Specifications", { exact: true })).toHaveValue(
    "8 kg, 1200 rpm",
  );
  await expect(page.getByLabel("Covered product")).toHaveValue("0");
  await expect(page.getByLabel("Warranty months")).toHaveValue("12");
  await expect(page.getByText(/Coverage dates:/)).toContainText("Jan 31, 2027");
  const confirmed = page.getByLabel(
    "I checked this warranty’s provider, terms and dates.",
  );
  await expect(confirmed).not.toBeChecked();
  await confirmed.check();
  await noOverflow(page);
  await accessibility(page);
  await page
    .getByLabel("I checked these details against the original document.")
    .check();
  await page
    .getByLabel("Specifications", { exact: true })
    .fill("8 kg, 1200 rpm, white");
  await expect(
    page.getByRole("button", { name: "Confirm & create products" }),
  ).toBeDisabled();
  await page
    .getByLabel("I checked these details against the original document.")
    .check();
  let invalidConfirmRequests = 0;
  page.on("request", (req) => {
    if (
      req.url().endsWith(`/documents/${d}/confirm`) &&
      req.method() === "POST"
    )
      invalidConfirmRequests++;
  });
  await page.getByRole("textbox", { name: /^Quantity/ }).fill("");
  await page
    .getByLabel("I checked these details against the original document.")
    .check();
  await page.getByRole("button", { name: "Confirm & create products" }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Enter a quantity greater than 0" }),
  ).toBeVisible();
  expect(invalidConfirmRequests).toBe(0);
  await page.getByRole("textbox", { name: /^Quantity/ }).fill(" 1 ");
  await page
    .getByLabel("I checked these details against the original document.")
    .check();
  const request = page.waitForRequest(
    (req) =>
      req.url().endsWith(`/documents/${d}/confirm`) && req.method() === "POST",
  );
  await page.getByRole("button", { name: "Confirm & create products" }).click();
  expect((await request).postDataJSON()).toMatchObject({
    items: [{ specifications: "8 kg, 1200 rpm, white", quantity: "1" }],
    warranties: [
      {
        item_index: 0,
        provider: "Maker",
        duration_months: 12,
        duration_days: null,
        confirmed: true,
      },
    ],
  });
  await expect(
    page.getByRole("heading", { name: "Washer", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("8 kg, 1200 rpm, white", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Edit details" }).click();
  await expect(page.getByLabel("Specifications", { exact: true })).toHaveValue(
    "8 kg, 1200 rpm, white",
  );
  await page.getByLabel("Product name", { exact: true }).fill("Updated washer");
  const saved = page.waitForRequest(
    (req) => req.url().endsWith(`/products/${p}`) && req.method() === "PATCH",
  );
  await page.getByRole("button", { name: "Save product" }).click();
  const edits = (await saved).postDataJSON();
  expect(productSchema.safeParse(edits).success).toBe(true);
  expect(edits).toMatchObject({
    name: "Updated washer",
    specifications: "8 kg, 1200 rpm, white",
  });
  for (const key of [
    "id",
    "workspace_id",
    "created_at",
    "updated_at",
    "archived_at",
    "documents",
    "coverage",
    "cases",
    "timeline",
  ])
    expect(edits).not.toHaveProperty(key);
  await expect(
    page.getByRole("heading", { name: "Updated washer", exact: true }),
  ).toBeVisible();
});

test("MOCK integrations: visual effects toggle persists and respects reduced motion", async ({
  page,
}, info) => {
  await fixtures(page);
  await page.goto("/auth");
  await page.getByLabel("Email address").fill("owner@example.test");
  await page.getByLabel("Password", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const toggle = page.getByRole("button", {
    name: "Visual effects",
    exact: true,
  });
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  const card = page.locator(".metric").first();
  await card.waitFor();
  const bounds = await card.boundingBox();
  await page.mouse.move(bounds!.x + 30, bounds!.y + 30);
  if (info.project.name === "desktop") {
    await expect(page.locator(".pointer-trail")).toHaveAttribute(
      "data-visible",
      "true",
    );
    await expect(card).toHaveAttribute("data-pointer-lit", "true");
  } else {
    await expect(page.locator(".pointer-trail")).toBeHidden();
  }
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".pointer-trail")).toHaveCount(0);
  await page.reload();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(toggle).toBeDisabled();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".pointer-trail")).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute(
    "data-visual-effects",
    "off",
  );
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(toggle).toBeEnabled();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await noOverflow(page);
  await accessibility(page);
});

test("MOCK integrations: review drafts survive refresh and quick search opens saved products", async ({
  page,
}) => {
  const { bytes } = await fixtures(page, { invoiceWarranty: true });
  await page.goto("/auth");
  await page.getByLabel("Email address").fill("owner@example.test");
  await page.getByLabel("Password", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page
    .getByRole("button", { name: "Search products and shortcuts", exact: true })
    .click();
  await page.getByRole("link", { name: /Add a purchase/ }).click();
  await page.getByLabel("Choose document file").setInputFiles({
    name: "draft.pdf",
    mimeType: "application/pdf",
    buffer: bytes,
  });
  await page.getByRole("button", { name: "Upload & continue" }).click();
  await expect(page.getByLabel("Seller", { exact: true })).toHaveValue(
    "Test Store",
  );
  await page.getByLabel("Seller", { exact: true }).fill("My corrected seller");
  await page
    .getByLabel("I checked this warranty’s provider, terms and dates.")
    .check();
  await expect(
    page.getByText("Draft saved on this browser.", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Seller", { exact: true })).toHaveValue(
    "My corrected seller",
  );
  await expect(
    page.getByLabel("I checked this warranty’s provider, terms and dates."),
  ).not.toBeChecked();
  await expect(
    page.getByLabel("I checked these details against the original document."),
  ).not.toBeChecked();
  await page.getByLabel("Currency", { exact: false }).fill("inr");
  await page
    .getByLabel("I checked these details against the original document.")
    .check();
  const confirmation = page.waitForRequest(
    (r) => r.url().endsWith(`/documents/${d}/confirm`) && r.method() === "POST",
  );
  await page.getByRole("button", { name: "Confirm & create products" }).click();
  expect((await confirmation).postDataJSON()).toMatchObject({
    seller: "My corrected seller",
    currency: "INR",
  });
  await expect(
    page.getByRole("heading", { name: "Washer", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).filter((key) =>
        key.startsWith("afterbuy.review-draft:"),
      ),
    ),
  ).toEqual([]);
  await page.keyboard.press("Control+k");
  await page
    .getByRole("textbox", { name: "Search product names" })
    .fill("Washer");
  await expect(page.getByRole("link", { name: /Washer/ })).toBeVisible();
  await noOverflow(page);
  await accessibility(page);
  await page.getByRole("textbox", { name: "Search product names" }).focus();
  await page.keyboard.press("ArrowUp");
  await expect(
    page.getByRole("link", { name: /View all 1 matching products/ }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("textbox", { name: "Search products", exact: true }),
  ).toHaveValue("Washer");
  await page.keyboard.press("Control+k");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("MOCK integrations: unavailable invoice offers a working upload recovery", async ({
  page,
}) => {
  await fixtures(page);
  await page.goto("/auth");
  await page.getByLabel("Email address").fill("owner@example.test");
  await page.getByLabel("Password", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("link", { name: "Add a purchase" }).waitFor();
  await page.route(`**/api/v1/workspaces/*/documents/${d}`, (route) =>
    route.fulfill({
      status: 404,
      json: { error: { code: "NOT_FOUND", message: "Record not found." } },
    }),
  );
  await page.goto(`/documents/${d}/review`);
  await expect(
    page.getByRole("heading", { name: "Document unavailable", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Upload invoice again" }).click();
  await expect(page.getByLabel("Choose document file")).toBeAttached();
  await expect(
    page.getByRole("heading", { name: "Add a document" }),
  ).toBeVisible();
});

test("MOCK integrations: compact phone and tablet layouts keep navigation and search usable", async ({
  page,
}, info) => {
  await fixtures(page);
  await page.goto("/auth");
  await page.getByLabel("Email address").fill("owner@example.test");
  await page.getByLabel("Password", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome home, Alex." }),
  ).toBeVisible();
  for (const width of [320, 768]) {
    await page.setViewportSize({ width, height: 740 });
    await noOverflow(page);
    await page
      .getByRole("button", {
        name: "Search products and shortcuts",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("textbox", { name: "Search product names" }),
    ).toBeFocused();
    await noOverflow(page);
    await accessibility(page);
    await mkdir(".local/qa", { recursive: true });
    await page.screenshot({
      path: `.local/qa/final-search-${width}-${info.project.name}.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    if (width === 320) {
      await page.getByRole("button", { name: "Open navigation" }).click();
      await noOverflow(page);
      await page
        .getByRole("dialog")
        .getByRole("link", { name: "Documents", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "Your documents", exact: true }),
      ).toBeVisible();
    }
  }
});

for (const deleteProducts of [false, true]) {
  test(`MOCK integrations: deleting a document ${deleteProducts ? "also removes created products when selected" : "keeps products by default"}`, async ({
    page,
  }) => {
    const { bytes } = await fixtures(page);
    await page.goto("/auth");
    await page.getByLabel("Email address").fill("owner@example.test");
    await page.getByLabel("Password", { exact: true }).fill("test-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("link", { name: "Add a purchase" }).click();
    await page
      .getByLabel("Choose document file")
      .setInputFiles({
        name: "delete-test.pdf",
        mimeType: "application/pdf",
        buffer: bytes,
      });
    await page.getByRole("button", { name: "Upload & continue" }).click();
    await expect(page.getByLabel("Product name", { exact: true })).toHaveValue(
      "Washer",
    );
    await page
      .getByLabel("I checked these details against the original document.")
      .check();
    await page
      .getByRole("button", { name: "Confirm & create products" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Washer", exact: true }),
    ).toBeVisible();
    await page.goto(`/documents/${d}/review`);
    await page
      .getByRole("button", {
        name: deleteProducts
          ? "Delete document and created products"
          : "Delete document",
        exact: true,
      })
      .click();
    const deletion = page.waitForRequest(
      (req) =>
        req.url().endsWith(`/documents/${d}`) && req.method() === "DELETE",
    );
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Confirm", exact: true })
      .click();
    expect((await deletion).postDataJSON()).toEqual({
      delete_created_products: deleteProducts,
    });
    await expect(
      page.getByRole("heading", { name: "Your documents", exact: true }),
    ).toBeVisible();
    await page.goto("/products");
    await expect(
      page.getByText(deleteProducts ? "0 products" : "1 products", {
        exact: true,
      }),
    ).toBeVisible();
  });
}
