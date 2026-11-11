"use client";

import { Bot, Clock, Loader2, PauseCircle, Quote, Send, User } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Alert, AlertDescription } from "@hirevine/ui/components/alert";
import { Button } from "@hirevine/ui/components/button";
import { Textarea } from "@hirevine/ui/components/textarea";
import { formatRemaining } from "@hirevine/ui/blocks/quiz-runner";
import { cn } from "@hirevine/ui/lib/utils";

export const MAX_ANSWER_CHARS = 2000;

export interface ChatEntry {
  role: "interviewer" | "candidate";
  content: string;
}

export interface InterviewChatProps {
  transcript: ChatEntry[];
  /** The question streaming in right now, or null. */
  streaming: string | null;
  turnCap: number;
  questionsAsked: number;
  awaiting: "question" | "answer" | null;
  deadlineAt: string;
  serverNow: string;
  paused: boolean;
  /** A turn request is in flight (sending, or streaming the next question). */
  busy: boolean;
  /** The last turn's problem, shown above the answer box, with a retry when the answer is saved. */
  error?: { message: string; canRetry: boolean } | null;
  onSend: (message: string) => void;
  onRetry: () => void;
  onFinish: () => void;
  /** Called once when the countdown reaches zero (the server closes the interview). */
  onExpire?: () => void;
}

/**
 * The candidate's AI interview (frontend plan §8.5): the transcript, the question streaming in
 * (announced politely to screen readers), a turn counter, the countdown, and one answer box.
 */
