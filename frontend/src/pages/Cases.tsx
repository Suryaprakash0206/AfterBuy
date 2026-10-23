import { useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { z } from "zod";
import { Plus, Wrench, Download, FileText, Check, Clock3 } from "lucide-react";
import {
  caseSchema,
  caseEventSchema,
  transitions,
  todayIn,
} from "../../../shared/domain";
import { useApp, useWorkspaceApi, useWorkspaceQuery } from "../lib/context";
import { date, money, download } from "../lib/api";
import {
  PageHeader,
  QueryState,
  Empty,
  Status,
  RowLink,
  RecordForm,
  Button,
  Modal,
  Field,
  ErrorNotice,
  Notice,
  type FormField,
} from "../components/ui";
import { ReminderDialog } from "./Notifications";
export function Cases() {
  const q = useWorkspaceQuery("/cases");
  const { canEdit } = useApp();
  const [filter, setFilter] = useState("open");
  const rows = q.data?.filter(
    (c: any) =>
      filter === "all" ||
      !["Resolved", "Rejected", "Cancelled"].includes(c.status),
  );
  return (
    <>
      <PageHeader
        eyebrow="FROM THE FIRST ISSUE TO THE FINAL ANSWER"
        title="Service cases"
        description="Keep the conversation, evidence and outcome in one place."
        action={
          canEdit && (
            <Link className="btn btn-primary" to="/cases/new">
              <Plus size={16} />
              Report an issue
            </Link>
          )
        }
      />
      <div className="filter-tabs">
        {["open", "all"].map((v) => (
          <button
            key={v}
            aria-pressed={filter === v}
            onClick={() => setFilter(v)}
          >
            {v === "open" ? "Open cases" : "All cases"}
          </button>
        ))}
      </div>
      <QueryState query={q}>
        {rows?.length ? (
          rows.map((c: any) => (
            <RowLink
              key={c.id}
              to={`/cases/${c.id}`}
              title={c.title}
              description={`${c.product.name} · Reported ${date(c.occurred_on)}`}
              icon={<Wrench size={18} />}
              trailing={<Status>{c.status}</Status>}
            />
          ))
        ) : (
          <Empty
            icon={<Wrench size={28} />}
            title="Nothing to work through."
            description="When something needs attention, record the issue and keep every step together."
          />
        )}
      </QueryState>
    </>
  );
}
export function CaseEditor() {
  const [params] = useSearchParams();
  const products = useWorkspaceQuery("/products?limit=100");
  const call = useWorkspaceApi();
  const { refresh, toast, me, canEdit } = useApp();
  const navigate = useNavigate();
  const fields: FormField[] = [
    {
      name: "product_id",
      label: "Product",
      type: "select",
      options: [
        { value: "", label: "Choose a product" },
        ...(products.data?.items || []).map((p: any) => ({
          value: p.id,
          label: p.name,
        })),
      ],
      full: true,
    },
    {
      name: "title",
      label: "Issue summary",
      full: true,
      placeholder: "e.g. Water leaking from the door",
    },
    {
      name: "description",
      label: "What happened?",
      type: "textarea",
      full: true,
      hint: "Describe the fault, when it happens and any troubleshooting you have tried.",
    },
    { name: "occurred_on", label: "Date noticed", type: "date" },
    { name: "support_contact", label: "Support contact", nullable: true },
    { name: "reference", label: "Existing case reference", nullable: true },
  ];
  return (
    <>
      <Link className="back-link" to="/cases">
        ← Service cases
      </Link>
      <PageHeader
        eyebrow="LET’S GET IT SORTED"
        title="Report an issue"
        description="Start a case. Add evidence and prepare a support package when you’re ready."
      />
      {!canEdit ? (
        <Notice>Viewers cannot create cases.</Notice>
      ) : (
        <QueryState query={products}>
          <div className="form-panel">
            <RecordForm
              schema={caseSchema}
              fields={fields}
              values={{
                product_id: params.get("product") || "",
                title: "",
                description: "",
                occurred_on: todayIn(me.profile.timezone),
              }}
              onSubmit={async (values) => {
                const c = await call("/cases", {
                  method: "POST",
                  body: values,
                });
                refresh();
                toast("Service case created.");
                navigate(`/cases/${c.id}`);
              }}
              submitLabel="Create service case"
            />
          </div>
        </QueryState>
      )}
    </>
  );
}
export function CaseDetail() {
  const { id } = useParams();
  const q = useWorkspaceQuery(`/cases/${id}`);
  const call = useWorkspaceApi();
  const { canEdit, refresh, toast, me } = useApp();
  const [eventOpen, setEventOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [reminderOpen, setReminderOpen] = useState(false);
  const c = q.data;
  const fields: FormField[] = [
    {
      name: "kind",
      label: "Update type",
      type: "select",
      options: [
        "note",
        "troubleshooting",
        "repair",
        "replacement",
        "refund",
        "maintenance",
        "status",
      ].map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) })),
    },
    { name: "occurred_on", label: "Date", type: "date" },
    { name: "note", label: "What changed?", type: "textarea", full: true },
    {
      name: "amount",
      label: "Cost or refund amount",
      nullable: true,
      hint: "Optional. Recorded in the currency below.",
    },
    { name: "currency", label: "Currency" },
    {
      name: "replacement_details",
      label: "Replacement details",
      nullable: true,
      hint: "Replacement does not automatically restart any warranty.",
    },
    {
      name: "status",
      label: "New status (for status updates)",
      type: "select",
      options: [
        { value: c?.status || "Draft", label: c?.status || "Draft" },
        ...((transitions as any)[c?.status] || []).map((s: string) => ({
          value: s,
          label: s,
        })),
      ],
    },
  ];
  return (
    <>
      <Link className="back-link" to="/cases">
        ← Service cases
      </Link>
      <QueryState query={q}>
        {c && (
          <>
            <PageHeader
              eyebrow={c.product.name}
              title={c.title}
              description={`First noticed ${date(c.occurred_on)} · ${c.reference || "No support reference yet"}`}
              action={
                <Link className="btn btn-primary" to={`/cases/${id}/package`}>
                  <FileText size={16} />
                  Prepare support package
                </Link>
              }
            />
            <div className="case-layout">
              <section>
                <div className="case-summary">
                  <Status>{c.status}</Status>
                  <h2>The issue</h2>
                  <p className="preserve-lines">{c.description}</p>
                  <Link className="text-link" to={`/products/${c.product_id}`}>
                    View product details ↗
                  </Link>
                </div>
                <div className="section-heading mt-6">
                  <h2>Case history</h2>
                  {canEdit && (
                    <Button
                      variant="secondary"
                      onClick={() => setEventOpen(true)}
                    >
                      <Plus size={15} />
                      Add an update
                    </Button>
                  )}
                </div>
                {c.events.length ? (
                  <ol className="timeline">
                    {c.events.map((e: any) => (
                      <li key={e.id}>
                        <span className="timeline-dot" />
                        <small>
                          {date(e.occurred_on)} · {e.kind}
                        </small>
                        <p>{e.note}</p>
                        {e.amount && (
                          <strong>{money(e.amount, e.currency)}</strong>
                        )}
                        {e.replacement_details && (
                          <p>{e.replacement_details}</p>
                        )}
                        {e.status && <Status>{e.status}</Status>}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <Empty
                    title="The first step is recorded."
                    description="Add troubleshooting, conversations, repairs and outcomes as they happen."
                  />
                )}
              </section>
              <aside>
                <section className="section-panel">
                  <div className="section-heading">
                    <h2>Support details</h2>
                  </div>
                  <div className="panel-content">
                    <dl>
                      <dt>Contact</dt>
                      <dd>{c.support_contact || "Not recorded"}</dd>
                      <dt>Reference</dt>
                      <dd>{c.reference || "Not recorded"}</dd>
                    </dl>
                    {canEdit && (
                      <Button
                        variant="secondary"
                        onClick={() => setContactOpen(true)}
                      >
                        Edit support details
                      </Button>
                    )}
                  </div>
                </section>
                <section className="section-panel mt-6">
                  <div className="panel-content">
                    <Clock3 size={24} />
                    <h3>Keep the conversation moving.</h3>
                    <p className="muted">
                      Set a reminder to follow up on your case.
                    </p>
                    <Button
                      variant="secondary"
                      disabled={["Resolved", "Rejected", "Cancelled"].includes(
                        c.status,
                      )}
                      onClick={() => setReminderOpen(true)}
                    >
                      Add follow-up
                    </Button>
                  </div>
                </section>
                {canEdit && (
                  <Link
                    className="btn btn-secondary mt-6"
                    to={`/documents/upload?product=${c.product_id}`}
                  >
                    <Plus size={16} />
                    Add photos or evidence
                  </Link>
                )}
              </aside>
            </div>
            <Modal
              wide
              title="Add to the case history"
              open={eventOpen}
              onOpenChange={setEventOpen}
            >
              <RecordForm
                key={c.status}
                schema={caseEventSchema}
                fields={fields}
                values={{
                  kind: "note",
                  note: "",
                  occurred_on: todayIn(me.profile.timezone),
                  currency: c.product.currency,
                  status: c.status,
                }}
                onSubmit={async (v) => {
                  await call(`/cases/${id}/events`, {
                    method: "POST",
                    body: v,
                  });
                  refresh();
                  toast("Case update recorded.");
                  setEventOpen(false);
                }}
                submitLabel="Record update"
              />
            </Modal>
            <Modal
              title="Support details"
              open={contactOpen}
              onOpenChange={setContactOpen}
            >
              <RecordForm
                schema={z.object({
                  support_contact: z.string().nullable(),
                  reference: z.string().nullable(),
                })}
                fields={[
                  {
                    name: "support_contact",
                    label: "Support contact",
                    nullable: true,
                  },
                  {
                    name: "reference",
                    label: "Case reference",
                    nullable: true,
                  },
                ]}
                values={{
                  support_contact: c.support_contact,
                  reference: c.reference,
                }}
                onSubmit={async (v) => {
                  await call(`/cases/${id}`, { method: "PATCH", body: v });
                  refresh();
                  toast("Support details saved.");
                  setContactOpen(false);
                }}
              />
            </Modal>
            <ReminderDialog
              productId={c.product_id}
              caseId={c.id}
              open={reminderOpen}
              onOpenChange={setReminderOpen}
            />
          </>
        )}
      </QueryState>
    </>
  );
}
export function SupportPackage() {
  const { id } = useParams();
  const q = useWorkspaceQuery(`/cases/${id}`);
  const product = useWorkspaceQuery(`/products/${q.data?.product_id}`, {
    enabled: !!q.data?.product_id,
  });
  const call = useWorkspaceApi();
  const [selected, setSelected] = useState<string[]>([]);
  const [options, setOptions] = useState({
    include_serial: false,
    include_cost: true,
    include_contact: false,
    include_timeline: true,
  });
  const [message, setMessage] = useState<string>();
  const [preview, setPreview] = useState<any>();
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState("");
  const { toast } = useApp();
  const body = {
    document_ids: selected,
    ...options,
    ...(message !== undefined ? { message } : {}),
  };
  const invalidate = () => setPreview(undefined);
  async function prepare() {
    setBusy("preview");
    setError(undefined);
    try {
      setPreview(
        await call(`/cases/${id}/package/preview`, { method: "POST", body }),
      );
    } catch (e) {
      setError(e);
    } finally {
      setBusy("");
    }
  }
  async function exportFile(format: string) {
    setBusy(format);
    try {
      const blob = await call<Blob>(`/cases/${id}/package/export`, {
        method: "POST",
        body: { ...body, format },
        blob: true,
      });
      download(blob, `afterbuy-support-${id}.${format}`);
      toast("Support package downloaded. Nothing was sent.");
    } catch (e) {
      setError(e);
    } finally {
      setBusy("");
    }
  }
  return (
    <>
      <Link className="back-link" to={`/cases/${id}`}>
        ← Back to service case
      </Link>
      <PageHeader
        eyebrow="BE READY FOR THE NEXT CONVERSATION"
        title="Your support package"
        description="Choose what to include, review the summary, then download it."
      />
      <QueryState query={q}>
        {q.data && (
          <div className="package-layout">
            <section className="section-panel">
              <div className="section-heading">
                <h2>What to include</h2>
                <ShieldIcon />
              </div>
              <div className="panel-content">
                <h3>Personal & purchase details</h3>
                {Object.entries(options).map(([key, value]) => (
                  <label className="inline-check package-option" key={key}>
                    <input
                      type="checkbox"
                      checked={value}
                      onChange={(e) => {
                        setOptions({ ...options, [key]: e.target.checked });
                        invalidate();
                      }}
                    />
                    {
                      (
                        {
                          include_serial: "Serial number",
                          include_cost: "Product costs and recorded amounts",
                          include_contact: "Support contact and reference",
                          include_timeline: "Chronological case history",
                        } as any
                      )[key]
                    }
                  </label>
                ))}
                <h3 className="mt-6">Original evidence</h3>
                <p className="muted">
                  Choose only documents you want to share. Shared invoices
                  require a separately prepared copy.
                </p>
                <QueryState query={product}>
                  {product.data?.documents.length ? (
                    product.data.documents.map((d: any) => (
                      <label className="inline-check package-option" key={d.id}>
                        <input
                          type="checkbox"
                          checked={selected.includes(d.id)}
                          onChange={(e) => {
                            setSelected(
                              e.target.checked
                                ? [...selected, d.id]
                                : selected.filter((x) => x !== d.id),
                            );
                            invalidate();
                          }}
                        />
                        {d.name}
                      </label>
                    ))
                  ) : (
                    <p className="muted">No evidence uploaded yet.</p>
                  )}
                </QueryState>
                <Field label="Draft support message (optional override)">
                  <textarea
                    rows={7}
                    value={message ?? ""}
                    onChange={(e) => {
                      setMessage(e.target.value || undefined);
                      invalidate();
                    }}
                    placeholder="Leave blank to prepare a factual draft from the case details."
                  />
                </Field>
                <ErrorNotice error={error} />
                <Button
                  className="w-full"
                  busy={busy === "preview"}
                  onClick={prepare}
                >
                  <FileText size={16} />
                  Preview package
                </Button>
              </div>
            </section>
            <section className="package-preview">
              {preview ? (
                <>
                  <div className="preview-sheet">
                    <p className="eyebrow">AFTERBUY · SUPPORT SUMMARY</p>
                    <h2>{preview.product.name}</h2>
                    <p>{preview.case.title}</p>
                    <dl className="detail-grid">
                      {Object.entries(preview.product)
                        .filter(([k, v]) => k !== "id" && v != null)
                        .map(([k, v]) => (
                          <div key={k}>
                            <dt>{k.replaceAll("_", " ")}</dt>
                            <dd>{String(v)}</dd>
                          </div>
                        ))}
                    </dl>
                    <h3>Issue summary</h3>
                    <p>{preview.case.description}</p>
                    <p>
                      First noticed {date(preview.case.occurred_on)} ·{" "}
                      {preview.case.status}
                    </p>
                    {preview.case.support_contact && (
                      <p>Support contact: {preview.case.support_contact}</p>
                    )}
                    {preview.case.reference && (
                      <p>Reference: {preview.case.reference}</p>
                    )}
                    <h3>Confirmed coverage</h3>
                    {preview.coverage.length ? (
                      preview.coverage.map((c: any, i: number) => (
                        <div key={i}>
                          <p>
                            <strong>{c.provider}</strong> · {c.kind}
                            <br />
                            {date(c.start_date)} – {date(c.end_date)}
                          </p>
                          {c.components && <p>Applies to: {c.components}</p>}
                          {c.conditions && <p>Conditions: {c.conditions}</p>}
                          {c.exclusions && <p>Exclusions: {c.exclusions}</p>}
                        </div>
                      ))
                    ) : (
                      <p>No confirmed coverage recorded.</p>
                    )}
                    <small>{preview.notice}</small>
                    {preview.timeline.length > 0 && (
                      <>
                        <h3>Case timeline</h3>
                        {preview.timeline.map((e: any) => (
                          <p key={e.id}>
                            {date(e.occurred_on)} · {e.kind}: {e.note}
                            {e.amount
                              ? ` · ${money(e.amount, e.currency)}`
                              : ""}
                          </p>
                        ))}
                      </>
                    )}
                    <h3>Selected evidence</h3>
                    {preview.documents.length ? (
                      preview.documents.map((d: any) => (
                        <p key={d.id}>
                          <FileText size={14} /> {d.name}
                        </p>
                      ))
                    ) : (
                      <p>No original attachments selected.</p>
                    )}
                    <h3>Draft support message</h3>
                    <p className="preserve-lines">{preview.draft}</p>
                  </div>
                  <div className="export-actions">
                    <Button
                      busy={busy === "pdf"}
                      disabled={!!busy}
                      onClick={() => exportFile("pdf")}
                    >
                      <Download size={16} />
                      Download PDF
                    </Button>
                    <Button
                      variant="secondary"
                      busy={busy === "zip"}
                      disabled={!!busy}
                      onClick={() => exportFile("zip")}
                    >
                      <Download size={16} />
                      Download ZIP + evidence
                    </Button>
                  </div>
                  <Notice>
                    Downloads stay on your device. AfterBuy does not send the
                    message. PDF text uses a Latin font; the ZIP also includes a
                    Unicode JSON summary and message.
                  </Notice>
                </>
              ) : (
                <Empty
                  icon={<FileText size={36} />}
                  title="A clear story, ready to share."
                  description="Choose the information on the left and preview your package. The PDF summary and original evidence will be available to download."
                />
              )}
            </section>
          </div>
        )}
      </QueryState>
    </>
  );
}
function ShieldIcon() {
  return <Check size={20} />;
}
