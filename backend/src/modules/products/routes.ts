import { Router } from "express";
import { z } from "zod";
import { productSchema, idSchema } from "../../../../shared/domain.js";
import { editAccess } from "../../lib/auth.js";
import { result, productFields } from "../../lib/db.js";
import { getProduct, productRelations } from "./repository.js";
export const productRoutes = Router({ mergeParams: true });
productRoutes.get("/products", async (req, res) => {
  const q = z
    .object({
      search: z.string().max(120).default(""),
      category: z.string().max(80).optional(),
      sort: z.enum(["newest", "name", "purchase_date"]).default("newest"),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(12),
      archived: z.enum(["true", "false"]).default("false"),
    })
    .parse(req.query);
  let query = req.db
    .from("products")
    .select(productFields, { count: "exact" })
    .eq("workspace_id", req.workspaceId);
  query =
    q.archived === "true"
      ? query.not("archived_at", "is", null)
      : query.is("archived_at", null);
  if (q.search)
    query = query.ilike("name", `%${q.search.replace(/[%_\\]/g, "\\$&")}%`);
  if (q.category) query = query.eq("category", q.category);
  const { data, error, count } = await query
    .order(q.sort === "newest" ? "created_at" : q.sort, {
      ascending: q.sort === "name",
    })
    .range((q.page - 1) * q.limit, q.page * q.limit - 1);
  await result(Promise.resolve({ data, error }));
  res.json({ items: data, total: count, page: q.page, limit: q.limit });
});
productRoutes.post("/products", editAccess, async (req, res) =>
  res.status(201).json(
    await result(
      req.db
        .from("products")
        .insert({
          ...productSchema.parse(req.body),
          workspace_id: req.workspaceId,
        })
        .select(productFields)
        .single(),
    ),
  ),
);
productRoutes.get("/products/:id", async (req, res) => {
  const id = idSchema.parse(req.params.id);
  const product = await getProduct(req.db, req.workspaceId, id);
  res.json({
    ...product,
    ...(await productRelations(req.db, req.workspaceId, id)),
  });
});
productRoutes.patch("/products/:id", editAccess, async (req, res) =>
  res.json(
    await result(
      req.db
        .from("products")
        .update(productSchema.parse(req.body))
        .eq("workspace_id", req.workspaceId)
        .eq("id", idSchema.parse(req.params.id))
        .select(productFields)
        .single(),
    ),
  ),
);
productRoutes.post("/products/:id/archive", editAccess, async (req, res) =>
  res.json(
    await result(
      req.db
        .from("products")
        .update({
          archived_at: z.object({ archived: z.boolean() }).parse(req.body)
            .archived
            ? new Date().toISOString()
            : null,
        })
        .eq("workspace_id", req.workspaceId)
        .eq("id", idSchema.parse(req.params.id))
        .select(productFields)
        .single(),
    ),
  ),
);
productRoutes.delete("/products/:id", editAccess, async (req, res) => {
  await getProduct(req.db, req.workspaceId, idSchema.parse(req.params.id));
  await result(
    req.db
      .from("products")
      .delete()
      .eq("workspace_id", req.workspaceId)
      .eq("id", req.params.id),
  );
  res.json({ ok: true });
});
