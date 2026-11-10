"use client";

import { messageFor, qk, unwrap } from "@hirevine/api-client";
import { PageHeader } from "@hirevine/ui/blocks/dashboard-layout";
import { EmptyState, ErrorState, PageSkeleton } from "@hirevine/ui/blocks/states";
import { Button } from "@hirevine/ui/components/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@hirevine/ui/components/card";
import { useQuery } from "@tanstack/react-query";
import { ScrollText } from "lucide-react";
import Link from "next/link";

import { api, useMe } from "@/lib/api";

export default function ApplicationsPage() {
  const me = useMe();
  const applications = useQuery({
    queryKey: qk.myApplications(),
    queryFn: () => unwrap(api.GET("/v1/candidate/applications")),
    enabled: me.isSuccess,
  });

  if (me.isError) return <ErrorState message={messageFor(me.error)} />;
  if (applications.isError) return <ErrorState message={messageFor(applications.error)} />;
  if (me.isPending || applications.isPending) return <PageSkeleton />;

  return (
    <>
      <PageHeader
        title="My applications"
        description={`Hi ${me.data.display_name}. Every application and its next step is here.`}
      />
      {applications.data.length === 0 ? (
        <EmptyState
          icon={<ScrollText />}
          title="No applications yet"
          description="When you apply to a role, you can follow its progress here."
        >
          <Button asChild>
            <Link href="/jobs">Browse jobs</Link>
          </Button>
        </EmptyState>
      ) : (
        <ul className="grid gap-3">
          {applications.data.map((a) => (
            <li key={a.id}>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Application</CardTitle>
                  <CardDescription>Applied {new Date(a.created_at).toLocaleDateString()}</CardDescription>
                </CardHeader>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
