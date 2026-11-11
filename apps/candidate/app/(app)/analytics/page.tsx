"use client";

import { messageFor } from "@hirevine/api-client";
import { ChartCard, ColumnChart, Meter, Sparkline, StatTile } from "@hirevine/ui/blocks/charts";
import { PageHeader } from "@hirevine/ui/blocks/dashboard-layout";
import { EmptyState, ErrorState, PageSkeleton } from "@hirevine/ui/blocks/states";
import { StatusBadge } from "@hirevine/ui/blocks/status-badge";
import { ChartColumn } from "lucide-react";
import Link from "next/link";

import { useMyAnalytics } from "@/lib/analytics";

const week = (d: string) => new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short" });

/** Personal analytics (frontend plan §8.7, Phase 10). Scores appear only once outcomes are released. */
export default function MyAnalyticsPage() {
  const q = useMyAnalytics();
  if (q.isError) return <ErrorState message={messageFor(q.error)} />;
  if (q.isPending) return <PageSkeleton />;
  const a = q.data;
  if (a.applications === 0) {
    return (
      <>
        <PageHeader title="My analytics" />
        <EmptyState icon={<ChartColumn />} title="No applications yet" description="Your progress shows here once you apply." />
      </>
    );
  }
  const trend = a.scores.filter((s) => s.screening != null);
  return (
    <>
      <PageHeader title="My analytics" description="Your applications at a glance. Scores appear only after a hiring team releases outcomes." />
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Applications" value={a.applications} />
        <StatTile
          label="Typical time to outcome"
          value={a.median_days_to_outcome == null ? "—" : `${a.median_days_to_outcome} days`}
          hint={a.scores.length ? `Across ${a.scores.length} released` : "No outcomes released yet"}
        />
        <StatTile
          label="Steps completed"
          value={a.stage_completion.share == null ? "—" : `${Math.round(a.stage_completion.share * 100)}%`}
          hint={a.stage_completion.n ? `Of ${a.stage_completion.n} quizzes and interviews you were invited to` : "No invitations yet"}
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Applications per week"
          description="Last 12 weeks."
          table={{ columns: ["Week of", "Applications"], rows: a.applications_per_week.map((b) => [week(b.start), b.count]) }}
        >
          <ColumnChart ariaLabel="Applications per week" data={a.applications_per_week.map((b) => ({ label: week(b.start), value: b.count }))} labelEvery={3} height={120} />
        </ChartCard>
        <ChartCard
          title="Resume match over time"
          description="Released outcomes only, oldest first."
          table={{ columns: ["Job", "Released", "Resume match", "Quiz", "Interview"], rows: a.scores.map((s) => [s.job_title, s.released_at, s.screening ?? "—", s.quiz ?? "—", s.interview ?? "—"]) }}
        >
          {trend.length ? (
            <Sparkline ariaLabel="Resume match across released outcomes" values={trend.map((s) => s.screening!)} />
          ) : (
            <p className="text-sm text-muted-foreground">Nothing released yet.</p>
          )}
        </ChartCard>
        <ChartCard title="How far each application got" className="lg:col-span-2">
          <ul className="divide-y">
            {a.progress.map((p) => (
              <li key={p.application_id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
                <Link className="font-medium hover:underline" href={`/applications/${p.application_id}`}>
                  {p.job_title}
                </Link>
                <span className="flex items-center gap-3">
                  <Meter value={p.reached} max={p.total} label={`${p.job_title}: stages reached`} />
                  <StatusBadge status={p.status} />
                </span>
              </li>
            ))}
          </ul>
        </ChartCard>
      </div>
    </>
  );
}
