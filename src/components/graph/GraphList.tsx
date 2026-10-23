import { STATUS_VIEW, type GraphStatus } from "./GraphCanvas";

export interface GraphListRow {
  id: string;
  status?: GraphStatus;
  name: string;
  /** The row's relations written as text. */
  relations: string;
  onOpen: () => void;
}
export interface GraphListSection {
  heading: string;
  count: number;
  rows: GraphListRow[];
}

/** The graph's text alternative: a grouped list, one Open button per row. */
export function GraphList({ sections }: { sections: GraphListSection[] }) {
  return (
    <div className="flex flex-col gap-4">
      {sections.map((s) => (
        <section key={s.heading} aria-label={s.heading}>
          <h3 className="text-[12px] font-semibold text-ink mb-1">
            {s.heading} <span className="font-normal text-mute">({s.count})</span>
          </h3>
          <ul className="flex flex-col divide-y divide-edge rounded-md ring-1 ring-edge bg-surface-card">
            {s.rows.map((r) => {
              const st = r.status ? STATUS_VIEW[r.status] : null;
              return (
                <li key={r.id} className="flex items-center gap-3 px-3 py-1.5 text-[12px]">
                  <span className="w-20 shrink-0">
                    {st && (
                      <>
                        <span aria-hidden="true" className={st.tone}>{st.glyph}</span>{" "}
                        <span className="text-ink">{st.word}</span>
                      </>
                    )}
                  </span>
                  <span className="font-mono text-ink break-all min-w-0">{r.name}</span>
                  <span className="text-mute min-w-0 flex-1">{r.relations}</span>
                  <button
                    type="button"
                    onClick={r.onOpen}
                    aria-label={`Open ${r.name}`}
                    className="shrink-0 min-h-6 px-2 rounded-sm text-accent ring-1 ring-edge hover:bg-surface-tint/6 focus-visible:ring-2 focus-visible:ring-accent/70 outline-hidden"
                  >
                    Open
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
