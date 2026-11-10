"use client";

import { messageFor } from "@hirevine/api-client";
import { PageHeader } from "@hirevine/ui/blocks/dashboard-layout";
import { ErrorState } from "@hirevine/ui/blocks/states";
import { Alert, AlertDescription, AlertTitle } from "@hirevine/ui/components/alert";
import { Badge } from "@hirevine/ui/components/badge";
import { Button } from "@hirevine/ui/components/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@hirevine/ui/components/card";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@hirevine/ui/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@hirevine/ui/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputProvider,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  type PromptInputMessage,
} from "@hirevine/ui/ai-elements/prompt-input";
import { Suggestion } from "@hirevine/ui/ai-elements/suggestion";
import { Spinner } from "@hirevine/ui/components/spinner";
import { AlertTriangle, BriefcaseBusiness } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { toast } from "sonner";

import { useConfirmJob, useJdChat, useSendJdMessage, type JdChatState } from "@/lib/jobs";

const FIELD_LABEL: Record<string, string> = {
  title: "Job title",
  seniority: "Seniority",
  location: "Location",
  must_have_skills: "Must-have skills",
};

const STARTERS = [
  "We're hiring a senior React engineer, remote, must know TypeScript.",
  "Data analyst in Bengaluru: SQL and Python required, 2–4 years.",
  "Mid-level backend engineer for our payments team, Go or Java.",
];

function Messages({ state, pending, onStarter }: { state?: JdChatState; pending: boolean; onStarter: (text: string) => void }) {
  const messages = state?.messages ?? [];
  if (messages.length === 0 && !pending) {
    return (
      <ConversationEmptyState>
        <BriefcaseBusiness className="size-8 text-muted-foreground" />
        <div className="space-y-1">
          <h3 className="text-sm font-medium">Describe the role</h3>
          <p className="max-w-md text-sm text-muted-foreground">
            What the person will do, the must-have skills, seniority and location. Hirevine asks for anything missing, then
            proposes a screening pipeline you can edit.
          </p>
        </div>
        <div className="flex flex-col items-center gap-2">
          {STARTERS.map((s) => (
            <Suggestion key={s} suggestion={s} onClick={onStarter} className="h-auto whitespace-normal py-1.5" />
          ))}
        </div>
      </ConversationEmptyState>
    );
  }
  return (
    <>
      {messages.map((m, i) => (
        <Message key={i} from={m.role}>
          <MessageContent>{m.role === "assistant" ? <MessageResponse>{m.content}</MessageResponse> : m.content}</MessageContent>
        </Message>
      ))}
      {pending ? (
        <Message from="assistant">
          <MessageContent>
            <span className="flex items-center gap-2 text-muted-foreground">
              <Spinner /> Thinking…
            </span>
          </MessageContent>
        </Message>
      ) : null}
    </>
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
  const chat = useJdChat(threadId);
  const send = useSendJdMessage();
  const confirm = useConfirmJob();
  const state = send.data && send.data.thread_id === threadId ? send.data : chat.data;

  /** Throws on failure so PromptInput keeps the text for a retry. */
  async function sendMessage(text: string) {
    const message = text.trim();
    if (!message || send.isPending) return;
    try {
      const next = await send.mutateAsync({ thread_id: threadId ?? undefined, message });
      if (!threadId) {
        setThreadId(next.thread_id);
        router.replace(`/jobs/new?thread=${next.thread_id}`, { scroll: false });
      }
    } catch (err) {
      toast.error(messageFor(err));
      throw err;
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
    <div className="mx-auto flex h-[calc(100svh-6rem)] w-full max-w-3xl flex-col gap-4">
      <PageHeader title="New job" description="Describe the role. Hirevine drafts the screening pipeline." />
      <Conversation className="min-h-0 flex-1 rounded-xl border">
        <ConversationContent>
          <Messages state={state} pending={send.isPending} onStarter={(t) => void sendMessage(t).catch(() => {})} />
          {state?.complete ? <Summary state={state} onConfirm={onConfirm} confirming={confirm.isPending} /> : null}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
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
      <PromptInputProvider>
        <PromptInput onSubmit={(msg: PromptInputMessage) => sendMessage(msg.text)}>
          <PromptInputBody>
            <PromptInputTextarea
              aria-label="Message"
              maxLength={4000}
              placeholder={state?.complete ? "Ask for changes before creating the job…" : "Describe the role…"}
            />
          </PromptInputBody>
          <PromptInputFooter>
            <PromptInputTools>
              <span className="px-2 text-xs text-muted-foreground">Enter to send · Shift+Enter for a new line</span>
            </PromptInputTools>
            <PromptInputSubmit status={send.isPending ? "submitted" : undefined} disabled={send.isPending} aria-label="Send" />
          </PromptInputFooter>
        </PromptInput>
      </PromptInputProvider>
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
