import { describe, expect, it } from "vitest";

import { WorkflowSchema } from "../zod/workflow";
import { humanizeDiff } from "./humanize";

const base = WorkflowSchema.parse({
  schema_version: 1,
  nodes: [
    { type: "screening", id: "n1", config: { cutoff: 60, criteria: [{ id: "c2", name: "SQL", weight: 2, must_have: false }] } },
    { type: "final", id: "n4", config: { notify_on_complete: true, ranking: "weighted_mean" } },
  ],
  edges: [["n1", "n4"]],
});

describe("humanizeDiff", () => {
  it("names stages, items and fields", () => {
    const rows = humanizeDiff(
      [
        { path: "n1.cutoff", kind: "changed", node_id: "n1", before: 60, after: 75 },
        { path: "n1.criteria[c2].weight", kind: "changed", node_id: "n1", before: 2, after: 5 },
        { path: "n1.criteria[c9]", kind: "added", node_id: "n1", after: { id: "c9", name: "Go" } },
        { path: "n4.notify_on_complete", kind: "changed", node_id: "n4", before: true, after: false },
      ],
      base,
    );
    expect(rows.map(({ key: _k, ...r }) => r)).toEqual([
      { kind: "changed", stage: "Screening", item: undefined, field: "cutoff", before: "60", after: "75" },
      { kind: "changed", stage: "Screening", item: "Criterion 'SQL'", field: "weight", before: "2", after: "5" },
      { kind: "added", stage: "Screening", item: "Criterion c9", field: undefined, before: undefined, after: "Go" },
      { kind: "changed", stage: "Final", item: undefined, field: "notify candidates on completion", before: "on", after: "off" },
    ]);
  });
});
