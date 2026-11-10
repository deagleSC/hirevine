"use client";

import { messageFor, type Patch } from "@hirevine/api-client";
import { Alert, AlertDescription } from "@hirevine/ui/components/alert";
import { Button } from "@hirevine/ui/components/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@hirevine/ui/components/sheet";
import { Spinner } from "@hirevine/ui/components/spinner";
import { Textarea } from "@hirevine/ui/components/textarea";
import { ArrowUp } from "lucide-react";
import { useState, type FormEvent } from "react";

import { overrideChat, type OverrideResult } from "@/lib/jobs";

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

  async function send(e: FormEvent) {
    e.preventDefault();
    const message = draft.trim();
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

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Edit by chat</SheetTitle>
          <SheetDescription>Say what to change, e.g. "raise the cutoff to 70 and skip the quiz". You review every change before it is applied.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4">
          {turns.map((t, i) => (
            <div key={i} className="flex flex-col gap-2">
              <div className="self-end rounded-2xl bg-primary px-3 py-2 text-sm text-primary-foreground">{t.message}</div>
              {!t.result && !t.error ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Spinner /> Working out the changes…
                </div>
              ) : null}
              {t.error ? (
                <Alert variant="destructive">
                  <AlertDescription>{t.error}</AlertDescription>
                </Alert>
              ) : null}
              {t.result ? (
                <div className="flex flex-col gap-2 rounded-2xl bg-muted px-3 py-2 text-sm">
                  <p>{t.result.explanation}</p>
                  {t.result.error ? <p className="text-destructive">Couldn't turn that into a valid change. Try rephrasing.</p> : null}
                  {t.result.descriptions.length ? (
                    <>
                      <ul className="list-disc pl-5">
                        {t.result.descriptions.map((d) => (
                          <li key={d}>{d}</li>
                        ))}
                      </ul>
                      <Button size="sm" className="self-start" disabled={busy} onClick={() => onPropose(t.result!.patches as Patch[])}>
                        Review changes
                      </Button>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>
        <form onSubmit={send} className="flex items-end gap-2 border-t p-4">
          <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Change request" rows={2} maxLength={2000} className="resize-none" />
          <Button type="submit" size="icon" aria-label="Send" disabled={!draft.trim() || sending}>
            {sending ? <Spinner /> : <ArrowUp />}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
