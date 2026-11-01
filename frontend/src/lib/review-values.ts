export function scannedQuantity(value: unknown): string {
  const text = value == null ? "" : String(value).trim();
  // Remove only explicit count units; never guess missing or ambiguous quantities.
  return text.replace(
    /^(\d{1,7}(?:\.\d{1,4})?)\s*(?:pcs?\.?|pieces?|nos?\.?|units?)$/i,
    "$1",
  );
}

export const emptyReviewItem = {
  name: "",
  category: "Other",
  brand: null,
  model: null,
  serial_number: null,
  specifications: null,
  quantity: "1",
  unit_price: null,
  line_total: null,
};

export function reviewValues(extracted: any, currency = "INR") {
  return {
    seller: extracted?.seller ?? "",
    invoice_number: extracted?.invoice_number ?? "",
    purchase_date: extracted?.purchase_date ?? "",
    currency: extracted ? (extracted.currency ?? "") : currency,
    subtotal: extracted?.subtotal ?? "",
    tax: extracted?.tax ?? "",
    total: extracted?.total ?? "",
    warranties: (extracted?.warranties ?? []).map((w: any) => {
      const matches = (extracted?.items ?? []).flatMap(
        (item: any, index: number) =>
          w.product_name && item.name === w.product_name ? [index] : [],
      );
      const index =
        Number.isInteger(w.item_index) &&
        w.item_index >= 0 &&
        w.item_index < (extracted?.items?.length ?? 0)
          ? w.item_index
          : matches.length === 1
            ? matches[0]
            : "";
      return {
        item_index: index,
        kind: w.kind ?? "",
        provider: w.provider ?? "",
        basis: ["purchase", "delivery", "explicit"].includes(w.start_basis)
          ? w.start_basis
          : "explicit",
        explicit_start: w.explicit_start ?? "",
        explicit_end: w.explicit_end ?? "",
        duration_months: w.duration_months ?? "",
        duration_days: w.duration_days ?? "",
        conditions: [
          w.terms,
          w.duration && `Stated duration: ${w.duration}`,
          w.quote && `Invoice quote: ${w.quote}`,
          w.page && `Page: ${w.page}`,
        ]
          .filter(Boolean)
          .join("\n"),
        exclusions: w.exclusions ?? "",
        uncertainty: !["purchase", "delivery", "explicit"].includes(
          w.start_basis,
        )
          ? "Start basis not provided; dates must be checked."
          : "",
        confirmed: false,
      };
    }),
    items: extracted?.items?.length
      ? extracted.items.map((item: any) => ({
          ...emptyReviewItem,
          ...item,
          name: item.name ?? "",
          quantity: scannedQuantity(item.quantity),
          category: item.category ?? "Other",
        }))
      : [{ ...emptyReviewItem }],
  };
}

export function hasReviewEdits(value: unknown): boolean {
  return (
    value === true ||
    (!!value &&
      typeof value === "object" &&
      Object.values(value).some(hasReviewEdits))
  );
}

// Item order/quantity may have been changed by the reviewer. Preserve the whole
// edited list rather than merging by index and attaching prices to another item.
export function mergeReviewValues(
  current: any,
  incoming: ReturnType<typeof reviewValues>,
  dirty: Record<string, unknown>,
) {
  return Object.fromEntries(
    Object.entries(incoming).map(([name, value]) => [
      name,
      hasReviewEdits(dirty[name]) ||
      (["items", "warranties"].includes(name) &&
        (hasReviewEdits(dirty.items) || hasReviewEdits(dirty.warranties)))
        ? current[name]
        : value,
    ]),
  );
}
