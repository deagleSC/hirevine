"use client";

import { CheckCircle2, Clock, CloudOff, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@hirevine/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@hirevine/ui/components/dialog";
import { RadioGroup, RadioGroupItem } from "@hirevine/ui/components/radio-group";
import { cn } from "@hirevine/ui/lib/utils";

export interface QuizRunnerQuestion {
  id: string;
  prompt: string;
  options: string[];
}

export type Answers = Record<string, number>;
type SaveState = "idle" | "saving" | "saved" | "error";

export interface QuizRunnerProps {
  questions: QuizRunnerQuestion[];
  /** Answers already saved on the server (a resumed attempt starts from these). */
  initialAnswers: Answers;
  /** ISO 8601 deadline and the server's clock at load time; the countdown corrects for clock skew. */
  deadlineAt: string;
  serverNow: string;
  /** Persist changed answers (merged on the server). */
  onSave: (changed: Answers) => Promise<void>;
  /** Submit; `auto` is true when the timer ran out. Called at most once. */
  onSubmit: (auto: boolean) => Promise<void>;
  /** Autosave delay after the last change. */
  saveDelayMs?: number;
}

export function formatRemaining(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * The candidate's timed quiz (frontend plan §8, Phase 6): one question list, autosave a moment after
 * each change, a countdown from the server's deadline, and auto-submit when it reaches zero.
 * Pending changes are always flushed before submitting.
 */
export function QuizRunner({
  questions,
  initialAnswers,
  deadlineAt,
  serverNow,
  onSave,
  onSubmit,
  saveDelayMs = 600,
}: QuizRunnerProps) {
  const [answers, setAnswers] = useState<Answers>(initialAnswers);
  const [save, setSave] = useState<SaveState>("idle");
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Server time = local time + skew, measured once at mount.
  const skew = useMemo(() => Date.parse(serverNow) - Date.now(), [serverNow]);
  const deadline = Date.parse(deadlineAt);
  const [now, setNow] = useState(() => Date.now() + skew);
  const remaining = deadline - now;

  const pending = useRef<Answers>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submitted = useRef(false);

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const changed = pending.current;
    if (Object.keys(changed).length === 0) return;
    pending.current = {};
    setSave("saving");
    try {
      await onSave(changed);
      setSave("saved");
    } catch {
      pending.current = { ...changed, ...pending.current }; // retry with the next change or submit
      setSave("error");
    }
  }, [onSave]);

  const finish = useCallback(
    async (auto: boolean) => {
      if (submitted.current) return;
      submitted.current = true;
      setSubmitting(true);
      setConfirming(false);
      await flush().catch(() => undefined);
      try {
        await onSubmit(auto);
      } catch {
        submitted.current = false;
        setSubmitting(false);
      }
    },
    [flush, onSubmit],
  );

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() + skew), 1000);
    return () => clearInterval(id);
  }, [skew]);

  useEffect(() => {
    if (remaining <= 0) void finish(true);
  }, [remaining, finish]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function choose(questionId: string, index: number) {
    setAnswers((a) => ({ ...a, [questionId]: index }));
    pending.current = { ...pending.current, [questionId]: index };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), saveDelayMs);
  }

  const answered = questions.filter((q) => answers[q.id] !== undefined).length;
  const low = remaining < 60_000;

  return (
    <div className="flex flex-col gap-6">
      <div className="sticky top-0 z-10 -mx-4 flex flex-wrap items-center justify-between gap-3 border-b bg-background/95 px-4 py-3 backdrop-blur">
        <div
          role="timer"
          aria-live="off"
          aria-label={`Time left ${formatRemaining(remaining)}`}
          className={cn("flex items-center gap-2 font-mono text-lg tabular-nums", low && "text-destructive")}
        >
          <Clock className="size-4" aria-hidden />
          {formatRemaining(remaining)}
        </div>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span>
            {answered} of {questions.length} answered
          </span>
          <SaveIndicator state={save} />
        </div>
      </div>

      <ol className="flex flex-col gap-6">
        {questions.map((q, i) => (
          <li key={q.id} className="rounded-xl border p-4 sm:p-5">
            <fieldset disabled={submitting}>
              <legend id={`q-${q.id}`} className="mb-3 font-medium">
                <span className="mr-2 text-muted-foreground">{i + 1}.</span>
                {q.prompt}
              </legend>
              <RadioGroup
                aria-labelledby={`q-${q.id}`}
                value={answers[q.id] === undefined ? "" : String(answers[q.id])}
                onValueChange={(v) => choose(q.id, Number(v))}
                className="gap-2"
              >
                {q.options.map((opt, j) => {
                  const id = `q-${q.id}-${j}`;
                  return (
                    <label
                      key={j}
                      htmlFor={id}
                      className="flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-sm has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
                    >
                      <RadioGroupItem id={id} value={String(j)} className="mt-0.5" />
                      <span>{opt}</span>
                    </label>
                  );
                })}
              </RadioGroup>
            </fieldset>
          </li>
        ))}
      </ol>

      <div className="flex justify-end">
        <Button size="lg" disabled={submitting} onClick={() => setConfirming(true)}>
          {submitting ? <Loader2 className="animate-spin" /> : null}
          Submit answers
        </Button>
      </div>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Submit your answers?</DialogTitle>
            <DialogDescription>
              {answered < questions.length
                ? `${questions.length - answered} question${questions.length - answered === 1 ? " is" : "s are"} unanswered. `
                : ""}
              You cannot change your answers after submitting.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Keep working
            </Button>
            <Button onClick={() => void finish(false)}>Submit</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === "saving")
    return (
      <span className="flex items-center gap-1" aria-live="polite">
        <Loader2 className="size-3.5 animate-spin" aria-hidden /> Saving
      </span>
    );
  if (state === "saved")
    return (
      <span className="flex items-center gap-1" aria-live="polite">
        <CheckCircle2 className="size-3.5" aria-hidden /> Saved
      </span>
    );
  if (state === "error")
    return (
      <span className="flex items-center gap-1 text-destructive" aria-live="polite">
        <CloudOff className="size-3.5" aria-hidden /> Not saved — will retry
      </span>
    );
  return null;
}

