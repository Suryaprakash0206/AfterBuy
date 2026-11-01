import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const mocked = vi.hoisted(() => ({
  process: vi.fn(),
  configured: true,
  databaseAvailable: false,
  cleanup: vi.fn(),
}));
vi.mock("../backend/src/modules/documents/deletion.js", () => ({
  cleanupPendingDocuments: mocked.cleanup,
}));
vi.mock("../backend/src/config.js", () => ({
  config: { DOCUMENT_PROCESSING_MODE: "inline", WORKER_CONCURRENCY: 1 },
  capabilities: () => ({ extraction: mocked.configured }),
}));
vi.mock("../backend/src/modules/documents/processor.js", () => ({
  processDocument: mocked.process,
}));
vi.mock("../backend/src/lib/db.js", () => ({
  adminClient: () => {
    if (mocked.databaseAvailable) return {};
    throw new Error("Mock database offline");
  },
  result: vi.fn(),
}));
describe("inline document scheduling", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocked.configured = true;
    mocked.databaseAvailable = false;
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());
  it("deduplicates active scans, bounds concurrency and drains on shutdown", async () => {
    let finish!: () => void;
    mocked.process.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const scanner = await import("../backend/src/modules/documents/inline.js");
    scanner.startInlineScanner();
    expect(scanner.inlineScannerAvailable()).toBe(true);
    scanner.enqueueInline("first");
    scanner.enqueueInline("first");
    scanner.enqueueInline("second");
    expect(mocked.process).toHaveBeenCalledTimes(1);
    finish();
    await scanner.stopInlineScanner();
    expect(scanner.inlineScannerAvailable()).toBe(false);
    scanner.enqueueInline("third");
    expect(mocked.process).toHaveBeenCalledTimes(1);
  });
  it("does not run unconfigured scans", async () => {
    mocked.configured = false;
    const scanner = await import("../backend/src/modules/documents/inline.js");
    scanner.enqueueInline("doc");
    expect(mocked.process).not.toHaveBeenCalled();
  });
  it("recovers document deletions even when AI is not configured", async () => {
    mocked.configured = false;
    mocked.databaseAvailable = true;
    mocked.cleanup.mockResolvedValue(undefined);
    const scanner = await import("../backend/src/modules/documents/inline.js");
    scanner.startInlineScanner();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocked.cleanup).toHaveBeenCalledOnce();
    expect(mocked.process).not.toHaveBeenCalled();
    await scanner.stopInlineScanner();
  });
});
