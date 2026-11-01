import { describe, expect, it } from "vitest";
import {
  reviewValues,
  mergeReviewValues,
  scannedQuantity,
} from "../frontend/src/lib/review-values";
import { quantitySchema } from "../shared/domain";

describe("invoice quantity validation", () => {
  it.each([
    [" 1 pcs ", "1"],
    ["2 Nos.", "2"],
    ["1.5", "1.5"],
    [null, ""],
    ["1 or 2", "1 or 2"],
  ])(
    "normalizes explicit count units without inventing a quantity: %s",
    (input, expected) => expect(scannedQuantity(input)).toBe(expected),
  );
  it.each(["", "0", "-1", "1 or 2", "1.12345", "10000000"])(
    "rejects invalid quantities with one readable error: %s",
    (input) => {
      const result = quantitySchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toHaveLength(1);
        expect(result.error.issues[0].message).toContain(
          "Enter a quantity greater than 0",
        );
      }
    },
  );
  it("trims a valid quantity before saving", () => {
    expect(quantitySchema.parse(" 1.5 ")).toBe("1.5");
  });
});

const scan = {
  seller: "Receipt store",
  invoice_number: "INV-1",
  currency: "USD",
  total: "81.00",
  items: [{ name: "Kettle", quantity: "1", line_total: "81.00" }],
};
describe("late-arriving automatic scan results", () => {
  it("fills an untouched form, including product rows", () => {
    expect(
      mergeReviewValues(reviewValues(null), reviewValues(scan), {}),
    ).toMatchObject(scan);
  });
  it("preserves an edited seller but fills the remaining fields", () => {
    const current = { ...reviewValues(null), seller: "My correction" };
    expect(
      mergeReviewValues(current, reviewValues(scan), { seller: true }),
    ).toMatchObject({
      seller: "My correction",
      invoice_number: "INV-1",
      items: scan.items,
    });
  });
  it("keeps a manually changed product list intact instead of joining unrelated prices by row", () => {
    const current = {
      ...reviewValues(null),
      items: [{ name: "My product", line_total: "12.00" }],
    };
    expect(
      mergeReviewValues(current, reviewValues(scan), {
        items: [{ name: true }],
      }).items,
    ).toEqual(current.items);
  });
  it("leaves missing scanned dates, currency and costs blank", () => {
    expect(
      reviewValues({
        items: [{ name: null, quantity: null, line_total: null }],
      }),
    ).toMatchObject({
      purchase_date: "",
      currency: "",
      total: "",
      items: [{ name: "", quantity: "", line_total: null }],
    });
  });
});

describe("invoice warranties and product specifications", () => {
  const invoice = {
    ...scan,
    items: [{ name: "Kettle", specifications: "1.5 L, 1500 W", quantity: "1" }],
    warranties: [
      {
        item_index: 0,
        product_name: "Kettle",
        kind: "manufacturer",
        provider: "Maker",
        start_basis: "purchase",
        duration_months: 12,
        terms: "Manufacturing defects",
        quote: "12 months from purchase",
        page: 1,
      },
    ],
  };
  it("fills editable warranty fields but never automatically confirms coverage", () => {
    expect(reviewValues(invoice)).toMatchObject({
      items: [{ specifications: "1.5 L, 1500 W" }],
      warranties: [
        {
          item_index: 0,
          basis: "purchase",
          duration_months: 12,
          confirmed: false,
        },
      ],
    });
  });
  it("does not guess a product association or start date for ambiguous terms", () => {
    const values = reviewValues({
      ...invoice,
      items: [{ name: "Kettle" }, { name: "Kettle" }],
      warranties: [{ product_name: "Kettle", terms: "Warranty included" }],
    });
    expect(values.warranties[0]).toMatchObject({
      item_index: "",
      provider: "",
      explicit_start: "",
      duration_months: "",
      confirmed: false,
    });
  });
  it("keeps product rows and warranties together when either list is edited", () => {
    const current = {
      ...reviewValues(invoice),
      items: [{ name: "Changed product" }],
    };
    expect(
      mergeReviewValues(current, reviewValues(scan), {
        items: [{ name: true }],
      }),
    ).toMatchObject({ items: current.items, warranties: current.warranties });
    expect(
      mergeReviewValues(current, reviewValues(scan), {
        warranties: [{ provider: true }],
      }),
    ).toMatchObject({ items: current.items, warranties: current.warranties });
  });
});
