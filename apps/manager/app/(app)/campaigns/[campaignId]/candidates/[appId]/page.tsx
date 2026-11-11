"use client";

import { messageFor } from "@hirevine/api-client";
import { PageHeader } from "@hirevine/ui/blocks/dashboard-layout";
import { EvidenceList, FlagBadges, ResumeViewer, type EvidenceItem } from "@hirevine/ui/blocks/evidence";
import { ProcessingState } from "@hirevine/ui/blocks/processing-state";
import { QuizResults, type QuizResultItem } from "@hirevine/ui/blocks/quiz-runner";
import { ErrorState, PageSkeleton } from "@hirevine/ui/blocks/states";
import { StatusBadge } from "@hirevine/ui/blocks/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@hirevine/ui/components/alert";
import { Button } from "@hirevine/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@hirevine/ui/components/card";
import { ShieldAlert } from "lucide-react";
import Link from "next/link";
import { use, useMemo, useState } from "react";

import { candidateLabel, useApplication } from "@/lib/campaigns";

export default function CandidatePage({ params }: { params: Promise<{ campaignId: string; appId: string }> }) {
  const { campaignId, appId } = use(params);
  const app = useApplication(campaignId, appId);
  const [activeLine, setActiveLine] = useState<number | null>(null);

  const screening = app.data?.stages.find((s) => s.node_type === "screening");
  const quizStage = app.data?.stages.find((s) => s.node_type === "quiz");
  const evidence = useMemo(() => (screening?.evidence ?? []) as unknown as EvidenceItem[], [screening]);
  const cited = useMemo(() => new Set(evidence.flatMap((e) => (e.verified && e.line_no ? [e.line_no] : []))), [evidence]);

  if (app.isError) return <ErrorState message={messageFor(app.error)} />;
  if (app.isPending) return <PageSkeleton />;
  const a = app.data;
  const flags = [...new Set(a.stages.flatMap((s) => s.flags))];
  const injections = a.resume?.injection_flags ?? [];
  const running = a.job_status === "queued" || a.job_status === "running";

  return (
    <>
      <PageHeader
        title={candidateLabel(a.id, a.candidate_name)}
        description={`Applied ${new Date(a.created_at).toLocaleDateString()}`}
        actions={
          <Button asChild variant="outline">
            <Link href={`/campaigns/${campaignId}`}>Back to campaign</Link>
          </Button>
        }
      />
      {flags.length ? <FlagBadges flags={flags} /> : null}
      {injections.length ? (
        <Alert>
          <ShieldAlert />
          <AlertTitle>Instruction-like text found in this resume</AlertTitle>
          <AlertDescription>
            <ul className="grid gap-1">
              {injections.map((f, i) => (
                <li key={i} className="text-xs">
                  {f.line_no ? (
                    <button type="button" className="mr-1 font-mono underline" onClick={() => setActiveLine(Number(f.line_no))}>
                      L{String(f.line_no)}
                    </button>
                  ) : (
                    <span className="mr-1 font-medium">Hidden text:</span>
                  )}
                  “{String(f.excerpt)}”
                </li>
              ))}
            </ul>
            It was scored like any other resume; check the evidence before relying on the result.
          </AlertDescription>
        </Alert>
      ) : null}
      {a.job_status === "deferred_budget" ? <ProcessingState status="queued_budget" title="Awaiting scoring" /> : null}
      {running && !screening?.evidence.length ? <ProcessingState status="processing" title="Screening this resume" /> : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base">Screening</CardTitle>
              <div className="flex items-center gap-2">
                {screening?.score != null ? <span className="text-lg font-semibold tabular-nums">{screening.score}%</span> : null}
                {screening ? <StatusBadge status={screening.status} stage="screening" /> : null}
              </div>
            </CardHeader>
            <CardContent className="grid gap-3">
              {evidence.length ? (
                <EvidenceList items={evidence} activeLine={activeLine} onSelectLine={setActiveLine} />
              ) : (
                <p className="text-sm text-muted-foreground">No scores yet.</p>
              )}
              {screening?.model_id ? (
                <p className="text-xs text-muted-foreground">
                  Scored by {screening.model_id} · prompt {screening.prompt_version}
                </p>
              ) : null}
              {a.job_error ? <p className="text-xs text-destructive">Last error: {a.job_error}</p> : null}
            </CardContent>
          </Card>
          {quizStage || a.quiz ? (
            <Card>
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">Quiz</CardTitle>
                <div className="flex items-center gap-2">
                  {quizStage?.score != null ? <span className="text-lg font-semibold tabular-nums">{quizStage.score}%</span> : null}
                  {quizStage ? <StatusBadge status={quizStage.status} stage="quiz" /> : null}
                </div>
              </CardHeader>
              <CardContent className="grid gap-3">
                {a.quiz ? (
                  <p className="text-xs text-muted-foreground">
                    {a.quiz.submitted_at
                      ? `Submitted ${new Date(a.quiz.submitted_at).toLocaleString()}`
                      : `In progress · ${a.quiz.answered} of ${a.quiz.total} answered · due ${new Date(a.quiz.deadline_at).toLocaleTimeString()}`}
                    {quizStage?.flags.includes("auto_submitted") ? " · submitted automatically at the time limit" : ""}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">Invited; not started yet.</p>
                )}
                {a.quiz?.submitted_at ? <QuizResults items={(quizStage?.evidence ?? []) as unknown as QuizResultItem[]} /> : null}
              </CardContent>
            </Card>
          ) : null}
          {Object.keys(a.screening_answers).length ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Screening answers</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid gap-2 text-sm">
                  {Object.entries(a.screening_answers).map(([q, ans]) => (
                    <div key={q}>
                      <dt className="text-muted-foreground">{q}</dt>
                      <dd>{ans}</dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
          ) : null}
        </div>
        <Card className="content-start">
          <CardHeader>
            <CardTitle className="text-base">Resume (redacted)</CardTitle>
          </CardHeader>
          <CardContent>
            {a.resume ? (
              <ResumeViewer lines={a.resume.lines} activeLine={activeLine} citedLines={cited} onSelectLine={setActiveLine} />
            ) : (
              <p className="text-sm text-muted-foreground">The resume hasn&apos;t been read yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