/** Per-question results for the manager's candidate page (stored stage evidence for a quiz). */
export interface QuizResultItem {
  question_id: string;
  prompt: string;
  options: string[];
  chosen: number | null;
  answer_index: number | null;
  correct: boolean;
  explanation: string;
}

export function QuizResults({ items }: { items: QuizResultItem[] }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">No answers recorded.</p>;
  return (
    <ol className="flex flex-col gap-4">
      {items.map((r, i) => (
        <li key={r.question_id} className="rounded-lg border p-3 text-sm">
          <p className="mb-2 font-medium">
            <span className="mr-2 text-muted-foreground">{i + 1}.</span>
            {r.prompt}
            <span className={cn("ml-2 text-xs font-normal", r.correct ? "text-emerald-600 dark:text-emerald-400" : "text-destructive")}>
              {r.correct ? "Correct" : r.chosen === null ? "Unanswered" : "Incorrect"}
            </span>
          </p>
          <ul className="flex flex-col gap-1">
            {r.options.map((o, j) => (
              <li
                key={j}
                className={cn(
                  "rounded px-2 py-1",
                  j === r.answer_index && "bg-emerald-500/10",
                  j === r.chosen && j !== r.answer_index && "bg-destructive/10",
                )}
              >
                {o}
                {j === r.chosen ? <span className="ml-2 text-xs text-muted-foreground">(chosen)</span> : null}
                {j === r.answer_index ? <span className="ml-2 text-xs text-muted-foreground">(answer)</span> : null}
              </li>
            ))}
          </ul>
          {r.explanation ? <p className="mt-2 text-muted-foreground">{r.explanation}</p> : null}
        </li>
      ))}
    </ol>
  );
}
