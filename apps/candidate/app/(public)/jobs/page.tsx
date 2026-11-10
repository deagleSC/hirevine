import { PageHeader } from "@hirevine/ui/blocks/dashboard-layout";
import { EmptyState } from "@hirevine/ui/blocks/states";
import { Briefcase } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Jobs" };

export default function JobsPage() {
  return (
    <>
      <PageHeader title="Open roles" description="Apply in minutes and follow every step in one place." />
      <EmptyState
        icon={<Briefcase />}
        title="No open roles yet"
        description="Check back soon. New roles appear here as soon as they are published."
      />
    </>
  );
}
