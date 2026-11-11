"use client";

import { messageFor } from "@hirevine/api-client";
import { PageHeader } from "@hirevine/ui/blocks/dashboard-layout";
import { CitationChip, ResumeViewer } from "@hirevine/ui/blocks/evidence";
import { QuizResults } from "@hirevine/ui/blocks/quiz-runner";
import { ErrorState, PageSkeleton } from "@hirevine/ui/blocks/states";
import { Badge } from "@hirevine/ui/components/badge";
import { Button } from "@hirevine/ui/components/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@hirevine/ui/components/card";
import { Hourglass } from "lucide-react";
import Link from "next/link";
import { use, useMemo, useState } from "react";

import { useFeedback } from "@/lib/feedback";

const STAGE: Record<string, string> = { screening: "Resume screening", quiz: "Skills quiz", interview: "AI interview" };
const STATUS: Record<string, string> = {
  passed: "Passed",
  failed: "Not passed",
  in_progress: "Not finished",
  pending: "Not reached",
  needs_review: "Reviewed by the team",
};

/** Feedback after release (frontend plan §8.6, Phase 8). Before release the API returns 404. */
export default function FeedbackPage({ params }: { params: Promise<{ appId: string }> }) {
  const { appId } = use(params);
  const fb = useFeedback(appId);
  const [line, setLine] = useState<number | null>(null);
  const cited = useMemo(() => new Set((fb.data?.resume_citations ?? []).map((c) => c.line_no)), [fb.data]);
  const back = (
    <Button asChild variant="outline">
      <Link href={`/applications/${appId}`}>Back to application</Link>
    </Button>
  );

  if (fb.isError) return <ErrorState message={messageFor(fb.error)} />;
  if (fb.isPending) return <PageSkeleton />;
  if (fb.data === null) {
    return (
      <>
        <PageHeader title="Feedback" />
        <Card className="max-w-xl">
          <CardHeader>
            <Hourglass className="mb-2 size-6 text-muted-foreground" aria-hidden />
            <CardTitle>Feedback is not available yet.</CardTitle>
            <CardDescription>
              The hiring team shares outcomes and feedback with everyone at once, when they finish reviewing. We&apos;ll let you know.
            </CardDescription>
          </CardHeader>
          <CardFooter>{back}</CardFooter>
        </Card>
      </>
    );
  }
  const f = fb.data;
  return (
    <>
      <PageHeader
        title={`Feedback: ${f.job_title}`}
        description={`Released ${new Date(f.released_at).toLocaleDateString()}`}
        actions={back}
      />
      <div className="grid max-w-3xl gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              Outcome
              <Badge variant={f.outcome === "shortlisted" ? "default" : "secondary"}>
                {f.outcome === "shortlisted" ? "Shortlisted" : "Not selected this time"}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{f.feedback}</p>
          </CardContent>
        </Card>
        {f.stages.length ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Your results</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-2 text-sm">
                {f.stages.map((s) => (
                  <div key={s.node_type} className="flex items-center justify-between gap-4 border-b pb-2 last:border-0">
                    <dt>{STAGE[s.node_type] ?? s.node_type}</dt>
                    <dd className="flex items-center gap-3">
                      <span className="text-muted-foreground">{STATUS[s.status] ?? s.status}</span>
                      {s.score != null ? <span className="font-semibold tabular-nums">{s.score}%</span> : null}
                    </dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        ) : null}
        {f.resume_citations?.length ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">From your resume</CardTitle>
              <CardDescription>The lines the review relied on, highlighted in your resume as it was read (personal details removed).</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <ul className="grid gap-2 text-sm">
                {f.resume_citations.map((c, i) => (
                  <li key={i} className="flex flex-wrap items-baseline gap-2">
                    <CitationChip lineNo={c.line_no} active={line === c.line_no} onSelect={setLine} />
                    <span className="font-medium">{c.criterion}:</span>
                    <span className="text-muted-foreground">&ldquo;{c.quote}&rdquo;</span>
                  </li>
                ))}
              </ul>
              <div className="max-h-96 overflow-y-auto rounded-md border p-2">
                <ResumeViewer lines={f.resume_lines ?? []} citedLines={cited} activeLine={line} onSelectLine={setLine} />
              </div>
            </CardContent>
          </Card>
        ) : null}
        {f.quiz_answers?.length ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Your quiz answers</CardTitle>
            </CardHeader>
            <CardContent>
              <QuizResults items={f.quiz_answers.map((q, i) => ({ ...q, question_id: `q${i}` }))} />
            </CardContent>
          </Card>
        ) : null}
        {f.interview_moments?.length ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">From your interview</CardTitle>
              <CardDescription>The answers the review drew on.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="grid gap-4 text-sm">
                {f.interview_moments.map((m, i) => (
                  <li key={i} className="grid gap-1">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{m.topic}</span>
                    {m.question ? <p className="text-muted-foreground">Q: {m.question}</p> : null}
                    <blockquote className="border-l-2 pl-3">{m.answer}</blockquote>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}
