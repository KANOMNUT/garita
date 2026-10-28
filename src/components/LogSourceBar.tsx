import { useEffect, useState, type ReactNode } from "react";
import { disabledAttrs } from "../utils/guardrails";
import {
  RANGE_OPTIONS, validateCustomRange,
  type CustomUnit, type LogZone, type RangeId, type RangeSpec,
} from "../utils/logSource";

// The "Source" group of the log toolbar (docs/ux/02-logs-debug.md §3.1 row 1):
// everything here changes what is LOADED and reloads the log, except Local/UTC,
// which only changes how timestamps are displayed. Shared by LogViewer and
// MultiLogViewer so the two cannot drift.

interface LogSourceBarProps {
  range: RangeSpec;
  onRangeChange: (r: RangeSpec) => void;
  timestamps: boolean;
  onTimestampsChange: (v: boolean) => void;
  zone: LogZone;
  onZoneChange: (z: LogZone) => void;
  /** Controls placed before Range (the container select). */
  leading?: ReactNode;
  /** Controls placed after the zone select (the "previous" toggle). */
  trailing?: ReactNode;
  disabledRangeReason?: string;
  /** History swaps the option list (no Custom, no lines). */
  rangeOptions?: { id: RangeId; label: string }[];
  /** The Timestamps box is forced on and aria-disabled with this reason (History). */
  timestampsLockedReason?: string;
}

const selectCls =
  "h-6 px-2 rounded-sm bg-card/80 ring-1 ring-edge text-[11px] mono text-ink focus:outline-hidden focus:ring-accent/40 disabled:opacity-50";

export function LogSourceBar({
  range, onRangeChange, timestamps, onTimestampsChange, zone, onZoneChange, leading, trailing, disabledRangeReason,
  rangeOptions = RANGE_OPTIONS, timestampsLockedReason,
}: LogSourceBarProps) {
  const [draftValue, setDraftValue] = useState(String(range.value ?? 30));
  const [draftUnit, setDraftUnit] = useState<CustomUnit>(range.unit ?? "minutes");
  const customError = range.id === "custom" ? validateCustomRange(draftValue, draftUnit) : null;

  // Keep the draft in step when the range changes from outside (remembered prefs load).
  useEffect(() => {
    if (range.id === "custom") {
      setDraftValue(String(range.value ?? 30));
      setDraftUnit(range.unit ?? "minutes");
    }
  }, [range.id, range.value, range.unit]);

  const commitCustom = (value: string, unit: CustomUnit) => {
    if (validateCustomRange(value, unit)) return;
    const n = Number(value.trim());
    if (range.id === "custom" && range.value === n && range.unit === unit) return;
    onRangeChange({ id: "custom", value: n, unit });
  };

  const onSelectRange = (id: RangeId) => {
    if (id === "custom") {
      const n = Number(draftValue.trim());
      onRangeChange(validateCustomRange(draftValue, draftUnit) ? { id: "custom", value: 30, unit: "minutes" } : { id: "custom", value: n, unit: draftUnit });
    } else {
      onRangeChange({ id });
    }
  };

  return (
    <div role="group" aria-label="Source: changes reload the log" className="flex flex-col gap-1">
      <div className="flex items-baseline gap-1.5">
        <span className="text-[9.5px] uppercase tracking-wider font-semibold text-mute">Source</span>
        <span className="text-[10px] text-mute">Reloads the log</span>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {leading}

        <select
          aria-label="Range"
          value={range.id}
          disabled={!!disabledRangeReason}
          title={disabledRangeReason ?? "Changing the range reloads the log."}
          onChange={(e) => onSelectRange(e.target.value as RangeId)}
          className={selectCls}
        >
          {rangeOptions.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>

        {range.id === "custom" && (
          <div className="flex items-center gap-1">
            <input
              aria-label="Custom range amount"
              aria-invalid={customError ? true : undefined}
              inputMode="numeric"
              value={draftValue}
              onChange={(e) => setDraftValue(e.target.value)}
              onBlur={() => commitCustom(draftValue, draftUnit)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitCustom(draftValue, draftUnit);
              }}
              className={`${selectCls} w-14 ${customError ? "ring-bad/40" : ""}`}
            />
            <select
              aria-label="Custom range unit"
              value={draftUnit}
              onChange={(e) => {
                const u = e.target.value as CustomUnit;
                setDraftUnit(u);
                commitCustom(draftValue, u);
              }}
              className={selectCls}
            >
              <option value="minutes">minutes</option>
              <option value="hours">hours</option>
              <option value="days">days</option>
            </select>
          </div>
        )}

        <label
          className="flex items-center gap-1.5 text-[11px] text-mute cursor-pointer"
          title="Turning timestamps on or off reloads the log. Local and UTC only change how they are shown."
        >
          <input
            type="checkbox"
            checked={timestamps || !!timestampsLockedReason}
            onChange={(e) => { if (!timestampsLockedReason) onTimestampsChange(e.target.checked); }}
            {...disabledAttrs(timestampsLockedReason)}
            className="accent-accent"
          />
          Timestamps
        </label>

        <select
          aria-label="Time zone"
          value={zone}
          disabled={!timestamps && !timestampsLockedReason}
          title="Display only. Changing the zone does not reload the log."
          onChange={(e) => onZoneChange(e.target.value as LogZone)}
          className={selectCls}
        >
          <option value="local">Local</option>
          <option value="utc">UTC</option>
        </select>

        {trailing}
      </div>
      {customError && (
        <p role="alert" className="text-[10.5px] text-bad">{customError}</p>
      )}
    </div>
  );
}
