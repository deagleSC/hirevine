"use client";

import { useState, type ReactNode } from "react";

import { Button } from "@hirevine/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@hirevine/ui/components/card";
import { cn } from "@hirevine/ui/lib/utils";

/**
 * Small, dependency-free charts for the dashboards (frontend plan §7.7, §8.7). Every chart here is a
 * single series, so it uses one hue (the primary token, which has its own dark-mode value), thin
 * marks rounded only at the data end, muted axes, a hover/focus tooltip on each mark, and a table
 * view behind a toggle so no value is reachable only by pointing.
 */

export interface ChartTable {
  columns: string[];
  rows: (string | number)[][];
}

export function ChartCard({
  title,
  description,
  table,
  children,
  className,
}: {
  title: string;
  description?: ReactNode;
  table?: ChartTable;
  children: ReactNode;
  className?: string;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <div className="grid gap-1">
          <CardTitle className="text-base">{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        {table ? (
          <Button variant="ghost" size="sm" className="h-7 shrink-0 text-xs" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable}>
            {asTable ? "Show chart" : "Show table"}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>{asTable && table ? <DataTable {...table} /> : children}</CardContent>
    </Card>
  );
}

export function DataTable({ columns, rows }: ChartTable) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            {columns.map((c, i) => (
              <th key={c} scope="col" className={cn("py-1.5 pr-3 font-medium", i > 0 && "text-right")}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b last:border-0">
              {r.map((v, j) => (
                <td key={j} className={cn("py-1.5 pr-3", j > 0 && "text-right tabular-nums")}>
                  {v}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A headline number: label, value, and an optional note. Not a chart (no plot, no hover). */
export function StatTile({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <Card className="gap-1 py-4">
      <CardContent className="grid gap-1 px-4">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-2xl font-semibold tabular-nums">{value}</span>
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </CardContent>
    </Card>
  );
}

export interface BarDatum {
  label: string;
  value: number;
  /** Text shown at the bar's end and in the tooltip (defaults to the value). */
  display?: string;
  /** Secondary line under the label, e.g. "5 passed · 50% drop-off". */
  sub?: string;
}

/** Horizontal bars on one baseline, largest scale = max value. Labels left, value at the bar end. */
export function BarList({ data, max, ariaLabel }: { data: BarDatum[]; max?: number; ariaLabel: string }) {
  const top = Math.max(max ?? 0, ...data.map((d) => d.value), 1);
  return (
    <ul className="grid gap-3" aria-label={ariaLabel}>
      {data.map((d) => {
        const pct = (d.value / top) * 100;
        const text = d.display ?? String(d.value);
        return (
          <li
            key={d.label}
            tabIndex={0}
            title={`${d.label}: ${text}`}
            aria-label={`${d.label}: ${text}${d.sub ? `, ${d.sub}` : ""}`}
            className="group grid grid-cols-[minmax(6rem,9rem)_1fr] items-center gap-3 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="grid text-sm">
              <span className="truncate">{d.label}</span>
              {d.sub ? <span className="truncate text-xs text-muted-foreground">{d.sub}</span> : null}
            </span>
            <span className="flex items-center gap-2">
              <span className="relative h-4 flex-1 border-l border-border">
                <span
                  className="absolute inset-y-0 left-0 rounded-r-[4px] bg-primary transition-opacity group-hover:opacity-80 group-focus-visible:opacity-80"
                  style={{ width: `${Math.max(pct, d.value > 0 ? 1 : 0)}%` }}
                />
              </span>
              <span className="w-14 shrink-0 text-right text-sm tabular-nums">{text}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export interface ColumnDatum {
  label: string;
  value: number;
}

/**
 * Vertical columns on one baseline (histograms, counts over time). A dashed reference line can mark a
 * threshold such as the cutoff. Only every `labelEvery`-th x label is printed; hover or focus shows each.
 */
export function ColumnChart({
  data,
  ariaLabel,
  height = 160,
  reference,
  labelEvery = 1,
  format = (v) => String(v),
}: {
  data: ColumnDatum[];
  ariaLabel: string;
  height?: number;
  reference?: { at: number; label: string };
  labelEvery?: number;
  format?: (v: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const top = Math.max(...data.map((d) => d.value), 1);
  const n = data.length;
  return (
    <div className={cn("relative", reference && "pt-5")} role="img" aria-label={ariaLabel}>
      <div className="relative flex items-end gap-[2px] border-b border-border" style={{ height }}>
        {[0.5, 1].map((g) => (
          <span key={g} className="pointer-events-none absolute inset-x-0 border-t border-dashed border-border/60" style={{ bottom: `${g * 100}%` }} />
        ))}
        {data.map((d, i) => (
          <button
            key={i}
            type="button"
            className="group relative flex h-full flex-1 items-end justify-center outline-none"
            onPointerEnter={() => setHover(i)}
            onPointerLeave={() => setHover(null)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
            aria-label={`${d.label}: ${format(d.value)}`}
          >
            <span
              className={cn(
                "w-full max-w-6 rounded-t-[4px] bg-primary transition-opacity",
                hover === i && "opacity-80",
                d.value === 0 && "bg-transparent",
              )}
              style={{ height: `${(d.value / top) * 100}%` }}
            />
          </button>
        ))}
        {reference ? (
          <span
            className="pointer-events-none absolute inset-y-0 border-l-2 border-dashed border-muted-foreground"
            style={{ left: `${(reference.at / n) * 100}%` }}
          >
            <span className="absolute bottom-full mb-1 -translate-x-1/2 whitespace-nowrap text-[11px] text-muted-foreground">{reference.label}</span>
          </span>
        ) : null}
        {hover !== null ? (
          <span
            role="tooltip"
            className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-md border bg-popover px-2 py-1 text-xs shadow-sm"
            style={{ left: `${((hover + 0.5) / n) * 100}%`, bottom: `calc(${(data[hover]!.value / top) * 100}% + 6px)` }}
          >
            <strong className="font-semibold tabular-nums">{format(data[hover]!.value)}</strong>
            <span className="ml-1.5 text-muted-foreground">{data[hover]!.label}</span>
          </span>
        ) : null}
      </div>
      <div className="mt-1 flex gap-[2px] text-[11px] text-muted-foreground">
        {data.map((d, i) => (
          <span key={i} className="flex-1 overflow-visible whitespace-nowrap text-center tabular-nums">
            {i % labelEvery === 0 ? d.label : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

/** A ratio against a whole, as a thin track (e.g. stages reached of the total). */
export function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max ? Math.min(100, (value / max) * 100) : 0;
  return (
    <span className="flex items-center gap-2" role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label}>
      <span className="relative h-2 w-28 overflow-hidden rounded-full bg-muted">
        <span className="absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </span>
      <span className="text-xs tabular-nums text-muted-foreground">
        {value}/{max}
      </span>
    </span>
  );
}

/** A small trend line (2px, round joins) with its points as dots; values in the table view. */
export function Sparkline({ values, ariaLabel, width = 220, height = 48 }: { values: number[]; ariaLabel: string; width?: number; height?: number }) {
  if (values.length === 0) return null;
  const pad = 5;
  const x = (i: number) => (values.length === 1 ? width / 2 : pad + (i * (width - 2 * pad)) / (values.length - 1));
  const y = (v: number) => height - pad - (v / 100) * (height - 2 * pad);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <svg width={width} height={height} role="img" aria-label={ariaLabel} className="overflow-visible text-primary">
      <line x1={0} x2={width} y1={height - pad} y2={height - pad} className="stroke-border" strokeWidth={1} />
      <path d={d} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {values.map((v, i) => (
        <circle key={i} cx={x(i)} cy={y(v)} r={4} fill="currentColor" className="stroke-card" strokeWidth={2}>
          <title>{`${v}%`}</title>
        </circle>
      ))}
    </svg>
  );
}
