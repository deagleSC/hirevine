"use client";

import { messageFor } from "@hirevine/api-client";
import { PageHeader } from "@hirevine/ui/blocks/dashboard-layout";
import { EmptyState, ErrorState, PageSkeleton } from "@hirevine/ui/blocks/states";
import { Badge } from "@hirevine/ui/components/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@hirevine/ui/components/card";
import { Input } from "@hirevine/ui/components/input";
import { Briefcase, MapPin, Search } from "lucide-react";
import Link from "next/link";
import { useDeferredValue, useState } from "react";

import { usePublicJobs } from "@/lib/jobs";

export default function JobsPage() {
  const [q, setQ] = useState("");
  const [location, setLocation] = useState("");
  const params = { q: useDeferredValue(q.trim()) || undefined, location: useDeferredValue(location.trim()) || undefined };
  const jobs = usePublicJobs(params);
  const filtering = Boolean(params.q || params.location);

  return (
    <>
      <PageHeader title="Open roles" description="Apply in minutes and follow every step in one place." />
      <div className="grid gap-2 sm:grid-cols-[1fr_14rem]">
        <label className="relative">
          <span className="sr-only">Search roles</span>
          <Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" aria-hidden />
          <Input className="pl-8" placeholder="Role, skill or keyword" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <label className="relative">
          <span className="sr-only">Location</span>
          <MapPin className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" aria-hidden />
          <Input className="pl-8" placeholder="Location" value={location} onChange={(e) => setLocation(e.target.value)} />
        </label>
      </div>
      {jobs.isError ? (
        <ErrorState message={messageFor(jobs.error)} />
      ) : jobs.isPending ? (
        <PageSkeleton />
      ) : jobs.data.items.length === 0 ? (
        <EmptyState
          icon={<Briefcase />}
          title={filtering ? "No roles match" : "No open roles yet"}
          description={filtering ? "Try fewer words or a different location." : "New roles appear here as soon as they are published."}
        />
      ) : (
        <ul className="grid gap-3">
          {jobs.data.items.map((job) => (
            <li key={job.id}>
              <Link href={`/jobs/${job.id}`} className="block rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                <Card className="transition-colors hover:bg-accent/50">
                  <CardHeader>
                    <CardTitle className="text-base">{job.title}</CardTitle>
                    <CardDescription className="flex flex-wrap items-center gap-2">
                      {job.seniority ? <Badge variant="secondary" className="capitalize">{job.seniority}</Badge> : null}
                      {job.location ? <span>{job.location}</span> : null}
                      <span>· Posted {new Date(job.published_at).toLocaleDateString()}</span>
                    </CardDescription>
                  </CardHeader>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
