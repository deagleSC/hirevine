"use client";

import { messageFor, type Workflow } from "@hirevine/api-client";
import { PageHeader } from "@hirevine/ui/blocks/dashboard-layout";
import { ErrorState, PageSkeleton } from "@hirevine/ui/blocks/states";
import { Badge } from "@hirevine/ui/components/badge";
import { Button } from "@hirevine/ui/components/button";
import { Card, CardContent } from "@hirevine/ui/components/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@hirevine/ui/components/collapsible";
import { ChevronRight, History, MessageSquareText, PanelRightOpen, Rocket, Undo2 } from "lucide-react";
import { use, useCallback, useState } from "react";

import { JobStatusBadge } from "@/components/job-status-badge";
import { WorkflowCanvas } from "@/components/workflow/canvas";
import { ChatDrawer } from "@/components/workflow/chat-drawer";
import { HistorySheet } from "@/components/workflow/history-sheet";
import { NodePanel } from "@/components/workflow/panels";
import { CopyLink, PublishDialog, shareUrl } from "@/components/workflow/publish-dialog";
import { usePatchFlow } from "@/components/workflow/use-patch-flow";
import { useJob, useWorkflow } from "@/lib/jobs";

export default function WorkflowEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = use(params);
  const job = useJob(jobId);
  const wf = useWorkflow(jobId);
  const flow = usePatchFlow(jobId, wf.data);
  const [selected, setSelected] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);

  const onToggle = useCallback(
    (nodeId: string, enabled: boolean) => void flow.preview([{ op: "toggle_node", node: nodeId, enabled }], "panel"),
    [flow],
  );

  if (job.isError) return <ErrorState message={messageFor(job.error)} />;
  if (wf.isError) return <ErrorState message={messageFor(wf.error)} />;
  if (job.isPending || wf.isPending) return <PageSkeleton />;

  const definition = wf.data.definition as Workflow;
  const node = definition.nodes.find((n) => n.id === (selected ?? definition.nodes[0]!.id))!;
  const campaign = job.data.campaign;
  const isOpen = campaign?.status === "open";

  return (
    // Fill the viewport (minus the h-16 app header and p-6 bottom padding) so the page never scrolls on desktop.
    <div className="flex min-w-0 flex-col gap-6 xl:h-[calc(100svh-5.5rem)] xl:min-h-0">
      <PageHeader
        title={job.data.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <JobStatusBadge status={job.data.status} />
            <Badge variant="outline">Version {wf.data.version}</Badge>
            {[job.data.seniority, job.data.location].filter(Boolean).join(" · ")}
          </span>
        }
        actions={
          <>
            <Button variant="outline" size="sm" aria-label="Undo" onClick={() => void flow.undo()} disabled={!wf.data.parent_version || flow.busy}>
              <Undo2 /> <span className="hidden sm:inline">Undo</span>
            </Button>
            <Button variant="outline" size="sm" aria-label="History" onClick={() => setHistoryOpen(true)}>
              <History /> <span className="hidden sm:inline">History</span>
            </Button>
            <Button variant="outline" size="sm" aria-label="Edit by chat" onClick={() => setChatOpen(true)}>
              <MessageSquareText /> <span className="hidden sm:inline">Edit by chat</span>
            </Button>
            {!isOpen ? (
              <Button size="sm" onClick={() => setPublishOpen(true)}>
                <Rocket /> Publish
              </Button>
            ) : null}
          </>
        }
      />

      {isOpen && campaign.share_slug ? (
        <Card>
          <CardContent className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <p className="shrink-0 text-sm">
              <span className="font-medium">Live.</span> {campaign.applicants} applicant{campaign.applicants === 1 ? "" : "s"}. Apply link:
            </p>
            <div className="min-w-0 flex-1">
              <CopyLink url={shareUrl(campaign.share_slug)} />
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-col gap-3 xl:min-h-0 xl:flex-1">
        <div className="flex flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm xl:min-h-0 xl:flex-1 xl:flex-row">
          <div className="min-w-0 xl:min-h-0 xl:flex-1">
            <WorkflowCanvas workflow={definition} selectedId={node.id} onSelect={setSelected} onToggle={onToggle} />
          </div>
          <Collapsible open={panelOpen} onOpenChange={setPanelOpen} asChild>
            <section className="flex flex-col border-t xl:min-h-0 xl:shrink-0 xl:border-t-0 xl:border-l data-[state=open]:xl:w-[400px]">
              <div className="flex items-center border-b px-4 py-2 in-data-[state=closed]:border-b-0">
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="-ml-2 flex-1 justify-start" aria-label={panelOpen ? "Collapse step settings" : "Expand step settings"}>
                    {panelOpen ? <ChevronRight /> : <PanelRightOpen />}
                    <span className={panelOpen ? "" : "xl:hidden"}>Step settings</span>
                  </Button>
                </CollapsibleTrigger>
              </div>
              <CollapsibleContent className="flex min-h-0 flex-1 flex-col">
                <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-4">
                  <NodePanel
                    base={definition}
                    node={node}
                    version={wf.data.version}
                    busy={flow.busy}
                    onPropose={(patches) => void flow.preview(patches, "panel")}
                  />
                </div>
              </CollapsibleContent>
            </section>
          </Collapsible>
        </div>
        <p className="text-xs text-muted-foreground">
          Select a step to edit it. The order is fixed: screening → quiz → interview → final review.
        </p>
      </div>

      {flow.dialogs}
      <ChatDrawer jobId={jobId} open={chatOpen} onOpenChange={setChatOpen} busy={flow.busy} onPropose={(p) => { setChatOpen(false); void flow.preview(p, "chat"); }} />
      <HistorySheet jobId={jobId} open={historyOpen} onOpenChange={setHistoryOpen} current={wf.data.version} />
      <PublishDialog jobId={jobId} version={wf.data.version} open={publishOpen} onOpenChange={setPublishOpen} />
    </div>
  );
}
