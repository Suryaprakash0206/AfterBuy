import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { profileSchema } from "../../../shared/domain";
import { api } from "../lib/api";
import { useApp } from "../lib/context";
import { PageHeader, RecordForm, Notice, Status } from "../components/ui";
export function Settings() {
  const { me, refresh, toast } = useApp();
  const config = useQuery({
    queryKey: ["config"],
    queryFn: () => api("/config"),
  });
  const schema = profileSchema.omit({ reminder_days: true }).extend({
    reminder_days: z
      .string()
      .transform((s) => s.split(",").map((x) => Number(x.trim())))
      .pipe(z.array(z.number().int().min(0).max(365)).max(8)),
  });
  return (
    <>
      <PageHeader
        eyebrow="MAKE YOURSELF AT HOME"
        title="Account & preferences"
        description="A few details that make AfterBuy work for you."
      />
      <div className="settings-layout">
        <section className="form-panel">
          <RecordForm
            schema={schema}
            fields={[
              { name: "display_name", label: "Your name", full: true },
              {
                name: "currency",
                label: "Default currency",
                hint: "Three-letter code, such as INR, USD or EUR.",
              },
              {
                name: "timezone",
                label: "Timezone",
                hint: "IANA timezone, such as Asia/Kolkata or Europe/London.",
              },
              {
                name: "reminder_days",
                label: "Days before a deadline",
                full: true,
                hint: "Comma-separated days, for example 30, 7, 1.",
              },
              {
                name: "reminders_enabled",
                label: "Enable reminders",
                type: "checkbox",
                full: true,
              },
              {
                name: "email_enabled",
                label: "Also request optional email reminders",
                type: "checkbox",
                full: true,
                hint: "Requires a configured email provider. Actual delivery state appears in Notifications.",
              },
            ]}
            values={{
              display_name: me.profile.display_name,
              currency: me.profile.currency,
              timezone: me.profile.timezone,
              reminder_days: me.profile.reminder_days.join(", "),
              reminders_enabled: me.profile.reminders_enabled,
              email_enabled: me.profile.email_enabled,
            }}
            onSubmit={async (values) => {
              await api("/me", { method: "PATCH", body: values });
              refresh();
              toast(
                "Preferences saved. Future coverage reminders will be recalculated.",
              );
            }}
          />
        </section>
        <aside>
          <section className="section-panel">
            <div className="section-heading">
              <h2>Connected services</h2>
            </div>
            <div className="panel-content">
              {[
                ["database", "Supabase"],
                ["extraction", "Document extraction"],
                ["assistant", "Document assistant"],
                ["email", "Email adapter"],
              ].map(([key, label]) => (
                <div className="service-status" key={key}>
                  <span>{label}</span>
                  <Status>
                    {config.isPending
                      ? "Checking"
                      : config.data?.[key]
                        ? "Configured"
                        : "Not configured"}
                  </Status>
                </div>
              ))}
              <p className="muted">
                Configuration does not confirm provider availability. Upload and
                delivery records show actual outcomes.
              </p>
            </div>
          </section>
          <Notice>
            Purchases in different currencies stay separate. Changing your
            preferred currency does not convert existing amounts.
          </Notice>
        </aside>
      </div>
    </>
  );
}
