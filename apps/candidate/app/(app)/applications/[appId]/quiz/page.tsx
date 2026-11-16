"use client";

import { ApiError, messageFor } from "@hirevine/api-client";
import { PageHeader } from "@hirevine/ui/blocks/dashboard-layout";
import { QuizRunner } from "@hirevine/ui/blocks/quiz-runner";
import { ErrorState, PageSkeleton, StatusCard } from "@hirevine/ui/blocks/states";
import { Alert, AlertDescription, AlertTitle } from "@hirevine/ui/components/alert";
import { Button } from "@hirevine/ui/components/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@hirevine/ui/components/card";
import { CheckCircle2, Clock, ListChecks, Loader2 } from "lucide-react";
import Link from "next/link";
import { use } from "react";

import { useQuiz, useQuizActions } from "@/lib/quiz";

/** The timed quiz (frontend plan §8.2, Phase 6). Reloading resumes the same attempt from the server. */
export default function QuizPage({ params }: { params: Promise<{ appId: string }> }) {
  const { appId } = use(params);
  const quiz = useQuiz(appId);
  const { start, submit, save } = useQuizActions(appId);

  if (quiz.isError) return <ErrorState message={messageFor(quiz.error)} />;
  if (quiz.isPending) return <PageSkeleton />;
  const q = quiz.data;
  const backTo = { href: `/applications/${appId}`, label: "Application" };
  const back = (
    <Button asChild variant="outline">
      <Link href={backTo.href}>Back to application</Link>
    </Button>
  );

  if (q.status === "submitted") {
    return (
      <>
        <PageHeader title="Skills quiz" back={backTo} />
        <StatusCard
          icon={<CheckCircle2 />}
          tone="success"
          title="Answers submitted"
          description="Thanks. The hiring team will review your application; results are shared when they release outcomes."
          actions={back}
        />
      </>
    );
  }

  if (q.status === "closed") {
    return (
      <>
        <PageHeader title="Skills quiz" back={backTo} />
        <StatusCard
          icon={<ListChecks />}
          title="This quiz is not open"
          description="Your application is not at the quiz step right now."
          actions={back}
        />
      </>
    );
  }

  if (q.status === "not_started") {
    const notReady = start.error instanceof ApiError && start.error.code === "quiz_not_ready";
    return (
      <>
        <PageHeader title="Skills quiz" back={backTo} />
        <Card>
          <CardHeader>
            <CardTitle>Before you start</CardTitle>
            <CardDescription>Read this first: the timer cannot be paused.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 text-sm">
            <div className="grid gap-3 sm:grid-cols-2">
              <p className="flex items-center gap-3 rounded-lg border bg-muted/40 p-3">
                <ListChecks className="size-5 text-primary" aria-hidden />
                <span>
                  <span className="block font-medium">{q.question_count} question{q.question_count === 1 ? "" : "s"}</span>
                  <span className="text-muted-foreground">Multiple choice</span>
                </span>
              </p>
              <p className="flex items-center gap-3 rounded-lg border bg-muted/40 p-3">
                <Clock className="size-5 text-primary" aria-hidden />
                <span>
                  <span className="block font-medium">{q.time_limit_min} minutes</span>
                  <span className="text-muted-foreground">Starts when you press Start</span>
                </span>
              </p>
            </div>
            <p className="text-muted-foreground">
              Answers save automatically. If you close the page, come back before time runs out to continue. When the
              time is up, your saved answers are submitted for you. You have one attempt.
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
              Start quiz
            </Button>
          </CardFooter>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Skills quiz" description="Choose one answer per question." />
      {submit.isError ? (
        <Alert variant="destructive" >
          <AlertTitle>Could not submit</AlertTitle>
          <AlertDescription>{messageFor(submit.error)} Your answers are saved; try again.</AlertDescription>
        </Alert>
      ) : null}
      <QuizRunner
        questions={q.questions ?? []}
        initialAnswers={q.answers ?? {}}
        deadlineAt={q.deadline_at!}
        serverNow={q.server_now}
        onSave={save}
        onSubmit={async () => {
          await submit.mutateAsync();
        }}
      />
    </>
  );
}
