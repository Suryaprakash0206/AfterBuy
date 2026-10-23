import { useState } from "react";
import { Link } from "react-router-dom";
import { Plus, ShieldCheck, Pencil, Trash2 } from "lucide-react";
import { coverageSchema } from "../../../shared/domain";
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
  Notice,
  ConfirmButton,
  Field,
  type FormField,
} from "../components/ui";
export function Coverage() {
  const q = useWorkspaceQuery("/coverage");
  const products = useWorkspaceQuery("/products?limit=100");
  const [open, setOpen] = useState(false);
  const [productId, setProductId] = useState("");
  const { canEdit } = useApp();
  const [filter, setFilter] = useState("all");
  const items = q.data?.filter(
    (c: any) =>
      (filter === "all" ||
        (filter === "confirmed" && c.confirmed) ||
        (filter === "unconfirmed" && !c.confirmed)) &&
      !c.product?.archived_at,
  );
  return (
    <>
      <PageHeader
        eyebrow="A LITTLE CLARITY GOES A LONG WAY"
        title="Coverage & deadlines"
        description="Return windows and warranties, with the facts and the fine print."
        action={
          canEdit && (
            <Button onClick={() => setOpen(true)}>
              <Plus size={16} />
              Add coverage
            </Button>
          )
        }
      />
      <Notice>
        Being within a recorded coverage period does not mean a particular issue
        is covered. Check the conditions and provider’s assessment.
      </Notice>
      <div className="filter-tabs">
        {["all", "confirmed", "unconfirmed"].map((v) => (
          <button
            key={v}
            aria-pressed={filter === v}
            onClick={() => setFilter(v)}
          >
            {v === "all"
              ? "All coverage"
              : v === "confirmed"
                ? "Confirmed"
                : "Needs confirmation"}
          </button>
        ))}
      </div>
      <QueryState query={q}>
        <CoverageList records={items || []} />
      </QueryState>
      <Modal
        title="Choose a product"
        open={open && !productId}
        onOpenChange={setOpen}
      >
        <Field label="Product">
          <select
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
          >
            <option value="">Select a product</option>
            {products.data?.items.map((p: any) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        {!products.data?.items.length && (
          <Link to="/products/new" className="btn btn-secondary">
            Add your first product
          </Link>
        )}
      </Modal>
      {productId && (
        <CoverageDialog
          product={products.data?.items.find((p: any) => p.id === productId)}
          open={open}
          onOpenChange={(v) => {
            setOpen(v);
            if (!v) setProductId("");
          }}
        />
      )}
    </>
  );
}
export function CoverageList({
  records,
  product,
}: {
  records: any[];
  product?: any;
}) {
  const [editing, setEditing] = useState<any>();
  const { canEdit, refresh, toast } = useApp();
  const call = useWorkspaceApi();
  if (!records.length)
    return (
      <Empty
        icon={<ShieldCheck size={30} />}
        title="Coverage starts with the facts."
        description="Record a return policy or warranty. Confirm its dates and source before reminders are activated."
      />
    );
  return (
    <>
      <div className="coverage-list">
        {records.map((c) => (
          <article key={c.id} className="coverage-card">
            <div className="coverage-mark">
              <ShieldCheck size={24} />
            </div>
            <div className="coverage-body">
              <div className="coverage-title">
                <div>
                  <p className="eyebrow">
                    {c.kind === "return"
                      ? "SELLER RETURN POLICY"
                      : `${c.kind} WARRANTY`}
                  </p>
                  <h3>{c.provider}</h3>
                  {!product && (
                    <Link to={`/products/${c.product_id}`}>
                      {c.product?.name}
                    </Link>
                  )}
                </div>
                <Status>{c.confirmed ? "Confirmed" : "Unconfirmed"}</Status>
              </div>
              <div className="coverage-dates">
                <span>
                  <small>RECORDED START</small>
                  <strong>{date(c.start_date)}</strong>
                </span>
                <span className="date-line" />
                <span>
                  <small>RECORDED END</small>
                  <strong>{date(c.end_date)}</strong>
                </span>
              </div>
              <p className="muted">
                Start basis:{" "}
                {c.basis === "explicit"
                  ? "Explicitly entered"
                  : `${c.basis} date`}
                {c.components ? ` · Applies to ${c.components}` : ""}
              </p>
              {c.uncertainty && <Notice>{c.uncertainty}</Notice>}
              {(c.conditions || c.exclusions) && (
                <details>
                  <summary>Conditions & exclusions</summary>
                  {c.conditions && <p>Conditions: {c.conditions}</p>}
                  {c.exclusions && <p>Exclusions: {c.exclusions}</p>}
                </details>
              )}
              {c.source_document_id && (
                <Link
                  className="text-link"
                  to={`/documents/${c.source_document_id}/review`}
                >
                  View source document ↗
                </Link>
              )}
              {canEdit && (
                <div className="actions">
                  <Button variant="ghost" onClick={() => setEditing(c)}>
                    <Pencil size={14} />
                    Edit
                  </Button>
                  <ConfirmButton
                    title="Delete coverage?"
                    description="This removes the record and its reminders."
                    onConfirm={async () => {
                      await call(`/coverage/${c.id}`, { method: "DELETE" });
                      refresh();
                      toast("Coverage removed.");
                    }}
                  >
                    <Trash2 size={14} />
                    Delete
                  </ConfirmButton>
                </div>
              )}
            </div>
          </article>
        ))}
      </div>
      {editing && (
        <CoverageDialog
          product={product || { id: editing.product_id }}
          record={editing}
          open={!!editing}
          onOpenChange={() => setEditing(undefined)}
        />
      )}
    </>
  );
}
export function CoverageDialog({
  product,
  record,
  open,
  onOpenChange,
}: {
  product: any;
  record?: any;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { refresh, toast } = useApp();
  const call = useWorkspaceApi();
  const docs = useWorkspaceQuery(`/products/${product?.id}`, {
    enabled: open && !!product?.id,
  });
  if (!product) return null;
  const fields: FormField[] = [
    {
      name: "kind",
      label: "Coverage type",
      type: "select",
      options: [
        { value: "return", label: "Seller return policy" },
        { value: "manufacturer", label: "Manufacturer warranty" },
        { value: "extended", label: "Extended warranty" },
        { value: "repair", label: "Repair warranty" },
      ],
    },
    { name: "provider", label: "Provider" },
    {
      name: "source_document_id",
      label: "Source document",
      nullable: true,
      type: "select",
      options: [
        { value: "", label: "No source document" },
        ...(docs.data?.documents || []).map((d: any) => ({
          value: d.id,
          label: d.name,
        })),
      ],
    },
    { name: "components", label: "Applicable components", nullable: true },
    {
      name: "basis",
      label: "Coverage starts from",
      type: "select",
      options: [
        { value: "explicit", label: "An explicitly stated date" },
        { value: "purchase", label: "Purchase date" },
        { value: "delivery", label: "Delivery date" },
      ],
    },
    {
      name: "explicit_start",
      label: "Explicit start date",
      type: "date",
      nullable: true,
    },
    {
      name: "duration_months",
      label: "Duration in calendar months",
      type: "number",
      nullable: true,
    },
    {
      name: "duration_days",
      label: "Or duration in days",
      type: "number",
      nullable: true,
    },
    {
      name: "explicit_end",
      label: "Or explicit end date",
      type: "date",
      nullable: true,
      hint: "An explicit end date takes precedence over duration.",
    },
    {
      name: "uncertainty",
      label: "Unknown or conflicting terms",
      nullable: true,
    },
    {
      name: "conditions",
      label: "Conditions",
      type: "textarea",
      nullable: true,
    },
    {
      name: "exclusions",
      label: "Exclusions",
      type: "textarea",
      nullable: true,
    },
    {
      name: "confirmed",
      label: "I checked these terms and confirm the dates.",
      type: "checkbox",
      full: true,
      hint: "Only confirmed dates can create deadline reminders.",
    },
  ];
  return (
    <Modal
      wide
      title={record ? "Edit coverage" : "Record coverage"}
      description="Use the stated terms. Leave anything uncertain unconfirmed."
      open={open}
      onOpenChange={onOpenChange}
    >
      <RecordForm
        schema={coverageSchema}
        fields={fields}
        values={
          record
            ? Object.fromEntries(
                Object.keys(coverageSchema.shape).map((k) => [
                  k,
                  record[k] ?? null,
                ]),
              )
            : {
                product_id: product.id,
                kind: "manufacturer",
                provider: "",
                basis: "explicit",
                confirmed: false,
                source_document_id: null,
                duration_months: null,
                duration_days: null,
                explicit_start: null,
                explicit_end: null,
              }
        }
        onSubmit={async (v) => {
          await call(record ? `/coverage/${record.id}` : "/coverage", {
            method: record ? "PATCH" : "POST",
            body: v,
          });
          refresh();
          toast(
            "Coverage saved. Confirmed reminders will be reconciled by the worker.",
          );
          onOpenChange(false);
        }}
        submitLabel="Save coverage"
      />
    </Modal>
  );
}
