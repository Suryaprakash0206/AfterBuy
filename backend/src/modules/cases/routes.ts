import { Router } from "express";
import { z } from "zod";
import {
  caseSchema,
  caseEventSchema,
  idSchema,
} from "../../../../shared/domain.js";
import { result, eventFields } from "../../lib/db.js";
import { editAccess } from "../../lib/auth.js";
import { getProduct } from "../products/repository.js";
import {
  buildPackage,
  packageSchema,
  renderPackagePdf,
  renderPackageZip,
} from "./service.js";
export const caseRoutes = Router({ mergeParams: true });
caseRoutes.get("/cases", async (req, res) =>
  res.json(
    await result(
      req.db
        .from("service_cases")
        .select("*,product:products(id,name)")
        .eq("workspace_id", req.workspaceId)
        .order("updated_at", { ascending: false })
        .limit(500),
    ),
  ),
);
caseRoutes.post("/cases", editAccess, async (req, res) => {
  const b = caseSchema.parse(req.body);
  await getProduct(req.db, req.workspaceId, b.product_id);
  res.status(201).json(
    await result(
      req.db
        .from("service_cases")
        .insert({ ...b, workspace_id: req.workspaceId })
        .select()
        .single(),
    ),
  );
});
caseRoutes.get("/cases/:id", async (req, res) => {
  const c = await result(
    req.db
      .from("service_cases")
      .select("*")
      .eq("workspace_id", req.workspaceId)
      .eq("id", idSchema.parse(req.params.id))
      .single(),
  );
  res.json({
    ...c,
    product: await getProduct(req.db, req.workspaceId, c.product_id),
    events: await result(
      req.db
        .from("case_events")
        .select(eventFields)
        .eq("workspace_id", req.workspaceId)
        .eq("case_id", c.id)
        .order("occurred_on")
        .order("created_at"),
    ),
  });
});
caseRoutes.patch("/cases/:id", editAccess, async (req, res) => {
  const b = z
    .object({
      support_contact: z.string().max(1000).nullable(),
      reference: z.string().max(1000).nullable(),
    })
    .strict()
    .parse(req.body);
  res.json(
    await result(
      req.db
        .from("service_cases")
        .update(b)
        .eq("workspace_id", req.workspaceId)
        .eq("id", idSchema.parse(req.params.id))
        .select()
        .single(),
    ),
  );
});
caseRoutes.post("/cases/:id/events", editAccess, async (req, res) =>
  res.status(201).json({
    id: await result(
      req.db.rpc("add_case_event", {
        w: req.workspaceId,
        p_case: idSchema.parse(req.params.id),
        p_event: caseEventSchema.parse(req.body),
      }),
    ),
  }),
);
caseRoutes.post("/cases/:id/package/preview", async (req, res) =>
  res.json(
    await buildPackage(
      req.db,
      req.workspaceId,
      idSchema.parse(req.params.id),
      packageSchema.parse(req.body),
    ),
  ),
);
caseRoutes.post("/cases/:id/package/export", async (req, res) => {
  const b = packageSchema
    .extend({ format: z.enum(["pdf", "zip"]) })
    .parse(req.body);
  const pkg = await buildPackage(
    req.db,
    req.workspaceId,
    idSchema.parse(req.params.id),
    b,
  );
  const pdf = await renderPackagePdf(pkg);
  if (b.format === "pdf") {
    res
      .type("pdf")
      .attachment("afterbuy-support-summary.pdf")
      .send(Buffer.from(pdf));
  } else {
    const zip = await renderPackageZip(req.db, pkg, pdf);
    res
      .type("application/zip")
      .attachment("afterbuy-support-package.zip")
      .send(zip);
  }
});
