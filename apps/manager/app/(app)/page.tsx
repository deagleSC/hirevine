"use client";

import { messageFor } from "@hirevine/api-client";
import { Alert, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@hirevine/ui";

import { useMe } from "@/lib/api";

export default function HomePage() {
  const me = useMe();

  if (me.isPending) {
    return <div className="h-32 animate-pulse rounded-lg bg-muted" aria-label="Loading" />;
  }
  if (me.isError) {
    return <Alert tone="error">{messageFor(me.error)}</Alert>;
  }

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Welcome, {me.data.display_name}</h1>
        <p className="text-muted-foreground">{me.data.org_name}</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>No jobs yet</CardTitle>
          <CardDescription>
            Describe a role in chat and Hirevine builds a screening pipeline you can edit.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">Job creation is coming in the next release.</CardContent>
      </Card>
    </div>
  );
}
