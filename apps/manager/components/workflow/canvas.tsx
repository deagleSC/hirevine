"use client";

import "@xyflow/react/dist/style.css";

import type { Workflow, WorkflowNode } from "@hirevine/api-client";
import { Badge } from "@hirevine/ui/components/badge";
import { Switch } from "@hirevine/ui/components/switch";
import { cn } from "@hirevine/ui/lib/utils";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import { Flag, ListChecks, MessagesSquare, ScanSearch } from "lucide-react";
import { useMemo } from "react";

export const STAGE_LABEL = { screening: "Resume screening", quiz: "Quiz", interview: "AI interview", final: "Final review" } as const;
const ICON = { screening: ScanSearch, quiz: ListChecks, interview: MessagesSquare, final: Flag } as const;

type Data = { node: WorkflowNode; selected: boolean; onToggle?: (enabled: boolean) => void; disabled: boolean };

function summary(n: WorkflowNode): string[] {
  switch (n.type) {
    case "screening":
      return [`Cutoff ${n.config.cutoff}`, `${n.config.criteria.length} criteria`];
    case "quiz":
      return [`Pass ${n.config.pass_mark}`, `${n.config.questions.length} questions`, `${n.config.time_limit_min} min`];
    case "interview":
      return [`Pass ${n.config.pass_threshold}`, `${n.config.turn_cap} questions`];
    case "final":
      return [n.config.notify_on_complete ? "Notify candidates" : "No notification"];
  }
}

function StageNode({ data }: NodeProps<Node<Data>>) {
  const { node, selected, onToggle, disabled } = data;
  const Icon = ICON[node.type];
  const enabled = "enabled" in node ? node.enabled : true;
  return (
    <div
      className={cn(
        "w-56 rounded-xl border bg-card p-3 text-card-foreground shadow-sm transition-colors",
        selected && "border-primary ring-2 ring-primary/30",
        !enabled && "opacity-60",
      )}
      data-testid={`stage-${node.id}`}
    >
      <Handle type="target" position={Position.Left} className="!invisible" isConnectable={false} />
      <div className="flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Icon className="size-4" />
        </span>
        <span className="flex-1 text-sm font-medium">{STAGE_LABEL[node.type]}</span>
        {onToggle ? (
          <Switch
            checked={enabled}
            onCheckedChange={onToggle}
            disabled={disabled}
            aria-label={`${enabled ? "Disable" : "Enable"} ${STAGE_LABEL[node.type]}`}
            className="nodrag"
            onClick={(e) => e.stopPropagation()}
          />
        ) : null}
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {enabled ? (
          summary(node).map((s) => (
            <Badge key={s} variant="secondary" className="font-normal">
              {s}
            </Badge>
          ))
        ) : (
          <Badge variant="outline" className="font-normal">
            Skipped
          </Badge>
        )}
      </div>
      <Handle type="source" position={Position.Right} className="!invisible" isConnectable={false} />
    </div>
  );
}

const nodeTypes: NodeTypes = { stage: StageNode };

export function WorkflowCanvas({
  workflow,
  selectedId,
  onSelect,
  onToggle,
  readOnly,
}: {
  workflow: Workflow;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggle: (nodeId: string, enabled: boolean) => void;
  readOnly?: boolean;
}) {
  const { nodes, edges } = useMemo(() => {
    const nodes: Node<Data>[] = workflow.nodes.map((n, i) => ({
      id: n.id,
      type: "stage",
      position: { x: i * 280, y: 0 },
      data: {
        node: n,
        selected: n.id === selectedId,
        disabled: !!readOnly,
        onToggle: n.type === "quiz" || n.type === "interview" ? (on: boolean) => onToggle(n.id, on) : undefined,
      },
      draggable: true, // visual only; positions are not saved
      connectable: false,
    }));
    const edges: Edge[] = workflow.edges.map(([a, b]) => ({ id: `${a}-${b}`, source: a, target: b, animated: false }));
    return { nodes, edges };
  }, [workflow, selectedId, onToggle, readOnly]);

  return (
    <div className="h-[260px] w-full overflow-hidden rounded-xl border bg-muted/20 md:h-[320px]">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        nodesConnectable={false}
        edgesFocusable={false}
        onNodeClick={(_, n) => onSelect(n.id)}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        proOptions={{ hideAttribution: true }}
        minZoom={0.4}
        maxZoom={1.5}
      >
        <Background gap={16} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
