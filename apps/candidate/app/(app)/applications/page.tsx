"use client";

import { messageFor, qk, unwrap } from "@hirevine/api-client";
import { Alert, Button, Card, CardDescription, CardHeader, CardTitle } from "@hirevine/ui";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { api, useMe } from "@/lib/api";

export default function ApplicationsPage() {
  const me = useMe();
  const applications = useQuery({
    queryKey: qk.myApplications(),
    queryFn: () => unwrap(api.GET("/v1/candidate/applications")),
    enabled: me.isSuccess,
  });

  if (me.isError) return <Alert tone="error">{messageFor(me.error)}</Alert>;
  if (applications.isError) return <Alert tone="error">{messageFor(applications.error)}</Alert>;
  if (me.isPending || applications.isPending) {
    return <div className="h-32 animate-pulse rounded-lg bg-muted" aria-label="Loading" />;
  }

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">My applications</h1>
        <p className="text-muted-foreground">Hi {me.data.display_name}. Every application and its next step is here.</p>
      </div>
      {applications.data.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No applications yet</CardTitle>
            <CardDescription>When you apply to a role, you can follow its progress here.</CardDescription>
          </CardHeader>
          <div className="px-6 pb-6">
            <Button asChild>
              <Link href="/jobs">Browse jobs</Link>
            </Button>
          </div>
        </Card>
      ) : (
        <ul className="grid gap-3">
          {applications.data.map((a) => (
            <li key={a.id}>
              <Card className="p-4 text-sm">Applied {new Date(a.created_at).toLocaleDateString()}</Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
