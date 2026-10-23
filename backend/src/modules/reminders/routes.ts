import { Router } from "express";
import { z } from "zod";
import {
  idSchema,
  dateSchema,
  reminderInstant,
} from "../../../../shared/domain.js";
import { result } from "../../lib/db.js";
export const reminderRoutes = Router({ mergeParams: true });
reminderRoutes.get("/notifications", async (req, res) => {
  const [notifications, reminders, deliveries] = await Promise.all([
    result(
      req.db
        .from("notifications")
        .select("*")
        .eq("workspace_id", req.workspaceId)
        .eq("user_id", req.userId)
        .order("created_at", { ascending: false })
        .limit(200),
    ),
    result(
      req.db
        .from("reminders")
        .select("*")
        .eq("workspace_id", req.workspaceId)
        .eq("user_id", req.userId)
        .order("due_at")
        .limit(500),
    ),
    result(
      req.db
        .from("deliveries")
        .select("*")
        .eq("workspace_id", req.workspaceId)
        .eq("user_id", req.userId)
        .order("updated_at", { ascending: false })
        .limit(200),
    ),
  ]);
  res.json({ notifications, reminders, deliveries });
});
reminderRoutes.patch("/notifications/:id", async (req, res) => {
  const b = z
    .object({
      read: z.boolean().optional(),
      snooze_until: z.iso.datetime().nullable().optional(),
    })
    .strict()
    .parse(req.body);
  const change = {
    ...(b.read !== undefined
      ? { read_at: b.read ? new Date().toISOString() : null }
      : {}),
    ...(b.snooze_until !== undefined ? { snoozed_until: b.snooze_until } : {}),
  };
  res.json(
    await result(
      req.db
        .from("notifications")
        .update(change)
        .eq("workspace_id", req.workspaceId)
        .eq("user_id", req.userId)
        .eq("id", idSchema.parse(req.params.id))
        .select()
        .single(),
    ),
  );
});
reminderRoutes.post("/reminders", async (req, res) => {
  const b = z
    .object({
      product_id: idSchema,
      case_id: idSchema.nullable().default(null),
      kind: z.enum(["maintenance", "follow_up"]),
      title: z.string().trim().min(1).max(200),
      date: dateSchema,
      repeat_months: z.number().int().min(1).max(120).nullable().default(null),
    })
    .parse(req.body);
  const profile = await result(
    req.db.from("profiles").select("timezone").eq("id", req.userId).single(),
  );
  res.status(201).json({
    id: await result(
      req.db.rpc("create_reminder", {
        w: req.workspaceId,
        p_product: b.product_id,
        p_case: b.case_id,
        p_kind: b.kind,
        p_title: b.title,
        p_due: reminderInstant(b.date, 0, profile.timezone),
        p_repeat: b.repeat_months,
      }),
    ),
  });
});
reminderRoutes.delete("/reminders/:id", async (req, res) => {
  await result(
    req.db.rpc("cancel_reminder", {
      w: req.workspaceId,
      p_id: idSchema.parse(req.params.id),
    }),
  );
  res.json({ ok: true });
});
