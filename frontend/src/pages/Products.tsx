import { useEffect, useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  Plus,
  Search,
  LayoutGrid,
  List,
  Package,
  ArrowUpRight,
  MapPin,
  Upload,
  ShieldCheck,
  FileText,
  Wrench,
  Clock3,
  Archive,
  Trash2,
  Pencil,
  MessageSquare,
  Send,
} from "lucide-react";
import * as Tabs from "@radix-ui/react-tabs";
import { productSchema } from "../../../shared/domain";
import { useApp, useWorkspaceApi, useWorkspaceQuery } from "../lib/context";
import { date, money } from "../lib/api";
import {
  Button,
  PageHeader,
  QueryState,
  Empty,
  Status,
  RecordForm,
  ConfirmButton,
  ErrorNotice,
  Field,
  RowLink,
  type FormField,
} from "../components/ui";
import { CoverageList, CoverageDialog } from "./Coverage";
import { ReminderDialog } from "./Notifications";
export const productFields: FormField[] = [
  {
    name: "name",
    label: "Product name",
    full: true,
    placeholder: "e.g. Washing machine",
  },
  {
    name: "category",
    label: "Category",
    type: "select",
    options: [
      "Other",
      "Appliances",
      "Electronics",
      "Furniture",
      "Home & garden",
      "Clothing",
      "Vehicles",
      "Health & fitness",
    ].map((v) => ({ value: v, label: v })),
  },
  {
    name: "location",
    label: "Household location",
    nullable: true,
    placeholder: "e.g. Utility room",
  },
  { name: "brand", label: "Brand", nullable: true },
  { name: "model", label: "Model", nullable: true },
  { name: "serial_number", label: "Serial number", nullable: true },
  {
    name: "specifications",
    label: "Specifications",
    type: "textarea",
    nullable: true,
    full: true,
  },
  { name: "seller", label: "Purchased from", nullable: true },
  {
    name: "purchase_date",
    label: "Purchase date",
    type: "date",
    nullable: true,
  },
  {
    name: "delivery_date",
    label: "Delivery date",
    type: "date",
    nullable: true,
  },
  {
    name: "price",
    label: "Recorded product cost",
    nullable: true,
    hint: "Total cost for this product or line item. Do not enter the whole invoice total.",
  },
  { name: "currency", label: "Currency", placeholder: "INR" },
  {
    name: "notes",
    label: "Notes",
    type: "textarea",
    nullable: true,
    full: true,
  },
];
export function Products() {
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.get("search") || "";
  const [sort, setSort] = useState("newest");
  const [category, setCategory] = useState("");
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [search]);
  const [view, setView] = useState("grid");
  const { canEdit } = useApp();
  const q = useWorkspaceQuery(
    `/products?${new URLSearchParams({ search, sort, page: String(page), archived: String(archived), ...(category ? { category } : {}) })}`,
  );
  return (
    <>
      <PageHeader
        eyebrow="YOUR COLLECTION"
        title="My products"
        description="The things you own, with the details you need."
        action={
          canEdit && (
            <Link className="btn btn-primary" to="/products/new">
              <Plus size={17} />
              Add product
            </Link>
          )
        }
      />
      <div className="collection-toolbar">
        <div className="search-input">
          <Search size={18} />
          <input
            aria-label="Search products"
            placeholder="Find a product…"
            value={search}
            onChange={(e) => {
              setSearchParams(
                e.target.value ? { search: e.target.value } : {},
                { replace: true },
              );
              setPage(1);
            }}
          />
        </div>
        <select
          aria-label="Filter by category"
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All categories</option>
          {productFields
            .find((f) => f.name === "category")
            ?.options?.map((o) => (
              <option key={o.value}>{o.value}</option>
            ))}
        </select>
        <select
          aria-label="Sort products"
          value={sort}
          onChange={(e) => {
            setSort(e.target.value);
            setPage(1);
          }}
        >
          <option value="newest">Recently added</option>
          <option value="name">Name A–Z</option>
          <option value="purchase_date">Purchase date</option>
        </select>
        <div className="view-switch">
          <button
            aria-label="Grid view"
            aria-pressed={view === "grid"}
            onClick={() => setView("grid")}
          >
            <LayoutGrid size={17} />
          </button>
          <button
            aria-label="List view"
            aria-pressed={view === "list"}
            onClick={() => setView("list")}
          >
            <List size={17} />
          </button>
        </div>
      </div>
      <div className="collection-meta">
        <span>{q.data?.total ?? "…"} products</span>
        <label className="inline-check">
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => {
              setArchived(e.target.checked);
              setPage(1);
            }}
          />
          Show archived
        </label>
      </div>
      <QueryState query={q}>
        {q.data?.items.length ? (
          <>
            <div className={view === "grid" ? "product-grid" : "product-list"}>
              {q.data.items.map((p: any) => (
                <Link
                  key={p.id}
                  to={`/products/${p.id}`}
                  className="product-card"
                >
                  <div className="product-symbol">
                    <Package size={34} />
                    <span>{p.category}</span>
                  </div>
                  <div className="product-card-body">
                    <div className="product-card-title">
                      <h3>{p.name}</h3>
                      <ArrowUpRight size={17} />
                    </div>
                    <p>
                      {[p.brand, p.model].filter(Boolean).join(" · ") ||
                        "Details ready when you are"}
                    </p>
                    <div className="product-card-meta">
                      <span>{money(p.price, p.currency)}</span>
                      <span>
                        <MapPin size={13} />
                        {p.location || "No location"}
                      </span>
                    </div>
                    <small>Purchased {date(p.purchase_date)}</small>
                  </div>
                </Link>
              ))}
            </div>
            <div className="pagination">
              <Button
                variant="secondary"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                Previous
              </Button>
              <span>
                Page {page} of {Math.max(1, Math.ceil(q.data.total / 12))}
              </span>
              <Button
                variant="secondary"
                disabled={page * 12 >= q.data.total}
                onClick={() => setPage(page + 1)}
              >
                Next
              </Button>
            </div>
          </>
        ) : (
          <Empty
            icon={<Package size={30} />}
            title={
              search || category
                ? "No matching products."
                : "Your collection starts here."
            }
            description={
              search || category
                ? "Try a different name or category."
                : "Add your first purchase to keep its receipt, coverage and service history together."
            }
            action={
              canEdit && (
                <Link className="btn btn-primary" to="/documents/upload">
                  <Upload size={16} />
                  Upload a receipt
                </Link>
              )
            }
          />
        )}
      </QueryState>
    </>
  );
}
export function ProductEditor() {
  const { id } = useParams();
  const q = useWorkspaceQuery(`/products/${id}`, { enabled: !!id });
  const { refresh, toast, me, canEdit } = useApp();
  const call = useWorkspaceApi();
  const navigate = useNavigate();
  if (!canEdit)
    return (
      <ErrorNotice
        error={new Error("You have read-only access to this workspace.")}
      />
    );
  const content = (
    <div className="form-panel">
      <RecordForm
        schema={productSchema}
        fields={productFields}
        values={
          id
            ? Object.fromEntries(
                productFields.map(({ name }) => [name, q.data?.[name]]),
              )
            : {
                name: "",
                category: "Other",
                currency: me?.profile.currency || "INR",
              }
        }
        onSubmit={async (values) => {
          const p = await call(id ? `/products/${id}` : "/products", {
            method: id ? "PATCH" : "POST",
            body: values,
          });
          refresh();
          toast(
            id
              ? "Product details updated."
              : "Product added to your collection.",
          );
          navigate(`/products/${p.id}`);
        }}
        submitLabel={id ? "Save product" : "Add product"}
      />
    </div>
  );
  return (
    <>
      <Link className="back-link" to={id ? `/products/${id}` : "/products"}>
        ← Back to {id ? "product" : "collection"}
      </Link>
      <PageHeader
        eyebrow="THE DETAILS MATTER"
        title={id ? "Edit product" : "Add a product"}
        description="Enter what you know. You can fill in the rest later."
      />
      {id ? <QueryState query={q}>{q.data && content}</QueryState> : content}
    </>
  );
}
export function ProductDetail() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") || "overview";
  const q = useWorkspaceQuery(`/products/${id}`);
  const call = useWorkspaceApi();
  const { canEdit, refresh, toast } = useApp();
  const navigate = useNavigate();
  const [coverageOpen, setCoverageOpen] = useState(false);
  const [reminderOpen, setReminderOpen] = useState(false);
  const p = q.data;
  return (
    <>
      <Link className="back-link" to="/products">
        ← My products
      </Link>
      <QueryState query={q}>
        {p && (
          <>
            <PageHeader
              eyebrow={`${p.category}${p.archived_at ? " · ARCHIVED" : ""}`}
              title={p.name}
              description={
                [p.brand, p.model, p.location].filter(Boolean).join(" · ") ||
                "Your product, from purchase onward."
              }
              action={
                canEdit && (
                  <>
                    <Link
                      to={`/products/${id}/edit`}
                      className="btn btn-secondary"
                    >
                      <Pencil size={16} />
                      Edit details
                    </Link>
                    <Link
                      to={`/cases/new?product=${id}`}
                      className="btn btn-primary"
                    >
                      <Wrench size={16} />
                      Report an issue
                    </Link>
                  </>
                )
              }
            />
            <Tabs.Root value={tab} onValueChange={(v) => setParams({ tab: v })}>
              <Tabs.List className="tabs" aria-label="Product sections">
                {[
                  ["overview", "Overview"],
                  ["documents", "Documents"],
                  ["coverage", "Coverage"],
                  ["cases", "Service cases"],
                  ["timeline", "Timeline"],
                ].map(([value, label]) => (
                  <Tabs.Trigger key={value} value={value}>
                    {label}
                    {value === "documents" && <span>{p.documents.length}</span>}
                  </Tabs.Trigger>
                ))}
              </Tabs.List>
              <Tabs.Content value="overview">
                <div className="detail-columns">
                  <div>
                    <section className="section-panel">
                      <div className="section-heading">
                        <h2>Purchase details</h2>
                        <Package size={20} />
                      </div>
                      <dl className="detail-grid">
                        {[
                          ["Purchased from", p.seller || "Not recorded"],
                          ["Purchase date", date(p.purchase_date)],
                          ["Delivery date", date(p.delivery_date)],
                          ["Recorded cost", money(p.price, p.currency)],
                          ["Serial number", p.serial_number || "Not recorded"],
                          ["Location", p.location || "Not recorded"],
                        ].map(([label, value]) => (
                          <div key={label}>
                            <dt>{label}</dt>
                            <dd>{value}</dd>
                          </div>
                        ))}
                      </dl>
                      <div className="product-notes">
                        <h3>Specifications</h3>
                        <p>{p.specifications || "Not provided"}</p>
                      </div>
                      {p.notes && (
                        <div className="product-notes">
                          <h3>Notes</h3>
                          <p>{p.notes}</p>
                        </div>
                      )}
                    </section>
                    <section className="section-panel mt-6">
                      <div className="section-heading">
                        <h2>Keep it in good shape</h2>
                        <Clock3 size={20} />
                      </div>
                      <div className="panel-content">
                        <p className="muted">
                          Set a maintenance reminder based on your manual or
                          your own schedule.
                        </p>
                        <Button
                          variant="secondary"
                          onClick={() => setReminderOpen(true)}
                        >
                          Add a reminder
                        </Button>
                      </div>
                    </section>
                  </div>
                  <Assistant productId={p.id} />
                </div>
              </Tabs.Content>
              <Tabs.Content value="documents">
                <div className="section-heading">
                  <h2>All the paperwork, together.</h2>
                  {canEdit && (
                    <Link
                      className="btn btn-primary"
                      to={`/documents/upload?product=${id}`}
                    >
                      <Plus size={16} />
                      Add document
                    </Link>
                  )}
                </div>
                {p.documents.length ? (
                  p.documents.map((d: any) => (
                    <RowLink
                      key={d.id}
                      to={`/documents/${d.id}/review`}
                      title={d.name}
                      description={`${d.kind} · ${d.page_count} page${d.page_count === 1 ? "" : "s"}`}
                      trailing={<Status>{d.status}</Status>}
                    />
                  ))
                ) : (
                  <Empty
                    icon={<FileText size={28} />}
                    title="A place for the paperwork."
                    description="Add receipts, manuals, warranty terms and service records for this product."
                  />
                )}
              </Tabs.Content>
              <Tabs.Content value="coverage">
                <div className="section-heading">
                  <h2>Know where you stand.</h2>
                  {canEdit && (
                    <Button onClick={() => setCoverageOpen(true)}>
                      <Plus size={16} />
                      Add coverage
                    </Button>
                  )}
                </div>
                <CoverageList records={p.coverage} product={p} />
              </Tabs.Content>
              <Tabs.Content value="cases">
                <div className="section-heading">
                  <h2>Service history</h2>
                  {canEdit && (
                    <Link
                      className="btn btn-primary"
                      to={`/cases/new?product=${id}`}
                    >
                      Report an issue
                    </Link>
                  )}
                </div>
                {p.cases.length ? (
                  p.cases.map((c: any) => (
                    <RowLink
                      key={c.id}
                      to={`/cases/${c.id}`}
                      title={c.title}
                      description={date(c.occurred_on)}
                      icon={<Wrench size={18} />}
                      trailing={<Status>{c.status}</Status>}
                    />
                  ))
                ) : (
                  <Empty
                    title="No service cases."
                    description="If something goes wrong, keep the issue and its resolution together here."
                  />
                )}
              </Tabs.Content>
              <Tabs.Content value="timeline">
                <h2 className="mb-6">The life of this product</h2>
                {p.timeline.length ? (
                  <ol className="timeline">
                    {p.timeline.map((e: any) => (
                      <li key={e.id}>
                        <span className="timeline-dot" />
                        <small>
                          {date(e.occurred_at)} · {e.kind}
                        </small>
                        <p>{e.description}</p>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <Empty
                    title="Your history starts here."
                    description="Purchases and important changes are recorded automatically."
                  />
                )}
              </Tabs.Content>
            </Tabs.Root>
            {canEdit && (
              <div className="product-danger">
                <ConfirmButton
                  title={
                    p.archived_at ? "Restore product?" : "Archive product?"
                  }
                  description="Archived products stay in your history. Scheduled reminders for archived products are cancelled."
                  onConfirm={async () => {
                    await call(`/products/${id}/archive`, {
                      method: "POST",
                      body: { archived: !p.archived_at },
                    });
                    refresh();
                    toast(
                      p.archived_at ? "Product restored." : "Product archived.",
                    );
                  }}
                >
                  <Archive size={16} />
                  {p.archived_at ? "Restore product" : "Archive product"}
                </ConfirmButton>
                <ConfirmButton
                  title="Delete this product?"
                  description="This permanently removes the product, coverage, cases, reminders and product history. Original documents remain in your document library until separately deleted."
                  onConfirm={async () => {
                    await call(`/products/${id}`, { method: "DELETE" });
                    refresh();
                    navigate("/products");
                    toast("Product deleted.");
                  }}
                >
                  <Trash2 size={16} />
                  Delete product
                </ConfirmButton>
              </div>
            )}
            <CoverageDialog
              product={p}
              open={coverageOpen}
              onOpenChange={setCoverageOpen}
            />
            <ReminderDialog
              productId={p.id}
              open={reminderOpen}
              onOpenChange={setReminderOpen}
            />
          </>
        )}
      </QueryState>
    </>
  );
}
function Assistant({ productId }: { productId: string }) {
  const q = useWorkspaceQuery(`/products/${productId}/assistant`);
  const call = useWorkspaceApi();
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  return (
    <section className="assistant-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">GROUNDED IN YOUR DOCUMENTS</p>
          <h2>
            <MessageSquare size={19} />
            Ask about this product
          </h2>
        </div>
      </div>
      <p className="muted">
        Find an answer in your receipts, manuals and service records, with
        sources you can open.
      </p>
      <div className="messages" aria-live="polite">
        <QueryState query={q}>
          {q.data?.length ? (
            q.data.map((m: any) => (
              <div key={m.id} className={`message message-${m.role}`}>
                <strong>{m.role === "user" ? "You" : "AfterBuy"}</strong>
                <p>{m.content}</p>
                {m.sources?.map((s: any) => (
                  <Link
                    className="citation"
                    key={s.id}
                    to={`/documents/${s.document_id}/review?page=${s.page}`}
                  >
                    <FileText size={13} />
                    {s.name} · p. {s.page}
                  </Link>
                ))}
              </div>
            ))
          ) : (
            <div className="assistant-empty">
              <ShieldCheck size={25} />
              <p>“What does the manual say about cleaning the filter?”</p>
              <small>
                Answers come from this product’s documents. Missing evidence
                stays missing.
              </small>
            </div>
          )}
        </QueryState>
        {busy && (
          <p className="muted" role="status">
            Checking your documents…
          </p>
        )}
      </div>
      <ErrorNotice error={error} />
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!question.trim()) return;
          setBusy(true);
          setError(undefined);
          try {
            await call(`/products/${productId}/assistant`, {
              method: "POST",
              body: { question },
            });
            setQuestion("");
            await q.refetch();
          } catch (e) {
            setError(e);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Your question">
          <textarea
            rows={2}
            maxLength={2000}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask a question about your documents…"
          />
        </Field>
        <Button busy={busy} disabled={!question.trim()} type="submit">
          <Send size={15} />
          Ask AfterBuy
        </Button>
      </form>
    </section>
  );
}
