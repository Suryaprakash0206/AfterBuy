import { beforeEach, describe, expect, it, vi } from "vitest";
const mocked = vi.hoisted(() => ({
  configured: false,
  ready: vi.fn(),
  add: vi.fn(),
  workers: vi.fn(),
  options: vi.fn(),
}));
vi.mock("../backend/src/config.js", () => ({
  config: { REDIS_URL: "redis://127.0.0.1:6379" },
  capabilities: () => ({ extraction: mocked.configured }),
}));
vi.mock("bullmq", () => ({
  Queue: class {
    constructor(_name: string, options: any) {
      mocked.options(options);
    }
    on() {}
    waitUntilReady = mocked.ready;
    add = mocked.add;
    getWorkers = mocked.workers;
  },
}));
// External Redis/BullMQ responses are explicitly mocked; no real jobs are run here.
describe("automatic dispatch and honest scanner availability", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocked.configured = true;
    mocked.ready.mockResolvedValue(undefined);
    mocked.add.mockResolvedValue({});
    mocked.workers.mockResolvedValue([{ id: "worker" }]);
  });
  it("dispatches with a stable job ID, retries and backoff", async () => {
    const { enqueueDocument } =
      await import("../backend/src/modules/documents/dispatch.js");
    await enqueueDocument("document-id");
    expect(mocked.add).toHaveBeenCalledWith(
      "process",
      { documentId: "document-id" },
      { jobId: "document-document-id" },
    );
    expect(mocked.options).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultJobOptions: expect.objectContaining({
          attempts: 4,
          backoff: { type: "exponential", delay: 5000 },
        }),
      }),
    );
  });
  it("does not pretend a scanner is running when configuration is absent", async () => {
    mocked.configured = false;
    const { enqueueDocument, scannerStatus } =
      await import("../backend/src/modules/documents/dispatch.js");
    await enqueueDocument("document-id");
    expect(mocked.add).not.toHaveBeenCalled();
    expect(await scannerStatus()).toEqual({
      configured: false,
      available: false,
      reason: "configuration",
    });
  });
  it("allows saved uploads to await recovery if Redis is unavailable", async () => {
    mocked.ready.mockRejectedValue(new Error("Mock Redis outage"));
    const { enqueueDocument, scannerStatus } =
      await import("../backend/src/modules/documents/dispatch.js");
    await expect(enqueueDocument("document-id")).resolves.toBeUndefined();
    expect(await scannerStatus()).toEqual({
      configured: true,
      available: false,
      reason: "queue",
    });
  });
  it("distinguishes a running queue from an actual connected worker", async () => {
    mocked.workers.mockResolvedValue([]);
    const { scannerStatus } =
      await import("../backend/src/modules/documents/dispatch.js");
    expect(await scannerStatus()).toEqual({
      configured: true,
      available: false,
      reason: "worker",
    });
  });
});
