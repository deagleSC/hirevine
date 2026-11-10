"use client";

import { messageFor } from "@hirevine/api-client";
import { PageHeader } from "@hirevine/ui/blocks/dashboard-layout";
import { FlagBadges } from "@hirevine/ui/blocks/evidence";
import { EmptyState, ErrorState, PageSkeleton } from "@hirevine/ui/blocks/states";
import { StatusBadge, statusLabel } from "@hirevine/ui/blocks/status-badge";
import { Badge } from "@hirevine/ui/components/badge";
import { Button } from "@hirevine/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@hirevine/ui/components/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@hirevine/ui/components/table";
import { Tabs, TabsList, TabsTrigger } from "@hirevine/ui/components/tabs";
import { Inbox, RotateCw } from "lucide-react";
import Link from "next/link";
import { use, useState } from "react";
import { toast } from "sonner";

import { candidateLabel, useCampaign, useCampaignApplications, useRetry, type Filters } from "@/lib/campaigns";

const TABS: Record<string, { label: string; filters: Filters }> = {
  all: { label: "All", filters: {} },
  attention: { label: "Needs review", filters: { status: "needs_review" } },
  injection: { label: "Possible injection", filters: { flag: "possible_injection" } },
  passed: { label: "Passed screening", filters: { status: "passed" } },
};
const STAGE_NAMES = { screening: "Screening", quiz: "Quiz", interview: "Interview", final: "Final" } as const;
const SHOWN: string[] = ["pending", "in_progress", "passed", "failed", "needs_review"];

export default function CampaignPage({ params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = use(params);
  const [tab, setTab] = useState("all");
  const campaign = useCampaign(campaignId);
  const rows = useCampaignApplications(campaignId, TABS[tab]!.filters, campaign.data?.status === "open");
  const retry = useRetry(campaignId);

  if (campaign.isError) return <ErrorState message={messageFor(campaign.error)} />;
  if (campaign.isPending) return <PageSkeleton />;
  const c = campaign.data;
  const names = Object.fromEntries(c.nodes.map((n) => [n.id, STAGE_NAMES[n.type]]));

  return (
    <>
      <PageHeader
        title={c.job_title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant={c.status === "open" ? "default" : "secondary"} className="capitalize">{c.status}</Badge>
            {c.total} applicant{c.total === 1 ? "" : "s"}
            {c.processing ? <span>· {c.processing} processing</span> : null}
            {c.ai_paused ? <Badge variant="destructive">AI paused</Badge> : null}
          </span>
        }
        actions={
          <Button asChild variant="outline">
            <Link href={`/jobs/${c.job_id}/workflow`}>Pipeline</Link>
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {c.nodes.filter((n) => n.enabled).map((n) => {
          const counts = c.counts.filter((x) => x.node_id === n.id);
          return (
            <Card key={n.id} className="gap-2 py-4">
              <CardHeader className="px-4">
                <CardTitle className="text-sm">{names[n.id]}</CardTitle>
              </CardHeader>
              <CardContent className="px-4">
                {counts.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No one here yet</p>
                ) : (
                  <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-xs">
                    {counts.sort((a, b) => SHOWN.indexOf(a.status) - SHOWN.indexOf(b.status)).map((x) => (
                      <div key={x.status} className="contents">
                        <dt className="text-muted-foreground">{statusLabel(x.status)}</dt>
                        <dd className="text-right tabular-nums">{x.count}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap">
          {Object.entries(TABS).map(([key, t]) => (
            <TabsTrigger key={key} value={key}>
              {t.label}
              {key === "attention" && c.needs_review ? <Badge variant="destructive" className="ml-1">{c.needs_review}</Badge> : null}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {rows.isError ? (
        <ErrorState message={messageFor(rows.error)} />
      ) : rows.isPending ? (
        <PageSkeleton />
      ) : rows.data.items.length === 0 ? (
        <EmptyState icon={<Inbox />} title={tab === "all" ? "No applications yet" : "Nothing here"}
          description={tab === "all" ? "Share the job link; applications appear here as they arrive." : undefined} />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Candidate</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Match</TableHead>
                <TableHead className="hidden md:table-cell">Flags</TableHead>
                <TableHead className="sr-only">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.data.items.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Link href={`/campaigns/${campaignId}/candidates/${r.id}`} className="font-medium hover:underline">
                      {candidateLabel(r.id, r.candidate_name)}
                    </Link>
                    <div className="text-xs text-muted-foreground">Applied {new Date(r.created_at).toLocaleDateString()}</div>
                  </TableCell>
                  <TableCell>{r.current_node ? names[r.current_node] : "—"}</TableCell>
                  <TableCell>
                    {r.job_status && ["queued", "running", "deferred_budget"].includes(r.job_status) ? (
                      <StatusBadge status={r.job_status} />
                    ) : r.stage_status ? (
                      <StatusBadge status={r.stage_status} />
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.screening_score != null ? `${r.screening_score}%` : "—"}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <FlagBadges flags={r.flags} />
                  </TableCell>
                  <TableCell className="text-right">
                    {r.stage_status === "needs_review" && r.current_node === c.nodes[0]?.id ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={retry.isPending}
                        onClick={() =>
                          retry.mutate(r.id, {
                            onSuccess: () => toast.success("Screening re-queued"),
                            onError: (e) => toast.error(messageFor(e)),
                          })
                        }
                      >
                        <RotateCw />
                        Retry
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
