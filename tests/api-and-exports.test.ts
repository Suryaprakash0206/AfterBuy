import { describe, it, expect, vi } from "vitest";
import { config } from "../backend/src/config.js";
import request from "supertest";
import { PDFDocument } from "pdf-lib";
import { createApp } from "../backend/src/app.js";
import {
  renderPackagePdf,
  renderPackageZip,
  assertEvidenceIsSafe,
} from "../backend/src/modules/cases/service.js";
import { inspectFile } from "../backend/src/modules/documents/service.js";
describe("API boundaries without external credentials", () => {
  const app = createApp();
  it("does not mistake an invalid API key for a ready database (mock HTTP probe)", async () => {
    const previous = {
      SUPABASE_URL: config.SUPABASE_URL,
      SUPABASE_PUBLISHABLE_KEY: config.SUPABASE_PUBLISHABLE_KEY,
    };
    try {
      Object.assign(config, {
        SUPABASE_URL: "https://example.invalid",
        SUPABASE_PUBLISHABLE_KEY: "test-only-key",
      });
      const fetchMock = vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ message: "Invalid API key" }), {
            status: 401,
          }),
        );
      vi.stubGlobal("fetch", fetchMock);
      expect((await request(app).get("/api/v1/ready")).status).toBe(503);
      fetchMock.mockResolvedValue(
        new Response(
          JSON.stringify({ code: "42501", message: "Permission denied" }),
          { status: 401 },
        ),
      );
      expect((await request(app).get("/api/v1/ready")).status).toBe(200);
    } finally {
      Object.assign(config, previous);
      vi.unstubAllGlobals();
    }
  });
  it("exposes health but never protected data without a verified session", async () => {
    expect((await request(app).get("/api/v1/health")).status).toBe(200);
    const r = await request(app).get("/api/v1/me");
    expect(r.status).toBe(401);
    expect(r.body.error.requestId).toBeTruthy();
  });
  it("applies security headers and does not reflect arbitrary CORS origins", async () => {
    const r = await request(app)
      .get("/api/v1/health")
      .set("Origin", "https://attacker.example");
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(r.headers["access-control-allow-origin"]).not.toBe(
      "https://attacker.example",
    );
    expect(r.headers["cache-control"]).toBe("no-store");
  });
});
describe("real local PDF and ZIP export", () => {
  it("rejects unrelated and multi-purchase originals even after another product is deleted", () => {
    expect(() =>
      assertEvidenceIsSafe({ kind: "service" }, [{ product_id: "other" }], "p"),
    ).toThrow("Evidence must belong");
    expect(() =>
      assertEvidenceIsSafe(
        { kind: "invoice", accepted_product_ids: ["p", "deleted-product"] },
        [{ product_id: "p" }],
        "p",
      ),
    ).toThrow("separately prepared");
    expect(() =>
      assertEvidenceIsSafe(
        { kind: "invoice", accepted_product_ids: null },
        [{ product_id: "p" }],
        "p",
      ),
    ).toThrow("invoice items");
    expect(() =>
      assertEvidenceIsSafe({ kind: "service" }, [{ product_id: "p" }], "p"),
    ).not.toThrow();
    expect(() =>
      assertEvidenceIsSafe(
        { kind: "invoice", accepted_product_ids: ["p"] },
        [{ product_id: "p" }],
        "p",
      ),
    ).not.toThrow();
  });
  const pkg = {
    product: {
      id: "p",
      name: "Test washer",
      brand: "Maker",
      model: "W1",
      serial_number: undefined,
      seller: "Store",
      purchase_date: "2025-01-01",
      price: "100.00",
      currency: "INR",
    },
    case: {
      id: "c",
      title: "Leak",
      description: "Door leaking",
      occurred_on: "2026-10-20",
      status: "Draft",
    },
    coverage: [],
    timeline: [],
    documents: [],
    draft: "Hello, please help with this fault.",
    notice: "Recorded period does not establish eligibility.",
  };
  it("creates a readable PDF and detects its real signature/page count", async () => {
    const bytes = await renderPackagePdf(pkg);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(0);
    const inspected = await inspectFile(Buffer.from(bytes), "application/pdf");
    expect(inspected.mime).toBe("application/pdf");
    expect(inspected.pages).toBe(pdf.getPageCount());
  });
  it("creates a real ZIP containing the PDF and draft without email", async () => {
    const pdf = await renderPackagePdf(pkg);
    const zip = await renderPackageZip({} as any, pkg, pdf);
    expect(zip.subarray(0, 2).toString()).toBe("PK");
    expect(zip.toString("latin1")).toContain("support-summary.pdf");
    expect(zip.toString("latin1")).toContain("draft-message.txt");
  });
  it("rejects spoofed file types", async () => {
    await expect(
      inspectFile(Buffer.from("<script>bad</script>"), "image/png"),
    ).rejects.toThrow();
    const bytes = await renderPackagePdf(pkg);
    await expect(
      inspectFile(Buffer.from(bytes), "image/jpeg"),
    ).rejects.toThrow();
  });
});
