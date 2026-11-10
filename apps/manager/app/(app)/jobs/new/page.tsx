"use client";

import { messageFor } from "@hirevine/api-client";
import { PageHeader } from "@hirevine/ui/blocks/dashboard-layout";
import { ErrorState } from "@hirevine/ui/blocks/states";
import { Alert, AlertDescription, AlertTitle } from "@hirevine/ui/components/alert";
import { Badge } from "@hirevine/ui/components/badge";
import { Button } from "@hirevine/ui/components/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@hirevine/ui/components/card";
import { Spinner } from "@hirevine/ui/components/spinner";
import { Textarea } from "@hirevine/ui/components/textarea";
import { cn } from "@hirevine/ui/lib/utils";
import { AlertTriangle, ArrowUp } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { toast } from "sonner";

import { useConfirmJob, useJdChat, useSendJdMessage, type JdChatState } from "@/lib/jobs";

const FIELD_LABEL: Record<string, string> = {
  title: "Job title",
  seniority: "Seniority",
  location: "Location",
  must_have_skills: "Must-have skills",
};

function Messages({ state, pending }: { state?: JdChatState; pending: boolean }) {
  const end = useRef<HTMLDivElement>(null);
  // Braces matter: an effect's return value is its cleanup, and newer browsers return a
  // Promise from scrollIntoView, which React would then try to call on unmount.
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [state?.messages.length, pending]);
  const messages = state?.messages ?? [];
  return (
    <div className="flex flex-col gap-3" aria-live="polite">
      {messages.length === 0 ? (
        <p className="rounded-lg bg-muted/50 p-4 text-sm text-muted-foreground">
          Describe the role in your own words: what the person will do, the must-have skills, seniority and location.
          Hirevine asks for anything missing, then proposes a screening pipeline you can edit.
        </p>
      ) : null}
      {messages.map((m, i) => (
        <div
          key={i}
          className={cn(
            "max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm",
            m.role === "user" ? "self-end bg-primary text-primary-foreground" : "self-start bg-muted",
          )}
        >
          {m.content}
        </div>
      ))}
      {pending ? (
        <div className="flex items-center gap-2 self-start rounded-2xl bg-muted px-4 py-2.5 text-sm text-muted-foreground">
          <Spinner /> Thinking…
        </div>
      ) : null}
      <div ref={end} />
    </div>
  );
}

function Summary({ state, onConfirm, confirming }: { state: JdChatState; onConfirm: () => void; confirming: boolean }) {
  const s = state.summary!;
  const screening = state.workflow!.nodes.find((n) => n.type === "screening");
  const criteria = screening?.type === "screening" ? screening.config.criteria : [];
  const flagged = new Map(state.warnings.map((w) => [w.criterion, w]));
  const steps = state.workflow!.nodes.map((n) => ({ screening: "Resume screening", quiz: "Quiz", interview: "AI interview", final: "Final review" })[n.type]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{s.title}</CardTitle>
        <CardDescription>{[s.seniority, s.location].filter(Boolean).join(" · ")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <div>
          <p className="mb-1.5 font-medium">Pipeline</p>
          <p className="text-muted-foreground">{steps.join(" → ")}</p>
        </div>
        <div>
          <p className="mb-1.5 font-medium">Screening criteria</p>
          <ul className="flex flex-col gap-1.5">
            {criteria.map((c) => {
              const warn = flagged.get(c.name);
              return (
                <li key={c.id} className="flex flex-wrap items-center gap-2">
                  <span>{c.name}</span>
                  <Badge variant="outline">weight {c.weight}</Badge>
                  {c.must_have ? <Badge>must-have</Badge> : null}
                  {warn ? (
                    <Badge variant="destructive" title={warn.reason}>
                      <AlertTriangle /> may screen on {warn.characteristic}
                    </Badge>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
        {state.warnings.length ? (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertTitle>Review the flagged criteria</AlertTitle>
            <AlertDescription>
              Hirevine won't block them, but screening on protected characteristics is unfair and often unlawful. Remove
              or reword them in the editor, or ask in chat.
            </AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
      <CardFooter className="flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">You can edit every step after creating the job.</p>
        <Button onClick={onConfirm} disabled={confirming}>
          {confirming ? <Spinner /> : null}
          Create job and open editor
        </Button>
      </CardFooter>
    </Card>
  );
}

function NewJobChat() {
  const router = useRouter();
  const params = useSearchParams();
  const [threadId, setThreadId] = useState<string | null>(params.get("thread"));
  const [draft, setDraft] = useState("");
  const chat = useJdChat(threadId);
  const send = useSendJdMessage();
  const confirm = useConfirmJob();
  const state = send.data && send.data.thread_id === threadId ? send.data : chat.data;

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    const message = draft.trim();
    if (!message || send.isPending) return;
    try {
      const next = await send.mutateAsync({ thread_id: threadId ?? undefined, message });
      setDraft("");
      if (!threadId) {
        setThreadId(next.thread_id);
        router.replace(`/jobs/new?thread=${next.thread_id}`, { scroll: false });
      }
    } catch (err) {
      toast.error(messageFor(err));
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  }

  async function onConfirm() {
    if (!threadId) return;
    try {
      const { job_id } = await confirm.mutateAsync(threadId);
      router.push(`/jobs/${job_id}/workflow`);
    } catch (err) {
      toast.error(messageFor(err));
    }
  }

  if (chat.isError) return <ErrorState message={messageFor(chat.error)} />;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader title="New job" description="Describe the role. Hirevine drafts the screening pipeline." />
      <Messages state={state} pending={send.isPending} />
      {state && !state.complete && state.messages.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          Still needed:
          {state.missing.map((m) => (
            <Badge key={m} variant="outline">
              {FIELD_LABEL[m] ?? m}
            </Badge>
          ))}
        </div>
      ) : null}
      {state?.complete ? <Summary state={state} onConfirm={onConfirm} confirming={confirm.isPending} /> : null}
      <form onSubmit={submit} className="sticky bottom-4 flex items-end gap-2 rounded-2xl border bg-background p-2 shadow-sm">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={state?.complete ? "Ask for changes before creating the job…" : "e.g. We're hiring a senior React engineer, remote…"}
          aria-label="Message"
          className="max-h-40 min-h-11 resize-none border-0 shadow-none focus-visible:ring-0"
          maxLength={4000}
        />
        <Button type="submit" size="icon" aria-label="Send" disabled={!draft.trim() || send.isPending}>
          {send.isPending ? <Spinner /> : <ArrowUp />}
        </Button>
      </form>
    </div>
  );
}

export default function NewJobPage() {
  return (
    <Suspense>
      <NewJobChat />
    </Suspense>
  );
}
