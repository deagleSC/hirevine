"use client";

import { ApiError, messageFor } from "@hirevine/api-client";
import { PageHeader } from "@hirevine/ui/blocks/dashboard-layout";
import { InterviewChat } from "@hirevine/ui/blocks/interview";
import { ErrorState, PageSkeleton, StatusCard } from "@hirevine/ui/blocks/states";
import { Alert, AlertDescription, AlertTitle } from "@hirevine/ui/components/alert";
import { Button } from "@hirevine/ui/components/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@hirevine/ui/components/card";
import { Bot, CheckCircle2, Clock, ListChecks, Loader2, MessagesSquare, Mic } from "lucide-react";
import Link from "next/link";
import { use, useEffect, useRef } from "react";

import { useInterview, useInterviewActions, useInterviewTurn, useQuestionAudio } from "@/lib/interview";

/** The AI interview (frontend plan §8.5, Phase 7). Reloading restores the transcript and the clock. */
export default function InterviewPage({ params }: { params: Promise<{ appId: string }> }) {
  const { appId } = use(params);
  const interview = useInterview(appId);
  const { start, finish } = useInterviewActions(appId);
  const turn = useInterviewTurn(appId);
  const voice = useQuestionAudio(appId);
  const asked = useRef(false);
  const spoken = useRef<number | null>(null);

  const s = interview.data;
  const voiceMode = s?.answer_mode === "voice";
  // The open question's number (1-based), once it has fully arrived.
  const openQuestion =
    s?.status === "in_progress" && s.awaiting === "answer" && !turn.busy ? s.questions_asked ?? null : null;
  // Read each new question aloud once; the candidate can replay it.
  useEffect(() => {
    if (voiceMode && openQuestion && spoken.current !== openQuestion) {
      spoken.current = openQuestion;
      void voice.play(openQuestion);
    }
  }, [voiceMode, openQuestion, voice]);
  useEffect(() => {
    if (s?.status === "finished") voice.stop();
  }, [s?.status, voice]);
  // A fresh or resumed session with no open question asks for one, once per visit.
  useEffect(() => {
    if (s?.status === "in_progress" && s.awaiting === "question" && !s.paused && !asked.current && !turn.busy) {
      asked.current = true;
      void turn.send(s.answers_given ?? 0);
    }
  }, [s, turn]);

  if (interview.isError) return <ErrorState message={messageFor(interview.error)} />;
  if (interview.isPending || !s) return <PageSkeleton />;
  const backTo = { href: `/applications/${appId}`, label: "Application" };
  const back = (
    <Button asChild variant="outline">
      <Link href={backTo.href}>Back to application</Link>
    </Button>
  );

  if (s.status === "finished") {
    return (
      <>
        <PageHeader title="AI interview" back={backTo} />
        <StatusCard
          icon={<CheckCircle2 />}
          tone="success"
          title="Thanks. Your responses are being reviewed."
          description="The hiring team will share outcomes when they release them."
          actions={back}
        />
      </>
    );
  }

  if (s.status === "closed") {
    return (
      <>
        <PageHeader title="AI interview" back={backTo} />
        <StatusCard
          icon={<Bot />}
          title="This interview is not open"
          description="Your application is not at the interview step right now."
          actions={back}
        />
      </>
    );
  }

  if (s.status === "not_started") {
    const notReady = start.error instanceof ApiError && start.error.code === "interview_not_ready";
    return (
      <>
        <PageHeader title="AI interview" back={backTo} />
        <Card>
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
            {s.answer_mode === "voice" ? (
              <p className="flex items-start gap-2">
                <Mic className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span>
                  Questions are read aloud and you answer by speaking, one take per question. Your answers are transcribed
                  and the recordings are not kept. Use a quiet room and allow microphone access when asked.
                </span>
              </p>
            ) : null}
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
          </CardFooter>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="AI interview"
        description={
          voiceMode
            ? "Listen to each question, then record your answer. You can take your time within the limit."
            : "Answer in your own words. You can take your time within the limit."
        }
      />
      {finish.isError ? (
        <Alert variant="destructive">
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
        answerMode={s.answer_mode ?? "text"}
        onSendAudio={(a) => void turn.sendAudio(s.answers_given ?? 0, a)}
        transcribing={turn.transcribing}
        speaking={voice.speaking}
        onReplay={openQuestion ? () => void voice.play(openQuestion) : undefined}
        onStopSpeaking={voice.stop}
        onRetry={() => void turn.send(s.answers_given ?? 0)}
        onFinish={() => finish.mutate()}
        onExpire={() => finish.mutate()}
      />
    </>
  );
}
