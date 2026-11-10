"use client";

import { Badge } from "@hirevine/ui/components/badge";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@hirevine/ui/components/sheet";
import { Skeleton } from "@hirevine/ui/components/skeleton";

import { useWorkflowVersions } from "@/lib/jobs";

export function HistorySheet({ jobId, open, onOpenChange, current }: { jobId: string; open: boolean; onOpenChange: (o: boolean) => void; current: number }) {
  const versions = useWorkflowVersions(jobId, open);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-sm">
        <SheetHeader>
          <SheetTitle>Version history</SheetTitle>
          <SheetDescription>Every change is a new version. Undo restores the previous one as a new version.</SheetDescription>
        </SheetHeader>
        <ol className="flex flex-col gap-2 px-4">
          {versions.isPending
            ? Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-12" />)
            : versions.data?.map((v) => (
                <li key={v.version} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                  <div>
                    <p className="font-medium">Version {v.version}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(v.created_at).toLocaleString()}
                      {v.parent_version ? ` · from v${v.parent_version}` : ""}
                    </p>
                  </div>
                  {v.version === current ? <Badge>Current</Badge> : null}
                </li>
              ))}
        </ol>
      </SheetContent>
    </Sheet>
  );
}
