import { describe, it, expect } from "vitest";
import {
  coverageDates,
  reminderInstant,
  todayIn,
  assertTransition,
  canWrite,
  dateSchema,
  moneySchema,
} from "../shared/domain.js";
import {
  chunkPages,
  safeFilename,
} from "../backend/src/modules/documents/service.js";
import {
  resolveAnswer,
  MISSING_EVIDENCE,
} from "../backend/src/modules/ai/schemas.js";
import { coverageReminderKey } from "../backend/src/modules/reminders/service.js";
describe("deterministic coverage and timezone rules", () => {
  it.each([
    ["2024-01-31", 1, "2024-02-29"],
    ["2023-01-31", 1, "2023-02-28"],
    ["2024-02-29", 12, "2025-02-28"],
    ["2024-12-31", 2, "2025-02-28"],
  ])("constrains %s + %i calendar months to %s", (start, months, end) =>
    expect(
      coverageDates(
        { basis: "explicit", explicit_start: start, duration_months: months },
        {},
      ).end_date,
    ).toBe(end),
  );
  it("does not assume purchase-date coverage", () =>
    expect(
      coverageDates(
        { basis: "delivery", duration_months: 12 },
        { purchase_date: "2025-01-01" },
      ),
    ).toEqual({ start_date: null, end_date: null }));
  it("uses explicit end date and rejects inverted coverage", () => {
    expect(
      coverageDates(
        { basis: "purchase", duration_months: 12, explicit_end: "2025-06-30" },
        { purchase_date: "2025-01-01" },
      ).end_date,
    ).toBe("2025-06-30");
    expect(() =>
      coverageDates(
        {
          basis: "explicit",
          explicit_start: "2025-02-01",
          explicit_end: "2025-01-01",
        },
        {},
      ),
    ).toThrow();
  });
  it("schedules 9 AM locally across DST", () => {
    expect(reminderInstant("2025-03-09", 0, "America/New_York")).toBe(
      "2025-03-09T13:00:00Z",
    );
    expect(reminderInstant("2025-03-08", 0, "America/New_York")).toBe(
      "2025-03-08T14:00:00Z",
    );
    expect(reminderInstant("2025-01-01", 1, "Asia/Kolkata")).toBe(
      "2024-12-31T03:30:00Z",
    );
  });
  it("uses the account calendar date instead of server timezone", () =>
    expect(todayIn("Asia/Kolkata", new Date("2025-01-01T20:00:00Z"))).toBe(
      "2025-01-02",
    ));
  it("rejects impossible dates and keeps money as exact decimal strings", () => {
    expect(dateSchema.safeParse("2025-02-29").success).toBe(false);
    expect(moneySchema.parse("123456789012.1234")).toBe("123456789012.1234");
    expect(moneySchema.safeParse(12.34).success).toBe(false);
  });
});
describe("access and case rules", () => {
  it("only editors and owners write", () => {
    expect(canWrite("viewer")).toBe(false);
    expect(canWrite("editor")).toBe(true);
    expect(canWrite("owner")).toBe(true);
  });
  it("enforces allowed case transitions", () => {
    expect(() => assertTransition("Draft", "Submitted")).not.toThrow();
    expect(() => assertTransition("Draft", "Resolved")).toThrow();
    expect(() => assertTransition("Resolved", "Submitted")).toThrow();
  });
});
describe("document assistant isolation (mock model output)", () => {
  const passages = [
    {
      id: "one",
      document_id: "doc",
      page: 3,
      name: "Manual",
      content: "Clean with a dry cloth.",
    },
  ];
  it("resolves only retrieved citations", () => {
    expect(
      resolveAnswer(
        {
          answer: "Use a dry cloth.",
          source_ids: ["one"],
          evidence_found: true,
        },
        passages,
      ).sources[0].page,
    ).toBe(3);
    expect(() =>
      resolveAnswer(
        {
          answer: "x",
          source_ids: ["other-user-passage"],
          evidence_found: true,
        },
        passages,
      ),
    ).toThrow("INVALID_CITATION");
  });
  it("returns an explicit missing-evidence answer", () =>
    expect(
      resolveAnswer(
        { answer: "Invented answer", source_ids: [], evidence_found: false },
        passages,
      ).answer,
    ).toBe(MISSING_EVIDENCE));
  it("preserves source pages in chunks", () => {
    const chunks = chunkPages([
      { page: 1, text: "A".repeat(1800) },
      { page: 2, text: "B".repeat(100) },
    ]);
    expect(chunks.map((c) => c.page)).toEqual([1, 1, 2]);
    expect(chunks[0].content.slice(-200)).toBe(chunks[1].content.slice(0, 200));
  });
  it("sanitizes archive filenames", () =>
    expect(safeFilename("../../invoice:bad.pdf")).not.toContain("/"));
});
describe("reminder deduplication identity", () => {
  it("is stable on retry and changes with confirmed revision or preferences", () => {
    const key = coverageReminderKey("c", 1, "u", 1, 7);
    expect(coverageReminderKey("c", 1, "u", 1, 7)).toBe(key);
    expect(coverageReminderKey("c", 2, "u", 1, 7)).not.toBe(key);
    expect(coverageReminderKey("c", 1, "u", 2, 7)).not.toBe(key);
  });
});
