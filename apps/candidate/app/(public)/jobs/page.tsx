import { Card, CardDescription, CardHeader, CardTitle } from "@hirevine/ui";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Jobs" };

export default function JobsPage() {
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Open roles</h1>
        <p className="text-muted-foreground">Apply in minutes and follow every step in one place.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>No open roles yet</CardTitle>
          <CardDescription>Check back soon. New roles appear here as soon as they are published.</CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
