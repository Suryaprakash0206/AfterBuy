import { adminClient, result } from "../../lib/db.js";
import { config, capabilities } from "../../config.js";
import { reminderInstant } from "../../../../shared/domain.js";
export function coverageReminderKey(
  coverageId: string,
  revision: number,
  userId: string,
  profileRevision: number,
  offset: number,
) {
  return `coverage-${coverageId}-${revision}-${userId}-${profileRevision}-${offset}`;
}
export async function reconcileCoverage() {
  const db = adminClient();
  for (let offset = 0; ; offset += 500) {
    const rows = await result(
      db
        .from("coverage")
        .select("*,product:products!inner(name,archived_at)")
        .eq("confirmed", true)
        .is("product.archived_at", null)
        .order("id")
        .range(offset, offset + 499),
    );
    for (const c of rows) {
      const members = await result(
        db
          .from("memberships")
          .select("user_id")
          .eq("workspace_id", c.workspace_id),
      );
      for (const member of members) {
        const profile = await result(
          db.from("profiles").select("*").eq("id", member.user_id).single(),
        );
        if (!profile.reminders_enabled) continue;
        for (const days of profile.reminder_days) {
          const due = reminderInstant(c.end_date, days, profile.timezone);
          await result(
            db.from("reminders").upsert(
              {
                workspace_id: c.workspace_id,
                user_id: member.user_id,
                product_id: c.product_id,
                coverage_id: c.id,
                kind: "coverage",
                title: `${c.product.name}: ${c.kind === "return" ? "return window" : "recorded coverage"} ends ${c.end_date}`,
                due_at: due,
                source_key: coverageReminderKey(
                  c.id,
                  c.revision,
                  member.user_id,
                  profile.revision,
                  days,
                ),
                source_revision: `${c.revision}-${profile.revision}`,
              },
              { onConflict: "source_key", ignoreDuplicates: true },
            ),
          );
        }
      }
    }
    if (rows.length < 500) break;
  }
}
export async function deliverReminder(id: string) {
  const db = adminClient();
  await result(db.rpc("deliver_reminder", { p_id: id }));
  const r = await result(
    db.from("reminders").select("*").eq("id", id).maybeSingle(),
  );
  if (!r || r.status !== "delivered") return;
  await deliverEmail(r.id);
}
export async function deliverEmail(reminderId: string) {
  const db = adminClient();
  const delivery = await result(
    db
      .from("deliveries")
      .select("*")
      .eq("reminder_id", reminderId)
      .eq("channel", "email")
      .maybeSingle(),
  );
  if (
    !delivery ||
    !["pending", "failed"].includes(delivery.state) ||
    delivery.attempts >= 4
  )
    return;
  const profile = await result(
    db
      .from("profiles")
      .select("email_enabled,reminders_enabled")
      .eq("id", delivery.user_id)
      .single(),
  );
  if (
    !profile.email_enabled ||
    !profile.reminders_enabled ||
    !capabilities().email
  ) {
    await result(
      db
        .from("deliveries")
        .update({
          state: "disabled",
          error_code: capabilities().email ? null : "EMAIL_NOT_CONFIGURED",
        })
        .eq("id", delivery.id),
    );
    return;
  }
  const { data, error } = await db.auth.admin.getUserById(delivery.user_id);
  if (error || !data.user.email) throw new Error("EMAIL_RECIPIENT_UNAVAILABLE");
  const reminder = await result(
    db.from("reminders").select("title,status").eq("id", reminderId).single(),
  );
  if (reminder.status !== "delivered") return;
  // Fixed provider URL, no user-supplied URLs. Resend deduplicates accepted sends via the idempotency key.
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `afterbuy-${delivery.id}`,
      },
      body: JSON.stringify({
        from: config.EMAIL_FROM,
        to: [data.user.email],
        subject: "AfterBuy reminder",
        text: `${reminder.title}\n\nOpen AfterBuy to review your records.`,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error("EMAIL_PROVIDER_FAILED");
    const body = (await response.json()) as { id: string };
    await result(
      db
        .from("deliveries")
        .update({
          state: "accepted",
          provider_id: body.id,
          attempts: delivery.attempts + 1,
          updated_at: new Date().toISOString(),
          error_code: null,
        })
        .eq("id", delivery.id),
    );
  } catch {
    await result(
      db
        .from("deliveries")
        .update({
          state: "failed",
          attempts: delivery.attempts + 1,
          error_code: "EMAIL_PROVIDER_FAILED",
          updated_at: new Date().toISOString(),
        })
        .eq("id", delivery.id),
    );
    throw new Error("EMAIL_PROVIDER_FAILED");
  }
}
