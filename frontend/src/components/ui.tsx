import {
  useState,
  useId,
  type ReactNode,
  type ButtonHTMLAttributes,
} from "react";
import { Link } from "react-router-dom";
import * as Dialog from "@radix-ui/react-dialog";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import {
  AlertCircle,
  ArrowRight,
  Check,
  FileText,
  LoaderCircle,
  X,
  Inbox,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { ApiError } from "../lib/api";
export function Button({
  children,
  variant = "primary",
  busy = false,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
  busy?: boolean;
}) {
  return (
    <button
      {...props}
      disabled={props.disabled || busy}
      className={`btn btn-${variant} ${className}`}
    >
      {busy ? <LoaderCircle className="spin" size={16} /> : null}
      {children}
    </button>
  );
}
export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p className="muted">{description}</p>}
      </div>
      {action && <div className="actions">{action}</div>}
    </header>
  );
}
export function Empty({
  title,
  description,
  action,
  icon = <Inbox size={28} />,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function ErrorNotice({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  if (!error) return null;
  return (
    <div className="notice error" role="alert">
      <AlertCircle size={19} />
      <div>
        <strong>Something needs attention</strong>
        <p>{error instanceof Error ? error.message : String(error)}</p>
        {error instanceof ApiError && error.requestId && (
          <small>Request {error.requestId}</small>
        )}
        {retry && (
          <Button variant="secondary" onClick={retry}>
            Try again
          </Button>
        )}
      </div>
    </div>
  );
}
export function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="notice">
      <AlertCircle size={18} />
      <div>{children}</div>
    </div>
  );
}
export function Loading({
  label = "Loading your records…",
}: {
  label?: string;
}) {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={22} />
      {label}
    </div>
  );
}
export function QueryState({
  query,
  children,
}: {
  query: { isPending: boolean; error: unknown; refetch: () => unknown };
  children: ReactNode;
}) {
  return query.isPending ? (
    <Loading />
  ) : query.error ? (
    <ErrorNotice error={query.error} retry={() => void query.refetch()} />
  ) : (
    children
  );
}
export function Status({ children }: { children: ReactNode }) {
  return (
    <span className="status">
      <span aria-hidden="true" />
      {String(children).replaceAll("_", " ")}
    </span>
  );
}
export function Modal({
  title,
  description,
  open,
  onOpenChange,
  children,
  wide = false,
}: {
  title: string;
  description?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content className={`modal ${wide ? "modal-wide" : ""}`}>
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Description className="muted">
            {description || "Update the details below and save your changes."}
          </Dialog.Description>
          <Dialog.Close
            className="icon-button modal-close"
            aria-label="Close dialog"
          >
            <X size={20} />
          </Dialog.Close>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function ConfirmButton({
  title,
  description,
  onConfirm,
  children,
}: {
  title: string;
  description: string;
  onConfirm: () => Promise<unknown>;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  return (
    <AlertDialog.Root open={open} onOpenChange={setOpen}>
      <AlertDialog.Trigger asChild>
        <Button variant="ghost">{children}</Button>
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="modal-overlay" />
        <AlertDialog.Content className="modal">
          <AlertDialog.Title>{title}</AlertDialog.Title>
          <AlertDialog.Description>{description}</AlertDialog.Description>
          <ErrorNotice error={error} />
          <div className="actions end">
            <AlertDialog.Cancel asChild>
              <Button variant="secondary">Cancel</Button>
            </AlertDialog.Cancel>
            <Button
              busy={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onConfirm();
                  setOpen(false);
                } catch (e) {
                  setError(e);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Confirm
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export type FormField = {
  name: string;
  label: string;
  type?:
    | "text"
    | "date"
    | "number"
    | "textarea"
    | "select"
    | "checkbox"
    | "email"
    | "password";
  options?: { value: string; label: string }[];
  nullable?: boolean;
  hint?: string;
  placeholder?: string;
  full?: boolean;
};
export function RecordForm({
  schema,
  fields,
  values,
  onSubmit,
  submitLabel = "Save changes",
  children,
}: {
  schema: z.ZodType;
  fields: FormField[];
  values?: any;
  onSubmit: (v: any) => Promise<unknown>;
  submitLabel?: string;
  children?: ReactNode;
}) {
  const form = useForm<any>({
    resolver: zodResolver(schema as any),
    defaultValues: values,
  });
  const [error, setError] = useState<unknown>();
  const id = useId();
  return (
    <form
      onSubmit={form.handleSubmit(async (v) => {
        setError(undefined);
        try {
          await onSubmit(v);
        } catch (e) {
          setError(e);
        }
      })}
      noValidate
    >
      <div className="form-grid">
        {fields.map((f) => {
          const error = form.formState.errors[f.name];
          const props = form.register(f.name, {
            setValueAs:
              f.type === "number"
                ? (v) => (v === "" || v == null ? null : Number(v))
                : f.nullable
                  ? (v) => (v === "" ? null : v)
                  : undefined,
          });
          return (
            <label
              className={`field ${f.full ? "full" : ""} ${f.type === "checkbox" ? "check-field" : ""}`}
              key={f.name}
              htmlFor={`${id}-${f.name}`}
            >
              <span>{f.label}</span>
              {f.type === "textarea" ? (
                <textarea
                  id={`${id}-${f.name}`}
                  {...props}
                  rows={4}
                  aria-invalid={!!error}
                />
              ) : f.type === "select" ? (
                <select
                  id={`${id}-${f.name}`}
                  {...props}
                  aria-invalid={!!error}
                >
                  {f.options?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id={`${id}-${f.name}`}
                  type={f.type || "text"}
                  {...props}
                  placeholder={f.placeholder}
                  aria-invalid={!!error}
                />
              )}{" "}
              {f.hint && <small>{f.hint}</small>}
              {error && (
                <small className="field-error" role="alert">
                  {String(error.message)}
                </small>
              )}
            </label>
          );
        })}
      </div>
      {children}
      <ErrorNotice
        error={
          error ||
          Object.values(form.formState.errors)
            .map((e) => e?.message)
            .filter(Boolean)
            .join("; ")
        }
      />
      <div className="form-footer">
        <Button type="submit" busy={form.formState.isSubmitting}>
          <Check size={16} />
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
export function RowLink({
  to,
  title,
  description,
  trailing,
  icon = <FileText size={18} />,
}: {
  to: string;
  title: string;
  description?: string;
  trailing?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <Link to={to} className="row-link">
      <span className="row-icon">{icon}</span>
      <span className="row-body">
        <strong>{title}</strong>
        {description && <small>{description}</small>}
      </span>
      {trailing}
      <ArrowRight size={16} />
    </Link>
  );
}
