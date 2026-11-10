"use client";

import { messageFor } from "@hirevine/api-client";
import { PageHeader } from "@hirevine/ui/blocks/dashboard-layout";
import { ErrorState, PageSkeleton } from "@hirevine/ui/blocks/states";
import { Badge } from "@hirevine/ui/components/badge";
import { Button } from "@hirevine/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@hirevine/ui/components/card";
import Link from "next/link";
import { use } from "react";

import { STAGE_COPY, usePublicJob } from "@/lib/jobs";

export default function JobDetailPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = use(params);
  const job = usePublicJob(jobId);

  if (job.isError) return <ErrorState title="Role not available" message={messageFor(job.error)} />;
  if (job.isPending) return <PageSkeleton />;
  const j = job.data;

  return (
    <>
      <PageHeader
        title={j.title}
        description={[j.seniority, j.location].filter(Boolean).join(" · ") || undefined}
        actions={
          <Button asChild>
            <Link href={`/apply/${j.id}`}>Apply</Link>
          </Button>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">About the role</CardTitle>
          </CardHeader>
          <CardContent className="text-sm whitespace-pre-line">{j.description || "No description provided."}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">How applying works</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="grid gap-3">
              {j.stages.map((s, i) => {
                const copy = STAGE_COPY[s.type](s);
                return (
                  <li key={s.type} className="grid grid-cols-[1.75rem_1fr] gap-2">
                    <Badge variant="outline" className="size-6 justify-center rounded-full p-0 tabular-nums">
                      {i + 1}
                    </Badge>
                    <div>
                      <p className="text-sm font-medium">{copy.title}</p>
                      <p className="text-xs text-muted-foreground">{copy.detail}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
            <p className="mt-4 text-xs text-muted-foreground">
              <Link href="/ai-evaluation" className="underline">How AI is used in this process</Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
