import { useState, useRef, useEffect, lazy, Suspense } from "react";
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
import { coverageDates, quantitySchema } from "../../../shared/domain";
import {
  readReviewDraft,
  writeReviewDraft,
  removeReviewDraft,
  reviewDraftKey,
} from "../lib/review-drafts";
import {
  emptyReviewItem,
  reviewValues,
  mergeReviewValues,
  hasReviewEdits,
} from "../lib/review-values";
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
const scanErrorMessages: Record<string, string> = {
  AI_NOT_CONFIGURED:
    "The scanner is not configured. You can enter details manually.",
  AI_RATE_LIMIT:
    "Groq’s usage limit was reached. Wait before choosing Retry extraction.",
  AI_CREDENTIALS:
    "The scanner cannot authenticate with Groq. Check the backend key and model permissions.",
  AI_MODEL_UNAVAILABLE:
    "The selected Groq model is unavailable or does not support this scan. Check the scanner configuration.",
  AI_INCOMPLETE:
    "The scanner could not finish reading the document. Try fewer pages or enter details manually.",
  SCAN_TIME_LIMIT:
    "This scan took too long. Split the document into smaller files and retry.",
};
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
                "The scanner reads your photo or invoice and fills in the details automatically when connected.",
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
  const q = useWorkspaceQuery(`/documents/${id}`, { poll: 2000 });
  const { canEdit, refresh, toast, session, workspaceId } = useApp();
  const call = useWorkspaceApi();
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const d = q.data?.document;
  const extraction = q.data?.extraction;
  async function deleteDocument(deleteProducts = false) {
    const result = await call(`/documents/${d.id}`, {
      method: "DELETE",
      body: { delete_created_products: deleteProducts },
    });
    if (session)
      removeReviewDraft(reviewDraftKey(session.user.id, workspaceId, d.id));
    refresh();
    toast(
      result.status === "deleted"
        ? deleteProducts
          ? "Document and its created products deleted."
          : "Document deleted. Saved products were kept."
        : "Document hidden. File cleanup is pending and will retry automatically.",
    );
    navigate("/documents");
  }
  if (!q.data && q.error instanceof ApiError && q.error.code === "NOT_FOUND")
    return (
      <>
        <PageHeader
          title="Document unavailable"
          description="This document may have been deleted or belongs to a different workspace."
        />
        <Empty
          title="Let’s get you back to your documents."
          description="Check the selected workspace, or upload the invoice again. Existing product records are not changed."
          action={
            <div className="actions">
              <Link className="btn btn-secondary" to="/documents">
                View documents
              </Link>
              {canEdit && (
                <Link className="btn btn-primary" to="/documents/upload">
                  Upload invoice again
                </Link>
              )}
            </div>
          }
        />
      </>
    );
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
      <QueryState query={{ ...q, error: q.data ? null : q.error }}>
        {d && (
          <>
            <ErrorNotice error={error} />
            <ErrorNotice error={q.error} retry={() => void q.refetch()} />
            <p className="muted">
              Document assistant index: <Status>{d.index_status}</Status>
            </p>
            {d.error_code && (
              <Notice>
                <strong>{d.error_code.replaceAll("_", " ")}</strong>
                <p>
                  {scanErrorMessages[d.error_code] ??
                    "Processing needs attention. Check the original and enter details manually, or retry when the service is available."}
                </p>
              </Notice>
            )}
            {["queued", "processing"].includes(d.status) &&
              (d.status === "processing" ? (
                <Loading label="Scanning your document. Details will appear automatically below…" />
              ) : q.data.scanner?.configured === false ? (
                <Notice>
                  <strong>Automatic scanning needs setup.</strong>
                  <p>
                    Your original is saved. The document scanner is not
                    connected yet, so it cannot fill these fields. You can enter
                    details manually or return after the scanner is configured.
                  </p>
                  <Link className="text-link" to="/settings">
                    View connected services
                  </Link>
                </Notice>
              ) : q.data.scanner?.available === false ? (
                <Notice>
                  <strong>The document scanner is offline.</strong>
                  <p>
                    Your upload is saved and will be picked up when the{" "}
                    {q.data.scanner.reason === "queue"
                      ? "queue connection"
                      : "background worker"}{" "}
                    returns. You can keep reviewing the original.
                  </p>
                </Notice>
              ) : (
                <Loading label="Waiting to scan. The details will fill in automatically…" />
              ))}
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
                    key={d.id}
                    document={d}
                    extracted={extraction?.result}
                    extractionId={extraction?.id}
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
                      Review and assign invoice warranties in the form above.
                      For other document types, use the product’s Coverage tab.
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
                  description="Delete the stored file and document record. Products and warranties already saved from this invoice are kept. Use the separate delete-products option if you want to remove those too."
                  onConfirm={() => deleteDocument()}
                >
                  <Trash2 size={16} />
                  Delete document
                </ConfirmButton>
                {!!d.accepted_product_ids?.length && (
                  <ConfirmButton
                    title="Delete document and created products?"
                    description={`Permanently delete this document and the ${d.accepted_product_ids.length} product record(s) originally created from it, including their warranties, service cases and reminders. Other uploaded documents are kept. This cannot be undone.`}
                    onConfirm={() => deleteDocument(true)}
                  >
                    <Trash2 size={16} />
                    Delete document and created products
                  </ConfirmButton>
                )}
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
  extractionId,
}: {
  document: any;
  extracted: any;
  extractionId?: string;
}) {
  const { me, refresh, toast, session, workspaceId } = useApp();
  const call = useWorkspaceApi();
  const navigate = useNavigate();
  const [error, setError] = useState<unknown>();
  const [duplicate, setDuplicate] = useState(false);
  const emptyItem = emptyReviewItem;
  const draftKey = reviewDraftKey(session!.user.id, workspaceId, document.id);
  const [restoredDraft] = useState(() => readReviewDraft(draftKey));
  const preserveDraft = useRef(!!restoredDraft);
  const [draftStatus, setDraftStatus] = useState(
    restoredDraft ? "restored" : "empty",
  );
  const savingDraft = useRef(true);
  const f = useForm<any>({
    defaultValues:
      restoredDraft ?? reviewValues(extracted, me?.profile.currency ?? "INR"),
  });
  const items = useFieldArray({ control: f.control, name: "items" });
  const warranties = useFieldArray({ control: f.control, name: "warranties" });
  const [checked, setChecked] = useState(false);
  const [keptItems, setKeptItems] = useState(false);
  const applied = useRef(extracted ? extractionId : undefined);
  const { dirtyFields } = f.formState;
  useEffect(() => {
    if (!extracted || !extractionId || applied.current === extractionId) return;
    applied.current = extractionId;
    setKeptItems(
      preserveDraft.current ||
        hasReviewEdits(dirtyFields.items) ||
        hasReviewEdits(dirtyFields.warranties),
    );
    f.reset(
      mergeReviewValues(
        f.getValues(),
        reviewValues(extracted),
        preserveDraft.current
          ? Object.fromEntries(
              Object.keys(f.getValues()).map((key) => [key, true]),
            )
          : dirtyFields,
      ),
      { keepDirty: true },
    );
    setChecked(false);
    setDuplicate(false);
    setError(undefined);
    toast(
      "Scan complete. Found details are filled in; your edits have been kept.",
    );
  }, [extracted, extractionId, dirtyFields, f, toast]);
  useEffect(() => {
    const subscription = f.watch((values) => {
      if (!savingDraft.current) return;
      setDraftStatus(
        writeReviewDraft(draftKey, values) ? "saved" : "unavailable",
      );
    });
    return () => subscription.unsubscribe();
  }, [f, draftKey]);
  return (
    <form
      onChange={() => {
        setChecked(false);
        setDuplicate(false);
      }}
      onSubmit={f.handleSubmit(async (values) => {
        if (!checked) return;
        setError(undefined);
        const nullable = (v: any) => (v === "" || v == null ? null : String(v));
        const body = {
          ...values,
          currency: values.currency.trim().toUpperCase(),
          seller: nullable(values.seller),
          invoice_number: nullable(values.invoice_number),
          purchase_date: nullable(values.purchase_date),
          subtotal: nullable(values.subtotal),
          tax: nullable(values.tax),
          total: nullable(values.total),
          duplicate_acknowledged: duplicate,
          warranties: values.warranties.map((w: any) => ({
            ...w,
            item_index: w.item_index === "" ? null : Number(w.item_index),
            provider: nullable(w.provider),
            explicit_start: nullable(w.explicit_start),
            explicit_end: nullable(w.explicit_end),
            duration_months:
              w.duration_months === "" || w.duration_months == null
                ? null
                : Number(w.duration_months),
            duration_days:
              w.duration_days === "" || w.duration_days == null
                ? null
                : Number(w.duration_days),
            conditions: nullable(w.conditions),
            exclusions: nullable(w.exclusions),
            uncertainty: nullable(w.uncertainty),
          })),
          items: values.items.map((i: any) => ({
            ...i,
            quantity: quantitySchema.parse(i.quantity),
            brand: nullable(i.brand),
            model: nullable(i.model),
            serial_number: nullable(i.serial_number),
            specifications: nullable(i.specifications),
            unit_price: nullable(i.unit_price),
            line_total: nullable(i.line_total),
          })),
        };
        try {
          const result = await call(`/documents/${document.id}/confirm`, {
            method: "POST",
            body,
          });
          savingDraft.current = false;
          removeReviewDraft(draftKey);
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
      <div className="draft-status">
        <div>
          <strong>
            {draftStatus === "restored"
              ? "Your unfinished review is restored."
              : draftStatus === "saved"
                ? "Draft saved on this browser."
                : draftStatus === "unavailable"
                  ? "This browser could not save your draft."
                  : "Your edits will be saved as a draft."}
          </strong>
          <small>
            {draftStatus === "unavailable"
              ? "Keep this page open until you confirm your details."
              : "Saved on this device. Drafts expire after 7 days and are cleared when you sign out. Review and confirm before creating products."}
          </small>
        </div>
        <ConfirmButton
          title="Discard your review edits?"
          description="This clears this invoice’s local draft and restores the latest scanned details. Your uploaded invoice and existing products stay saved."
          onConfirm={async () => {
            savingDraft.current = false;
            preserveDraft.current = false;
            removeReviewDraft(draftKey);
            f.reset(reviewValues(extracted, me?.profile.currency ?? "INR"));
            setChecked(false);
            setDuplicate(false);
            setKeptItems(false);
            setError(undefined);
            setDraftStatus("empty");
            savingDraft.current = true;
          }}
        >
          Discard edits
        </ConfirmButton>
      </div>
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
      {keptItems && extracted?.items?.length > 0 && (
        <Notice>
          <strong>Your product edits were kept.</strong>
          <p>
            The scanner found {extracted.items.length} item(s). Your edited list
            stays in place because matching items by row could overwrite your
            work.
          </p>
          <ConfirmButton
            title="Use the scanned product list?"
            description="This replaces your current product rows and warranty associations with the scanner’s suggestions. Your seller, invoice date and invoice totals stay as they are. Review the suggested items before confirming."
            onConfirm={async () => {
              items.replace(reviewValues(extracted).items);
              warranties.replace(reviewValues(extracted).warranties);
              setKeptItems(false);
              setChecked(false);
            }}
          >
            Use scanned product list
          </ConfirmButton>
        </Notice>
      )}
      <div className="form-grid">
        {[
          ["seller", "Seller", "text"],
          ["invoice_number", "Invoice number", "text"],
          ["purchase_date", "Purchase date", "date"],
          ["currency", "Currency", "text"],
        ].map(([name, label, type]) => (
          <Field key={name} label={label}>
            <input
              {...f.register(name)}
              type={type}
              maxLength={name === "currency" ? 3 : undefined}
              pattern={name === "currency" ? "[A-Za-z]{3}" : undefined}
            />
            {name === "currency" && (
              <small>
                Three-letter code, such as INR. Enter prices in the amount
                fields.
              </small>
            )}
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
              onClick={() => {
                items.remove(index);
                warranties.replace(
                  f.getValues("warranties").map((w: any) => ({
                    ...w,
                    item_index:
                      w.item_index === "" || Number(w.item_index) === index
                        ? ""
                        : Number(w.item_index) > index
                          ? Number(w.item_index) - 1
                          : Number(w.item_index),
                  })),
                );
                setChecked(false);
              }}
            >
              <Trash2 size={15} />
            </Button>
          </div>
          <Field label="Product name">
            <input {...f.register(`items.${index}.name`)} required />
          </Field>
          <Field label="Specifications">
            <textarea
              {...f.register(`items.${index}.specifications`)}
              placeholder="Not provided on the invoice"
            />
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
                <input
                  {...f.register(
                    `items.${index}.${name}`,
                    name === "quantity"
                      ? {
                          validate: (value) => {
                            const result = quantitySchema.safeParse(value);
                            return (
                              result.success || result.error.issues[0].message
                            );
                          },
                        }
                      : {},
                  )}
                  inputMode={name === "quantity" ? "decimal" : undefined}
                  aria-invalid={
                    name === "quantity" &&
                    !!(f.formState.errors.items as any)?.[index]?.quantity
                  }
                  aria-describedby={
                    name === "quantity" ? `quantity-hint-${index}` : undefined
                  }
                />
                {name === "quantity" && (
                  <small
                    id={`quantity-hint-${index}`}
                    role={
                      (f.formState.errors.items as any)?.[index]?.quantity
                        ? "alert"
                        : undefined
                    }
                  >
                    {String(
                      (f.formState.errors.items as any)?.[index]?.quantity
                        ?.message ??
                        "Required. Enter the quantity shown on the invoice, for example 1.",
                    )}
                  </small>
                )}
              </Field>
            ))}
          </div>
        </div>
      ))}
      <Button
        type="button"
        variant="secondary"
        onClick={() => {
          items.append({ ...emptyItem });
          setChecked(false);
        }}
      >
        <Plus size={15} />
        Add another item
      </Button>
      <div className="review-subheading">
        <h3>Warranty details</h3>
      </div>
      <p className="muted">
        Assign each warranty to its product. Missing terms stay blank. Confirm
        dates only when the invoice supports them; otherwise the warranty is
        saved as unconfirmed.
      </p>
      {!warranties.fields.length && (
        <Notice>
          No warranty details were found or entered. No warranty will be
          assumed.
        </Notice>
      )}
      {warranties.fields.map((w, index) => (
        <div className="review-item" key={w.id}>
          <div className="section-heading">
            <strong>Warranty {index + 1}</strong>
            <Button
              type="button"
              variant="ghost"
              aria-label={`Remove warranty ${index + 1}`}
              onClick={() => {
                warranties.remove(index);
                setChecked(false);
              }}
            >
              <Trash2 size={15} />
            </Button>
          </div>
          <Field label="Covered product">
            <select {...f.register(`warranties.${index}.item_index`)} required>
              <option value="">Choose the matching product</option>
              {f.watch("items").map((item: any, i: number) => (
                <option key={i} value={i}>
                  {i + 1}. {item.name || "Unnamed product"}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Warranty type">
            <select {...f.register(`warranties.${index}.kind`)} required>
              <option value="">Choose the stated type</option>
              <option value="manufacturer">Manufacturer warranty</option>
              <option value="extended">Extended warranty</option>
              <option value="repair">Repair warranty</option>
              <option value="return">Return policy</option>
            </select>
          </Field>
          <Field label="Warranty provider">
            <input
              {...f.register(`warranties.${index}.provider`)}
              placeholder="Not provided"
            />
          </Field>
          <Field label="Warranty starts from">
            <select {...f.register(`warranties.${index}.basis`)}>
              <option value="explicit">
                Stated date below (leave blank if unknown)
              </option>
              <option value="purchase">Purchase date — only if stated</option>
              <option value="delivery">Delivery date — only if stated</option>
            </select>
          </Field>
          <div className="form-grid">
            {[
              ["explicit_start", "Stated start date", "date"],
              ["explicit_end", "Stated end date", "date"],
              ["duration_months", "Warranty months", "number"],
              ["duration_days", "Or warranty days", "number"],
            ].map(([name, label, type]) => (
              <Field key={name} label={label}>
                <input
                  {...f.register(`warranties.${index}.${name}`)}
                  type={type}
                  min={type === "number" ? 0 : undefined}
                />
              </Field>
            ))}
          </div>
          <WarrantyDates
            value={f.watch(`warranties.${index}`)}
            purchaseDate={f.watch("purchase_date")}
          />
          {[
            ["conditions", "Warranty terms and source"],
            ["exclusions", "Exclusions"],
            ["uncertainty", "Unknown or conflicting terms"],
          ].map(([name, label]) => (
            <Field key={name} label={label}>
              <textarea {...f.register(`warranties.${index}.${name}`)} />
            </Field>
          ))}
          <label className="inline-check">
            <input
              type="checkbox"
              {...f.register(`warranties.${index}.confirmed`)}
            />
            I checked this warranty’s provider, terms and dates.
          </label>
        </div>
      ))}
      <Button
        type="button"
        variant="secondary"
        onClick={() => {
          warranties.append({
            item_index: "",
            kind: "",
            provider: "",
            basis: "explicit",
            explicit_start: "",
            explicit_end: "",
            duration_months: "",
            duration_days: "",
            conditions: "",
            exclusions: "",
            uncertainty: "",
            confirmed: false,
          });
          setChecked(false);
        }}
      >
        <Plus size={15} />
        Add warranty from invoice
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
            onChange={(e) => {
              e.stopPropagation();
              setDuplicate(e.target.checked);
            }}
          />
          These are separate purchases. Create them anyway.
        </label>
      )}
      <label className="review-confirm inline-check">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => {
            e.stopPropagation();
            setChecked(e.target.checked);
          }}
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
        Product details and assigned warranties are saved together. Only
        warranties whose dates you explicitly confirmed can create reminders.
      </p>
    </form>
  );
}

function WarrantyDates({
  value,
  purchaseDate,
}: {
  value: any;
  purchaseDate: string;
}) {
  try {
    const dates = coverageDates(
      {
        ...value,
        explicit_start: value.explicit_start || null,
        explicit_end: value.explicit_end || null,
        duration_months:
          value.duration_months === "" || value.duration_months == null
            ? null
            : Number(value.duration_months),
        duration_days:
          value.duration_days === "" || value.duration_days == null
            ? null
            : Number(value.duration_days),
      },
      { purchase_date: purchaseDate || null },
    );
    return (
      <p className="muted">
        Coverage dates: {date(dates.start_date)} to {date(dates.end_date)}. A
        stated end date takes precedence over duration.
      </p>
    );
  } catch {
    return <Notice>Check the warranty dates and duration.</Notice>;
  }
}
