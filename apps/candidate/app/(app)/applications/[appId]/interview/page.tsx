"use client";

import { ApiError, messageFor } from "@hirevine/api-client";
import { PageHeader } from "@hirevine/ui/blocks/dashboard-layout";
import { InterviewChat } from "@hirevine/ui/blocks/interview";
import { ErrorState, PageSkeleton } from "@hirevine/ui/blocks/states";
import { Alert, AlertDescription, AlertTitle } from "@hirevine/ui/components/alert";
import { Button } from "@hirevine/ui/components/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@hirevine/ui/components/card";
import { Bot, CheckCircle2, Clock, ListChecks, Loader2, MessagesSquare } from "lucide-react";
import Link from "next/link";
import { use, useEffect, useRef } from "react";

import { useInterview, useInterviewActions, useInterviewTurn } from "@/lib/interview";

/** The AI interview (frontend plan §8.5, Phase 7). Reloading restores the transcript and the clock. */
export default function InterviewPage({ params }: { params: Promise<{ appId: string }> }) {
  const { appId } = use(params);
  const interview = useInterview(appId);
  const { start, finish } = useInterviewActions(appId);
  const turn = useInterviewTurn(appId);
  const asked = useRef(false);

  const s = interview.data;
  // A fresh or resumed session with no open question asks for one, once per visit.
  useEffect(() => {
    if (s?.status === "in_progress" && s.awaiting === "question" && !s.paused && !asked.current && !turn.busy) {
      asked.current = true;
      void turn.send(s.answers_given ?? 0);
    }
  }, [s, turn]);

  if (interview.isError) return <ErrorState message={messageFor(interview.error)} />;
  if (interview.isPending || !s) return <PageSkeleton />;
  const back = (
    <Button asChild variant="outline">
      <Link href={`/applications/${appId}`}>Back to application</Link>
    </Button>
  );

  if (s.status === "finished") {
    return (
      <>
        <PageHeader title="AI interview" />
        <Card className="max-w-xl">
          <CardHeader>
            <CheckCircle2 className="mb-2 size-6 text-emerald-600 dark:text-emerald-400" />
            <CardTitle>Thanks. Your responses are being reviewed.</CardTitle>
            <CardDescription>The hiring team will share outcomes when they release them.</CardDescription>
          </CardHeader>
          <CardFooter>{back}</CardFooter>
        </Card>
      </>
    );
  }

  if (s.status === "closed") {
    return (
      <>
        <PageHeader title="AI interview" />
        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle>This interview is not open</CardTitle>
            <CardDescription>Your application is not at the interview step right now.</CardDescription>
          </CardHeader>
          <CardFooter>{back}</CardFooter>
        </Card>
      </>
    );
  }

  if (s.status === "not_started") {
    const notReady = start.error instanceof ApiError && start.error.code === "interview_not_ready";
    return (
      <>
        <PageHeader title="AI interview" />
        <Card className="max-w-xl">
          <CardHeader>
            <Bot className="mb-2 size-6 text-primary" aria-hidden />
            <CardTitle>This interview is conducted by an AI</CardTitle>
            <CardDescription>{s.disclosure}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <p className="flex items-center gap-2">
              <MessagesSquare className="size-4 text-muted-foreground" aria-hidden />
              {s.turn_cap} questions, one at a time
            </p>
            <p className="flex items-center gap-2">
              <Clock className="size-4 text-muted-foreground" aria-hidden />
              {s.time_limit_min} minutes, starting when you press Start
            </p>
            {s.evaluates.length ? (
              <p className="flex items-start gap-2">
                <ListChecks className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span>Your answers are assessed on: {s.evaluates.join(", ")}.</span>
              </p>
            ) : null}
            <p className="text-muted-foreground">
              You have one attempt. Answers save as you send them; if you close the page, come back before the time runs out
              to continue. When the time is up, the answers you sent are reviewed.
            </p>
            {start.isError ? (
              <Alert variant="destructive">
                <AlertTitle>{notReady ? "Not ready yet" : "Could not start"}</AlertTitle>
                <AlertDescription>{messageFor(start.error)}</AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
          <CardFooter className="gap-2">
            <Button onClick={() => start.mutate()} disabled={start.isPending}>
              {start.isPending ? <Loader2 className="animate-spin" /> : null}
              Start interview
            </Button>
            {back}
          </CardFooter>
        </Card>
      </>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader title="AI interview" description="Answer in your own words. You can take your time within the limit." />
      {finish.isError ? (
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>Could not finish</AlertTitle>
          <AlertDescription>{messageFor(finish.error)}</AlertDescription>
        </Alert>
      ) : null}
      <InterviewChat
        transcript={s.transcript ?? []}
        streaming={turn.streaming}
        turnCap={s.turn_cap}
        questionsAsked={s.questions_asked ?? 0}
        awaiting={s.awaiting ?? null}
        deadlineAt={s.deadline_at!}
        serverNow={s.server_now}
        paused={s.paused ?? false}
        busy={turn.busy || finish.isPending}
        error={turn.error}
        onSend={(m) => void turn.send(s.answers_given ?? 0, m)}
        onRetry={() => void turn.send(s.answers_given ?? 0)}
        onFinish={() => finish.mutate()}
        onExpire={() => finish.mutate()}
      />
    </div>
  );
}
