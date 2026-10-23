import { useState, useRef, lazy, Suspense } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useForm, useFieldArray } from "react-hook-form";
import {
  Upload,
  FileText,
  ArrowUpRight,
  Plus,
  Trash2,
  Check,
  RefreshCw,
  ShieldCheck,
  ExternalLink,
} from "lucide-react";
import { useApp, useWorkspaceApi, useWorkspaceQuery } from "../lib/context";
import { ApiError, date } from "../lib/api";
import {
  Button,
  PageHeader,
  QueryState,
  Empty,
  Status,
  ErrorNotice,
  Field,
  Notice,
  ConfirmButton,
  Loading,
} from "../components/ui";
const PdfPreview = lazy(() => import("../components/PdfPreview"));
export function Documents() {
  const q = useWorkspaceQuery("/documents", { poll: 10000 });
  const { canEdit } = useApp();
  return (
    <>
      <PageHeader
        eyebrow="LESS SEARCHING. MORE FINDING."
        title="Your documents"
        description="Receipts, warranty terms, manuals and everything in between."
        action={
          canEdit && (
            <Link to="/documents/upload" className="btn btn-primary">
              <Upload size={16} />
              Upload document
            </Link>
          )
        }
      />
      <QueryState query={q}>
        {q.data?.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Type</th>
                  <th>Added</th>
                  <th>Status</th>
                  <th>
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {q.data.map((d: any) => (
                  <tr key={d.id}>
                    <td>
                      <Link
                        className="document-name"
                        to={`/documents/${d.id}/review`}
                      >
                        <FileText size={20} />
                        <span>
                          {d.name}
                          <small>
                            {d.page_count} page{d.page_count === 1 ? "" : "s"} ·{" "}
                            {(d.size_bytes / 1024).toFixed(0)} KB
                          </small>
                        </span>
                      </Link>
                    </td>
                    <td className="capitalize">{d.kind}</td>
                    <td>{date(d.created_at)}</td>
                    <td>
                      <Status>{d.status}</Status>
                    </td>
                    <td>
                      <Link
                        className="icon-button"
                        aria-label={`Open ${d.name}`}
                        to={`/documents/${d.id}/review`}
                      >
                        <ArrowUpRight size={18} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            icon={<FileText size={30} />}
            title="Goodbye, mystery paperwork."
            description="Upload your first receipt. We’ll help you organise its details, and you’ll confirm them before anything is recorded."
            action={
              canEdit && (
                <Link to="/documents/upload" className="btn btn-primary">
                  Upload your first document
                </Link>
              )
            }
          />
        )}
      </QueryState>
    </>
  );
}
export function UploadDocument() {
  const [params] = useSearchParams();
  const product = params.get("product");
  const [kind, setKind] = useState(product ? "manual" : "invoice");
  const [file, setFile] = useState<File>();
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const call = useWorkspaceApi();
  const navigate = useNavigate();
  const { canEdit, refresh, toast } = useApp();
  async function submit() {
    if (!file) return;
    setBusy(true);
    setError(undefined);
    const body = new FormData();
    body.append("file", file);
    body.append("kind", kind);
    if (product) body.append("product_id", product);
    try {
      const data = await call("/documents", { method: "POST", body });
      refresh();
      if (data.duplicate)
        toast(
          "This file is already in your workspace. Opened the existing document.",
        );
      navigate(`/documents/${data.document.id}/review`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Link
        className="back-link"
        to={product ? `/products/${product}?tab=documents` : "/documents"}
      >
        ← Back to {product ? "product" : "documents"}
      </Link>
      <PageHeader
        eyebrow="LET’S GET IT ORGANISED"
        title="Add a document"
        description="A receipt is a good place to start. You’ll review the details before they become records."
      />
      {!canEdit ? (
        <ErrorNotice error={new Error("Viewers cannot upload documents.")} />
      ) : (
        <div className="upload-layout">
          <section>
            <div
              className={`dropzone ${dragging ? "dragging" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                setFile(e.dataTransfer.files[0]);
              }}
            >
              <div className="upload-icon">
                <Upload size={29} />
              </div>
              <h2>{file ? file.name : "A home for your paperwork."}</h2>
              <p>
                {file
                  ? `${(file.size / 1024 / 1024).toFixed(2)} MB · Ready to upload`
                  : "Drag a document here, or choose a file from your device."}
              </p>
              <Button
                variant="secondary"
                onClick={() => input.current?.click()}
              >
                {file ? "Choose another file" : "Choose a file"}
              </Button>
              <input
                ref={input}
                type="file"
                className="sr-only"
                aria-label="Choose document file"
                accept="application/pdf,image/jpeg,image/png"
                onChange={(e) => setFile(e.target.files?.[0])}
              />
              <small>PDF, JPEG or PNG · Up to 20 MB · Up to 40 pages</small>
            </div>
            <Field label="What kind of document is this?">
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                {[
                  "invoice",
                  "warranty",
                  "manual",
                  "service",
                  "photo",
                  "other",
                ].map((k) => (
                  <option key={k} value={k}>
                    {k === "invoice"
                      ? "Invoice or receipt"
                      : k[0].toUpperCase() + k.slice(1)}
                  </option>
                ))}
              </select>
            </Field>
            <ErrorNotice error={error} />
            <div className="form-footer">
              <Button busy={busy} disabled={!file} onClick={submit}>
                <Upload size={16} />
                {busy ? "Uploading securely…" : "Upload & continue"}
              </Button>
            </div>
          </section>
          <aside className="upload-explainer">
            <p className="eyebrow">WHAT HAPPENS NEXT</p>
            {[
              [
                "01",
                "Keep the original",
                "Your file goes into private storage, accessible only to your workspace.",
              ],
              [
                "02",
                "Find the details",
                "The background worker reads supported documents when AI is configured.",
              ],
              [
                "03",
                "Make it yours",
                "Review, correct and confirm. You can always enter the details manually.",
              ],
            ].map(([n, t, d]) => (
              <div className="step" key={n}>
                <span>{n}</span>
                <div>
                  <h3>{t}</h3>
                  <p>{d}</p>
                </div>
              </div>
            ))}
            <div className="quiet-note">
              <ShieldCheck size={18} />
              <span>
                Nothing becomes a purchase or a warranty without your
                confirmation.
              </span>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
export function DocumentPreview({
  document,
  page = 1,
}: {
  document: any;
  page?: number;
}) {
  const call = useWorkspaceApi();
  const { workspaceId } = useApp();
  const q = useQuery({
    queryKey: [workspaceId, "signed-url", document.id],
    queryFn: () =>
      call(`/documents/${document.id}/download`, { method: "POST" }),
    staleTime: 90000,
    refetchInterval: 90000,
    retry: 1,
    enabled: document.upload_complete,
  });
  return (
    <div className="document-preview">
      <div className="preview-toolbar">
        <span>
          <FileText size={16} />
          {document.name}
        </span>
        {q.data && (
          <a
            href={q.data.url}
            target="_blank"
            rel="noreferrer"
            aria-label="Open original document"
            className="icon-button"
          >
            <ExternalLink size={16} />
          </a>
        )}
      </div>
      {!document.upload_complete ? (
        <Notice>
          The upload has not finished. Retry the same file to resume.
        </Notice>
      ) : (
        <QueryState query={q}>
          {q.data &&
            (document.mime === "application/pdf" ? (
              <Suspense fallback={<Loading label="Loading document viewer…" />}>
                <PdfPreview url={q.data.url} page={page} name={document.name} />
              </Suspense>
            ) : (
              <img
                src={q.data.url}
                alt={`Original uploaded document: ${document.name}`}
              />
            ))}
        </QueryState>
      )}
      <div className="preview-caption">
        Original document · Private access · Link expires automatically
      </div>
    </div>
  );
}
export function DocumentReview() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const [page, setPage] = useState(Number(params.get("page") || 1));
  const q = useWorkspaceQuery(`/documents/${id}`, { poll: 5000 });
  const { canEdit, refresh, toast } = useApp();
  const call = useWorkspaceApi();
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const d = q.data?.document;
  const extraction = q.data?.extraction;
  return (
    <>
      <Link to="/documents" className="back-link">
        ← All documents
      </Link>
      <PageHeader
        eyebrow="CHECK THE DETAILS, KEEP THE ORIGINAL"
        title="Review your document"
        description="Only what you confirm becomes part of your records."
        action={d && <Status>{d.status}</Status>}
      />
      <QueryState query={q}>
        {d && (
          <>
            <ErrorNotice error={error} />
            <p className="muted">
              Document assistant index: <Status>{d.index_status}</Status>
            </p>
            {d.error_code && (
              <Notice>
                <strong>{d.error_code.replaceAll("_", " ")}</strong>
                <p>
                  {d.error_code === "AI_NOT_CONFIGURED"
                    ? "AI is not configured. You can read the original and enter purchase details below."
                    : "Processing needs attention. Check the original and enter details manually, or retry when the service is available."}
                </p>
              </Notice>
            )}
            {["queued", "processing"].includes(d.status) && (
              <Notice>
                {d.status === "queued"
                  ? "Queued for the background worker. Start the worker if this status does not change."
                  : "Reading your document. You can check the original while processing continues."}
              </Notice>
            )}
            <div className="review-layout">
              <div className="review-original">
                <DocumentPreview document={d} page={page} />
              </div>
              <section className="review-fields">
                {d.status === "completed" ? (
                  <>
                    <div className="review-complete">
                      <Check size={28} />
                      <h2>Reviewed and recorded.</h2>
                      <p>These details have been confirmed.</p>
                    </div>
                    {d.accepted_product_ids?.map((pid: string, i: number) => (
                      <Link
                        key={pid}
                        className="row-link"
                        to={`/products/${pid}`}
                      >
                        View product {i + 1}
                        <ArrowUpRight size={17} />
                      </Link>
                    ))}
                  </>
                ) : d.kind === "invoice" && canEdit ? (
                  <PurchaseReviewForm
                    key={extraction?.id || d.id}
                    document={d}
                    extracted={extraction?.result}
                  />
                ) : (
                  <>
                    <h2>
                      {d.kind === "invoice"
                        ? "Purchase review"
                        : "Document review"}
                    </h2>
                    <p className="muted">
                      {canEdit
                        ? "Check the original. Any warranty terms still need a separate confirmed coverage record."
                        : "An editor or owner can confirm the extracted details."}
                    </p>
                    {canEdit && (
                      <Button
                        busy={busy}
                        disabled={[
                          "queued",
                          "processing",
                          "uploading",
                        ].includes(d.status)}
                        onClick={async () => {
                          setBusy(true);
                          try {
                            await call(`/documents/${d.id}/complete`, {
                              method: "POST",
                            });
                            refresh();
                            toast("Document reviewed.");
                          } catch (e) {
                            setError(e);
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        <Check size={16} />
                        Mark reviewed
                      </Button>
                    )}
                  </>
                )}
                {extraction?.result?.evidence?.length > 0 && (
                  <details className="evidence-details">
                    <summary>Where these details came from</summary>
                    {extraction.result.evidence.map((e: any, i: number) => (
                      <div key={i} className="evidence">
                        <strong>
                          {e.field} · {e.origin}
                        </strong>
                        <blockquote>“{e.quote}”</blockquote>
                        {e.page && (
                          <button
                            className="text-link"
                            onClick={() => setPage(e.page)}
                          >
                            Open page {e.page}
                          </button>
                        )}
                      </div>
                    ))}
                  </details>
                )}
                {extraction?.result?.warranties?.length > 0 && (
                  <div className="suggestions">
                    <h3>Stated coverage to check</h3>
                    <p className="muted">
                      These are suggestions only. Open a product’s Coverage tab
                      to record and confirm them.
                    </p>
                    {extraction.result.warranties.map((w: any, i: number) => (
                      <blockquote key={i}>
                        <strong>
                          {w.product_name || "Product unspecified"} · {w.kind}
                        </strong>
                        <p>{w.terms}</p>
                        <small>“{w.quote}”</small>
                      </blockquote>
                    ))}
                  </div>
                )}
                {extraction?.result?.warnings?.map((w: string, i: number) => (
                  <Notice key={i}>{w}</Notice>
                ))}
              </section>
            </div>
            {canEdit && (
              <div className="product-danger">
                {["completed", "needs_review"].includes(d.status) && (
                  <Button
                    variant="secondary"
                    disabled={["pending", "processing"].includes(
                      d.index_status,
                    )}
                    onClick={async () => {
                      try {
                        await call(`/documents/${d.id}/reindex`, {
                          method: "POST",
                        });
                        refresh();
                        toast("Document queued for indexing.");
                      } catch (e) {
                        setError(e);
                      }
                    }}
                  >
                    Rebuild assistant index
                  </Button>
                )}
                {["failed", "needs_review"].includes(d.status) && (
                  <Button
                    variant="secondary"
                    onClick={async () => {
                      try {
                        await call(`/documents/${d.id}/retry`, {
                          method: "POST",
                        });
                        refresh();
                        toast("Document queued for another attempt.");
                      } catch (e) {
                        setError(e);
                      }
                    }}
                  >
                    <RefreshCw size={15} />
                    Retry extraction
                  </Button>
                )}
                <ConfirmButton
                  title="Delete this document?"
                  description="This revokes access and removes extracted text and embeddings. The background worker removes the stored original. Confirmed products remain, but their original document link is removed."
                  onConfirm={async () => {
                    await call(`/documents/${d.id}`, { method: "DELETE" });
                    refresh();
                    toast("Document scheduled for deletion.");
                    navigate("/documents");
                  }}
                >
                  <Trash2 size={16} />
                  Delete document
                </ConfirmButton>
              </div>
            )}
          </>
        )}
      </QueryState>
    </>
  );
}
function PurchaseReviewForm({
  document,
  extracted,
}: {
  document: any;
  extracted: any;
}) {
  const { me, refresh, toast } = useApp();
  const call = useWorkspaceApi();
  const navigate = useNavigate();
  const [error, setError] = useState<unknown>();
  const [duplicate, setDuplicate] = useState(false);
  const emptyItem = {
    name: "",
    category: "Other",
    brand: null,
    model: null,
    serial_number: null,
    quantity: "1",
    unit_price: null,
    line_total: null,
  };
  const f = useForm<any>({
    defaultValues: {
      seller: extracted?.seller ?? "",
      invoice_number: extracted?.invoice_number ?? "",
      purchase_date: extracted?.purchase_date ?? "",
      currency: extracted
        ? (extracted.currency ?? "")
        : (me?.profile.currency ?? "INR"),
      subtotal: extracted?.subtotal ?? "",
      tax: extracted?.tax ?? "",
      total: extracted?.total ?? "",
      items: extracted?.items?.length
        ? extracted.items.map((i: any) => ({
            ...emptyItem,
            ...i,
            name: i.name ?? "",
            quantity: i.quantity ?? "",
            category: i.category ?? "Other",
          }))
        : [emptyItem],
    },
  });
  const items = useFieldArray({ control: f.control, name: "items" });
  const [checked, setChecked] = useState(false);
  return (
    <form
      onSubmit={f.handleSubmit(async (values) => {
        setError(undefined);
        const nullable = (v: any) => (v === "" || v == null ? null : String(v));
        const body = {
          ...values,
          seller: nullable(values.seller),
          invoice_number: nullable(values.invoice_number),
          purchase_date: nullable(values.purchase_date),
          subtotal: nullable(values.subtotal),
          tax: nullable(values.tax),
          total: nullable(values.total),
          duplicate_acknowledged: duplicate,
          items: values.items.map((i: any) => ({
            ...i,
            brand: nullable(i.brand),
            model: nullable(i.model),
            serial_number: nullable(i.serial_number),
            unit_price: nullable(i.unit_price),
            line_total: nullable(i.line_total),
          })),
        };
        try {
          const result = await call(`/documents/${document.id}/confirm`, {
            method: "POST",
            body,
          });
          refresh();
          toast(
            `${result.product_ids.length} product record${result.product_ids.length === 1 ? "" : "s"} created.`,
          );
          navigate(`/products/${result.product_ids[0]}`);
        } catch (e) {
          setError(e);
        }
      })}
    >
      <div className="section-heading">
        <div>
          <p className="eyebrow">
            {extracted ? "EXTRACTED · AWAITING YOUR REVIEW" : "MANUAL ENTRY"}
          </p>
          <h2>Purchase details</h2>
        </div>
        <FileText size={20} />
      </div>
      <p className="muted">
        {extracted
          ? "Check each field against the original. Blank fields were not found in the document."
          : "Enter the information shown on your receipt. Leave missing details blank."}
      </p>
      <div className="form-grid">
        {[
          ["seller", "Seller", "text"],
          ["invoice_number", "Invoice number", "text"],
          ["purchase_date", "Purchase date", "date"],
          ["currency", "Currency", "text"],
        ].map(([name, label, type]) => (
          <Field key={name} label={label}>
            <input {...f.register(name)} type={type} />
          </Field>
        ))}
      </div>
      <div className="review-subheading">
        <h3>Products on this invoice</h3>
        <span className="count-badge">{items.fields.length}</span>
      </div>
      {items.fields.map((item, index) => (
        <div key={item.id} className="review-item">
          <div className="section-heading">
            <strong>Item {index + 1}</strong>
            <Button
              type="button"
              variant="ghost"
              aria-label={`Remove item ${index + 1}`}
              disabled={items.fields.length === 1}
              onClick={() => items.remove(index)}
            >
              <Trash2 size={15} />
            </Button>
          </div>
          <Field label="Product name">
            <input {...f.register(`items.${index}.name`)} required />
          </Field>
          <div className="form-grid">
            {[
              ["brand", "Brand"],
              ["model", "Model"],
              ["serial_number", "Serial number"],
              ["quantity", "Quantity"],
              ["unit_price", "Unit price"],
              ["line_total", "Total product cost"],
            ].map(([name, label]) => (
              <Field key={name} label={label}>
                <input {...f.register(`items.${index}.${name}`)} />
              </Field>
            ))}
          </div>
        </div>
      ))}
      <Button
        type="button"
        variant="secondary"
        onClick={() => items.append(emptyItem)}
      >
        <Plus size={15} />
        Add another item
      </Button>
      <details className="invoice-totals">
        <summary>Invoice-level totals</summary>
        <p className="muted">
          Stored separately. These totals are never added again to product
          expenditure.
        </p>
        <div className="form-grid">
          {[
            ["subtotal", "Subtotal"],
            ["tax", "Tax"],
            ["total", "Invoice total"],
          ].map(([name, label]) => (
            <Field key={name} label={label}>
              <input {...f.register(name)} />
            </Field>
          ))}
        </div>
      </details>
      <ErrorNotice error={error} />
      {error instanceof ApiError && error.code === "POSSIBLE_DUPLICATE" && (
        <label className="inline-check">
          <input
            type="checkbox"
            checked={duplicate}
            onChange={(e) => setDuplicate(e.target.checked)}
          />
          These are separate purchases. Create them anyway.
        </label>
      )}
      <label className="review-confirm inline-check">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
        />
        I checked these details against the original document.
      </label>
      <Button
        className="w-full"
        type="submit"
        busy={f.formState.isSubmitting}
        disabled={
          !checked ||
          document.status === "processing" ||
          !document.upload_complete
        }
      >
        <Check size={16} />
        Confirm & create products
      </Button>
      <p className="form-footnote">
        Coverage stays unconfirmed until you check its terms separately.
      </p>
    </form>
  );
}