export function InterviewChat({
  transcript,
  streaming,
  turnCap,
  questionsAsked,
  awaiting,
  deadlineAt,
  serverNow,
  paused,
  busy,
  error,
  onSend,
  onRetry,
  onFinish,
  onExpire,
}: InterviewChatProps) {
  const [draft, setDraft] = useState("");
  const skew = useMemo(() => Date.parse(serverNow) - Date.now(), [serverNow]);
  const [now, setNow] = useState(() => Date.now() + skew);
  const remaining = Date.parse(deadlineAt) - now;
  const expired = useRef(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() + skew), 1000);
    return () => clearInterval(id);
  }, [skew]);

  useEffect(() => {
    if (!paused && remaining <= 0 && !expired.current) {
      expired.current = true;
      onExpire?.();
    }
  }, [paused, remaining, onExpire]);

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
  }, [transcript.length, streaming]);

  const canSend = awaiting === "answer" && !busy && draft.trim().length > 0 && (paused || remaining > 0);
  const send = () => {
    if (!canSend) return;
    onSend(draft.trim());
    setDraft("");
  };
  const current = Math.min(Math.max(questionsAsked, 1), turnCap);

  return (
    <div className="flex flex-col gap-4">
      <div className="sticky top-0 z-10 -mx-4 flex flex-wrap items-center justify-between gap-3 border-b bg-background/95 px-4 py-3 backdrop-blur">
        <span className="text-sm font-medium">
          Question {current} of {turnCap}
        </span>
        {paused ? (
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <PauseCircle className="size-4" aria-hidden /> Paused — the clock is stopped
          </span>
        ) : (
          <div
            role="timer"
            aria-live="off"
            aria-label={`Time left ${formatRemaining(remaining)}`}
            className={cn("flex items-center gap-2 font-mono text-lg tabular-nums", remaining < 60_000 && "text-destructive")}
          >
            <Clock className="size-4" aria-hidden />
            {formatRemaining(remaining)}
          </div>
        )}
      </div>

      <ol className="flex flex-col gap-3" aria-label="Interview transcript">
        {transcript.map((e, i) => (
          <Bubble key={i} entry={e} />
        ))}
        {streaming !== null ? (
          <li aria-live="polite" aria-busy={busy}>
            <Bubble entry={{ role: "interviewer", content: streaming }} pending as="div" />
          </li>
        ) : null}
      </ol>
      <div ref={end} />

      {error ? (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>{error.message}</span>
            {error.canRetry ? (
              <Button size="sm" variant="outline" onClick={onRetry} disabled={busy}>
                Try again
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-2">
        <label htmlFor="interview-answer" className="text-sm font-medium">
          Your answer
        </label>
        <Textarea
          id="interview-answer"
          value={draft}
          maxLength={MAX_ANSWER_CHARS}
          rows={5}
          disabled={awaiting !== "answer" || busy}
          placeholder={awaiting === "answer" ? "Type your answer…" : "Waiting for the next question…"}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground tabular-nums">
            {draft.length} / {MAX_ANSWER_CHARS}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onFinish} disabled={busy}>
              Finish interview
            </Button>
            <Button onClick={send} disabled={!canSend}>
              {busy ? <Loader2 className="animate-spin" /> : <Send />}
              Send answer
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Bubble({ entry, pending, as = "li" }: { entry: ChatEntry; pending?: boolean; as?: "li" | "div" }) {
  const ai = entry.role === "interviewer";
  const Tag = as;
  return (
    <Tag className={cn("flex gap-3", !ai && "flex-row-reverse")}>
      <span className={cn("mt-1 flex size-7 shrink-0 items-center justify-center rounded-full", ai ? "bg-primary/10" : "bg-muted")}>
        {ai ? <Bot className="size-4" aria-label="AI interviewer" /> : <User className="size-4" aria-label="You" />}
      </span>
      <p
        className={cn(
          "max-w-[85%] whitespace-pre-wrap rounded-xl px-3.5 py-2.5 text-sm",
          ai ? "bg-muted/60" : "bg-primary text-primary-foreground",
        )}
      >
        {entry.content || (pending ? <Loader2 className="size-4 animate-spin" aria-label="Writing the next question" /> : null)}
      </p>
    </Tag>
  );
}

// ------------------------------------------------------------------ manager views

export interface TranscriptTurn extends ChatEntry {
  n: number;
}

/** Numbered interview turns (frontend plan §5 `TranscriptView`); cited turns are marked. */
export function TranscriptView({
  turns,
  cited,
  activeTurn,
  onSelect,
}: {
  turns: TranscriptTurn[];
  cited?: ReadonlySet<number>;
  activeTurn?: number | null;
  onSelect?: (n: number) => void;
}) {
  const refs = useRef(new Map<number, HTMLLIElement>());
  useEffect(() => {
    if (activeTurn != null) refs.current.get(activeTurn)?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [activeTurn]);
  if (!turns.length) return <p className="text-sm text-muted-foreground">No turns yet.</p>;
  return (
    <ol className="flex flex-col gap-2 text-sm">
      {turns.map((t) => (
        <li
          key={t.n}
          ref={(el) => {
            if (el) refs.current.set(t.n, el);
          }}
          data-turn={t.n}
          data-active={activeTurn === t.n || undefined}
          className={cn(
            "grid grid-cols-[2.5rem_1fr] gap-2 rounded-md px-2 py-1.5",
            cited?.has(t.n) && "bg-amber-500/10",
            activeTurn === t.n && "ring-2 ring-primary",
          )}
        >
          <button
            type="button"
            className="h-fit text-left font-mono text-xs text-muted-foreground tabular-nums hover:underline"
            onClick={() => onSelect?.(t.n)}
            aria-label={`Turn ${t.n}`}
          >
            T{t.n}
          </button>
          <div>
            <span className="mr-1.5 text-xs font-medium text-muted-foreground">{t.role === "interviewer" ? "AI" : "Candidate"}</span>
            <span className="whitespace-pre-wrap">{t.content}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}

export interface InterviewScoreItem {
  item_id: string;
  name: string;
  weight: number;
  score: number;
  rationale: string;
  turns: number[];
  verified: boolean;
}

/** Rubric scores with turn citations; a chip selects the cited turn in the transcript. */
export function InterviewScores({
  items,
  activeTurn,
  onSelectTurn,
}: {
  items: InterviewScoreItem[];
  activeTurn?: number | null;
  onSelectTurn: (n: number) => void;
}) {
  if (!items.length) return <p className="text-sm text-muted-foreground">Not scored yet.</p>;
  return (
    <ul className="flex flex-col gap-3">
      {items.map((it) => (
        <li key={it.item_id} className="rounded-lg border p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">
              {it.name} <span className="text-xs font-normal text-muted-foreground">× {it.weight}</span>
            </span>
            <span className="text-xs tabular-nums text-muted-foreground" aria-label={`${it.score} of 4`}>
              {it.score}/4
            </span>
          </div>
          <p className="mt-1 text-muted-foreground">{it.rationale}</p>
          <div className="mt-2 flex flex-wrap gap-1">
            {it.turns.length ? (
              it.turns.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => onSelectTurn(n)}
                  aria-pressed={activeTurn === n}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-xs tabular-nums hover:bg-accent",
                    activeTurn === n && "border-primary bg-primary/10",
                  )}
                >
                  <Quote className="size-3" aria-hidden />T{n}
                </button>
              ))
            ) : (
              <span className="text-xs text-amber-700 dark:text-amber-400">No supporting answer</span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
