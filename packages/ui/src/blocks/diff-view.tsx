"use client";

import { AlertTriangle, ArrowRight, Info } from "lucide-react";
import type { ReactNode } from "react";

import { Alert, AlertDescription, AlertTitle } from "@hirevine/ui/components/alert";
import { Badge } from "@hirevine/ui/components/badge";
import { Button } from "@hirevine/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@hirevine/ui/components/dialog";
import { Spinner } from "@hirevine/ui/components/spinner";

/** Matches `DiffRow` from @hirevine/api-client (`humanizeDiff`). */
export interface DiffViewRow {
  key: string;
  kind: "added" | "removed" | "changed";
  stage: string;
  item?: string;
  field?: string;
  before?: string;
  after?: string;
}

export interface DiffViewProps {
  rows: DiffViewRow[];
  /** Plain-language line per patch, from the preview response. */
  descriptions?: string[];
  warnings?: { message: string }[];
  affectsRunningCampaign?: boolean;
  affectedStageNote?: string | null;
}

const KIND = {
  added: { label: "Added", variant: "default" },
  removed: { label: "Removed", variant: "destructive" },
  changed: { label: "Changed", variant: "secondary" },
} as const;

/** What a workflow change does (frontend plan §153, §194). */
export function DiffView({ rows, descriptions, warnings, affectsRunningCampaign, affectedStageNote }: DiffViewProps) {
  const byStage = rows.reduce<Record<string, DiffViewRow[]>>((acc, r) => {
    (acc[r.stage] ??= []).push(r);
    return acc;
  }, {});

  return (
    <div className="flex flex-col gap-4">
      {affectsRunningCampaign ? (
        <Alert>
          <Info />
          <AlertTitle>This campaign is running</AlertTitle>
          <AlertDescription>
            The change applies only to candidates who have not reached this stage yet.
            {affectedStageNote ? <span className="mt-1 block">{affectedStageNote}</span> : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {warnings?.length ? (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>Check these criteria</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {warnings.map((w) => (
                <li key={w.message}>{w.message}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      {descriptions?.length ? (
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {descriptions.map((d, i) => (
            <li key={`${d}-${i}`}>{d}</li>
          ))}
        </ul>
      ) : null}

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No changes.</p>
      ) : (
        Object.entries(byStage).map(([stage, stageRows]) => (
          <section key={stage} className="rounded-lg border">
            <h3 className="border-b bg-muted/40 px-3 py-2 text-sm font-medium">{stage}</h3>
            <ul className="divide-y">
              {stageRows.map((r) => (
                <li key={r.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm" data-kind={r.kind}>
                  <Badge variant={KIND[r.kind].variant}>{KIND[r.kind].label}</Badge>
                  <span className="font-medium">{[r.item, r.field].filter(Boolean).join(" · ")}</span>
                  {r.kind === "changed" ? (
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <span className="line-through">{r.before}</span>
                      <ArrowRight className="size-3.5" aria-label="to" />
                      <span className="text-foreground">{r.after}</span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">{r.kind === "added" ? r.after : r.before}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

export interface DiffDialogProps extends DiffViewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  pending?: boolean;
  title?: ReactNode;
}

/** The confirm modal for the preview → apply flow (frontend plan §192–195). */
export function DiffDialog({ open, onOpenChange, onConfirm, pending, title = "Review changes", ...view }: DiffDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Nothing changes until you confirm. You can undo afterwards.</DialogDescription>
        </DialogHeader>
        <DiffView {...view} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={pending || view.rows.length === 0}>
            {pending ? <Spinner /> : null}
            Apply changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
