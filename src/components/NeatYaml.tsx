import { useState } from "react";
import { NEAT_HIDDEN_PATHS, neatNote } from "../utils/neatYaml";

// #6 neat YAML — presentation only (docs/ux/03-diffs-write-safety.md §4, copy §17.6).
// DISPLAY ONLY: the text behind the chip comes from get_resource_yaml_neat. The
// editor seed and Save always use get_resource_yaml (useResourceYaml); the neat
// data is never passed to the editor or to apply_resource_yaml.

export function NeatChip({ on, onToggle, editing }: { on: boolean; onToggle: () => void; editing: boolean }) {
  return (
    <button
      type="button"
      onClick={() => { if (!editing) onToggle(); }}
      aria-pressed={on}
      aria-disabled={editing || undefined}
      title={editing ? "Neat is display only. Cancel editing to switch." : "Hide managed fields, status and other server-set fields"}
      className={`h-6 px-2 rounded ring-1 text-[10.5px] transition-colors outline-hidden focus-visible:ring-2 focus-visible:ring-accent/70 aria-disabled:opacity-50 aria-disabled:cursor-not-allowed ${
        on && !editing
          ? "bg-accent/20 text-accent ring-accent/30"
          : "bg-card/80 text-mute ring-edge hover:text-ink aria-disabled:hover:text-mute"
      }`}
    >
      Neat
    </button>
  );
}

/** The one-line note under the toolbar, with the "What?" disclosure. */
export function NeatNote({ hidden, editing, error }: { hidden: readonly string[]; editing: boolean; error?: string }) {
  const [open, setOpen] = useState(false);
  if (editing) {
    return (
      <p className="text-[10.5px] text-mute">
        Editing the full object, including managedFields and status. Neat is display only and is never saved.
      </p>
    );
  }
  if (error) {
    return <p className="text-[10.5px] text-warn wrap-break-word">Couldn't load the neat view ({error}). Showing the full object.</p>;
  }
  return (
    <div className="text-[10.5px] text-mute">
      {neatNote(hidden)}{" "}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="underline hover:text-ink rounded-xs outline-hidden focus-visible:ring-2 focus-visible:ring-accent/70"
      >
        What?
      </button>
      {open && (
        <ul className="mt-1 mono text-[10.5px] flex flex-col gap-0.5">
          {NEAT_HIDDEN_PATHS.map((p) => (
            <li key={p} className="text-mute">
              {p}{hidden.includes(p) ? "" : " (not present)"}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
