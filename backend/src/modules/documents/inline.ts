import { config, capabilities } from "../../config.js";
import { adminClient, result } from "../../lib/db.js";
import { logger } from "../../lib/logger.js";
import { processDocument } from "./processor.js";
import { cleanupPendingDocuments } from "./deletion.js";

const active = new Map<string, Promise<void>>();
let timer: ReturnType<typeof setInterval> | undefined;
let scanning = false;
let stopping = false;
export function inlineScannerAvailable() {
  return !!timer && !stopping;
}
export function enqueueInline(documentId: string) {
  if (
    stopping ||
    !capabilities().extraction ||
    active.has(documentId) ||
    active.size >= config.WORKER_CONCURRENCY
  )
    return;
  const task = processDocument(documentId)
    .catch(() => {
      logger.warn(
        { documentId, code: "SCAN_FAILED" },
        "Document scan failed; review its status and retry",
      );
    })
    .finally(() => active.delete(documentId));
  active.set(documentId, task);
}
async function recover() {
  if (scanning || stopping) return;
  scanning = true;
  try {
    const db = adminClient();
    await cleanupPendingDocuments(db);
    if (!capabilities().extraction) return;
    // A scan is bounded to ten minutes below; abandoned leases are recoverable.
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
    for (const doc of docs) enqueueInline(doc.id);
  } catch {
    logger.warn(
      { code: "SCAN_RECOVERY_FAILED" },
      "Cannot recover invoice scans; check database setup and service credentials",
    );
  } finally {
    scanning = false;
  }
}
export function startInlineScanner() {
  if (config.DOCUMENT_PROCESSING_MODE !== "inline" || timer) return;
  stopping = false;
  timer = setInterval(() => void recover(), 10000);
  timer.unref();
  void recover();
}
export async function stopInlineScanner() {
  stopping = true;
  if (timer) clearInterval(timer);
  timer = undefined;
  await Promise.all(active.values());
}
