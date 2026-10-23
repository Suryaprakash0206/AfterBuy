import { z } from "zod";
import { Temporal } from "@js-temporal/polyfill";

export const idSchema = z.uuid();
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    try {
      Temporal.PlainDate.from(v);
      return true;
    } catch {
      return false;
    }
  }, "Enter a valid calendar date");
export const moneySchema = z
  .string()
  .regex(
    /^\d{1,12}(\.\d{1,4})?$/,
    "Use a positive decimal amount, with up to four decimal places",
  );
export const currencySchema = z
  .string()
  .regex(/^[A-Z]{3}$/, "Use a three-letter currency code");
const optionalText = z.string().trim().max(1000).nullable().optional();
export const productSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    category: z.string().trim().max(80).default("Other"),
    brand: optionalText,
    model: optionalText,
    serial_number: optionalText,
    seller: optionalText,
    purchase_date: dateSchema.nullable().optional(),
    delivery_date: dateSchema.nullable().optional(),
    price: moneySchema.nullable().optional(),
    currency: currencySchema.default("INR"),
    location: optionalText,
    notes: z.string().max(5000).nullable().optional(),
  })
  .strict();
export type ProductInput = z.infer<typeof productSchema>;
export const coverageSchema = z
  .object({
    product_id: idSchema,
    kind: z.enum(["return", "manufacturer", "extended", "repair"]),
    provider: z.string().trim().min(1).max(160),
    source_document_id: idSchema.nullable().optional(),
    components: optionalText,
    basis: z.enum(["purchase", "delivery", "explicit"]),
    explicit_start: dateSchema.nullable().optional(),
    duration_months: z.number().int().min(0).max(600).nullable().optional(),
    duration_days: z.number().int().min(0).max(36600).nullable().optional(),
    explicit_end: dateSchema.nullable().optional(),
    exclusions: z.string().max(5000).nullable().optional(),
    conditions: z.string().max(5000).nullable().optional(),
    confirmed: z.boolean(),
    uncertainty: z.string().max(2000).nullable().optional(),
  })
  .strict()
  .refine(
    (v) =>
      !v.confirmed ||
      !!(
        v.explicit_end ||
        v.duration_months != null ||
        v.duration_days != null
      ),
    "Confirmed coverage needs an end date or duration",
  )
  .refine(
    (v) => !v.confirmed || v.basis !== "explicit" || !!v.explicit_start,
    "Enter the start date",
  )
  .refine(
    (v) => !(v.duration_months != null && v.duration_days != null),
    "Choose months or days",
  );
export type CoverageInput = z.infer<typeof coverageSchema>;
export const caseStatuses = [
  "Draft",
  "Submitted",
  "Awaiting response",
  "Inspection",
  "Resolved",
  "Rejected",
  "Cancelled",
] as const;
export const caseSchema = z
  .object({
    product_id: idSchema,
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().min(1).max(6000),
    occurred_on: dateSchema,
    support_contact: optionalText,
    reference: optionalText,
  })
  .strict();
export const caseEventSchema = z
  .object({
    kind: z.enum([
      "note",
      "troubleshooting",
      "repair",
      "replacement",
      "refund",
      "maintenance",
      "status",
    ]),
    note: z.string().trim().min(1).max(5000),
    occurred_on: dateSchema,
    amount: moneySchema.nullable().optional(),
    currency: currencySchema.default("INR"),
    status: z.enum(caseStatuses).optional(),
    replacement_details: optionalText,
  })
  .strict()
  .refine((v) => v.kind !== "status" || !!v.status, "Choose a status");
export const profileSchema = z
  .object({
    display_name: z.string().trim().min(1).max(100),
    currency: currencySchema,
    timezone: z.string().refine((v) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: v });
        return true;
      } catch {
        return false;
      }
    }, "Use an IANA timezone"),
    reminder_days: z.array(z.number().int().min(0).max(365)).max(8),
    reminders_enabled: z.boolean(),
    email_enabled: z.boolean(),
  })
  .strict();
export type Role = "owner" | "editor" | "viewer";
export function canWrite(role: Role) {
  return role === "owner" || role === "editor";
}
export const transitions: Record<
  (typeof caseStatuses)[number],
  readonly string[]
> = {
  Draft: ["Submitted", "Cancelled"],
  Submitted: [
    "Awaiting response",
    "Inspection",
    "Resolved",
    "Rejected",
    "Cancelled",
  ],
  "Awaiting response": [
    "Submitted",
    "Inspection",
    "Resolved",
    "Rejected",
    "Cancelled",
  ],
  Inspection: ["Awaiting response", "Resolved", "Rejected", "Cancelled"],
  Resolved: [],
  Rejected: ["Submitted", "Cancelled"],
  Cancelled: [],
};
export function assertTransition(
  from: (typeof caseStatuses)[number],
  to: string,
) {
  if (from !== to && !transitions[from].includes(to))
    throw new Error(`Cannot move a case from ${from} to ${to}`);
}
export function coverageDates(
  input: Pick<
    CoverageInput,
    | "basis"
    | "explicit_start"
    | "duration_months"
    | "duration_days"
    | "explicit_end"
  >,
  product: Pick<ProductInput, "purchase_date" | "delivery_date">,
) {
  const start =
    input.basis === "purchase"
      ? product.purchase_date
      : input.basis === "delivery"
        ? product.delivery_date
        : input.explicit_start;
  if (!start) return { start_date: null, end_date: input.explicit_end ?? null };
  const d = Temporal.PlainDate.from(start);
  const end =
    input.explicit_end ??
    (input.duration_months != null
      ? d
          .add({ months: input.duration_months }, { overflow: "constrain" })
          .toString()
      : input.duration_days != null
        ? d.add({ days: input.duration_days }).toString()
        : null);
  if (end && Temporal.PlainDate.compare(end, start) < 0)
    throw new Error("Coverage cannot end before it starts");
  return { start_date: start, end_date: end };
}
export function reminderInstant(
  date: string,
  daysBefore: number,
  timezone: string,
) {
  return Temporal.PlainDate.from(date)
    .subtract({ days: daysBefore })
    .toZonedDateTime({ timeZone: timezone, plainTime: "09:00" })
    .toInstant()
    .toString();
}
export function todayIn(timezone: string, now = new Date()) {
  return Temporal.Instant.from(now.toISOString())
    .toZonedDateTimeISO(timezone)
    .toPlainDate()
    .toString();
}
export function addDays(date: string, days: number) {
  return Temporal.PlainDate.from(date).add({ days }).toString();
}
