"use client";

import { FileWarning, Quote, ShieldAlert, TriangleAlert } from "lucide-react";
import { useEffect, useRef } from "react";

import { Badge } from "@hirevine/ui/components/badge";
import { cn } from "@hirevine/ui/lib/utils";

export interface EvidenceItem {
  criterion_id: string;
  name: string;
  weight: number;
  must_have: boolean;
  score: number;
  rationale: string;
  quote: string;
  line_no: number | null;
  verified: boolean;
}

const FLAG_COPY: Record<string, { label: string; hint: string; icon: typeof TriangleAlert }> = {
  no_evidence: { label: "No evidence", hint: "A claimed skill had no quote in the resume; it was scored 0.", icon: Quote },
  missing_must_have: { label: "Must-have missing", hint: "A must-have criterion scored 0. Not an automatic reject.", icon: TriangleAlert },
  possible_injection: { label: "Possible injection", hint: "The resume contains instruction-like or hidden text.", icon: ShieldAlert },
  unreadable: { label: "Unreadable", hint: "Too little text could be read from the file (no OCR yet).", icon: FileWarning },
  missing_resume: { label: "Resume missing", hint: "The uploaded file could not be found.", icon: FileWarning },
  model_failed: { label: "AI failed", hint: "The AI could not produce a valid result. Retry or score by hand.", icon: TriangleAlert },
  not_scored: { label: "Not scored", hint: "Screening finished without a score.", icon: TriangleAlert },
  auto_submitted: { label: "Auto-submitted", hint: "The quiz time ran out; the saved answers were graded.", icon: TriangleAlert },
};

export function flagLabel(flag: string): string {
  return FLAG_COPY[flag]?.label ?? flag.replace(/_/g, " ");
}

export function FlagBadges({ flags, className }: { flags: readonly string[]; className?: string }) {
  if (!flags.length) return null;
  return (
    <span className={cn("flex flex-wrap gap-1", className)}>
      {flags.map((f) => {
        const Icon = FLAG_COPY[f]?.icon ?? TriangleAlert;
        return (
          <Badge key={f} variant="outline" title={FLAG_COPY[f]?.hint} className="border-amber-500/50 text-amber-700 dark:text-amber-400">
            <Icon aria-hidden />
            {flagLabel(f)}
          </Badge>
        );
      })}
    </span>
  );
}

/** A quoted line reference; clicking it selects the line in the resume viewer. */
export function CitationChip({ lineNo, active, onSelect }: { lineNo: number; active?: boolean; onSelect: (n: number) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(lineNo)}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-xs tabular-nums transition-colors",
        "hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        active && "border-primary bg-primary/10",
      )}
    >
      <Quote className="size-3" aria-hidden />L{lineNo}
    </button>
  );
}

function ScoreDots({ score, max = 4 }: { score: number; max?: number }) {
  return (
    <span className="inline-flex items-center gap-1" aria-label={`${score} of ${max}`}>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={cn("size-2 rounded-full", i < score ? "bg-primary" : "bg-muted-foreground/25")} />
      ))}
      <span className="ml-1 text-xs tabular-nums text-muted-foreground">{score}/{max}</span>
    </span>
  );
}

/** Screening evidence: one row per criterion with weight, score, rationale and its quoted line. */
export function EvidenceList({
  items,
  activeLine,
  onSelectLine,
}: {
  items: readonly EvidenceItem[];
  activeLine?: number | null;
  onSelectLine: (n: number) => void;
}) {
  return (
    <ul className="divide-y rounded-lg border">
      {items.map((e) => (
        <li key={e.criterion_id} className="grid gap-1.5 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{e.name}</span>
              <Badge variant="secondary">Weight {e.weight}</Badge>
              {e.must_have ? <Badge variant="outline">Must-have</Badge> : null}
              {e.must_have && e.score === 0 ? <FlagBadges flags={["missing_must_have"]} /> : null}
            </div>
            <ScoreDots score={e.score} />
          </div>
          <p className="text-sm text-muted-foreground">{e.rationale}</p>
          {e.verified && e.line_no ? (
            <blockquote className="flex items-start gap-2 border-l-2 pl-2 text-sm">
              <CitationChip lineNo={e.line_no} active={activeLine === e.line_no} onSelect={onSelectLine} />
              <span className="italic">“{e.quote}”</span>
            </blockquote>
          ) : (
            <p className="text-xs text-muted-foreground">No quoted evidence.</p>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Redacted resume with line numbers; the selected line scrolls into view and is highlighted. */
export function ResumeViewer({
  lines,
  activeLine,
  citedLines,
  onSelectLine,
}: {
  lines: readonly string[];
  activeLine?: number | null;
  citedLines?: ReadonlySet<number>;
  onSelectLine?: (n: number) => void;
}) {
  const refs = useRef(new Map<number, HTMLLIElement>());
  useEffect(() => {
    if (activeLine) refs.current.get(activeLine)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeLine]);

  return (
    <ol className="max-h-[70vh] overflow-y-auto rounded-lg border bg-muted/30 py-2 font-mono text-xs leading-relaxed">
      {lines.map((line, i) => {
        const n = i + 1;
        const cited = citedLines?.has(n);
        return (
          <li
            key={n}
            ref={(el) => {
              if (el) refs.current.set(n, el);
              else refs.current.delete(n);
            }}
            id={`resume-line-${n}`}
            aria-current={activeLine === n ? "true" : undefined}
            onClick={cited && onSelectLine ? () => onSelectLine(n) : undefined}
            className={cn(
              "grid grid-cols-[3rem_1fr] gap-2 px-2",
              cited && "cursor-pointer bg-primary/5",
              activeLine === n && "bg-primary/15 ring-1 ring-primary ring-inset",
            )}
          >
            <span className="text-right text-muted-foreground select-none">{n}</span>
            <span className="break-words whitespace-pre-wrap">{line}</span>
          </li>
        );
      })}
    </ol>
  );
}
