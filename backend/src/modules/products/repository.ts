import type { SupabaseClient } from "@supabase/supabase-js";
import { result, productFields } from "../../lib/db.js";
export const getProduct = (db: SupabaseClient, w: string, id: string) =>
  result(
    db
      .from("products")
      .select(productFields)
      .eq("workspace_id", w)
      .eq("id", id)
      .single(),
  );
export async function productRelations(
  db: SupabaseClient,
  w: string,
  id: string,
) {
  const [documents, coverage, cases, timeline] = await Promise.all([
    result(
      db
        .from("document_links")
        .select("document:documents(*)")
        .eq("workspace_id", w)
        .eq("product_id", id),
    ),
    result(
      db
        .from("coverage")
        .select("*")
        .eq("workspace_id", w)
        .eq("product_id", id)
        .order("end_date"),
    ),
    result(
      db
        .from("service_cases")
        .select("*")
        .eq("workspace_id", w)
        .eq("product_id", id)
        .order("created_at", { ascending: false }),
    ),
    result(
      db
        .from("lifecycle_events")
        .select("*")
        .eq("workspace_id", w)
        .eq("product_id", id)
        .order("occurred_at", { ascending: false })
        .limit(200),
    ),
  ]);
  return {
    documents: documents.map((x) => x.document),
    coverage,
    cases,
    timeline,
  };
}
