import React, { useId, useState } from 'react';
import { AlertCircle, Info, Table2, BarChart3 } from 'lucide-react';

import { AnalyticsNote } from '../../../types/admin';
import { CHROME, MARK_GAP_PX, MAX_BAR_PX, compact, inkOn } from './tokens';

/**
 * Chart primitives, built in plain HTML/SVG.
 *
 * No chart library: the forms here are bars, stacks and a range strip, all of
 * which are a div with a width or a handful of rects. Adding a charting
 * dependency to draw a `<div style={{width: '43%'}}>` would be weight without
 * capability, and it would take the mark specs out of our hands — the 2px
 * surface gap and the 4px rounded data-end are the specs that make these read
 * as considered rather than as default output.
 *
 * Every chart here ships a **table-view twin** (the toggle in ChartCard) because
 * a tooltip must never be the only way to read a value, and every chart with two
 * or more series ships a **legend**, because identity must never rest on colour
 * alone.
 */

// ─── Card ─────────────────────────────────────────────────────────────────────

interface ChartCardProps {
  title: string;
  /** One line on what the figure means or what it excludes. */
  subtitle?: string;
  /** Rendered instead of the chart when the reader asks for the table. */
  table: React.ReactNode;
  children: React.ReactNode;
  /** Shown in place of everything when there is nothing to plot. */
  empty?: boolean;
  emptyLabel?: string;
}

export const ChartCard: React.FC<ChartCardProps> = ({
  title,
  subtitle,
  table,
  children,
  empty = false,
  emptyLabel = 'No data in this window.',
}) => {
  const [showTable, setShowTable] = useState(false);
  const headingId = useId();

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-[16px] border border-[#EEF2F6] bg-white p-5 shadow-2xs"
    >
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h3 id={headingId} className="text-sm font-bold text-[#0F172A]">
            {title}
          </h3>
          {subtitle && <p className="mt-0.5 text-xs text-[#475569]">{subtitle}</p>}
        </div>
        {!empty && (
          <button
            type="button"
            onClick={() => setShowTable((v) => !v)}
            aria-pressed={showTable}
            className="flex shrink-0 items-center gap-1.5 rounded-[8px] border border-[#EEF2F6] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#475569] transition hover:bg-[#F6F8FA] hover:text-[#0F172A]"
          >
            {showTable ? (
              <>
                <BarChart3 className="h-3.5 w-3.5" aria-hidden="true" /> Chart
              </>
            ) : (
              <>
                <Table2 className="h-3.5 w-3.5" aria-hidden="true" /> Table
              </>
            )}
          </button>
        )}
      </div>

      {empty ? (
        <p className="py-6 text-center text-sm text-slate-400">{emptyLabel}</p>
      ) : showTable ? (
        <div className="overflow-x-auto">{table}</div>
      ) : (
        children
      )}
    </section>
  );
};

