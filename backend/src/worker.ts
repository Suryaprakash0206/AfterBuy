import { Worker } from "bullmq";
import { config } from "./config.js";
import { adminClient, result } from "./lib/db.js";
import { createQueues, redisConnection } from "./lib/queues.js";
import { logger } from "./lib/logger.js";
import { processDocument } from "./modules/documents/processor.js";
import { indexDocument } from "./modules/documents/indexer.js";
import {
  reconcileCoverage,
  deliverReminder,
} from "./modules/reminders/service.js";
const db = adminClient();
const queues = createQueues();
const connection = redisConnection();
const workers = [
  new Worker(
    "afterbuy-documents",
    (job) =>
      job.name === "index"
        ? indexDocument(job.data.documentId)
        : processDocument(job.data.documentId),
    { connection, concurrency: config.WORKER_CONCURRENCY },
  ),
  new Worker(
    "afterbuy-reminders",
    (job) => deliverReminder(job.data.reminderId),
    { connection, concurrency: config.WORKER_CONCURRENCY },
  ),
];
for (const worker of workers) {
  worker.on("error", () =>
    logger.error({ worker: worker.name }, "Worker connection error"),
  );
  worker.on("failed", (job) =>
    logger.warn({ worker: worker.name, jobId: job?.id }, "Job attempt failed"),
  );
}
for (const queue of Object.values(queues))
  queue.on("error", () =>
    logger.warn({ queue: queue.name }, "Queue unavailable"),
  );
let scanning = false;
async function scan() {
  if (scanning) return;
  scanning = true;
  try {
    await result(
      db
        .from("documents")
        .update({ status: "queued", processing_started_at: null })
        .eq("status", "processing")
        .lt(
          "processing_started_at",
          new Date(Date.now() - 15 * 60000).toISOString(),
        ),
    );
    const docs = await result(
      db
        .from("documents")
        .select("id")
        .eq("status", "queued")
        .eq("upload_complete", true)
        .order("created_at")
        .limit(100),
    );
    for (const d of docs)
      await queues.documents.add(
        "process",
        { documentId: d.id },
        { jobId: `document-${d.id}` },
      );
    await result(
      db
        .from("documents")
        .update({ index_status: "pending", index_started_at: null })
        .eq("index_status", "processing")
        .lt(
          "index_started_at",
          new Date(Date.now() - 15 * 60000).toISOString(),
        ),
    );
    const indexes = await result(
      db
        .from("documents")
        .select("id")
        .eq("index_status", "pending")
        .in("status", ["completed", "needs_review"])
        .limit(100),
    );
    for (const d of indexes)
      await queues.documents.add(
        "index",
        { documentId: d.id },
        { jobId: `index-${d.id}` },
      );
    const deleting = await result(
      db
        .from("documents")
        .select("id,storage_path")
        .eq("status", "deleting")
        .limit(100),
    );
    for (const d of deleting) {
      const { error } = await db.storage
        .from("documents")
        .remove([d.storage_path]);
      if (!error)
        await result(
          db.from("documents").delete().eq("id", d.id).eq("status", "deleting"),
        );
    }
    await reconcileCoverage();
    const due = await result(
      db
        .from("reminders")
        .select("id")
        .eq("status", "scheduled")
        .lte("due_at", new Date().toISOString())
        .order("due_at")
        .limit(500),
    );
    for (const r of due)
      await queues.reminders.add(
        "deliver",
        { reminderId: r.id },
        { jobId: `reminder-${r.id}` },
      );
    const emails = await result(
      db
        .from("deliveries")
        .select("reminder_id")
        .eq("channel", "email")
        .in("state", ["pending", "failed"])
        .lt("attempts", 4)
        .limit(100),
    );
    for (const e of emails)
      await queues.reminders.add(
        "deliver",
        { reminderId: e.reminder_id },
        { jobId: `reminder-${e.reminder_id}` },
      );
    logger.info(
      { documentsQueued: docs.length, remindersQueued: due.length },
      "Recovery scan completed",
    );
  } catch {
    logger.error(
      { code: "RECONCILE_FAILED" },
      "Recovery scan failed; check database migrations and Redis connectivity",
    );
  } finally {
    scanning = false;
  }
}
void scan();
const timer = setInterval(() => void scan(), 30000);
async function stop() {
  clearInterval(timer);
  await Promise.all(workers.map((w) => w.close()));
  await Promise.all(Object.values(queues).map((q) => q.close()));
  process.exit(0);
}
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
logger.info(
  "AfterBuy worker started; PostgreSQL schedules are reconciled every 30 seconds",
);
