import { useState } from "react";
import { z } from "zod";
import { Bell, Check, Clock3, Plus } from "lucide-react";
import { Link } from "react-router-dom";
import { dateSchema, todayIn, addDays } from "../../../shared/domain";
import { useApp, useWorkspaceApi, useWorkspaceQuery } from "../lib/context";
import { date } from "../lib/api";
import {
  Button,
  PageHeader,
  QueryState,
  Empty,
  Status,
  Modal,
  RecordForm,
  ErrorNotice,
  ConfirmButton,
} from "../components/ui";
export function Notifications() {
  const q = useWorkspaceQuery("/notifications", { poll: 15000 });
  const { refresh, toast, me } = useApp();
  const call = useWorkspaceApi();
  const [error, setError] = useState<unknown>();
  const [filter, setFilter] = useState("all");
  const d = q.data;
  const now = new Date();
  const items = d?.notifications.filter(
    (n: any) =>
      (filter !== "unread" || !n.read_at) &&
      (!n.snoozed_until || new Date(n.snoozed_until) <= now),
  );
  async function update(id: string, body: any) {
    try {
      await call(`/notifications/${id}`, { method: "PATCH", body });
      refresh();
    } catch (e) {
      setError(e);
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="THE RIGHT NUDGE, AT THE RIGHT TIME"
        title="Notifications"
        description={`Your reminders, delivered in ${me.profile.timezone}.`}
        action={
          <Link className="btn btn-secondary" to="/settings">
            Reminder preferences
          </Link>
        }
      />
      <div className="filter-tabs">
        {["all", "unread"].map((v) => (
          <button
            aria-pressed={filter === v}
            key={v}
            onClick={() => setFilter(v)}
          >
            {v === "all" ? "All notifications" : "Unread"}
          </button>
        ))}
      </div>
      <ErrorNotice error={error} />
      <QueryState query={q}>
        {d && (
          <>
            <section>
              {items.length ? (
                items.map((n: any) => (
                  <article
                    className={`notification ${n.read_at ? "read" : ""}`}
                    key={n.id}
                  >
                    <span className="row-icon">
                      <Bell size={18} />
                    </span>
                    <div className="row-body">
                      <strong>{n.title}</strong>
                      <small>
                        {date(n.created_at)} · {n.read_at ? "Read" : "Unread"}
                      </small>
                    </div>
                    <div className="actions">
                      <Button
                        variant="ghost"
                        onClick={() => update(n.id, { read: !n.read_at })}
                      >
                        <Check size={15} />
                        {n.read_at ? "Mark unread" : "Mark read"}
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={async () => {
                          await update(n.id, {
                            snooze_until: new Date(
                              Date.now() + 24 * 3600000,
                            ).toISOString(),
                          });
                          toast("Snoozed for 24 hours.");
                        }}
                      >
                        <Clock3 size={15} />
                        Snooze
                      </Button>
                    </div>
                  </article>
                ))
              ) : (
                <Empty
                  icon={<Bell size={28} />}
                  title="A quiet moment."
                  description="Delivered reminders will appear here. A queued job is not counted as a delivered notification."
                />
              )}
            </section>
            <section className="section-panel mt-6">
              <div className="section-heading">
                <h2>Scheduled reminders</h2>
                <Clock3 size={19} />
              </div>
              {d.reminders.filter((r: any) => r.status === "scheduled")
                .length ? (
                d.reminders
                  .filter((r: any) => r.status === "scheduled")
                  .map((r: any) => (
                    <div className="row-link" key={r.id}>
                      <div className="row-body">
                        <strong>{r.title}</strong>
                        <small>
                          {new Intl.DateTimeFormat("en", {
                            dateStyle: "medium",
                            timeStyle: "short",
                            timeZone: me.profile.timezone,
                          }).format(new Date(r.due_at))}
                        </small>
                      </div>
                      <Status>{r.kind}</Status>
                      <ConfirmButton
                        title="Cancel this reminder?"
                        description="This reminder will no longer be delivered."
                        onConfirm={async () => {
                          await call(`/reminders/${r.id}`, {
                            method: "DELETE",
                          });
                          refresh();
                          toast("Reminder cancelled.");
                        }}
                      >
                        Cancel
                      </ConfirmButton>
                    </div>
                  ))
              ) : (
                <div className="panel-content muted">
                  No upcoming reminders. Add confirmed coverage or a maintenance
                  schedule from a product.
                </div>
              )}
            </section>
            {d.deliveries.length > 0 && (
              <details className="mt-6">
                <summary>Delivery history</summary>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Channel</th>
                        <th>State</th>
                        <th>Attempts</th>
                        <th>Details</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.deliveries.map((v: any) => (
                        <tr key={v.id}>
                          <td>{v.channel.replaceAll("_", " ")}</td>
                          <td>
                            <Status>{v.state}</Status>
                          </td>
                          <td>{v.attempts}</td>
                          <td>{v.error_code || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="muted">
                  Email “accepted” means the provider accepted it. Inbox
                  delivery is not asserted.
                </p>
              </details>
            )}
          </>
        )}
      </QueryState>
    </>
  );
}
export function ReminderDialog({
  productId,
  caseId,
  open,
  onOpenChange,
}: {
  productId: string;
  caseId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const call = useWorkspaceApi();
  const { me, refresh, toast } = useApp();
  return (
    <Modal
      title={caseId ? "Set a follow-up" : "Add a maintenance reminder"}
      description="Choose a schedule you have checked. Reminders are scheduled for 9:00 AM in your account timezone."
      open={open}
      onOpenChange={onOpenChange}
    >
      <RecordForm
        schema={z.object({
          title: z.string().min(1).max(200),
          date: dateSchema,
          repeat_months: z.number().int().min(1).max(120).nullable(),
        })}
        fields={[
          { name: "title", label: "Reminder", full: true },
          { name: "date", label: "Next reminder date", type: "date" },
          {
            name: "repeat_months",
            label: "Repeat every N months",
            type: "number",
            nullable: true,
            hint: "Leave blank for a one-time reminder.",
          },
        ]}
        values={{
          title: caseId ? "Follow up on service case" : "",
          date: addDays(todayIn(me.profile.timezone), 7),
          repeat_months: null,
        }}
        onSubmit={async (v) => {
          await call("/reminders", {
            method: "POST",
            body: {
              ...v,
              product_id: productId,
              case_id: caseId ?? null,
              kind: caseId ? "follow_up" : "maintenance",
            },
          });
          refresh();
          toast("Confirmed reminder schedule saved.");
          onOpenChange(false);
        }}
        submitLabel="Save confirmed reminder"
      >
        <p className="quiet-note">
          <Plus size={15} />
          Only save a recurring schedule you have checked.
        </p>
      </RecordForm>
    </Modal>
  );
}
