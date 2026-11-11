"use client";

import { messageFor } from "@hirevine/api-client";
import { PageHeader } from "@hirevine/ui/blocks/dashboard-layout";
import { EvidenceList, FlagBadges, ResumeViewer, type EvidenceItem } from "@hirevine/ui/blocks/evidence";
import { ProcessingState } from "@hirevine/ui/blocks/processing-state";
import { InterviewScores, TranscriptView, type InterviewScoreItem } from "@hirevine/ui/blocks/interview";
import { FeedbackEditor } from "@hirevine/ui/blocks/report";
import { QuizResults, type QuizResultItem } from "@hirevine/ui/blocks/quiz-runner";
import { ErrorState, PageSkeleton } from "@hirevine/ui/blocks/states";
import { StatusBadge } from "@hirevine/ui/blocks/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@hirevine/ui/components/alert";
import { Button } from "@hirevine/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@hirevine/ui/components/card";
import { ShieldAlert } from "lucide-react";
import Link from "next/link";
import { use, useMemo, useState } from "react";

import { DemoBanner } from "@/components/demo-banner";
import { candidateLabel, useApplication, useManualScore, useSaveFeedback } from "@/lib/campaigns";

export default function CandidatePage({ params }: { params: Promise<{ campaignId: string; appId: string }> }) {
  const { campaignId, appId } = use(params);
  const app = useApplication(campaignId, appId);
  const saveFeedback = useSaveFeedback(campaignId, appId);
  const [activeLine, setActiveLine] = useState<number | null>(null);
  const [activeTurn, setActiveTurn] = useState<number | null>(null);

  const screening = app.data?.stages.find((s) => s.node_type === "screening");
  const quizStage = app.data?.stages.find((s) => s.node_type === "quiz");
  const interviewStage = app.data?.stages.find((s) => s.node_type === "interview");
  const interviewScores = useMemo(() => (interviewStage?.evidence ?? []) as unknown as InterviewScoreItem[], [interviewStage]);
  const citedTurns = useMemo(() => new Set(interviewScores.flatMap((i) => i.turns)), [interviewScores]);
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
      <DemoBanner campaignId={campaignId} />
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
          {interviewStage || a.interview ? (
            <Card>
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">AI interview</CardTitle>
                <div className="flex items-center gap-2">
                  {interviewStage?.score != null ? (
                    <span className="text-lg font-semibold tabular-nums">{interviewStage.score}%</span>
                  ) : null}
                  {interviewStage ? <StatusBadge status={interviewStage.status} stage="interview" /> : null}
                </div>
              </CardHeader>
              <CardContent className="grid gap-4">
                {a.interview ? (
                  <p className="text-sm text-muted-foreground">
                    {a.interview.finished_at
                      ? `Finished ${new Date(a.interview.finished_at).toLocaleString()} · ${a.interview.answers_given} of ${a.interview.turn_cap} answered`
                      : a.interview.paused
                        ? `Paused (daily AI limit) · ${a.interview.answers_given} of ${a.interview.turn_cap} answered`
                        : `In progress · ${a.interview.answers_given} of ${a.interview.turn_cap} answered · due ${new Date(a.interview.deadline_at).toLocaleTimeString()}`}
                    {interviewStage?.flags.includes("auto_finished") ? " · ended at the time limit" : ""}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">Invited; not started yet.</p>
                )}
                {a.interview?.finished_at && !interviewScores.length && interviewStage?.status === "in_progress" ? (
                  <ProcessingState status="processing" title="Scoring the interview" />
                ) : null}
                {interviewScores.length ? (
                  <InterviewScores items={interviewScores} activeTurn={activeTurn} onSelectTurn={setActiveTurn} />
                ) : null}
                {a.interview?.transcript.length ? (
                  <div className="grid gap-2">
                    <h3 className="text-sm font-medium">Transcript</h3>
                    <div className="max-h-[28rem] overflow-y-auto rounded-md border p-2">
                      <TranscriptView turns={a.interview.transcript} cited={citedTurns} activeTurn={activeTurn} onSelect={setActiveTurn} />
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
          {a.stages.some((s) => s.status === "needs_review") && !a.feedback?.released ? (
            <ManualScoreCard campaignId={campaignId} appId={appId} stages={a.stages.filter((s) => s.status === "needs_review")} />
          ) : null}
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base">Feedback</CardTitle>
              {a.feedback?.released ? <span className="text-xs text-muted-foreground">Released</span> : null}
            </CardHeader>
            <CardContent>
              <FeedbackEditor
                key={a.feedback?.ai_draft ?? "none"}
                value={{
                  ai_draft: a.feedback?.ai_draft ?? null,
                  ai_recommendation: a.feedback?.ai_recommendation ?? null,
                  edited_text: a.feedback?.edited_text ?? null,
                  recommendation: a.feedback?.recommendation ?? null,
                  manager_note: a.feedback?.manager_note ?? null,
                  excluded: a.feedback?.excluded ?? false,
                }}
                readOnly={a.feedback?.released ?? false}
                onSave={saveFeedback}
              />
            </CardContent>
          </Card>
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

function ManualScoreCard({
  campaignId,
  appId,
  stages,
}: {
  campaignId: string;
  appId: string;
  stages: { node_id: string; node_type: string }[];
}) {
  const score = useManualScore(campaignId, appId);
  const [node, setNode] = useState(stages[0]!.node_id);
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const n = Number(value);
  const valid = value !== "" && n >= 0 && n <= 100 && note.trim().length > 0;
  return (
    <Card className="border-amber-500/40">
      <CardHeader>
        <CardTitle className="text-base">Score by hand</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) score.mutate({ node_id: node, score: n, note: note.trim() });
          }}
        >
          <p className="text-sm text-muted-foreground">
            The AI could not finish this stage. Review the evidence and give a score from 0 to 100; the usual pass rule then moves the
            application on.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            {stages.length > 1 ? (
              <label className="grid gap-1 text-sm">
                Stage
                <select className="h-9 rounded-md border bg-background px-2" value={node} onChange={(e) => setNode(e.target.value)}>
                  {stages.map((s) => (
                    <option key={s.node_id} value={s.node_id}>
                      {s.node_type}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="grid gap-1 text-sm">
              Score (0–100)
              <input
                type="number"
                min={0}
                max={100}
                className="h-9 w-28 rounded-md border bg-background px-2"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </label>
          </div>
          <label className="grid gap-1 text-sm">
            Reason (kept with the score)
            <textarea className="min-h-16 rounded-md border bg-background p-2" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          {score.isError ? <p className="text-sm text-destructive">{messageFor(score.error)}</p> : null}
          <Button type="submit" className="w-fit" disabled={!valid || score.isPending}>
            Save score
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
