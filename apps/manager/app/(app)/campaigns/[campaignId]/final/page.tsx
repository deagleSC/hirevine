"use client";

import { messageFor } from "@hirevine/api-client";
import { PageHeader } from "@hirevine/ui/blocks/dashboard-layout";
import { FlagBadges } from "@hirevine/ui/blocks/evidence";
import { CompleteCampaignDialog, RECOMMENDATION_LABEL, RecommendationBadge } from "@hirevine/ui/blocks/report";
import { EmptyState, ErrorState, PageSkeleton } from "@hirevine/ui/blocks/states";
import { StatusBadge } from "@hirevine/ui/blocks/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@hirevine/ui/components/alert";
import { Badge } from "@hirevine/ui/components/badge";
import { Button } from "@hirevine/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@hirevine/ui/components/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@hirevine/ui/components/table";
import { CheckCircle2, ChevronDown, ChevronRight, ListOrdered } from "lucide-react";
import Link from "next/link";
import { Fragment, use, useState } from "react";
import { toast } from "sonner";

import { DemoBanner } from "@/components/demo-banner";
import { candidateLabel, useCompleteCampaign, useFinalReport, type FinalRow } from "@/lib/campaigns";

const STANDING: Record<FinalRow["standing"], string> = {
  final: "Finalist",
  needs_review: "Needs review",
  in_progress: "In progress",
  failed: "Stopped",
};
const FEEDBACK: Record<FinalRow["feedback_status"], string> = {
  none: "No feedback yet",
  drafting: "Drafting…",
  draft: "AI draft",
  edited: "Edited",
};

/** Final ranked list and completion (frontend plan §7.6, Phase 8). */
export default function FinalPage({ params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = use(params);
  const report = useFinalReport(campaignId);
  const complete = useCompleteCampaign(campaignId);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  if (report.isError) return <ErrorState message={messageFor(report.error)} />;
  if (report.isPending) return <PageSkeleton />;
  const r = report.data;
  const done = r.status === "completed";
  const toggle = (id: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <>
      <PageHeader
        title={`${r.job_title} — final list`}
        description={`${r.finalists} finalist${r.finalists === 1 ? "" : "s"} of ${r.total} applicant${r.total === 1 ? "" : "s"}`}
        actions={
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link href={`/campaigns/${campaignId}`}>Back to campaign</Link>
            </Button>
            {!done ? (
              <Button variant="destructive" onClick={() => setOpen(true)} disabled={!r.total}>
                Complete campaign
              </Button>
            ) : null}
          </div>
        }
      />
      <DemoBanner campaignId={campaignId} />

      {done ? (
        <Alert>
          <CheckCircle2 />
          <AlertTitle>Released on {new Date(r.completed_at!).toLocaleString()}</AlertTitle>
          <AlertDescription>Outcomes and feedback are visible to candidates. This list is read-only.</AlertDescription>
        </Alert>
      ) : r.unedited ? (
        <Alert>
          <AlertTitle>Review feedback before releasing</AlertTitle>
          <AlertDescription>
            {r.unedited} candidate{r.unedited === 1 ? " has" : "s have"} an unedited AI draft or no feedback yet. Open a
            candidate to edit what they will receive.
          </AlertDescription>
        </Alert>
      ) : null}

      {!r.rows.length ? (
        <EmptyState icon={<ListOrdered />} title="No applicants yet" description="The final list fills in as candidates finish." />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ranked by overall score</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead className="w-12">Rank</TableHead>
                  <TableHead>Candidate</TableHead>
                  <TableHead>Overall</TableHead>
                  <TableHead>Stages</TableHead>
                  <TableHead>Recommendation</TableHead>
                  <TableHead>Feedback</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {r.rows.map((row) => (
                  <Fragment key={row.application_id}>
                    <TableRow data-testid={`final-row-${row.application_id}`} className={row.excluded ? "opacity-60" : undefined}>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          aria-label={expanded.has(row.application_id) ? "Hide feedback" : "Show feedback"}
                          aria-expanded={expanded.has(row.application_id)}
                          onClick={() => toggle(row.application_id)}
                        >
                          {expanded.has(row.application_id) ? <ChevronDown /> : <ChevronRight />}
                        </Button>
                      </TableCell>
                      <TableCell className="tabular-nums">{row.rank ?? "—"}</TableCell>
                      <TableCell>
                        <Link className="font-medium hover:underline" href={`/campaigns/${campaignId}/candidates/${row.application_id}`}>
                          {candidateLabel(row.application_id, row.candidate_name)}
                        </Link>
                        <div className="mt-1 flex flex-wrap gap-1">
                          <Badge variant="secondary">{STANDING[row.standing]}</Badge>
                          {row.excluded ? <Badge variant="outline">Excluded</Badge> : null}
                          <FlagBadges flags={row.flags} />
                        </div>
                      </TableCell>
                      <TableCell className="font-semibold tabular-nums">{row.overall != null ? `${row.overall}%` : "—"}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1.5">
                          {row.stages.map((s) => (
                            <span key={s.node_id} className="flex items-center gap-1 text-xs">
                              <span className="capitalize text-muted-foreground">{s.node_type}</span>
                              {s.score != null ? <span className="tabular-nums">{s.score}</span> : <StatusBadge status={s.status} stage={s.node_type} />}
                            </span>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        {row.recommendation ? (
                          <RecommendationBadge value={row.recommendation} />
                        ) : (
                          <RecommendationBadge value={row.suggested} suggested />
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{FEEDBACK[row.feedback_status]}</TableCell>
                    </TableRow>
                    {expanded.has(row.application_id) ? (
                      <TableRow>
                        <TableCell />
                        <TableCell colSpan={6} className="whitespace-pre-wrap text-sm text-muted-foreground">
                          {row.feedback_preview ?? "No feedback yet: the candidate receives a short neutral message on release."}
                          {row.recommendation && row.recommendation !== row.suggested ? (
                            <p className="mt-1 text-xs">
                              You chose {RECOMMENDATION_LABEL[row.recommendation]}; suggested was {RECOMMENDATION_LABEL[row.suggested]}.
                            </p>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {!done ? (
        <CompleteCampaignDialog
          open={open}
          onOpenChange={setOpen}
          jobTitle={r.job_title}
          total={r.total}
          unedited={r.unedited}
          inProgress={r.in_progress}
          notifyDefault={r.notify_on_complete}
          pending={complete.isPending}
          error={complete.isError ? messageFor(complete.error) : null}
          onConfirm={(v) =>
            complete.mutate(v, {
              onSuccess: (res) => {
                setOpen(false);
                toast.success(`Released to ${res.released} candidate${res.released === 1 ? "" : "s"}`);
                void report.refetch();
              },
            })
          }
        />
      ) : null}
    </>
  );
}
