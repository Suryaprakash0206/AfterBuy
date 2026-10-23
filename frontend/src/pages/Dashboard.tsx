import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  Upload,
  Plus,
  Package,
  ShieldCheck,
  Wrench,
  ArrowRight,
  CalendarDays,
  Check,
  FileText,
} from "lucide-react";
import { useApp, useWorkspaceQuery } from "../lib/context";
import { date } from "../lib/api";
import {
  PageHeader,
  QueryState,
  Empty,
  Status,
  RowLink,
} from "../components/ui";
export function Dashboard() {
  const q = useWorkspaceQuery("/dashboard", { poll: 30000 });
  const { canEdit, me } = useApp();
  const d = q.data;
  return (
    <>
      <PageHeader
        eyebrow="A CLEARER PICTURE OF WHAT YOU OWN"
        title={
          me?.profile.display_name
            ? `Welcome home, ${me.profile.display_name.split(" ")[0]}.`
            : "Everything in its place."
        }
        description="Your purchases, protected and organised. Here’s what matters next."
        action={
          canEdit && (
            <Link className="btn btn-primary" to="/documents/upload">
              <Upload size={17} />
              Add a purchase
            </Link>
          )
        }
      />
      <QueryState query={q}>
        {d && (
          <>
            <div className="metrics">
              <Metric
                label="Products in your care"
                value={d.summary.products}
                icon={<Package />}
                to="/products"
              />
              <Metric
                label="Open service cases"
                value={d.summary.open_cases}
                icon={<Wrench />}
                to="/cases"
              />
              <Metric
                label="Receipts to add"
                value={d.summary.missing_receipts}
                icon={<FileText />}
                to="/products"
              />
            </div>
            <div className="dashboard-columns">
              <section className="section-panel">
                <div className="section-heading">
                  <div>
                    <span className="eyebrow">YOUR NEXT STEPS</span>
                    <h2>Needs attention</h2>
                  </div>
                  <span className="count-badge">
                    {d.review.length + d.cases.length}
                  </span>
                </div>
                {!d.review.length && !d.cases.length ? (
                  <Empty
                    icon={<Check size={27} />}
                    title="You’re all caught up."
                    description="Documents to review and active service cases will appear here."
                  />
                ) : (
                  <div>
                    {d.review.map((r: any) => (
                      <RowLink
                        key={r.id}
                        to={`/documents/${r.id}/review`}
                        title={r.name}
                        description={
                          r.status === "failed"
                            ? "Processing needs your attention"
                            : "Review purchase details"
                        }
                        trailing={<Status>{r.status}</Status>}
                      />
                    ))}
                    {d.cases.map((c: any) => (
                      <RowLink
                        key={c.id}
                        to={`/cases/${c.id}`}
                        title={c.title}
                        description="Service case"
                        icon={<Wrench size={18} />}
                        trailing={<Status>{c.status}</Status>}
                      />
                    ))}
                  </div>
                )}
                {d.summary.unconfirmed_coverage > 0 && (
                  <Link to="/coverage" className="subtle-action">
                    <ShieldCheck size={17} />
                    {d.summary.unconfirmed_coverage} coverage record
                    {d.summary.unconfirmed_coverage === 1 ? "" : "s"} to confirm
                    <ArrowRight size={16} />
                  </Link>
                )}
              </section>
              <section className="section-panel">
                <div className="section-heading">
                  <div>
                    <span className="eyebrow">THE NEXT 90 DAYS</span>
                    <h2>Upcoming deadlines</h2>
                  </div>
                  <CalendarDays size={20} />
                </div>
                {!d.deadlines.length ? (
                  <Empty
                    icon={<CalendarDays size={27} />}
                    title="Nothing on the horizon."
                    description="Confirm a return window or warranty to start keeping track of dates."
                  />
                ) : (
                  <div>
                    {d.deadlines.map((c: any) => (
                      <RowLink
                        key={c.id}
                        to={`/products/${c.product_id}?tab=coverage`}
                        title={c.product.name}
                        description={`${c.kind === "return" ? "Return window" : c.kind + " warranty"} · ${c.provider}`}
                        icon={<CalendarDays size={18} />}
                        trailing={
                          <strong className="deadline-date">
                            {date(c.end_date)}
                          </strong>
                        }
                      />
                    ))}
                  </div>
                )}
                <Link className="panel-footer" to="/coverage">
                  All coverage & deadlines <ArrowRight size={16} />
                </Link>
              </section>
            </div>
            <section className="getting-started">
              <div className="getting-icon">
                <Package size={32} />
              </div>
              <div>
                <p className="eyebrow">
                  FROM THE FIRST RECEIPT TO THE LAST REPAIR
                </p>
                <h2>Give your purchases a little aftercare.</h2>
                <p>
                  Start with a receipt. Keep the details that matter. Find them
                  when you need them.
                </p>
              </div>
              {canEdit && (
                <Link className="btn btn-secondary" to="/products/new">
                  <Plus size={16} />
                  Add manually
                </Link>
              )}
            </section>
            <div className="quiet-note">
              <ShieldCheck size={16} />
              <span>
                Only confirmed coverage creates deadline reminders. Your
                documents stay private.
              </span>
            </div>
          </>
        )}
      </QueryState>
    </>
  );
}
function Metric({
  label,
  value,
  icon,
  to,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  to: string;
}) {
  return (
    <Link className="metric" to={to}>
      <div className="metric-heading">
        <span>{label}</span>
        {icon}
      </div>
      <div className="metric-value">
        {value}
        <ArrowUpRight size={18} />
      </div>
    </Link>
  );
}
