"use client";

import { messageFor } from "@hirevine/api-client";
import { PageHeader } from "@hirevine/ui/blocks/dashboard-layout";
import { EmptyState, ErrorState, PageSkeleton } from "@hirevine/ui/blocks/states";
import { Button } from "@hirevine/ui/components/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@hirevine/ui/components/table";
import { FolderKanban, MessageSquarePlus } from "lucide-react";
import Link from "next/link";

import { JobStatusBadge } from "@/components/job-status-badge";
import { useMe } from "@/lib/api";
import { useJobs } from "@/lib/jobs";

export default function JobsPage() {
  const me = useMe();
  const jobs = useJobs();

  if (me.isError) return <ErrorState message={messageFor(me.error)} />;
  if (jobs.isError) return <ErrorState message={messageFor(jobs.error)} />;
  if (me.isPending || jobs.isPending) return <PageSkeleton />;

  const newJob = (
    <Button asChild>
      <Link href="/jobs/new">
        <MessageSquarePlus />
        New job
      </Link>
    </Button>
  );

  return (
    <>
      <PageHeader title="Jobs" description={me.data.org_name} actions={jobs.data.length ? newJob : null} />
      {jobs.data.length === 0 ? (
        <EmptyState
          icon={<FolderKanban />}
          title="No jobs yet"
          description="Describe a role in chat and Hirevine builds a screening pipeline you can edit."
        >
          {newJob}
        </EmptyState>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden sm:table-cell">Pipeline</TableHead>
                <TableHead className="text-right">Applicants</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.data.map((job) => (
                <TableRow key={job.id}>
                  <TableCell>
                    <Link href={`/jobs/${job.id}/workflow`} className="font-medium hover:underline">
                      {job.title}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {[job.seniority, job.location].filter(Boolean).join(" · ")}
                    </div>
                  </TableCell>
                  <TableCell>
                    <JobStatusBadge status={job.status} />
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">
                    {job.workflow_version ? `Version ${job.workflow_version}` : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {job.campaign ? (
                      <Link href={`/campaigns/${job.campaign.id}`} className="hover:underline">
                        {job.campaign.applicants}
                      </Link>
                    ) : (
                      "—"
                    )}
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
