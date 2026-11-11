"use client";

import { messageFor } from "@hirevine/api-client";
import { BarList, ChartCard, ColumnChart, DataTable, StatTile } from "@hirevine/ui/blocks/charts";
import { PageHeader } from "@hirevine/ui/blocks/dashboard-layout";
import { ErrorState, PageSkeleton } from "@hirevine/ui/blocks/states";
import { Button } from "@hirevine/ui/components/button";
import Link from "next/link";
import { use } from "react";

import { DemoBanner } from "@/components/demo-banner";
import { BIN_LABELS, STAGE_NAME, hours, pct, useCampaignAnalytics } from "@/lib/analytics";

/** Campaign analytics (frontend plan §7.7, Phase 10): funnel and score distribution first. */
export default function CampaignAnalyticsPage({ params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = use(params);
  const q = useCampaignAnalytics(campaignId);
  if (q.isError) return <ErrorState message={messageFor(q.error)} />;
  if (q.isPending) return <PageSkeleton />;
  const a = q.data;
  const screening = a.funnel[0];

  return (
    <>
      <PageHeader
        title={`${a.job_title} — analytics`}
        description={`${a.applications} application${a.applications === 1 ? "" : "s"} · ${a.status}`}
        actions={
          <Button asChild variant="outline">
            <Link href={`/campaigns/${campaignId}`}>Back to campaign</Link>
          </Button>
        }
      />
      <DemoBanner campaignId={campaignId} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="kpis">
        <StatTile label="Applications" value={a.applications} />
        <StatTile label="Passed screening" value={screening ? `${screening.passed} of ${screening.reached}` : "—"} />
        <StatTile label="AI drafts sent unedited" value={pct(a.feedback_acceptance.share)} hint={`of ${a.feedback_acceptance.n} released drafts`} />
        <StatTile label="Agreed with AI suggestion" value={pct(a.recommendation_agreement.share)} hint={`of ${a.recommendation_agreement.n} decisions`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Funnel"
          description="Candidates who reached each stage, with the share lost from the stage before."
          table={{
            columns: ["Stage", "Reached", "Passed", "Failed", "Needs review", "Active", "Drop-off"],
            rows: a.funnel.map((f) => [STAGE_NAME[f.node_type] ?? f.node_type, f.reached, f.passed, f.failed, f.needs_review, f.active, f.drop_off_pct == null ? "—" : `${f.drop_off_pct}%`]),
          }}
        >
          <BarList
            ariaLabel="Funnel by stage"
            data={a.funnel.map((f) => ({
              label: STAGE_NAME[f.node_type] ?? f.node_type,
              value: f.reached,
              sub: [f.node_type === "final" ? null : `${f.passed} passed`, f.drop_off_pct == null ? null : `${f.drop_off_pct}% drop-off`].filter(Boolean).join(" · "),
            }))}
          />
        </ChartCard>

        <ChartCard
          title="Cutoff impact"
          description={screening ? "How many would pass screening at nearby cutoffs." : undefined}
        >
          <DataTable
            columns={["Cutoff", "Would pass"]}
            rows={a.cutoff_impact.map((r) => [r.delta === 0 ? `${r.cutoff} (current)` : `${r.cutoff} (${r.delta > 0 ? "+" : ""}${r.delta})`, r.passing])}
          />
        </ChartCard>

        {a.distributions.map((d) => (
          <ChartCard
            key={d.node_id}
            title={`${STAGE_NAME[d.node_type] ?? d.node_type} scores`}
            description={`${d.scored} scored, in 10-point bands${d.cutoff != null ? `; dashed line at the pass mark (${d.cutoff})` : ""}.`}
            table={{ columns: ["Score", "Candidates"], rows: d.bins.map((n, i) => [BIN_LABELS[i]!, n]) }}
          >
            <ColumnChart
              ariaLabel={`${d.node_type} score distribution`}
              data={d.bins.map((n, i) => ({ label: BIN_LABELS[i]!, value: n }))}
              reference={d.cutoff != null ? { at: d.cutoff / 10, label: `Pass mark ${d.cutoff}` } : undefined}
              labelEvery={2}
            />
          </ChartCard>
        ))}

        <ChartCard
          title="Time per stage"
          description="Median time from reaching a stage to its result."
          table={{ columns: ["Stage", "Median", "Completed"], rows: a.time_per_stage.map((t) => [STAGE_NAME[t.node_type] ?? t.node_type, hours(t.median_hours), t.completed]) }}
        >
          <BarList
            ariaLabel="Median hours per stage"
            data={a.time_per_stage.map((t) => ({ label: STAGE_NAME[t.node_type] ?? t.node_type, value: t.median_hours ?? 0, display: hours(t.median_hours), sub: `${t.completed} completed` }))}
          />
        </ChartCard>

        <ChartCard title="AI usage" description="Stages scored by each model.">
          {a.model_usage.length ? (
            <DataTable columns={["Model", "Stages scored"]} rows={a.model_usage.map((m) => [m.model_id, m.stages_scored])} />
          ) : (
            <p className="text-sm text-muted-foreground">No AI-scored stages yet.</p>
          )}
        </ChartCard>
      </div>
    </>
  );
}
