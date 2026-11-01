import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { adminClient, result } from "../../lib/db.js";
import { AppError } from "../../lib/errors.js";
import { purgeDeletedDocument } from "./deletion.js";

// A deleted file's hash remains reserved until its private object is removed.
// Finish that already-requested deletion before registering a new upload.
export async function registerUpload(
  db: SupabaseClient,
  params: {
    w: string;
    p_name: string;
    p_mime: string;
    p_size: number;
    p_pages: number;
    p_hash: string;
    p_kind: string;
    p_product: string | null;
  },
  privileged: () => SupabaseClient = adminClient,
) {
  const register = () =>
    result(db.rpc("register_document", { ...params, p_id: randomUUID() }));
  const registered = await register();
  const previous = registered.document;
  if (previous?.status !== "deleting") return registered;
  if (previous.workspace_id !== params.w)
    throw new AppError(403, "FORBIDDEN", "Document workspace does not match.");
  try {
    await purgeDeletedDocument(privileged(), params.w, previous.id);
  } catch {
    throw new AppError(
      409,
      "DOCUMENT_DELETION_PENDING",
      "The previous copy of this file is still being deleted. Try uploading again shortly. If this continues, check the document cleanup service.",
    );
  }
  const replacement = await register();
  if (replacement.document?.status === "deleting")
    throw new AppError(
      409,
      "DOCUMENT_DELETION_PENDING",
      "The previous copy is being deleted. Please retry the upload shortly.",
    );
  return replacement;
}
