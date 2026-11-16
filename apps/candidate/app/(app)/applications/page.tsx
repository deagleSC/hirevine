"use client";

import { messageFor, qk, unwrap } from "@hirevine/api-client";
import { PageHeader } from "@hirevine/ui/blocks/dashboard-layout";
import { EmptyState, ErrorState, PageSkeleton } from "@hirevine/ui/blocks/states";
import { StatusBadge } from "@hirevine/ui/blocks/status-badge";
import { Button } from "@hirevine/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { ScrollText } from "lucide-react";
import Link from "next/link";

import { api, useMe } from "@/lib/api";
import type { TrackerItem } from "@/lib/jobs";

const POLL_MS = 30_000;
const ORDER: Record<TrackerItem["status"], number> = { action_required: 0, received: 1, in_review: 2, outcome_released: 3 };

export default function ApplicationsPage() {
  const me = useMe();
  const applications = useQuery({
    queryKey: qk.myApplications(),
    queryFn: () => unwrap(api.GET("/v1/candidate/applications")),
    enabled: me.isSuccess,
    // Keep polling while anything is still being received (§8.2).
    refetchInterval: (q) => (q.state.data?.some((a) => a.status === "received") ? POLL_MS : false),
  });

  if (me.isError) return <ErrorState message={messageFor(me.error)} />;
  if (applications.isError) return <ErrorState message={messageFor(applications.error)} />;
  if (me.isPending || applications.isPending) return <PageSkeleton />;

  const items = [...applications.data].sort((a, b) => ORDER[a.status] - ORDER[b.status]);
  return (
    <>
      <PageHeader title="My applications" description={`Hi ${me.data.display_name}. Every application and its next step is here.`} />
      {items.length === 0 ? (
        <EmptyState icon={<ScrollText />} title="No applications yet" description="When you apply to a role, you can follow its progress here.">
          <Button asChild>
            <Link href="/jobs">Browse jobs</Link>
          </Button>
        </EmptyState>
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-sm">
          {items.map((a) => (
            <li key={a.id} className="relative flex flex-col gap-3 px-4 py-3.5 transition-colors hover:bg-muted/40 sm:flex-row sm:items-center sm:px-5">
              <div className="grid min-w-0 flex-1 gap-0.5">
                <Link href={`/applications/${a.id}`} className="truncate font-medium after:absolute after:inset-0 hover:underline">
                  {a.job_title}
                </Link>
                <span className="text-sm text-muted-foreground">Applied {new Date(a.created_at).toLocaleDateString()}</span>
              </div>
              <div className="relative flex flex-wrap items-center gap-2">
                <StatusBadge status={a.status} />
                {a.next_action ? (
                  <Button asChild size="sm">
                    <Link href={`/applications/${a.id}/${a.next_action}`}>
                      {a.next_action === "quiz" ? "Take quiz" : "Start interview"}
                    </Link>
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
