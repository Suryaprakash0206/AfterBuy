import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Link, useLocation } from "react-router-dom";
import {
  Search,
  Package,
  Upload,
  ShieldCheck,
  ArrowUpRight,
} from "lucide-react";
import { useApp, useWorkspaceQuery } from "../lib/context";
import { Modal, ErrorNotice } from "./ui";

export function QuickSearch() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const command = useRef<HTMLDivElement>(null);
  const moveFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (
      !["ArrowDown", "ArrowUp"].includes(event.key) ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    )
      return;
    const links = Array.from(
      command.current?.querySelectorAll<HTMLAnchorElement>(
        ".command-row, .command-footer",
      ) ?? [],
    );
    if (!links.length) return;
    event.preventDefault();
    const index = links.findIndex((link) => link === document.activeElement);
    const next =
      index < 0
        ? event.key === "ArrowDown"
          ? 0
          : links.length - 1
        : (index + (event.key === "ArrowDown" ? 1 : -1) + links.length) %
          links.length;
    links[next].focus();
    links[next].scrollIntoView({ block: "nearest" });
  };
  const { canEdit, workspaceId } = useApp();
  const location = useLocation();
  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), 200);
    return () => clearTimeout(timer);
  }, [text]);
  useEffect(() => {
    setOpen(false);
    setText("");
    setQuery("");
  }, [location.pathname, workspaceId]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "k" &&
        !event.altKey
      ) {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);
  const results = useWorkspaceQuery<{
    items: { id: string; name: string; brand?: string; model?: string }[];
    total: number;
  }>(`/products?search=${encodeURIComponent(query)}&limit=6&sort=name`, {
    enabled: open && !!query,
  });
  const pending = text.trim() !== query || results.isFetching;
  const close = () => setOpen(false);
  return (
    <>
      <button
        className="icon-button quick-search-trigger"
        aria-label="Search products and shortcuts"
        title="Search products and shortcuts (Ctrl / ⌘ K)"
        onClick={() => setOpen(true)}
      >
        <Search size={19} />
        <span>Search</span>
        <kbd>Ctrl K</kbd>
      </button>
      <Modal
        title="Find it in a moment."
        description="Search your products by name, or jump to your next task. Ctrl / ⌘ K opens this from anywhere."
        open={open}
        onOpenChange={setOpen}
      >
        <div ref={command} onKeyDown={moveFocus}>
          <label className="command-input">
            <Search size={20} />
            <input
              autoFocus
              aria-label="Search product names"
              value={text}
              maxLength={120}
              placeholder="Try washing machine, headphones…"
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          {text.trim() ? (
            <div
              className="command-results"
              aria-live="polite"
              aria-busy={pending}
            >
              {pending ? (
                <p className="command-hint">Searching your collection…</p>
              ) : results.error ? (
                <ErrorNotice
                  error={results.error}
                  retry={() => void results.refetch()}
                />
              ) : (
                <>
                  {!results.data?.items.length && (
                    <p className="command-hint">
                      No matching products. Try another name.
                    </p>
                  )}
                  {results.data?.items.map((product) => (
                    <Link
                      key={product.id}
                      className="command-row"
                      to={`/products/${product.id}`}
                      onClick={close}
                    >
                      <Package size={19} />
                      <span>
                        <strong>{product.name}</strong>
                        <small>
                          {[product.brand, product.model]
                            .filter(Boolean)
                            .join(" · ") || "Open product details"}
                        </small>
                      </span>
                      <ArrowUpRight size={16} />
                    </Link>
                  ))}
                  {!!results.data?.total && (
                    <Link
                      className="command-footer"
                      to={`/products?search=${encodeURIComponent(query)}`}
                      onClick={close}
                    >
                      View all {results.data.total} matching products{" "}
                      <ArrowUpRight size={15} />
                    </Link>
                  )}
                </>
              )}
            </div>
          ) : (
            <div className="command-results">
              <p className="eyebrow">QUICK ACTIONS</p>
              {canEdit && (
                <Link
                  className="command-row"
                  to="/documents/upload"
                  onClick={close}
                >
                  <Upload size={19} />
                  <span>
                    <strong>Add a purchase</strong>
                    <small>Scan an invoice or receipt</small>
                  </span>
                  <ArrowUpRight size={16} />
                </Link>
              )}
              <Link className="command-row" to="/products" onClick={close}>
                <Package size={19} />
                <span>
                  <strong>Browse my products</strong>
                  <small>Your collection, in one place</small>
                </span>
                <ArrowUpRight size={16} />
              </Link>
              <Link className="command-row" to="/coverage" onClick={close}>
                <ShieldCheck size={19} />
                <span>
                  <strong>Check coverage</strong>
                  <small>Warranty dates and return windows</small>
                </span>
                <ArrowUpRight size={16} />
              </Link>
            </div>
          )}
          <p className="command-key-hints">
            <span>↑ ↓ move</span>
            <span>Enter opens a focused link</span>
            <span>Esc close</span>
          </p>
        </div>
      </Modal>
    </>
  );
}
