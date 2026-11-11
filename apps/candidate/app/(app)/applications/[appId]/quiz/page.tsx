"use client";

import { ApiError, messageFor } from "@hirevine/api-client";
import { PageHeader } from "@hirevine/ui/blocks/dashboard-layout";
import { QuizRunner } from "@hirevine/ui/blocks/quiz-runner";
import { ErrorState, PageSkeleton } from "@hirevine/ui/blocks/states";
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
  const back = (
    <Button asChild variant="outline">
      <Link href={`/applications/${appId}`}>Back to application</Link>
    </Button>
  );

  if (q.status === "submitted") {
    return (
      <>
        <PageHeader title="Skills quiz" />
        <Card className="max-w-xl">
          <CardHeader>
            <CheckCircle2 className="mb-2 size-6 text-emerald-600 dark:text-emerald-400" />
            <CardTitle>Answers submitted</CardTitle>
            <CardDescription>
              Thanks. The hiring team will review your application; results are shared when they release outcomes.
            </CardDescription>
          </CardHeader>
          <CardFooter>{back}</CardFooter>
        </Card>
      </>
    );
  }

  if (q.status === "closed") {
    return (
      <>
        <PageHeader title="Skills quiz" />
        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle>This quiz is not open</CardTitle>
            <CardDescription>Your application is not at the quiz step right now.</CardDescription>
          </CardHeader>
          <CardFooter>{back}</CardFooter>
        </Card>
      </>
    );
  }

  if (q.status === "not_started") {
    const notReady = start.error instanceof ApiError && start.error.code === "quiz_not_ready";
    return (
      <>
        <PageHeader title="Skills quiz" />
        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle>Before you start</CardTitle>
            <CardDescription>Read this first: the timer cannot be paused.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <p className="flex items-center gap-2">
              <ListChecks className="size-4 text-muted-foreground" aria-hidden />
              {q.question_count} multiple-choice question{q.question_count === 1 ? "" : "s"}
            </p>
            <p className="flex items-center gap-2">
              <Clock className="size-4 text-muted-foreground" aria-hidden />
              {q.time_limit_min} minutes, starting when you press Start
            </p>
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
            {back}
          </CardFooter>
        </Card>
      </>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader title="Skills quiz" description="Choose one answer per question." />
      {submit.isError ? (
        <Alert variant="destructive" className="mb-4">
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
    </div>
  );
}
