"use client";

import { ApiError, humanizeDiff, messageFor, qk, type Patch, type Workflow } from "@hirevine/api-client";
import { DiffDialog } from "@hirevine/ui/blocks/diff-view";
import { Button } from "@hirevine/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@hirevine/ui/components/dialog";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { applyPatches, fetchWorkflow, previewPatches, undoWorkflow, type Preview, type WorkflowVersion } from "@/lib/jobs";

type Source = "panel" | "chat";
interface Pending {
  patches: Patch[];
  source: Source;
  baseVersion: number;
  base: Workflow;
  preview: Preview;
}

/**
 * The patch flow shared by the side panel, the canvas toggles and the chat drawer
 * (frontend plan §192–196): preview → DiffView → apply → toast with Undo; a 409 opens the
 * conflict dialog, which re-previews the same patches against the latest version.
 */
export function usePatchFlow(jobId: string, current: WorkflowVersion | undefined) {
  const qc = useQueryClient();
  const [pending, setPending] = useState<Pending | null>(null);
  const [conflict, setConflict] = useState<{ patches: Patch[]; source: Source } | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: qk.workflow(jobId) }),
      qc.invalidateQueries({ queryKey: qk.workflowVersions(jobId) }),
      qc.invalidateQueries({ queryKey: qk.job(jobId) }),
    ]);
  }, [qc, jobId]);

  const preview = useCallback(
    async (patches: Patch[], source: Source, against?: WorkflowVersion) => {
      const base = against ?? current;
      if (!base || patches.length === 0) {
        if (patches.length === 0) toast.info("Nothing changed.");
        return;
      }
      setBusy(true);
      try {
        const result = await previewPatches(jobId, base.version, patches);
        setPending({ patches, source, baseVersion: base.version, base: base.definition as Workflow, preview: result });
      } catch (err) {
        if (err instanceof ApiError && err.code === "stale_base_version") setConflict({ patches, source });
        else toast.error(messageFor(err));
      } finally {
        setBusy(false);
      }
    },
    [current, jobId],
  );

  const undo = useCallback(async () => {
    try {
      const res = await undoWorkflow(jobId);
      await refresh();
      toast.success(`Restored the previous version (now version ${res.version}).`, { id: "workflow-saved" });
    } catch (err) {
      toast.error(messageFor(err));
    }
  }, [jobId, refresh]);

  const confirm = useCallback(async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const res = await applyPatches(jobId, pending.baseVersion, pending.patches, pending.source);
      setPending(null);
      await refresh();
      // One save toast at a time: Undo always restores the latest version's parent, so an older
      // toast's Undo would undo a different change than the one it was shown for.
      toast.success(`Saved as version ${res.version}.`, {
        id: "workflow-saved",
        action: { label: "Undo", onClick: () => void undo() },
      });
    } catch (err) {
      if (err instanceof ApiError && err.code === "stale_base_version") {
        setConflict({ patches: pending.patches, source: pending.source });
        setPending(null);
      } else toast.error(messageFor(err));
    } finally {
      setBusy(false);
    }
  }, [pending, jobId, refresh, undo]);

  const resolveConflict = useCallback(async () => {
    if (!conflict) return;
    const { patches, source } = conflict;
    setConflict(null);
    try {
      const latest = await qc.fetchQuery({ queryKey: qk.workflow(jobId), queryFn: () => fetchWorkflow(jobId), staleTime: 0 });
      await refresh();
      await preview(patches, source, latest);
    } catch (err) {
      toast.error(messageFor(err));
    }
  }, [conflict, qc, jobId, refresh, preview]);

  const dialogs: ReactNode = (
    <>
      <DiffDialog
        open={!!pending}
        onOpenChange={(open) => !open && !busy && setPending(null)}
        onConfirm={() => void confirm()}
        pending={busy}
        rows={pending ? humanizeDiff(pending.preview.diff, pending.base, pending.preview.resulting_definition as Workflow) : []}
        descriptions={pending?.preview.descriptions}
        warnings={pending?.preview.warnings}
        affectsRunningCampaign={pending?.preview.affects_running_campaign}
        affectedStageNote={pending?.preview.affected_stage_note}
      />
      <Dialog open={!!conflict} onOpenChange={(open) => !open && setConflict(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>The pipeline changed</DialogTitle>
            <DialogDescription>
              Someone saved a newer version since you opened it. Review your change against the latest version before
              applying it.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConflict(null)}>
              Discard my change
            </Button>
            <Button onClick={() => void resolveConflict()}>Review against latest</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );

  return { preview, undo, busy, dialogs };
}
