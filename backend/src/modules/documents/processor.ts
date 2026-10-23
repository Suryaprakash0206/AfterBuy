import { adminClient, result } from "../../lib/db.js";
import { config } from "../../config.js";
import { AppError } from "../../lib/errors.js";
import { OpenAIProvider } from "../ai/provider.js";
import { pdfPages, chunkPages, inspectFile } from "./service.js";
export async function processDocument(documentId: string) {
  const db = adminClient();
  const d = await result(
    db.from("documents").select("*").eq("id", documentId).maybeSingle(),
  );
  if (
    !d ||
    !d.upload_complete ||
    d.status === "deleting" ||
    d.status === "completed" ||
    d.status === "needs_review"
  )
    return;
  const member = await result(
    db
      .from("memberships")
      .select("role")
      .eq("workspace_id", d.workspace_id)
      .eq("user_id", d.uploaded_by)
      .maybeSingle(),
  );
  if (!member || member.role === "viewer") {
    await result(
      db
        .from("documents")
        .update({ status: "failed", error_code: "UPLOADER_ACCESS_REVOKED" })
        .eq("id", d.id),
    );
    return;
  }
  const claimed = await result(
    db
      .from("documents")
      .update({
        status: "processing",
        processing_started_at: new Date().toISOString(),
        error_code: null,
      })
      .eq("id", d.id)
      .in("status", ["queued", "failed"])
      .is("accepted_product_ids", null)
      .select("id")
      .maybeSingle(),
  );
  if (!claimed) return;
  const run = await result(
    db
      .from("extraction_runs")
      .insert({
        workspace_id: d.workspace_id,
        document_id: d.id,
        status: "processing",
        model: config.OPENAI_EXTRACTION_MODEL || null,
      })
      .select("id")
      .single(),
  );
  try {
    const { data, error } = await db.storage
      .from("documents")
      .download(d.storage_path);
    if (error)
      throw new AppError(502, "STORAGE_READ_FAILED", "Stored file unavailable");
    const bytes = Buffer.from(await data.arrayBuffer());
    const inspected = await inspectFile(bytes, d.mime);
    if (inspected.hash !== d.sha256) throw new Error("HASH_MISMATCH");
    let pages = d.mime === "application/pdf" ? await pdfPages(bytes) : [];
    let ai: OpenAIProvider | undefined;
    if (!pages.length || pages.some((p) => p.text.trim().length < 40)) {
      ai = new OpenAIProvider();
      await result(
        db.rpc("reserve_ai_usage", {
          w: d.workspace_id,
          p_user: d.uploaded_by,
          p_operation: "vision",
          p_units: d.page_count * 2000 + config.AI_MAX_OUTPUT_TOKENS,
          p_daily_limit: config.AI_DAILY_UNITS,
        }),
      );
      pages = await ai.transcribe(bytes, d.mime);
      if (
        pages.length !== d.page_count ||
        pages.some((p, i) => p.page !== i + 1)
      )
        throw new AppError(
          502,
          "INCOMPLETE_PAGES",
          "Not every page was transcribed",
        );
    }
    const text = pages.map((p) => `[Page ${p.page}]\n${p.text}`).join("\n\n");
    if (text.length > config.AI_MAX_INPUT_CHARS)
      throw new AppError(422, "DOCUMENT_TOO_LONG", "Split the document");
    const chunks = chunkPages(pages);
    await result(db.from("document_chunks").delete().eq("document_id", d.id));
    if (chunks.length)
      await result(
        db.from("document_chunks").insert(
          chunks.map((c) => ({
            ...c,
            workspace_id: d.workspace_id,
            document_id: d.id,
          })),
        ),
      );
    let extracted = null;
    if (d.kind === "invoice" || d.kind === "warranty") {
      ai ??= new OpenAIProvider();
      await result(
        db.rpc("reserve_ai_usage", {
          w: d.workspace_id,
          p_user: d.uploaded_by,
          p_operation: "extract",
          p_units: text.length + config.AI_MAX_OUTPUT_TOKENS,
          p_daily_limit: config.AI_DAILY_UNITS,
        }),
      );
      extracted = await ai.extract(text);
    }
    await result(
      db
        .from("extraction_runs")
        .update({ status: "succeeded", result: extracted })
        .eq("id", run.id),
    );
    await result(
      db
        .from("documents")
        .update({
          status: "needs_review",
          error_code: null,
          index_status:
            config.OPENAI_API_KEY && config.OPENAI_EMBEDDING_MODEL
              ? "pending"
              : "unavailable",
        })
        .eq("id", d.id)
        .eq("status", "processing")
        .is("accepted_product_ids", null),
    );
  } catch (error) {
    const code = error instanceof AppError ? error.code : "PROCESSING_FAILED";
    await result(
      db
        .from("extraction_runs")
        .update({ status: "failed", error_code: code })
        .eq("id", run.id),
    );
    await result(
      db
        .from("documents")
        .update({
          status: code === "AI_NOT_CONFIGURED" ? "needs_review" : "failed",
          error_code: code,
          index_status: "unavailable",
        })
        .eq("id", d.id)
        .eq("status", "processing"),
    );
    if (code !== "AI_NOT_CONFIGURED") throw error;
  }
}
