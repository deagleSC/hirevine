import { WorkflowSchema, humanizeDiff } from "@hirevine/api-client";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DiffDialog, DiffView } from "../src/blocks/diff-view";

const base = WorkflowSchema.parse({
  schema_version: 1,
  nodes: [
    { type: "screening", id: "n1", config: { cutoff: 60, criteria: [{ id: "c2", name: "SQL", weight: 2, must_have: false }] } },
    { type: "final", id: "n4", config: { notify_on_complete: true, ranking: "weighted_mean" } },
  ],
  edges: [["n1", "n4"]],
});

/** A preview response as the API returns it. */
const preview = {
  diff: [
    { path: "n1.cutoff", kind: "changed" as const, node_id: "n1", before: 60, after: 75 },
    { path: "n1.criteria[c2]", kind: "removed" as const, node_id: "n1", before: { id: "c2", name: "SQL" } },
  ],
  descriptions: ["Set the screening cutoff to 75", "Remove criterion c2"],
  warnings: [{ patch_index: 0, code: "protected_characteristic" as const, message: "'Young' may screen on age" }],
  affects_running_campaign: true,
  affected_stage_note: "2 candidates who have not reached the screening step yet will use this version.",
};

describe("DiffView", () => {
  it("renders a preview response: rows, banner, warnings", () => {
    render(
      <DiffView
        rows={humanizeDiff(preview.diff, base)}
        descriptions={preview.descriptions}
        warnings={preview.warnings}
        affectsRunningCampaign={preview.affects_running_campaign}
        affectedStageNote={preview.affected_stage_note}
      />,
    );
    expect(screen.getByText("This campaign is running")).toBeInTheDocument();
    expect(screen.getByText(/2 candidates who have not reached/)).toBeInTheDocument();
    expect(screen.getByText("'Young' may screen on age")).toBeInTheDocument();
    expect(screen.getByText("Screening")).toBeInTheDocument();
    expect(screen.getByText("cutoff")).toBeInTheDocument();
    expect(screen.getByText("75")).toBeInTheDocument();
    expect(screen.getByText("Criterion 'SQL'")).toBeInTheDocument();
  });

  it("hides the running-campaign banner for drafts", () => {
    render(<DiffView rows={humanizeDiff(preview.diff, base)} />);
    expect(screen.queryByText("This campaign is running")).not.toBeInTheDocument();
  });

  it("confirms from the dialog, and cannot confirm an empty diff", () => {
    const onConfirm = vi.fn();
    const { rerender } = render(<DiffDialog open onOpenChange={() => {}} onConfirm={onConfirm} rows={humanizeDiff(preview.diff, base)} />);
    fireEvent.click(screen.getByRole("button", { name: "Apply changes" }));
    expect(onConfirm).toHaveBeenCalledOnce();
    rerender(<DiffDialog open onOpenChange={() => {}} onConfirm={onConfirm} rows={[]} />);
    expect(screen.getByRole("button", { name: "Apply changes" })).toBeDisabled();
  });
});