/** The table twin's shared shell — tabular figures, because columns must align. */
export const DataTable: React.FC<{
  columns: string[];
  rows: (string | number)[][];
}> = ({ columns, rows }) => (
  <table className="w-full text-left text-xs" style={{ fontVariantNumeric: 'tabular-nums' }}>
    <thead>
      <tr className="border-b border-slate-200">
        {columns.map((c, i) => (
          <th
            key={c}
            scope="col"
            className={`py-2 font-medium text-slate-500 ${i > 0 ? 'text-right' : ''}`}
          >
            {c}
          </th>
        ))}
      </tr>
    </thead>
    <tbody>
      {rows.map((row, ri) => (
        <tr key={ri} className="border-b border-slate-100 last:border-0">
          {row.map((cell, ci) => (
            <td
              key={ci}
              className={`py-2 ${ci > 0 ? 'text-right text-slate-900' : 'text-slate-600'}`}
            >
              {cell}
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  </table>
);

// ─── Figures ──────────────────────────────────────────────────────────────────

/**
 * The one number a view leads with. Exactly one per screen.
 *
 * Same sans as everything else and proportional figures — a display face or
 * tabular digits on a 48px number reads as decoration rather than data.
 */
export const HeroFigure: React.FC<{
  label: string;
  value: string;
  caption?: string;
}> = ({ label, value, caption }) => (
  <div>
    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
    <p className="mt-1 text-5xl font-semibold leading-none text-slate-900">{value}</p>
    {caption && <p className="mt-2 text-xs text-slate-500">{caption}</p>}
  </div>
);

export const StatTile: React.FC<{
  label: string;
  value: string;
  hint?: string;
}> = ({ label, value, hint }) => (
  <div className="rounded-xl border border-slate-200 bg-white p-4">
    <p className="text-xs text-slate-500">{label}</p>
    <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
    {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
  </div>
);

// ─── Legend ───────────────────────────────────────────────────────────────────

/**
 * Always present for two or more series. The swatch beside the text carries
 * identity; the text itself stays in an ink token, never the series colour —
 * a light categorical hue is illegible as text on white.
 */
export const Legend: React.FC<{ items: { label: string; color: string }[] }> = ({ items }) => (
  <ul className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
    {items.map((item) => (
      <li key={item.label} className="flex items-center gap-1.5 text-xs text-slate-600">
        <span
          aria-hidden="true"
          className="h-2.5 w-2.5 shrink-0 rounded-sm"
          style={{ background: item.color }}
        />
        {item.label}
      </li>
    ))}
  </ul>
);

// ─── Horizontal bars, single series ───────────────────────────────────────────

export interface BarDatum {
  label: string;
  value: number;
  /** Overrides the series colour for this bar only — used for emphasis. */
  color?: string;
}

/**
 * Magnitude across named categories. One series, one colour for every bar:
 * darkening the bigger bars would double-encode length as hue and burn the only
 * free channel on something the length already says.
 *
 * Horizontal because the category labels are words (`partner_en_route`), and
 * rotated axis text is a readability tax no column chart is worth.
 */
export const HBars: React.FC<{
  data: BarDatum[];
  color: string;
  /** Appended to the value in the tooltip and the direct label. */
  unit?: string;
}> = ({ data, color, unit = '' }) => {
  const max = Math.max(...data.map((d) => d.value), 1);

  return (
    <ul className="space-y-2.5">
      {data.map((d) => {
        const widthPct = (d.value / max) * 100;
        const label = `${compact(d.value)}${unit ? ` ${unit}` : ''}`;
        return (
          <li key={d.label} className="group grid grid-cols-[9.5rem_1fr] items-center gap-3">
            <span className="truncate text-xs text-slate-600" title={d.label}>
              {d.label}
            </span>
            {/* The hit target is the whole track, not the fill — a 3px bar is
                not something anyone should have to land on. */}
            <span
              className="relative flex h-6 items-center"
              title={`${d.label}: ${label}`}
              tabIndex={0}
              role="img"
              aria-label={`${d.label}: ${label}`}
            >
              <span
                className="absolute inset-y-0 left-0 right-0 rounded-md transition group-hover:bg-slate-50 group-focus-within:bg-slate-50"
                aria-hidden="true"
              />
              <span
                className="relative rounded-r-[4px]"
                style={{
                  width: `${widthPct}%`,
                  minWidth: d.value > 0 ? 2 : 0,
                  height: Math.min(MAX_BAR_PX, 14),
                  background: d.color ?? color,
                }}
                aria-hidden="true"
              />
              {/* Selective direct label: at the tip, always, because this chart
                  has no value axis to fall back on. */}
              <span
                className="relative ml-2 text-xs font-medium text-slate-900"
                style={{ fontVariantNumeric: 'tabular-nums' }}
                aria-hidden="true"
              >
                {label}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
};

// ─── Stacked bar, part-to-whole ───────────────────────────────────────────────

export interface StackSegment {
  label: string;
  value: number;
  color: string;
}

/**
 * Part-to-whole for a handful of segments. A stacked bar rather than a donut:
 * a ring makes close values hard to compare and a two-slice pie is a stat tile
 * wearing a costume.
 *
 * Segments are separated by a 2px gap **in the surface colour**, not by a
 * border — a stroke adds ink that isn't data. An in-segment label is rendered
 * only when it measurably fits; otherwise the legend and the table carry it,
 * and nothing is clipped.
 */
export const StackedBar: React.FC<{ segments: StackSegment[]; total?: number }> = ({
  segments,
  total,
}) => {
  const sum = total ?? segments.reduce((acc, s) => acc + s.value, 0);
  const safeSum = sum > 0 ? sum : 1;

  return (
    <>
      <Legend items={segments.map((s) => ({ label: s.label, color: s.color }))} />
      <div
        className="flex h-9 w-full overflow-hidden rounded-md"
        role="img"
        aria-label={segments.map((s) => `${s.label}: ${s.value}`).join(', ')}
      >
        {segments.map((s, i) => {
          const widthPct = (s.value / safeSum) * 100;
          if (s.value === 0) return null;
          // ~7px per character plus padding; below that the text would be
          // clipped, which is worse than no label.
          const text = compact(s.value);
          const fits = widthPct > (text.length * 7 + 16) / 4;
          return (
            <div
              key={s.label}
              className="flex items-center justify-center text-xs font-semibold"
              title={`${s.label}: ${text} (${((s.value / safeSum) * 100).toFixed(1)}%)`}
              style={{
                width: `${widthPct}%`,
                background: s.color,
                marginLeft: i === 0 ? 0 : MARK_GAP_PX,
                color: inkOn(s.color),
              }}
            >
              {fits && text}
            </div>
          );
        })}
      </div>
    </>
  );
};

// ─── Grouped bars, two series across categories ───────────────────────────────

/**
 * Two series compared across the same categories — the console's centrepiece.
 *
 * One axis, always. The temptation with two arms whose scales differ is a second
 * y-scale; that invents a correlation the data does not contain. Here both arms
 * are mean scores in 0..1, so one shared 0..1 scale is the honest encoding and
 * the comparison is a length comparison.
 */
export const GroupedBars: React.FC<{
  categories: string[];
  series: { label: string; color: string; values: (number | null)[] }[];
  /** Upper bound of the shared scale. Scores are 0..1. */
  max?: number;
  format?: (v: number) => string;
}> = ({ categories, series, max = 1, format = (v) => v.toFixed(3) }) => (
  <>
    <Legend items={series.map((s) => ({ label: s.label, color: s.color }))} />
    <ul className="space-y-3.5">
      {categories.map((category, ci) => (
        <li key={category}>
          <p className="mb-1 text-xs text-slate-600">{category}</p>
          <div className="space-y-[2px]">
            {series.map((s) => {
              const value = s.values[ci];
              return (
                <div key={s.label} className="flex items-center gap-2">
                  <span
                    className="flex h-3.5 flex-1 items-center"
                    title={`${s.label} · ${category}: ${value === null ? 'no data' : format(value)}`}
                    tabIndex={0}
                    role="img"
                    aria-label={`${s.label}, ${category}: ${
                      value === null ? 'no data' : format(value)
                    }`}
                  >
                    {value === null ? (
                      <span className="text-xs italic text-slate-400">no data</span>
                    ) : (
                      <span
                        className="h-3.5 rounded-r-[4px]"
                        style={{
                          width: `${Math.max((value / max) * 100, 0.5)}%`,
                          background: s.color,
                        }}
                      />
                    )}
                  </span>
                  <span
                    className="w-16 shrink-0 text-right text-xs text-slate-700"
                    style={{ fontVariantNumeric: 'tabular-nums' }}
                  >
                    {value === null ? '—' : format(value)}
                  </span>
                </div>
              );
            })}
          </div>
        </li>
      ))}
    </ul>
  </>
);

// ─── Diverging bars, signed values ────────────────────────────────────────────

/**
 * Signed values around a zero line. Two hues that read as opposite with a
 * neutral gray midpoint, because the midpoint has to read as "nothing" rather
 * than as a third category.
 *
 * Rows flagged `muted` are components the backend reports as constant across the
 * window: they cannot have driven anything, and the backend excludes them from
 * `driver` for that reason. They are drawn recessive **and labelled**, not
 * recoloured — a third hue would make "not applicable" look like a category.
 */
export const DivergingBars: React.FC<{
  rows: { label: string; value: number | null; muted?: boolean }[];
  positive: string;
  negative: string;
  format?: (v: number) => string;
}> = ({ rows, positive, negative, format = (v) => (v >= 0 ? `+${v.toFixed(4)}` : v.toFixed(4)) }) => {
  const magnitudes = rows.map((r) => Math.abs(r.value ?? 0));
  const scale = Math.max(...magnitudes, 0.0001);

  return (
    <ul className="space-y-2.5">
      {rows.map((r) => {
        const value = r.value;
        const halfPct = value === null ? 0 : (Math.abs(value) / scale) * 50;
        const isPositive = (value ?? 0) >= 0;
        return (
          <li key={r.label} className="grid grid-cols-[8.5rem_1fr_4.5rem] items-center gap-2">
            <span className="flex items-center gap-1 truncate text-xs text-slate-600">
              {r.label}
              {r.muted && (
                <span
                  className="rounded bg-slate-100 px-1 py-0.5 text-xs font-medium text-slate-500"
                  title="Constant across this window — cannot have driven the choice, so the backend excludes it from the driver."
                >
                  constant
                </span>
              )}
            </span>
            <span
              className="relative flex h-5 items-center"
              title={`${r.label}: ${value === null ? 'no data' : format(value)}`}
              tabIndex={0}
              role="img"
              aria-label={`${r.label}: ${value === null ? 'no data' : format(value)}`}
            >
              {/* The zero line — a solid hairline, never dashed. */}
              <span
                aria-hidden="true"
                className="absolute inset-y-0 left-1/2 w-px"
                style={{ background: CHROME.axis }}
              />
              {value !== null && value !== 0 && (
                <span
                  aria-hidden="true"
                  className="absolute h-3"
                  style={{
                    width: `${halfPct}%`,
                    left: isPositive ? '50%' : `${50 - halfPct}%`,
                    background: r.muted ? CHROME.grid : isPositive ? positive : negative,
                    borderTopRightRadius: isPositive ? 4 : 0,
                    borderBottomRightRadius: isPositive ? 4 : 0,
                    borderTopLeftRadius: isPositive ? 0 : 4,
                    borderBottomLeftRadius: isPositive ? 0 : 4,
                  }}
                />
              )}
            </span>
            <span
              className="text-right text-xs text-slate-700"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {value === null ? '—' : format(value)}
            </span>
          </li>
        );
      })}
    </ul>
  );
};

// ─── Range strip, a distribution summary ──────────────────────────────────────

/**
 * min · p50 · p95 · max, with the mean marked.
 *
 * **Not a histogram** — the backend returns five summary numbers and no raw
 * distribution, so bins would be invented. This draws exactly what is known: a
 * track from min to max, the p50–p95 span filled, and the mean as a ringed dot.
 * Where a value is absent it is absent, never plotted as zero.
 */
export const RangeStrip: React.FC<{
  min: number | null;
  p50: number | null;
  p95: number | null;
  max: number | null;
  mean: number | null;
  unit: string;
  color: string;
}> = ({ min, p50, p95, max, mean, unit, color }) => {
  if (min === null || max === null || max === min) {
    return (
      <p className="py-2 text-sm text-slate-500">
        Not enough spread to plot — see the table.
      </p>
    );
  }
  const span = max - min;
  const at = (v: number) => ((v - min) / span) * 100;
  const fmt = (v: number | null) =>
    v === null ? '—' : `${v.toLocaleString('en-IN', { maximumFractionDigits: 1 })}`;

  return (
    <div className="pt-1">
      <div
        className="relative h-10"
        role="img"
        aria-label={`min ${fmt(min)}, median ${fmt(p50)}, p95 ${fmt(p95)}, max ${fmt(
          max
        )} ${unit}; mean ${fmt(mean)}`}
      >
        {/* min→max track */}
        <span
          aria-hidden="true"
          className="absolute left-0 right-0 top-4 h-1.5 rounded-full"
          style={{ background: CHROME.track }}
        />
        {/* p50→p95 span: where most of the mass is */}
        {p50 !== null && p95 !== null && (
          <span
            aria-hidden="true"
            className="absolute top-4 h-1.5 rounded-full"
            style={{
              left: `${at(p50)}%`,
              width: `${Math.max(at(p95) - at(p50), 0.5)}%`,
              background: color,
              opacity: 0.35,
            }}
            title={`p50–p95: ${fmt(p50)}–${fmt(p95)} ${unit}`}
          />
        )}
        {/* p50 and p95 ticks */}
        {[
          { v: p50, label: 'p50' },
          { v: p95, label: 'p95' },
        ].map(({ v, label }) =>
          v === null ? null : (
            <span
              key={label}
              className="absolute top-2.5 h-5 w-0.5"
              style={{ left: `${at(v)}%`, background: color }}
              title={`${label}: ${fmt(v)} ${unit}`}
            />
          )
        )}
        {/* mean, with a 2px surface ring so it stays legible over the span */}
        {mean !== null && (
          <span
            className="absolute top-[11px] h-3 w-3 rounded-full"
            style={{
              left: `calc(${at(mean)}% - 6px)`,
              background: color,
              boxShadow: `0 0 0 2px ${CHROME.surface}`,
            }}
            title={`mean: ${fmt(mean)} ${unit}`}
          />
        )}
        <span className="absolute left-0 top-7 text-xs text-slate-400">{fmt(min)}</span>
        <span className="absolute right-0 top-7 text-xs text-slate-400">
          {fmt(max)} {unit}
        </span>
      </div>
    </div>
  );
};

// ─── Notes ────────────────────────────────────────────────────────────────────

/**
 * The backend's own caveats, rendered verbatim.
 *
 * These are not decoration and not debug output: each one names a reason a
 * figure on this screen cannot be read the obvious way — a sample too small for
 * percentiles, a roster that is current rather than historical, an attribution
 * that is group means rather than a counterfactual. ADR-021's whole argument is
 * that a number ships with its caveat attached instead of being read alongside a
 * document nobody has open. Dropping these would undo that.
 */
export const NotesList: React.FC<{ notes: AnalyticsNote[] }> = ({ notes }) => {
  if (notes.length === 0) return null;
  return (
    <section
      aria-label="Caveats on these figures"
      className="rounded-xl border border-amber-200 bg-amber-50 p-4"
    >
      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-amber-900">
        <AlertCircle className="h-4 w-4" aria-hidden="true" />
        How to read these figures ({notes.length})
      </h3>
      <ul className="space-y-2">
        {notes.map((note) => (
          <li key={note.code} className="flex gap-2 text-xs leading-relaxed text-amber-900">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden="true" />
            <span>
              <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-xs font-semibold">
                {note.code}
              </code>{' '}
              {note.detail}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
};
