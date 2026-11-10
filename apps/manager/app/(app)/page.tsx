"use client";

import { messageFor } from "@hirevine/api-client";
import { PageHeader } from "@hirevine/ui/blocks/dashboard-layout";
import { EmptyState, ErrorState, PageSkeleton } from "@hirevine/ui/blocks/states";
import { FolderKanban } from "lucide-react";

import { useMe } from "@/lib/api";

export default function HomePage() {
  const me = useMe();

  if (me.isPending) return <PageSkeleton />;
  if (me.isError) return <ErrorState message={messageFor(me.error)} />;

  return (
    <>
      <PageHeader title={`Welcome, ${me.data.display_name}`} description={me.data.org_name} />
      <EmptyState
        icon={<FolderKanban />}
        title="No jobs yet"
        description="Describe a role in chat and Hirevine builds a screening pipeline you can edit. Job creation is coming in the next release."
      />
    </>
  );
}
