import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { idSchema } from "../../../../shared/domain.js";
import { config } from "../../config.js";
import { result, productFields, adminClient } from "../../lib/db.js";
import { editAccess } from "../../lib/auth.js";
import { AppError } from "../../lib/errors.js";
import { inspectFile, safeFilename } from "./service.js";
import { reviewSchema } from "../ai/schemas.js";
import { rateLimit } from "express-rate-limit";
import { enqueueDocument, scannerStatus } from "./dispatch.js";
import { registerUpload } from "./registration.js";
import { purgeDeletedDocument } from "./deletion.js";
export const documentRoutes = Router({ mergeParams: true });
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.MAX_FILE_BYTES, files: 1, fields: 3 },
});
documentRoutes.get("/documents", async (req, res) =>
  res.json(
    await result(
      req.db
        .from("documents")
        .select("*")
        .eq("workspace_id", req.workspaceId)
        .neq("status", "deleting")
        .order("created_at", { ascending: false })
        .limit(500),
    ),
  ),
);
documentRoutes.post(
  "/documents",
  editAccess,
  rateLimit({
    windowMs: 60000,
    limit: 6,
    keyGenerator: (req) => req.userId,
    handler: (req, res) =>
      res.status(429).json({
        error: {
          code: "UPLOAD_RATE_LIMIT",
          message: "Please wait a minute before uploading more documents.",
          requestId: req.requestId,
        },
      }),
  }),
  upload.single("file"),
  async (req, res) => {
    if (!req.file)
      throw new AppError(400, "FILE_REQUIRED", "Choose a document to upload.");
    const b = z
      .object({
        kind: z
          .enum(["invoice", "warranty", "manual", "service", "photo", "other"])
          .default("invoice"),
        product_id: idSchema.optional(),
      })
      .parse(req.body);
    const inspected = await inspectFile(req.file.buffer, req.file.mimetype);
    const registered = await registerUpload(req.db, {
      w: req.workspaceId,
      p_name: safeFilename(req.file.originalname),
      p_mime: inspected.mime,
      p_size: req.file.size,
      p_pages: inspected.pages,
      p_hash: inspected.hash,
      p_kind: b.kind,
      p_product: b.product_id ?? null,
    });
    const d = registered.document;
    if (registered.duplicate && d.upload_complete) {
      if (b.product_id)
        await result(
          req.db.rpc("link_document", {
            w: req.workspaceId,
            p_document: d.id,
            p_product: b.product_id,
          }),
        );
      if (d.status === "queued") void enqueueDocument(d.id);
      res.status(200).json(registered);
      return;
    }
    if (d.uploaded_by !== req.userId)
      throw new AppError(
        409,
        "UPLOAD_IN_PROGRESS",
        "Another member is uploading this file. Try again later.",
      );
    const { error } = await req.db.storage
      .from("documents")
      .upload(d.storage_path, req.file.buffer, {
        contentType: inspected.mime,
        upsert: false,
      });
    if (error && error.message !== "The resource already exists")
      throw new AppError(
        502,
        "UPLOAD_FAILED",
        "Private storage upload failed. Retry this file to resume safely.",
      );
    await result(
      req.db.rpc("finish_upload", { w: req.workspaceId, p_id: d.id }),
    );
    void enqueueDocument(d.id);
    res.status(201).json({
      ...registered,
      document: { ...d, status: "queued", upload_complete: true },
    });
  },
);
documentRoutes.get("/documents/:id", async (req, res) => {
  const id = idSchema.parse(req.params.id);
  const document = await result(
    req.db
      .from("documents")
      .select("*")
      .eq("workspace_id", req.workspaceId)
      .eq("id", id)
      .neq("status", "deleting")
      .single(),
  );
  const extraction = await result(
    req.db
      .from("extraction_runs")
      .select("*")
      .eq("workspace_id", req.workspaceId)
      .eq("document_id", id)
      .order("created_at", { ascending: false })
      .limit(1),
  );
  res.json({
    document,
    extraction: extraction[0] ?? null,
    scanner: document.status === "completed" ? null : await scannerStatus(),
  });
});
documentRoutes.post("/documents/:id/download", async (req, res) => {
  const d = await result(
    req.db
      .from("documents")
      .select("storage_path")
      .eq("workspace_id", req.workspaceId)
      .eq("id", idSchema.parse(req.params.id))
      .neq("status", "deleting")
      .single(),
  );
  const { data, error } = await req.db.storage
    .from("documents")
    .createSignedUrl(d.storage_path, 120);
  if (error)
    throw new AppError(
      502,
      "STORAGE_ERROR",
      "Could not create a private download link.",
    );
  res.json({ url: data!.signedUrl, expires_in: 120 });
});
documentRoutes.post("/documents/:id/retry", editAccess, async (req, res) => {
  const id = idSchema.parse(req.params.id);
  await result(
    req.db.rpc("retry_document", {
      w: req.workspaceId,
      p_id: id,
    }),
  );
  void enqueueDocument(id);
  res.json({ ok: true });
});
documentRoutes.post("/documents/:id/reindex", editAccess, async (req, res) => {
  await result(
    req.db.rpc("request_reindex", {
      w: req.workspaceId,
      p_id: idSchema.parse(req.params.id),
    }),
  );
  res.json({ ok: true });
});
documentRoutes.post("/documents/:id/complete", editAccess, async (req, res) => {
  await result(
    req.db.rpc("complete_document_review", {
      w: req.workspaceId,
      p_document: idSchema.parse(req.params.id),
    }),
  );
  res.json({ ok: true });
});
documentRoutes.post("/documents/:id/confirm", editAccess, async (req, res) => {
  const b = reviewSchema.parse(req.body);
  const id = idSchema.parse(req.params.id);
  const doc = await result(
    req.db
      .from("documents")
      .select("accepted_product_ids")
      .eq("workspace_id", req.workspaceId)
      .eq("id", id)
      .single(),
  );
  if (doc.accepted_product_ids) {
    res.json({ product_ids: doc.accepted_product_ids });
    return;
  }
  let duplicates: any[] = [];
  if (b.purchase_date) {
    duplicates = await result(
      req.db
        .from("products")
        .select(productFields)
        .eq("workspace_id", req.workspaceId)
        .eq("purchase_date", b.purchase_date)
        .in(
          "name",
          b.items.map((i) => i.name),
        )
        .limit(20),
    );
  }
  if (duplicates.length && !b.duplicate_acknowledged) {
    res.status(409).json({
      error: {
        code: "POSSIBLE_DUPLICATE",
        message:
          "Products with the same name and purchase date already exist. Deleting a document keeps saved products unless you choose to delete them too. Confirm only if these are separate purchases.",
        requestId: req.requestId,
      },
      duplicates,
    });
    return;
  }
  res.json({
    product_ids: await result(
      req.db.rpc("confirm_invoice_details", {
        w: req.workspaceId,
        p_document: id,
        p_review: b,
      }),
    ),
  });
});
documentRoutes.delete("/documents/:id", editAccess, async (req, res) => {
  const id = idSchema.parse(req.params.id);
  const { delete_created_products } = z
    .object({ delete_created_products: z.boolean().default(false) })
    .strict()
    .parse(req.body ?? {});
  const document = await result(
    req.db
      .from("documents")
      .select("accepted_product_ids")
      .eq("workspace_id", req.workspaceId)
      .eq("id", id)
      .maybeSingle(),
  );
  if (!document) {
    res.json({ ok: true, status: "deleted" });
    return;
  }
  // Only the products originally created by this invoice, never arbitrary linked products.
  if (delete_created_products && document.accepted_product_ids?.length) {
    await result(
      req.db
        .from("products")
        .delete()
        .eq("workspace_id", req.workspaceId)
        .in("id", document.accepted_product_ids),
    );
  }
  await result(
    req.db.rpc("mark_document_deleting", {
      w: req.workspaceId,
      p_id: id,
    }),
  );
  try {
    await purgeDeletedDocument(adminClient(), req.workspaceId, id);
    res.json({ ok: true, status: "deleted" });
  } catch {
    res.status(202).json({ ok: true, status: "deleting" });
  }
});
