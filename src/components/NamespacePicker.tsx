import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Check, ChevronDown, Loader2, Search } from "lucide-react";
import { Popover } from "./Popover";
import { useNamespaceRows } from "../hooks/useResources";
import { classifyReadError } from "../utils/resourceCompare";
import { isTerminating, namespaceNames, namespaceRows } from "../utils/namespaces";

interface Props {
  context: string;
  /** "all" or a namespace name. */
  ns: string;
  setNs: (ns: string) => void;
  /** Absent: no "Manage namespaces" footer. */
  onManage?: () => void;
}

/**
 * The TopBar namespace picker (docs/ux/24 §4.3): picks the scope of every namespaced list and filters a long list.
 * It writes nothing, so read-only mode changes nothing here. Create and delete live on the Namespaces page.
 *
 * Focus rule for every action from inside the panel: focus the trigger first, then close, then act. A ConfirmModal
 * or a page change after it returns focus to what was focused when it opened, and on WebKit a click does not focus
 * a button at all.
 */
export function NamespacePicker({ context, ns, setNs, onManage }: Props) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const act = (run: () => void) => {
    triggerRef.current?.focus();
    setOpen(false);
    run();
  };

  return (
    <div className="relative min-w-[3.25rem] shrink-[10000]">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Namespace: ${ns}`}
        className="group flex items-center gap-1 min-w-0 max-w-full px-1.5 py-1 rounded-sm hover:bg-surface-tint/4 aria-expanded:bg-surface-tint/6 outline-hidden focus-visible:ring-2 focus-visible:ring-accent/70"
      >
        <span className="mono text-[12px] text-ink max-w-[28ch] truncate" title={ns}>{ns}</span>
        <ChevronDown size={12} aria-hidden className={`shrink-0 text-mute transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        triggerRef={triggerRef}
        label="Namespaces"
        className="left-0 top-8 w-80 max-w-[calc(100vw-2rem)] flex flex-col overflow-hidden"
      >
        {/* Mounted only while open: the query and the filter text start fresh on every open. */}
        <PickerBody
          context={context}
          ns={ns}
          onPick={(name) => act(() => setNs(name))}
          onManage={onManage ? () => act(onManage) : undefined}
        />
      </Popover>
    </div>
  );
}

