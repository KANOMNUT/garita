import { ChevronDown, ChevronRight } from "lucide-react";
import { memo, type ReactNode } from "react";
import type { ParsedLogLine } from "../utils/logParse";
import { parseJsonObject } from "../utils/logParse";
import { prettyJson, summarizeJson } from "../utils/logJson";
import { findRanges, legacyColumns, markSegments, type Matcher, type Range } from "../utils/logFilter";
import { formatLogTime, type LogZone } from "../utils/logSource";

function levelClass(level: ParsedLogLine["lvl"]): string {
  if (level === "ERROR") return "text-bad";
  if (level === "WARN") return "text-warn";
  if (level === "DEBUG") return "text-log-debug";
  return "text-ink/85";
}

function wordClass(level: ParsedLogLine["lvl"]): string {
  if (level === "ERROR") return "text-bad";
  if (level === "WARN") return "text-warn";
  if (level === "DEBUG") return "text-log-debug";
  return "text-info";
}

const SEGMENT_CLASS = {
  plain: undefined,
  match: "bg-log-match",
  // Highlight is a tint PLUS an underline, so it is distinguishable without colour.
  highlight: "bg-log-highlight underline decoration-2 underline-offset-2",
  both: "bg-log-highlight underline decoration-2 underline-offset-2",
} as const;

/** One slice of `body`, marked as React spans. Log bytes never reach innerHTML. */
function Slice({ body, start, end, inc, hl }: { body: string; start: number; end: number; inc: Range[]; hl: Range[] }) {
  const segs = markSegments(body, start, end, inc, hl);
  return <>{segs.map((s, i) => <span key={i} className={SEGMENT_CLASS[s.kind]}>{s.text}</span>)}</>;
}

interface LogLineProps {
  seq: number;
  line: ParsedLogLine;
  timestamps: boolean;
  zone: LogZone;
  withDate: boolean;
  include: Matcher | null;
  highlight: Matcher | null;
  jsonView: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  activeMatch: boolean;
  prefix?: ReactNode;
}

/** Safe React log row. Keyed by `seq` by the caller; JSON is parsed lazily and cached with the row. */
export const LogLine = memo(function LogLine({
  seq, line, timestamps, zone, withDate, include, highlight, jsonView, expanded, onToggleExpanded, activeMatch, prefix,
}: LogLineProps) {
  const json = line.json && (jsonView || expanded) ? parseJsonObject(line.body) : null;
  const summary = json && jsonView ? summarizeJson(json) : null;
  const inc = findRanges(line.body, include);
  const hl = findRanges(line.body, highlight);
  const cols = legacyColumns(line.body);

  // UXA-5: in summary mode the marks are found on the displayed pieces (message and key=value),
  // not on `body`, so a counted match is visible. If the match sits only in text the summary
  // does not show, the row falls back to the raw line so the mark is still on screen.
  const summaryText = summary ? (summary.message || line.body) : "";
  const fieldTexts = summary
    ? summary.fields.map((f) => `${f.key}=${f.long && !expanded ? `${f.value.slice(0, 120)}…` : f.value}`)
    : [];
  const summaryHasMarks = summary
    ? [summaryText, ...fieldTexts].some((t) => findRanges(t, include).length > 0 || findRanges(t, highlight).length > 0)
    : false;
  const bodyHasMarks = inc.length > 0 || hl.length > 0;
  const summaryRaw = !!summary && bodyHasMarks && !summaryHasMarks;

  const chevron = (
    <button
      type="button"
      onClick={onToggleExpanded}
      aria-expanded={expanded}
      aria-label={expanded ? "Collapse JSON" : "Expand JSON"}
      className="shrink-0 hover:text-ink focus-visible:ring-1 focus-visible:ring-accent rounded-sm"
    >
      {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
    </button>
  );

  let content: ReactNode;
  if (summary && json && !summaryRaw) {
    content = (
      <>
        {chevron}
        <span className="font-semibold mr-1">{line.word ?? "JSON"}</span>
        <Slice body={summaryText} start={0} end={summaryText.length}
          inc={findRanges(summaryText, include)} hl={findRanges(summaryText, highlight)} />
        {summary.fields.map((f, i) => (
          <span key={f.key} className="ml-2 text-dim">
            <Slice body={fieldTexts[i]} start={0} end={fieldTexts[i].length}
              inc={findRanges(fieldTexts[i], include)} hl={findRanges(fieldTexts[i], highlight)} />
          </span>
        ))}
        {summary.fields.some((f) => f.long) && !expanded && (
          <button type="button" onClick={onToggleExpanded} className="ml-2 rounded-xs text-[10.5px] text-accent hover:underline outline-hidden focus-visible:ring-2 focus-visible:ring-accent/70">Show full value</button>
        )}
      </>
    );
  } else if (cols) {
    content = (
      <>
        <span className="text-dim shrink-0 mr-2"><Slice body={line.body} start={cols.ts.start} end={cols.ts.end} inc={inc} hl={hl} /></span>
        <span className={`font-semibold mr-2 ${wordClass(line.lvl)}`}><Slice body={line.body} start={cols.word.start} end={cols.word.end} inc={inc} hl={hl} /></span>
        <span className="text-ink/85"><Slice body={line.body} start={cols.msg.start} end={cols.msg.end} inc={inc} hl={hl} /></span>
      </>
    );
  } else {
    content = <Slice body={line.body} start={0} end={line.body.length} inc={inc} hl={hl} />;
  }

  return (
    <div data-log-seq={seq} className={`group flex gap-2.5 ${activeMatch ? "outline-solid outline-1 outline-accent rounded-sm" : ""}`}>
      {timestamps && line.k8sTs && (
        <span className="text-dim shrink-0" title={`Time Kubernetes received the line: ${line.k8sTs}`}>
          {formatLogTime(line.k8sTs, zone, withDate)}
        </span>
      )}
      {prefix}
      <div className={`min-w-0 flex-1 ${levelClass(line.lvl)}`}>
        {line.json && !jsonView && (
          // JSON off: raw text, with a small {} marker (hover / focus) that expands the line.
          <button
            type="button"
            onClick={onToggleExpanded}
            aria-expanded={expanded}
            aria-label={expanded ? "Collapse JSON" : "Expand JSON"}
            className="mr-1 rounded-xs text-[10.5px] text-mute opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-accent outline-hidden focus-visible:ring-2 focus-visible:ring-accent/70"
          >
            {"{}"}
          </button>
        )}
        {content}
        {expanded && json && (
          <pre className="ml-5 mt-1 whitespace-pre-wrap break-all text-[10.5px] text-mute">{prettyJson(json)}</pre>
        )}
      </div>
    </div>
  );
});
