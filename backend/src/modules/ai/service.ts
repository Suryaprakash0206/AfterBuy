import type { SupabaseClient } from "@supabase/supabase-js";
import { config } from "../../config.js";
import { adminClient, result } from "../../lib/db.js";
import { getProduct } from "../products/repository.js";
import { OpenAIProvider, type AIProvider } from "./provider.js";
import { resolveAnswer, MISSING_EVIDENCE, type Passage } from "./schemas.js";
import { AppError } from "../../lib/errors.js";
export async function askProduct(
  db: SupabaseClient,
  w: string,
  user: string,
  productId: string,
  question: string,
  provider?: AIProvider,
) {
  const product = await getProduct(db, w, productId);
  const coverage = await result(
    db
      .from("coverage")
      .select(
        "id,kind,provider,confirmed,start_date,end_date,conditions,uncertainty",
      )
      .eq("workspace_id", w)
      .eq("product_id", productId),
  );
  const historyConversation = await result(
    db
      .from("conversations")
      .select("id")
      .eq("workspace_id", w)
      .eq("product_id", productId)
      .eq("user_id", user)
      .maybeSingle(),
  );
  const history = historyConversation
    ? await result(
        db
          .from("messages")
          .select("role,content")
          .eq("workspace_id", w)
          .eq("conversation_id", historyConversation.id)
          .order("created_at", { ascending: false })
          .limit(8),
      )
    : [];
  const links = await result(
    db
      .from("document_links")
      .select("document_id,document:documents(index_status)")
      .eq("workspace_id", w)
      .eq("product_id", productId),
  );
  let answer: { answer: string; sources: Passage[] } = {
    answer: MISSING_EVIDENCE,
    sources: [],
  };
  if (links.length) {
    if (!links.some((l: any) => l.document?.index_status === "ready"))
      throw new AppError(
        409,
        "DOCUMENTS_NOT_INDEXED",
        "Your documents are not ready for questions yet. Check their processing state and indexing configuration.",
      );
    const ai = provider ?? new OpenAIProvider();
    const admin = adminClient();
    await result(
      admin.rpc("reserve_ai_usage", {
        w,
        p_user: user,
        p_operation: "chat",
        p_units: question.length + config.AI_MAX_OUTPUT_TOKENS + 20000,
        p_daily_limit: config.AI_DAILY_UNITS,
      }),
    );
    try {
      const [embedding] = await ai.embed([question]);
      const passages: Passage[] = await result(
        db.rpc("match_product_chunks", {
          w,
          p_product: productId,
          p_embedding: JSON.stringify(embedding),
          p_model: config.OPENAI_EMBEDDING_MODEL,
          p_limit: 8,
        }),
      );
      const relevant = passages.filter((p) => (p.similarity ?? 0) >= 0.2);
      if (relevant.length)
        answer = resolveAnswer(
          await ai.answer(
            question,
            relevant,
            { product, coverage },
            history.reverse(),
          ),
          relevant,
        );
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        502,
        "AI_UNAVAILABLE",
        "The document assistant is temporarily unavailable. No answer has been fabricated.",
      );
    }
  }
  // Recheck access immediately before saving an exchange after a potentially slow provider request.
  await getProduct(db, w, productId);
  const sources = answer.sources.map(({ id, document_id, page, name }) => ({
    id,
    document_id,
    page,
    name,
  }));
  await result(
    adminClient().rpc("save_assistant_exchange", {
      w,
      p_user: user,
      p_product: productId,
      p_question: question,
      p_answer: answer.answer,
      p_sources: sources,
    }),
  );
  return { ...answer, sources };
}
