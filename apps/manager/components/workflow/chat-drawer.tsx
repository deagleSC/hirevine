"use client";

import { messageFor, type Patch } from "@hirevine/api-client";
import { Alert, AlertDescription } from "@hirevine/ui/components/alert";
import { Button } from "@hirevine/ui/components/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@hirevine/ui/components/sheet";
import { Spinner } from "@hirevine/ui/components/spinner";
import { Textarea } from "@hirevine/ui/components/textarea";
import { cn } from "@hirevine/ui/lib/utils";
import { ArrowUp, CircleAlert, ListChecks, Sparkles } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import { overrideChat, type OverrideResult } from "@/lib/jobs";

const SUGGESTIONS = [
  "Raise the screening cutoff to 70",
  "Skip the quiz",
  "Make the AI interview 8 questions long",
  "Lower the interview pass mark to 55",
];

interface Turn {
  message: string;
  result?: OverrideResult;
  error?: string;
}

/** "Edit by chat" (frontend plan §198): proposals join the same preview → apply flow. */
export function ChatDrawer({
  jobId,
  open,
  onOpenChange,
  onPropose,
  busy,
}: {
  jobId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPropose: (patches: Patch[]) => void;
  busy: boolean;
}) {
  const [threadId, setThreadId] = useState<string>();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  async function submit(text: string) {
    const message = text.trim();
    if (!message || sending) return;
    setSending(true);
    setTurns((t) => [...t, { message }]);
    setDraft("");
    try {
      const result = await overrideChat(jobId, message, threadId);
      setThreadId(result.thread_id);
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, result } : x)));
    } catch (err) {
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, error: messageFor(err) } : x)));
    } finally {
      setSending(false);
    }
  }

  function send(e: FormEvent) {
    e.preventDefault();
    void submit(draft);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit(draft);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" /> Edit by chat
          </SheetTitle>
          <SheetDescription>Describe what to change. You review every change before it is applied.</SheetDescription>
        </SheetHeader>

        <div ref={scrollRef} className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 py-5">
          {turns.length === 0 ? (
            <div className="m-auto flex w-full flex-col items-center gap-4 text-center">
              <span className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Sparkles className="size-5" />
              </span>
              <div className="space-y-1">
                <p className="text-sm font-medium">What should change in this workflow?</p>
                <p className="text-sm text-muted-foreground">Try one of these, or write your own.</p>
              </div>
              <div className="flex w-full flex-col gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={sending}
                    onClick={() => void submit(s)}
                    className="rounded-lg border bg-card px-3 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {turns.map((t, i) => (
            <div key={i} className="flex flex-col gap-3">
              <div className="max-w-[85%] self-end rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-sm whitespace-pre-wrap text-primary-foreground">
                {t.message}
              </div>

              {!t.result && !t.error ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Spinner /> Working out the changes…
                </div>
              ) : null}

              {t.error ? (
                <Alert variant="destructive">
                  <CircleAlert />
                  <AlertDescription>{t.error}</AlertDescription>
                </Alert>
              ) : null}

              {t.result ? (
                <div className="flex max-w-[92%] gap-2.5">
                  <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Sparkles className="size-3.5" />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-3 text-sm">
                    <p className="leading-relaxed">{t.result.explanation}</p>
                    {t.result.error ? (
                      <p className="flex items-center gap-1.5 text-destructive">
                        <CircleAlert className="size-4" /> Couldn&apos;t turn that into a valid change. Try rephrasing.
                      </p>
                    ) : null}
                    {t.result.descriptions.length ? (
                      <div className="overflow-hidden rounded-lg border bg-card">
                        <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
                          <ListChecks className="size-3.5" />
                          {t.result.descriptions.length} proposed change{t.result.descriptions.length === 1 ? "" : "s"}
                        </div>
                        <ul className="flex flex-col divide-y">
                          {t.result.descriptions.map((d) => (
                            <li key={d} className="px-3 py-2">
                              {d}
                            </li>
                          ))}
                        </ul>
                        <div className="border-t p-2">
                          <Button size="sm" className="w-full" disabled={busy} onClick={() => onPropose(t.result!.patches as Patch[])}>
                            Review changes
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          ))}
        </div>

        <form onSubmit={send} className="border-t p-4">
          <div className="flex flex-col rounded-xl border bg-card shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              aria-label="Change request"
              placeholder="e.g. Raise the cutoff to 70 and skip the quiz"
              rows={2}
              maxLength={2000}
              className="max-h-40 min-h-0 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent"
            />
            <div className="flex items-center justify-between px-3 pb-2">
              <span className={cn("text-xs text-muted-foreground", draft.length > 1800 && "text-destructive")}>
                {draft.length > 1500 ? `${draft.length}/2000` : "Enter to send · Shift+Enter for a new line"}
              </span>
              <Button type="submit" size="icon" className="size-8 rounded-full" aria-label="Send" disabled={!draft.trim() || sending}>
                {sending ? <Spinner /> : <ArrowUp />}
              </Button>
            </div>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
