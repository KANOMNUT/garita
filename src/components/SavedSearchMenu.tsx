import { useEffect, useRef, useState } from "react";
import { Bookmark, X } from "lucide-react";
import { Popover } from "./Popover";
import { disabledAttrs } from "../utils/guardrails";
import {
  FOOTNOTE, hasName, insertAt, loadView, nameFor, PODS_FOOTNOTE, removeAt, saveDisabledReason, saveView, suggestName, upsert,
  type SavedSearch, type StoreLike,
} from "../utils/savedSearches";

// #40 (docs/ux/04 §3.18, §4.16, §5.14, §6.2). Search text only; the namespace and sort are never saved.
// Local UI state, not a cluster write: read-only mode does not touch it.

const store = (): StoreLike | null => {
  try { return window.localStorage; } catch { return null; }
};

interface Props {
  /** A ResourceType, or `crd-instances:<crd name>` (B-16). */
  viewKey: string;
  /** "Pods", "widgets.acme.io" ... */
  label: string;
  search: string;
  onPick: (text: string) => void;
}

export function SavedSearchMenu({ viewKey, label, search, onPick }: Props) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<SavedSearch[]>([]);
  const [corrupt, setCorrupt] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [name, setName] = useState("");
  const [undo, setUndo] = useState<{ entry: SavedSearch; index: number } | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [status, setStatus] = useState("");
  // Bumped by remove / undo: the focused Remove button unmounts, so focus has to be put back (the Popover ignores a null blur).
  const [refocus, setRefocus] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstRef = useRef<HTMLButtonElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // Opening reads the store (synchronous), prefills the name, and moves focus inside (Popover is not a focus trap).
  useEffect(() => {
    if (!open) return;
    const v = loadView(store(), viewKey);
    setItems(v.items); setCorrupt(v.corrupt); setUnavailable(v.unavailable);
    setName(suggestName(search)); setUndo(null); setSaveFailed(false); setStatus("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, viewKey]);
  useEffect(() => {
    if (open) (firstRef.current ?? nameRef.current)?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, items.length === 0, refocus]);
  // Another view starts closed.
  useEffect(() => { setOpen(false); }, [viewKey]);

  const persist = (next: SavedSearch[]) => {
    const ok = saveView(store(), viewKey, next);
    setSaveFailed(!ok);
    if (ok) setItems(next);
    return ok;
  };

  const reason = saveDisabledReason({ text: search, name, items, unavailable });
  const replacing = hasName(items, nameFor(name, search));
  const save = () => {
    if (reason) return;
    const next = upsert(items, name, search);
    if (next && persist(next)) {
      setStatus(`${replacing ? "Replaced" : "Saved"} "${nameFor(name, search)}".`);
      setUndo(null); setName("");
    }
  };
  const remove = (i: number) => {
    const entry = items[i];
    if (persist(removeAt(items, i))) { setUndo({ entry, index: i }); setStatus(""); setRefocus((n) => n + 1); }
  };
  const undoRemove = () => {
    if (!undo) return;
    if (persist(insertAt(items, undo.entry, undo.index))) { setUndo(null); setRefocus((n) => n + 1); }
  };

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Saved searches for ${label}`}
        title="Saved searches"
        className="h-8 w-8 rounded-md flex items-center justify-center text-dim hover:text-ink hover:bg-surface-tint/6 transition-colors duration-150 focus:outline-hidden focus:ring-1 focus:ring-accent/40"
      >
        <Bookmark size={14} aria-hidden />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} triggerRef={triggerRef} label={`Saved searches for ${label}`} className="right-0 top-9 w-[300px] p-3 flex flex-col gap-2.5">
        <h2 className="text-[12px] font-semibold text-ink">Saved searches for {label}</h2>
        {corrupt && <p className="text-[11px] text-warn">Saved searches couldn't be read, so the list is empty.</p>}
        {items.length === 0 ? (
          <p className="text-[11.5px] text-mute">No saved searches for {label} yet.</p>
        ) : (
          <ul className="flex flex-col rounded-md ring-1 ring-edge max-h-48 overflow-y-auto">
            {items.map((s, i) => (
              <li key={s.name} className="flex items-center gap-1 border-b border-edge-raw/70 last:border-b-0">
                <button
                  ref={i === 0 ? firstRef : undefined}
                  type="button"
                  onClick={() => { onPick(s.text); setOpen(false); }}
                  title={s.text}
                  className="flex-1 min-w-0 min-h-6 px-2 py-1 text-left mono text-[11.5px] text-ink truncate hover:bg-surface-tint/6"
                >
                  {s.name}
                </button>
                <button
                  type="button"
                  onClick={() => remove(i)}
                  aria-label={`Remove ${s.name}`}
                  className="min-h-6 px-1.5 inline-flex items-center gap-1 text-[11px] text-mute hover:text-bad"
                >
                  <X size={11} aria-hidden /> Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        {undo && (
          <p className="text-[11px] text-mute flex items-center gap-1.5" role="status">
            Removed "{undo.entry.name}".
            <button type="button" onClick={undoRemove} className="text-accent hover:underline">Undo</button>
          </p>
        )}
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] text-dim" htmlFor="saved-search-name">Name</label>
          <input
            id="saved-search-name"
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save(); } }}
            spellCheck={false}
            autoComplete="off"
            placeholder="e.g. crashloop"
            className="h-7 px-2 rounded-md bg-card/80 ring-1 ring-edge focus:ring-accent/40 focus:outline-hidden text-[12px] text-ink mono"
          />
          <button
            type="button"
            onClick={save}
            {...disabledAttrs(reason)}
            className={`self-start h-7 px-3 rounded-md bg-accent/15 ring-1 ring-accent/30 text-accent text-[12px] hover:bg-accent/25 ${reason ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            {replacing ? "Replace" : "Save"}
          </button>
          {reason && <p className="text-[11px] text-dim">{reason}</p>}
          <p role="status" aria-live="polite" className="text-[11px] text-ok empty:hidden">{status}</p>
          {saveFailed && <p className="text-[11px] text-bad">Saved searches can't be stored in this session.</p>}
        </div>
        <p className="text-[11px] text-dim">
          {FOOTNOTE}{viewKey === "pods" ? ` ${PODS_FOOTNOTE}` : ""}
        </p>
      </Popover>
    </div>
  );
}
