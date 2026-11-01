import type { SupabaseClient } from "@supabase/supabase-js";
import { result } from "../../lib/db.js";
import { logger } from "../../lib/logger.js";

export async function purgeDeletedDocument(
  db: SupabaseClient,
  workspace: string,
  id: string,
) {
  const deleting = await result(
    db
      .from("documents")
      .select("id,storage_path")
      .eq("workspace_id", workspace)
      .eq("id", id)
      .eq("status", "deleting")
      .maybeSingle(),
  );
  if (!deleting) return;
  const { error } = await db.storage
    .from("documents")
    .remove([deleting.storage_path]);
  if (error) throw new Error("Document storage cleanup failed");
  await result(
    db
      .from("documents")
      .delete()
      .eq("workspace_id", workspace)
      .eq("id", id)
      .eq("status", "deleting"),
  );
}

export async function cleanupPendingDocuments(db: SupabaseClient) {
  const pending = await result(
    db
      .from("documents")
      .select("id,workspace_id")
      .eq("status", "deleting")
      .order("created_at")
      .limit(50),
  );
  for (const document of pending) {
    try {
      await purgeDeletedDocument(db, document.workspace_id, document.id);
    } catch {
      logger.warn(
        { documentId: document.id, code: "DOCUMENT_CLEANUP_DEFERRED" },
        "Document deletion will be retried",
      );
    }
  }
}
