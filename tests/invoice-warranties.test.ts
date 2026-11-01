import { describe, expect, it } from "vitest";
import {
  reviewSchema,
  extractionSchema,
} from "../backend/src/modules/ai/schemas.js";
import { zodTextFormat } from "openai/helpers/zod";
const warranty = {
  item_index: 0,
  kind: "manufacturer",
  provider: "Maker",
  basis: "purchase",
  explicit_start: null,
  explicit_end: null,
  duration_months: 12,
  duration_days: null,
  conditions: "Defects only",
  exclusions: null,
  uncertainty: null,
  confirmed: true,
};
const review = {
  seller: null,
  invoice_number: null,
  purchase_date: "2026-01-31",
  currency: "INR",
  subtotal: null,
  tax: null,
  total: null,
  items: [
    {
      name: "Washer",
      brand: null,
      model: null,
      serial_number: null,
      specifications: "8 kg",
      quantity: "1",
      unit_price: "24000",
      line_total: "24000",
    },
  ],
  warranties: [warranty],
};
describe("invoice confirmation validation", () => {
  it("accepts reviewed specifications and known warranty dates", () =>
    expect(reviewSchema.parse(review).items[0].specifications).toBe("8 kg"));
  it("supports old clients and invoices with no warranties", () =>
    expect(
      reviewSchema.parse({ ...review, warranties: undefined }).warranties,
    ).toEqual([]));
  it.each([
    { item_index: 1 },
    { duration_days: 30 },
    { provider: null },
    { basis: "explicit" },
    { explicit_end: "2025-01-01" },
  ])("rejects invalid confirmed warranty %j", (change) =>
    expect(
      reviewSchema.safeParse({
        ...review,
        warranties: [{ ...warranty, ...change }],
      }).success,
    ).toBe(false),
  );
  it("retains incomplete warranty terms without inventing dates", () =>
    expect(
      reviewSchema.safeParse({
        ...review,
        warranties: [
          { ...warranty, provider: null, basis: "explicit", confirmed: false },
        ],
      }).success,
    ).toBe(true));
  it("can generate a strict extraction schema with specs and structured warranty fields", () => {
    const format = zodTextFormat(extractionSchema, "invoice");
    expect(format.strict).toBe(true);
    expect(JSON.stringify(format.schema)).toContain("specifications");
    expect(JSON.stringify(format.schema)).toContain("item_index");
  });
});
