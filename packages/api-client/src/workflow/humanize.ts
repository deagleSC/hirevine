/**
 * Turn the id-keyed diff from /workflow/preview into rows people can read, e.g.
 * `n1.criteria[c2].weight` → { stage: "Screening", item: "Criterion 'SQL'", field: "weight" }.
 */
import type { components } from "../schema";
import type { Workflow } from "../zod/workflow";

export type DiffEntry = components["schemas"]["DiffEntry"];

export interface DiffRow {
  key: string;
  kind: DiffEntry["kind"];
  stage: string;
  item?: string;
  field?: string;
  before?: string;
  after?: string;
}

const STAGE: Record<string, string> = { screening: "Screening", quiz: "Quiz", interview: "AI interview", final: "Final" };
const FIELD: Record<string, string> = {
  cutoff: "cutoff",
  pass_mark: "pass mark",
  pass_threshold: "pass mark",
  time_limit_min: "time limit (min)",
  turn_cap: "number of questions",
  prompt_additions: "prompt additions",
  themes: "themes",
  rubric: "rubric",
  enabled: "step enabled",
  notify_on_complete: "notify candidates on completion",
  must_have: "must-have",
  answer_index: "correct option",
  order: "order",
};
const ITEM: Record<string, string> = { criteria: "Criterion", questions: "Question", rubric: "Rubric item" };

function show(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "boolean") return v ? "on" : "off";
  if (typeof v === "string") return v.length > 80 ? `${v.slice(0, 77)}…` : v || "(empty)";
  if (Array.isArray(v)) return v.length ? v.map((x) => (typeof x === "object" ? (x as { name?: string; prompt?: string }).name ?? (x as { prompt?: string }).prompt ?? "…" : String(x))).join(", ") : "(none)";
  if (typeof v === "object") {
    const o = v as { name?: string; prompt?: string };
    return o.name ?? o.prompt ?? "…";
  }
  return String(v);
}

function itemName(defs: Workflow[], nodeId: string, list: string, itemId: string): string | undefined {
  for (const def of defs) {
    const node = def.nodes.find((n) => n.id === nodeId) as { config: Record<string, unknown> } | undefined;
    const items = node?.config[list] as { id: string; name?: string; prompt?: string }[] | undefined;
    const hit = items?.find((i) => i.id === itemId);
    if (hit) return hit.name ?? hit.prompt;
  }
  return undefined;
}

export function humanizeDiff(diff: DiffEntry[], base: Workflow, result?: Workflow): DiffRow[] {
  const defs = result ? [result, base] : [base];
  return diff.map((d, i) => {
    const node = defs.flatMap((w) => w.nodes).find((n) => n.id === d.node_id);
    const stage = node ? STAGE[node.type] ?? node.type : d.node_id;
    // path: <node>.<field> | <node>.<list>[<id>] | <node>.<list>[<id>].<field> | <node>.<list>.order
    const rest = d.path.slice(d.node_id.length + 1);
    const m = /^(\w+)\[([^\]]+)\](?:\.(\w+))?$/.exec(rest);
    let item: string | undefined;
    let field: string | undefined;
    if (m) {
      const [, list, itemId, sub] = m;
      const name = itemName(defs, d.node_id, list!, itemId!);
      item = `${ITEM[list!] ?? list} ${name ? `'${name}'` : itemId}`;
      field = sub ? FIELD[sub] ?? sub.replace(/_/g, " ") : undefined;
    } else {
      const [list, sub] = rest.split(".");
      if (sub === "order") {
        item = `${ITEM[list!] ?? list} list`;
        field = "order";
      } else {
        field = FIELD[rest] ?? rest.replace(/_/g, " ");
      }
    }
    return { key: `${d.path}-${i}`, kind: d.kind, stage, item, field, before: show(d.before), after: show(d.after) };
  });
}
