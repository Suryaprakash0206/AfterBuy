import { z } from "zod";
import {
  dateSchema,
  moneySchema,
  quantitySchema,
  currencySchema,
  coverageSchema,
  coverageDates,
} from "../../../../shared/domain.js";
const nullable = z.string().nullable();
export const transcriptionSchema = z.object({
  pages: z.array(z.object({ page: z.number().int(), text: z.string() })),
});
export const extractionSchema = z.object({
  seller: nullable,
  invoice_number: nullable,
  purchase_date: nullable,
  currency: nullable,
  subtotal: nullable,
  tax: nullable,
  total: nullable,
  items: z.array(
    z.object({
      name: nullable,
      category: nullable,
      brand: nullable,
      model: nullable,
      serial_number: nullable,
      specifications: nullable,
      quantity: nullable,
      unit_price: nullable,
      line_total: nullable,
    }),
  ),
  warranties: z.array(
    z.object({
      product_name: nullable,
      item_index: z.number().int().nonnegative().nullable(),
      kind: z.enum(["return", "manufacturer", "extended", "repair"]).nullable(),
      provider: nullable,
      start_basis: nullable,
      duration: nullable,
      duration_months: z.number().int().min(0).max(600).nullable(),
      duration_days: z.number().int().min(0).max(36600).nullable(),
      explicit_start: nullable,
      explicit_end: nullable,
      exclusions: nullable,
      terms: z.string(),
      page: z.number().int().nullable(),
      quote: z.string(),
    }),
  ),
  evidence: z.array(
    z.object({
      field: z.string(),
      quote: z.string(),
      page: z.number().int().nullable(),
      origin: z.enum(["extracted", "inferred"]),
    }),
  ),
  warnings: z.array(z.string()),
});
export type Extraction = z.infer<typeof extractionSchema>;
export const reviewSchema = z
  .object({
    seller: z.string().max(1000).nullable(),
    invoice_number: z.string().max(200).nullable(),
    purchase_date: dateSchema.nullable(),
    currency: currencySchema,
    subtotal: moneySchema.nullable(),
    tax: moneySchema.nullable(),
    total: moneySchema.nullable(),
    items: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(160),
          category: z.string().max(80).default("Other"),
          brand: z.string().max(1000).nullable(),
          model: z.string().max(1000).nullable(),
          serial_number: z.string().max(1000).nullable(),
          specifications: z.string().max(5000).nullable().default(null),
          quantity: quantitySchema,
          unit_price: moneySchema.nullable(),
          line_total: moneySchema.nullable(),
        }),
      )
      .min(1)
      .max(100),
    warranties: z
      .array(
        z
          .object({
            item_index: z.number().int().nonnegative(),
            kind: coverageSchema.shape.kind,
            provider: z.string().max(160).nullable(),
            basis: coverageSchema.shape.basis,
            explicit_start: dateSchema.nullable(),
            explicit_end: dateSchema.nullable(),
            duration_months: z.number().int().min(0).max(600).nullable(),
            duration_days: z.number().int().min(0).max(36600).nullable(),
            conditions: z.string().max(5000).nullable(),
            exclusions: z.string().max(5000).nullable(),
            uncertainty: z.string().max(2000).nullable(),
            confirmed: z.boolean(),
          })
          .strict(),
      )
      .max(200)
      .default([]),
    duplicate_acknowledged: z.boolean().default(false),
  })
  .strict()
  .superRefine((review, ctx) => {
    review.warranties.forEach((w, index) => {
      const fail = (message: string) =>
        ctx.addIssue({ code: "custom", path: ["warranties", index], message });
      if (w.item_index >= review.items.length)
        fail("Choose the product this warranty covers.");
      if (w.duration_months != null && w.duration_days != null)
        fail("Choose months or days, not both.");
      try {
        const dates = coverageDates(w, { purchase_date: review.purchase_date });
        if (
          w.confirmed &&
          (!w.provider?.trim() || !dates.start_date || !dates.end_date)
        )
          fail(
            "Confirmed warranties need a provider and known start and end dates. Otherwise save as unconfirmed.",
          );
      } catch {
        fail("Coverage cannot end before its start date.");
      }
    });
  });
export const answerSchema = z.object({
  answer: z.string(),
  source_ids: z.array(z.string()),
  evidence_found: z.boolean(),
});
export type Passage = {
  id: string;
  document_id: string;
  page: number;
  content: string;
  name: string;
  similarity?: number;
};
export const MISSING_EVIDENCE =
  "I could not find this in your documents. Add the relevant manual, warranty terms, or service record and try again.";
export function resolveAnswer(
  output: z.infer<typeof answerSchema>,
  passages: Passage[],
) {
  const allowed = new Map(passages.map((p) => [p.id, p]));
  if (!output.evidence_found || !output.source_ids.length)
    return { answer: MISSING_EVIDENCE, sources: [] as Passage[] };
  if (output.source_ids.some((id) => !allowed.has(id)))
    throw new Error("INVALID_CITATION");
  return {
    answer: output.answer,
    sources: [...new Set(output.source_ids)].map((id) => allowed.get(id)!),
  };
}
