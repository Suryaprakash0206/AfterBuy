import { z } from "zod";

const prefix = "afterbuy.review-draft:";
const storedDraft = z.object({
  version: z.literal(1),
  savedAt: z.number(),
  values: z.object({
    seller: z.string(),
    invoice_number: z.string(),
    purchase_date: z.string(),
    currency: z.string(),
    subtotal: z.string(),
    tax: z.string(),
    total: z.string(),
    items: z
      .array(z.object({ name: z.string(), quantity: z.string() }).passthrough())
      .min(1)
      .max(100),
    warranties: z
      .array(
        z
          .object({
            item_index: z.union([z.number(), z.string()]),
            confirmed: z.boolean(),
          })
          .passthrough(),
      )
      .max(200),
  }),
});
export function reviewDraftKey(
  user: string,
  workspace: string,
  document: string,
) {
  return `${prefix}${user}:${workspace}:${document}`;
}
export function readReviewDraft(key: string) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const draft = storedDraft.parse(JSON.parse(raw));
    if (Date.now() - draft.savedAt > 7 * 86400000) {
      removeReviewDraft(key);
      return null;
    }
    return {
      ...draft.values,
      warranties: draft.values.warranties.map((w) => ({
        ...w,
        confirmed: false,
      })),
    };
  } catch {
    removeReviewDraft(key);
    return null;
  }
}
export function writeReviewDraft(key: string, values: unknown): boolean {
  try {
    const draft = storedDraft.parse({
      version: 1,
      savedAt: Date.now(),
      values,
    });
    localStorage.setItem(key, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}
export function removeReviewDraft(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* Storage may be unavailable. */
  }
}
export function clearReviewDrafts() {
  try {
    for (let index = localStorage.length - 1; index >= 0; index--) {
      const key = localStorage.key(index);
      if (key?.startsWith(prefix)) localStorage.removeItem(key);
    }
  } catch {
    /* Signing out must work even without storage access. */
  }
}
