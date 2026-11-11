"use client";

import { messageFor } from "@hirevine/api-client";
import { ChartCard, ColumnChart, StatTile } from "@hirevine/ui/blocks/charts";
import { PageHeader } from "@hirevine/ui/blocks/dashboard-layout";
import { ErrorState, PageSkeleton } from "@hirevine/ui/blocks/states";

import { hours, pct, useOverview } from "@/lib/analytics";

const week = (d: string) => new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short" });
const month = (d: string) => new Date(d).toLocaleDateString(undefined, { month: "short" });

/** Organisation overview (frontend plan §7.7, Phase 10). Campaign detail lives on each campaign's analytics page. */
export default function OverviewPage() {
  const q = useOverview();
  if (q.isError) return <ErrorState message={messageFor(q.error)} />;
  if (q.isPending) return <PageSkeleton />;
  const o = q.data;
  return (
    <>
      <PageHeader title="Analytics" description="Across all your jobs. Open a campaign for its funnel and scores." />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatTile label="Open jobs" value={o.open_jobs} />
        <StatTile label="Applications" value={o.applications} />
        <StatTile label="Time to shortlist" value={hours(o.time_to_shortlist_hours)} hint="Median, first application to release" />
        <StatTile label="AI drafts sent unedited" value={pct(o.feedback_acceptance.share)} hint={`of ${o.feedback_acceptance.n}`} />
        <StatTile label="Agreed with AI suggestion" value={pct(o.recommendation_agreement.share)} hint={`of ${o.recommendation_agreement.n}`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Applications per week"
          description="Last 12 weeks."
          table={{ columns: ["Week of", "Applications"], rows: o.applications_per_week.map((b) => [week(b.start), b.count]) }}
        >
          <ColumnChart ariaLabel="Applications per week" data={o.applications_per_week.map((b) => ({ label: week(b.start), value: b.count }))} labelEvery={3} />
        </ChartCard>
        <ChartCard
          title="Campaigns completed per month"
          description="Last 12 months."
          table={{ columns: ["Month", "Completed"], rows: o.completed_per_month.map((b) => [month(b.start), b.count]) }}
        >
          <ColumnChart ariaLabel="Campaigns completed per month" data={o.completed_per_month.map((b) => ({ label: month(b.start), value: b.count }))} labelEvery={2} />
        </ChartCard>
      </div>
    </>
  );
}
