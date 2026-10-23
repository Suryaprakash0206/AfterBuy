import { config } from "../../config.js";
import { adminClient, result } from "../../lib/db.js";
import { OpenAIProvider } from "../ai/provider.js";
import { inspectFile, pdfPages, chunkPages } from "./service.js";
export async function indexDocument(documentId: string) {
  const db = adminClient();
  const d = await result(
    db.from("documents").select("*").eq("id", documentId).maybeSingle(),
  );
  if (!d || !["completed", "needs_review"].includes(d.status)) return;
  const member = await result(
    db
      .from("memberships")
      .select("role")
      .eq("workspace_id", d.workspace_id)
      .eq("user_id", d.uploaded_by)
      .maybeSingle(),
  );
  if (!member || member.role === "viewer") return;
  if (!config.OPENAI_API_KEY || !config.OPENAI_EMBEDDING_MODEL) {
    await result(
      db
        .from("documents")
        .update({ index_status: "unavailable" })
        .eq("id", d.id),
    );
    return;
  }
  const claimed = await result(
    db
      .from("documents")
      .update({
        index_status: "processing",
        index_started_at: new Date().toISOString(),
      })
      .eq("id", d.id)
      .in("index_status", ["pending", "failed"])
      .in("status", ["completed", "needs_review"])
      .select("id")
      .maybeSingle(),
  );
  if (!claimed) return;
  try {
    let chunks = await result(
      db
        .from("document_chunks")
        .select("id,content")
        .eq("workspace_id", d.workspace_id)
        .eq("document_id", d.id)
        .order("ordinal")
        .limit(1000),
    );
    const ai = new OpenAIProvider();
    // Manual confirmation may precede extraction. Build retrieval text without
    // re-extracting or changing any user-confirmed purchase information.
    if (!chunks.length) {
      const { data, error } = await db.storage
        .from("documents")
        .download(d.storage_path);
      if (error || !data) throw new Error("STORAGE_READ_FAILED");
      const bytes = Buffer.from(await data.arrayBuffer());
      const inspected = await inspectFile(bytes, d.mime);
      if (inspected.hash !== d.sha256) throw new Error("HASH_MISMATCH");
      let pages = d.mime === "application/pdf" ? await pdfPages(bytes) : [];
      if (!pages.length || pages.some((p) => p.text.trim().length < 40)) {
        await result(
          db.rpc("reserve_ai_usage", {
            w: d.workspace_id,
            p_user: d.uploaded_by,
            p_operation: "vision_index",
            p_units: d.page_count * 2000 + config.AI_MAX_OUTPUT_TOKENS,
            p_daily_limit: config.AI_DAILY_UNITS,
          }),
        );
        pages = await ai.transcribe(bytes, d.mime);
        if (
          pages.length !== d.page_count ||
          pages.some((p, i) => p.page !== i + 1)
        )
          throw new Error("INCOMPLETE_PAGES");
      }
      if (
        pages.reduce((n, p) => n + p.text.length, 0) > config.AI_MAX_INPUT_CHARS
      )
        throw new Error("DOCUMENT_TOO_LONG");
      const created = chunkPages(pages);
      if (!created.length) throw new Error("NO_TEXT");
      chunks = await result(
        db
          .from("document_chunks")
          .insert(
            created.map((c) => ({
              ...c,
              workspace_id: d.workspace_id,
              document_id: d.id,
            })),
          )
          .select("id,content"),
      );
    }
    await result(
      db.rpc("reserve_ai_usage", {
        w: d.workspace_id,
        p_user: d.uploaded_by,
        p_operation: "reindex",
        p_units: chunks.reduce((n, c) => n + c.content.length, 0),
        p_daily_limit: config.AI_DAILY_UNITS,
      }),
    );
    for (let i = 0; i < chunks.length; i += 32) {
      const batch = chunks.slice(i, i + 32);
      const embeddings = await ai.embed(batch.map((c) => c.content));
      for (let j = 0; j < batch.length; j++)
        await result(
          db
            .from("document_chunks")
            .update({
              embedding: JSON.stringify(embeddings[j]),
              embedding_model: config.OPENAI_EMBEDDING_MODEL,
            })
            .eq("id", batch[j].id)
            .eq("workspace_id", d.workspace_id),
        );
    }
    await result(
      db.from("documents").update({ index_status: "ready" }).eq("id", d.id),
    );
  } catch (e) {
    await result(
      db.from("documents").update({ index_status: "failed" }).eq("id", d.id),
    );
    throw e;
  }
}
