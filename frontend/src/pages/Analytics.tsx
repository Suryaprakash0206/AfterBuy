import { useWorkspaceQuery } from "../lib/context";
import { money } from "../lib/api";
import { Link } from "react-router-dom";
import { ChartNoAxesCombined, ArrowUpRight } from "lucide-react";
import { PageHeader, QueryState, Empty, RowLink } from "../components/ui";
export function Analytics() {
  const q = useWorkspaceQuery("/analytics");
  const d = q.data;
  return (
    <>
      <PageHeader
        eyebrow="YOUR RECORDS, IN PERSPECTIVE"
        title="Ownership insights"
        description="A factual view of what you’ve spent, maintained and resolved."
      />
      <QueryState query={q}>
        {d && (
          <>
            <div className="metrics">
              <Link className="metric" to="/cases">
                <div className="metric-heading">
                  Open service cases
                  <ArrowUpRight size={17} />
                </div>
                <div className="metric-value">{d.open_cases}</div>
              </Link>
              <Link className="metric" to="/products">
                <div className="metric-heading">
                  Missing receipts
                  <ArrowUpRight size={17} />
                </div>
                <div className="metric-value">{d.missing_receipts}</div>
              </Link>
              <Link className="metric" to="/coverage">
                <div className="metric-heading">
                  Unconfirmed coverage
                  <ArrowUpRight size={17} />
                </div>
                <div className="metric-value">{d.unconfirmed_coverage}</div>
              </Link>
            </div>
            <div className="dashboard-columns">
              <section className="section-panel">
                <div className="section-heading">
                  <h2>Recorded purchase expenditure</h2>
                  <ChartNoAxesCombined size={21} />
                </div>
                {d.expenditure.length ? (
                  <div className="panel-content">
                    {d.expenditure.map((r: any) => (
                      <div className="spend-row" key={r.currency}>
                        <span>{r.currency}</span>
                        <strong>{money(r.amount, r.currency)}</strong>
                        <div
                          className="spend-bar"
                          role="img"
                          aria-label={`${r.currency} recorded product expenditure ${r.amount}`}
                        >
                          <span />
                        </div>
                      </div>
                    ))}
                    <p className="muted">
                      Sum of product costs, including archived products. Invoice
                      totals are stored separately and are not counted again.
                      Currencies are not converted.
                    </p>
                  </div>
                ) : (
                  <Empty
                    title="The story starts with your records."
                    description="Add a product cost to see recorded expenditure here."
                  />
                )}
              </section>
              <section className="section-panel">
                <div className="section-heading">
                  <h2>Costs & refunds</h2>
                </div>
                {d.costs.length ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Type</th>
                          <th>Currency</th>
                          <th>Recorded amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.costs.map((c: any) => (
                          <tr key={`${c.kind}-${c.currency}`}>
                            <td className="capitalize">{c.kind}</td>
                            <td>{c.currency}</td>
                            <td>{money(c.amount, c.currency)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty
                    title="No costs or refunds recorded."
                    description="Record repair costs, maintenance and refunds in your service case history."
                  />
                )}
              </section>
            </div>
            <section className="section-panel mt-6">
              <div className="section-heading">
                <h2>Products with repeated issues</h2>
              </div>
              {d.repeated_issues.length ? (
                d.repeated_issues.map((p: any) => (
                  <RowLink
                    key={p.id}
                    to={`/products/${p.id}?tab=cases`}
                    title={p.name}
                    description={`${p.count} recorded service cases`}
                  />
                ))
              ) : (
                <div className="panel-content muted">
                  No product has more than one recorded service case.
                </div>
              )}
            </section>
            <p className="quiet-note">
              These insights describe your records. They do not estimate market
              values, money saved or future maintenance needs.
            </p>
          </>
        )}
      </QueryState>
    </>
  );
}
