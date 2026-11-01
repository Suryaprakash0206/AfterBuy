import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reviewValues } from "../frontend/src/lib/review-values";
import {
  clearReviewDrafts,
  readReviewDraft,
  removeReviewDraft,
  reviewDraftKey,
  writeReviewDraft,
} from "../frontend/src/lib/review-drafts";
let data: Map<string, string>;
beforeEach(() => {
  data = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size;
    },
  });
});
afterEach(() => vi.unstubAllGlobals());
const key = reviewDraftKey("user", "workspace", "document");
describe("local invoice review drafts", () => {
  it("restores edits without restoring warranty confirmation", () => {
    const values = reviewValues({
      seller: "Edited seller",
      items: [{ name: "Kettle", quantity: "1" }],
      warranties: [{ item_index: 0 }],
    });
    values.warranties[0].confirmed = true;
    expect(writeReviewDraft(key, values)).toBe(true);
    expect(readReviewDraft(key)).toMatchObject({
      seller: "Edited seller",
      warranties: [{ confirmed: false }],
    });
  });
  it("isolates accounts, workspaces and documents", () => {
    writeReviewDraft(key, reviewValues(null));
    for (const other of [
      reviewDraftKey("other", "workspace", "document"),
      reviewDraftKey("user", "other", "document"),
      reviewDraftKey("user", "workspace", "other"),
    ])
      expect(readReviewDraft(other)).toBeNull();
  });
  it("drops corrupt and expired drafts", () => {
    data.set(key, "bad json");
    expect(readReviewDraft(key)).toBeNull();
    expect(data.has(key)).toBe(false);
    data.set(
      key,
      JSON.stringify({
        version: 1,
        savedAt: Date.now() - 8 * 86400000,
        values: reviewValues(null),
      }),
    );
    expect(readReviewDraft(key)).toBeNull();
  });
  it("removes the confirmed draft and clears only review drafts at sign-out", () => {
    writeReviewDraft(key, reviewValues(null));
    removeReviewDraft(key);
    expect(readReviewDraft(key)).toBeNull();
    writeReviewDraft(key, reviewValues(null));
    data.set("afterbuy.visual-effects", "off");
    clearReviewDrafts();
    expect([...data.keys()]).toEqual(["afterbuy.visual-effects"]);
  });
  it("reports unavailable browser storage without crashing", () => {
    vi.stubGlobal("localStorage", {
      getItem() {
        throw Error("blocked");
      },
      setItem() {
        throw Error("blocked");
      },
      removeItem() {
        throw Error("blocked");
      },
    });
    expect(readReviewDraft(key)).toBeNull();
    expect(writeReviewDraft(key, reviewValues(null))).toBe(false);
    expect(() => clearReviewDrafts()).not.toThrow();
  });
});
