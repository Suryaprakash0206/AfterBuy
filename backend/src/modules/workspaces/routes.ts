import { Router } from "express";
import { z } from "zod";
import { profileSchema, idSchema } from "../../../../shared/domain.js";
import { result } from "../../lib/db.js";
import { ownerAccess } from "../../lib/auth.js";
export const accountRoutes = Router();
accountRoutes.get("/me", async (req, res) => {
  const [profile, memberships] = await Promise.all([
    result(req.db.from("profiles").select("*").eq("id", req.userId).single()),
    result(
      req.db
        .from("memberships")
        .select("role,workspace:workspaces(*)")
        .eq("user_id", req.userId),
    ),
  ]);
  res.json({ user_id: req.userId, profile, memberships });
});
accountRoutes.patch("/me", async (req, res) =>
  res.json(
    await result(
      req.db
        .from("profiles")
        .update(profileSchema.parse(req.body))
        .eq("id", req.userId)
        .select()
        .single(),
    ),
  ),
);
accountRoutes.post("/workspaces", async (req, res) => {
  const b = z
    .object({
      name: z.string().trim().min(1).max(100),
      kind: z.enum(["personal", "household"]).default("personal"),
    })
    .parse(req.body);
  res.status(201).json({
    id: await result(
      req.db.rpc("create_workspace", { p_name: b.name, p_kind: b.kind }),
    ),
  });
});
accountRoutes.post("/invitations/accept", async (req, res) =>
  res.json({
    workspace_id: await result(
      req.db.rpc("accept_invitation", {
        p_token: z
          .object({ token: z.string().regex(/^[a-f0-9]{64}$/) })
          .parse(req.body).token,
      }),
    ),
  }),
);
export const householdRoutes = Router({ mergeParams: true });
householdRoutes.get("/members", async (req, res) =>
  res.json(await result(req.db.rpc("list_members", { w: req.workspaceId }))),
);
householdRoutes.patch("/members/:id", ownerAccess, async (req, res) => {
  await result(
    req.db.rpc("manage_member", {
      w: req.workspaceId,
      p_user: idSchema.parse(req.params.id),
      p_role: z
        .object({ role: z.enum(["editor", "viewer"]).nullable() })
        .parse(req.body).role,
    }),
  );
  res.json({ ok: true });
});
householdRoutes.get("/invitations", ownerAccess, async (req, res) =>
  res.json(
    await result(
      req.db
        .from("invitations")
        .select("id,email,role,expires_at,accepted_at,revoked_at,created_at")
        .eq("workspace_id", req.workspaceId)
        .order("created_at", { ascending: false }),
    ),
  ),
);
householdRoutes.post("/invitations", ownerAccess, async (req, res) => {
  const b = z
    .object({ email: z.email(), role: z.enum(["editor", "viewer"]) })
    .parse(req.body);
  res.status(201).json({
    token: await result(
      req.db.rpc("create_invitation", {
        w: req.workspaceId,
        p_email: b.email,
        p_role: b.role,
      }),
    ),
    delivery: "manual_link",
    message:
      "Invitation created. Copy the link to share it. No email was sent.",
  });
});
householdRoutes.delete("/invitations/:id", ownerAccess, async (req, res) => {
  await result(
    req.db.rpc("revoke_invitation", {
      w: req.workspaceId,
      p_id: idSchema.parse(req.params.id),
    }),
  );
  res.json({ ok: true });
});