function PickerBody({ context, ns, onPick, onManage }: {
  context: string;
  ns: string;
  onPick: (name: string) => void;
  onManage?: () => void;
}) {
  const { data, isLoading, isSuccess, isFetching, error, refetch } = useNamespaceRows(context);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  // Opening moves focus into the filter (a Popover is not a focus trap).
  useEffect(() => { inputRef.current?.focus(); }, []);

  const names = useMemo(() => (data ? namespaceNames(data) : []), [data]);
  const terminating = useMemo(() => new Set((data ?? []).filter(isTerminating).map((r) => r.name)), [data]);
  const rows = namespaceRows(names, ns, query);
  const q = query.trim();
  const filtering = q !== "" && isSuccess;
  // Every row but "All namespaces", including a selected name that is missing from the list: the same set `rows` is
  // filtered from, so the count never reads "2 of 1".
  const total = namespaceRows(names, ns, "").length - 1;

  const message = error ? ((error as any)?.message ?? String(error)) : "";
  const forbidden = !!error && classifyReadError(message) === "no-access";

  return (
    <>
      <div className="p-2 border-b border-edge">
        <div className="relative">
          <Search size={12} aria-hidden className="absolute left-2 top-1/2 -translate-y-1/2 text-mute pointer-events-none" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // Enter picks the first match of a non-empty filter; with no filter or no match it does nothing.
              if (e.key === "Enter" && !e.nativeEvent.isComposing && q !== "" && rows.length > 0) {
                e.preventDefault();
                onPick(rows[0]);
              }
            }}
            aria-label="Filter namespaces"
            placeholder="Filter namespaces…"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            autoComplete="off"
            className="h-7 w-full pl-7 pr-16 rounded-md bg-surface-input ring-1 ring-mute/70 mono text-[12px] text-ink placeholder:text-mute placeholder:font-sans outline-hidden focus-visible:ring-2 focus-visible:ring-accent/70"
          />
          {filtering && (
            <span aria-hidden className="absolute right-2 top-1/2 -translate-y-1/2 mono text-[11px] tabular-nums text-mute">
              {rows.length} of {total}
            </span>
          )}
        </div>
      </div>
      <div role="status" aria-live="polite" className="sr-only">
        {filtering && rows.length > 0 ? `${rows.length} of ${total} namespaces` : ""}
      </div>

      <div className="max-h-[min(18rem,50vh)] overflow-y-auto overscroll-contain py-1">
        <ul>
          {rows.map((n) => {
            const current = n === ns;
            return (
              <li
                key={n}
                className={`mx-1 flex items-center rounded-sm ${current ? "bg-accent/10" : "hover:bg-surface-tint/6 focus-within:bg-surface-tint/6"}`}
              >
                <button
                  type="button"
                  onClick={() => onPick(n)}
                  aria-current={current ? "true" : undefined}
                  className={`flex-1 min-w-0 h-7 pl-2 pr-2 flex items-center gap-2 rounded-sm text-left outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/70 ${current ? "text-ink" : "text-mute hover:text-ink"}`}
                >
                  <span className="w-3.5 shrink-0 flex justify-center" aria-hidden>
                    {current && <Check size={12} className="text-accent" />}
                  </span>
                  {n === "all" ? (
                    <span className="text-[12px] truncate min-w-0">All namespaces</span>
                  ) : (
                    <span className="mono text-[12px] truncate min-w-0" title={n}>{n}</span>
                  )}
                  {terminating.has(n) && (
                    <span className="ml-auto shrink-0 text-[10.5px] text-purple" title="This namespace is being deleted.">Terminating</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>

        {isLoading && (
          <p role="status" className="flex items-center gap-2 px-3 py-2 text-[11.5px] text-mute">
            <Loader2 size={12} className="animate-spin" aria-hidden />
            Loading namespaces…
          </p>
        )}
        {error && (
          <div role="alert" className="px-3 py-2 flex flex-col gap-1.5">
            {forbidden ? (
              <>
                <p className="text-[11.5px] text-mute">You don't have access to list namespaces in this cluster.</p>
                <p className="text-[11px] text-mute">Only the entries above can be selected.</p>
              </>
            ) : (
              <p className="text-[11.5px] text-bad wrap-break-word">Couldn't load namespaces: {message}.</p>
            )}
            <button
              type="button"
              onClick={() => { if (!isFetching) void refetch(); }}
              aria-disabled={isFetching || undefined}
              className="self-start h-6 px-2 rounded-sm ring-1 ring-edge text-[11.5px] text-mute hover:text-ink outline-hidden focus-visible:ring-2 focus-visible:ring-accent/70"
            >
              {isFetching ? "Retrying…" : "Retry"}
            </button>
          </div>
        )}
        {isSuccess && q !== "" && rows.length === 0 && (
          <p role="status" className="px-3 py-2 text-[11.5px] text-mute break-all">No namespace matches "{q}".</p>
        )}
        {isSuccess && q === "" && names.length === 0 && (
          <p role="status" className="px-3 py-2 text-[11.5px] text-mute">No namespaces found.</p>
        )}
      </div>

      {onManage && (
        <div className="border-t border-edge">
          <button
            type="button"
            onClick={onManage}
            className="w-full h-8 px-3 flex items-center gap-2 text-[12px] text-mute hover:text-ink hover:bg-surface-tint/6 outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/70"
          >
            <ArrowUpRight size={12} aria-hidden />
            Manage namespaces
          </button>
        </div>
      )}
    </>
  );
}
