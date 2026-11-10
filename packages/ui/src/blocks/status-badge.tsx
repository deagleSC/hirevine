import { CircleCheck, CircleDashed, CircleX, Clock, Loader, TriangleAlert, type LucideIcon } from "lucide-react";

import { Badge } from "@hirevine/ui/components/badge";

type Variant = "default" | "secondary" | "destructive" | "outline";

/**
 * One mapping from the API's status enums to labels, icons and colours (frontend plan §6), so both
 * apps word statuses the same way. Every status has a text label and an icon, never colour alone.
 */
const STATUSES: Record<string, { label: string; icon: LucideIcon; variant: Variant }> = {
  // stage_results.status (manager)
  pending: { label: "Pending", icon: CircleDashed, variant: "outline" },
  in_progress: { label: "In progress", icon: Loader, variant: "secondary" },
  passed: { label: "Passed", icon: CircleCheck, variant: "default" },
  failed: { label: "Below cutoff", icon: CircleX, variant: "outline" },
  needs_review: { label: "Needs review", icon: TriangleAlert, variant: "destructive" },
  // job_runs.status (manager)
  queued: { label: "Queued", icon: Clock, variant: "outline" },
  running: { label: "Processing", icon: Loader, variant: "secondary" },
  deferred_budget: { label: "Awaiting scoring", icon: Clock, variant: "outline" },
  // candidate-facing status (§7.4)
  received: { label: "Received", icon: CircleDashed, variant: "outline" },
  in_review: { label: "In review", icon: Clock, variant: "secondary" },
  action_required: { label: "Action required", icon: TriangleAlert, variant: "default" },
  outcome_released: { label: "Outcome released", icon: CircleCheck, variant: "default" },
};

export function statusLabel(status: string): string {
  return STATUSES[status]?.label ?? status.replace(/_/g, " ");
}

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const s = STATUSES[status] ?? { label: statusLabel(status), icon: CircleDashed, variant: "outline" as const };
  const Icon = s.icon;
  return (
    <Badge variant={s.variant} className={className}>
      <Icon aria-hidden />
      {s.label}
    </Badge>
  );
}
