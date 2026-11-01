import { Queue } from "bullmq";
import { capabilities, config } from "../../config.js";
import { redisConnection } from "../../lib/queues.js";
import { logger } from "../../lib/logger.js";

let queue: Queue | undefined;
function documentQueue() {
  if (!queue) {
    queue = new Queue("afterbuy-documents", {
      connection: {
        ...redisConnection(),
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        connectTimeout: 1500,
      },
      defaultJobOptions: {
        attempts: 4,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: true,
        removeOnFail: true,
      },
    });
    // A queue outage must not lose an uploaded document. PostgreSQL's queued
    // record is recovered by the worker when the connection returns.
    queue.on("error", () => {});
  }
  return queue;
}
async function bounded<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("QUEUE_TIMEOUT")), 2000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function enqueueDocument(documentId: string) {
  if (!capabilities().extraction) return;
  if (config.DOCUMENT_PROCESSING_MODE === "inline") {
    const { enqueueInline } = await import("./inline.js");
    enqueueInline(documentId);
    return;
  }
  try {
    const q = documentQueue();
    await bounded(q.waitUntilReady());
    await bounded(
      q.add("process", { documentId }, { jobId: `document-${documentId}` }),
    );
  } catch {
    logger.warn(
      { documentId, code: "SCAN_DISPATCH_DEFERRED" },
      "Document saved; recovery worker will retry scan dispatch",
    );
  }
}

export type ScannerStatus = {
  configured: boolean;
  available: boolean;
  reason: "configuration" | "queue" | "worker" | null;
};
let cached: { expires: number; value: ScannerStatus } | undefined;
let checking: Promise<ScannerStatus> | undefined;
export async function scannerStatus(): Promise<ScannerStatus> {
  if (!capabilities().extraction)
    return { configured: false, available: false, reason: "configuration" };
  if (config.DOCUMENT_PROCESSING_MODE === "inline") {
    const { inlineScannerAvailable } = await import("./inline.js");
    const available = inlineScannerAvailable();
    return { configured: true, available, reason: available ? null : "worker" };
  }
  if (cached && cached.expires > Date.now()) return cached.value;
  if (checking) return checking;
  checking = (async () => {
    let value: ScannerStatus;
    try {
      const q = documentQueue();
      await bounded(q.waitUntilReady());
      const workers = await bounded(q.getWorkers());
      value = {
        configured: true,
        available: workers.length > 0,
        reason: workers.length ? null : "worker",
      };
    } catch {
      value = { configured: true, available: false, reason: "queue" };
    }
    cached = { value, expires: Date.now() + 5000 };
    return value;
  })();
  try {
    return await checking;
  } finally {
    checking = undefined;
  }
}
