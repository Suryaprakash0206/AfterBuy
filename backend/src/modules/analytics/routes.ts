import { Router } from "express";
import { result } from "../../lib/db.js";
import { todayIn, addDays } from "../../../../shared/domain.js";
export const analyticsRoutes = Router({ mergeParams: true });
analyticsRoutes.get("/analytics", async (req, res) =>
  res.json(
    await result(req.db.rpc("workspace_analytics", { w: req.workspaceId })),
  ),
);
analyticsRoutes.get("/dashboard", async (req, res) => {
  const profile = await result(
    req.db.from("profiles").select("timezone").eq("id", req.userId).single(),
  );
  const today = todayIn(profile.timezone);
  const [summary, deadlines, review, cases] = await Promise.all([
    result(req.db.rpc("workspace_analytics", { w: req.workspaceId })),
    result(
      req.db
        .from("coverage")
        .select("*,product:products!inner(id,name,archived_at)")
        .eq("workspace_id", req.workspaceId)
        .eq("confirmed", true)
        .is("product.archived_at", null)
        .gte("end_date", today)
        .lte("end_date", addDays(today, 90))
        .order("end_date")
        .limit(8),
    ),
    result(
      req.db
        .from("documents")
        .select("id,name,status,error_code")
        .eq("workspace_id", req.workspaceId)
        .in("status", ["needs_review", "failed", "queued", "processing"])
        .order("created_at", { ascending: false })
        .limit(5),
    ),
    result(
      req.db
        .from("service_cases")
        .select("id,title,status,product_id")
        .eq("workspace_id", req.workspaceId)
        .not("status", "in", "(Resolved,Rejected,Cancelled)")
        .order("updated_at", { ascending: false })
        .limit(4),
    ),
  ]);
  res.json({ summary, deadlines, review, cases, today });
});
