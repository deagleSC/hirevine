/**
 * `diffFormToPatches` (frontend plan §192): turn a side-panel form submit into the minimal
 * patch list against the base definition. Pure; unchanged fields produce no patches.
 *
 * Ordering keeps every intermediate state valid on the server:
 * - criteria: add → update → remove (screening must always keep at least one criterion);
 * - quiz questions: remove → replace → add (a replaced or removed prompt frees its text
 *   before a new question uses it, so the duplicate check never trips mid-batch).
 * Reordering items has no patch op in v1, so order-only changes produce nothing.
 */
import type { Criterion, Patch, QuizQuestion, RubricItem, Workflow, WorkflowNode } from "../zod/workflow";

/** A criterion or question in a form: new rows have no id yet. */
type Draft<T extends { id: string }> = Omit<T, "id"> & { id?: string };

export interface ScreeningForm {
  cutoff: number;
  criteria: Draft<Criterion>[];
}
export interface QuizForm {
  enabled: boolean;
  pass_mark: number;
  time_limit_min: number;
  questions: Draft<QuizQuestion>[];
}
export interface InterviewForm {
  enabled: boolean;
  prompt_additions: string;
  themes: string[];
  turn_cap: number;
  rubric: RubricItem[];
  pass_threshold: number;
}
export interface FinalForm {
  notify_on_complete: boolean;
}
export type NodeForm = ScreeningForm | QuizForm | InterviewForm | FinalForm;

export interface DiffOptions {
  /** Id generator for new rows (tests pass a deterministic one). */
  newId?: (prefix: string) => string;
}

const defaultId = (prefix: string) => `${prefix}${Math.random().toString(36).slice(2, 8)}`;

function equal(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function freshId(prefix: string, taken: Set<string>, newId: (p: string) => string): string {
  let next = newId(prefix);
  while (taken.has(next)) next = newId(prefix);
  taken.add(next);
  return next;
}

function screening(node: Extract<WorkflowNode, { type: "screening" }>, form: ScreeningForm, newId: (p: string) => string): Patch[] {
  const out: Patch[] = [];
  if (form.cutoff !== node.config.cutoff) out.push({ op: "set_cutoff", node: node.id, value: form.cutoff });

  const base = new Map(node.config.criteria.map((c) => [c.id, c]));
  const taken = new Set(base.keys());
  const kept = new Set<string>();
  const adds: Patch[] = [];
  const updates: Patch[] = [];
  for (const row of form.criteria) {
    const existing = row.id ? base.get(row.id) : undefined;
    if (!existing) {
      const id = row.id && !taken.has(row.id) ? row.id : freshId("c", taken, newId);
      taken.add(id);
      adds.push({ op: "add_criterion", node: node.id, criterion: { id, name: row.name, weight: row.weight, must_have: row.must_have } });
      continue;
    }
    kept.add(existing.id);
    const fields: { name?: string; weight?: number; must_have?: boolean } = {};
    if (row.name !== existing.name) fields.name = row.name;
    if (row.weight !== existing.weight) fields.weight = row.weight;
    if (row.must_have !== existing.must_have) fields.must_have = row.must_have;
    if (Object.keys(fields).length) updates.push({ op: "update_criterion", node: node.id, criterion_id: existing.id, fields });
  }
  const removes: Patch[] = node.config.criteria
    .filter((c) => !kept.has(c.id))
    .map((c) => ({ op: "remove_criterion", node: node.id, criterion_id: c.id }));
  return [...out, ...adds, ...updates, ...removes];
}

function quiz(node: Extract<WorkflowNode, { type: "quiz" }>, form: QuizForm, newId: (p: string) => string): Patch[] {
  const out: Patch[] = [];
  if (form.enabled !== node.enabled) out.push({ op: "toggle_node", node: node.id, enabled: form.enabled });
  if (form.pass_mark !== node.config.pass_mark) out.push({ op: "set_pass_mark", node: node.id, value: form.pass_mark });
  if (form.time_limit_min !== node.config.time_limit_min) {
    out.push({ op: "set_time_limit", node: node.id, value: form.time_limit_min });
  }

  const base = new Map(node.config.questions.map((q) => [q.id, q]));
  const taken = new Set(base.keys());
  const kept = new Set<string>();
  const replaces: Patch[] = [];
  const adds: Patch[] = [];
  for (const row of form.questions) {
    const existing = row.id ? base.get(row.id) : undefined;
    if (!existing) {
      const id = row.id && !taken.has(row.id) ? row.id : freshId("q", taken, newId);
      taken.add(id);
      adds.push({ op: "add_quiz_question", node: node.id, question: { ...row, id } });
      continue;
    }
    kept.add(existing.id);
    const next: QuizQuestion = { ...row, id: existing.id };
    if (!equal(next, existing)) replaces.push({ op: "replace_quiz_question", node: node.id, question_id: existing.id, question: next });
  }
  const removes: Patch[] = node.config.questions
    .filter((q) => !kept.has(q.id))
    .map((q) => ({ op: "remove_quiz_question", node: node.id, question_id: q.id }));
  return [...out, ...removes, ...replaces, ...adds];
}

function interview(node: Extract<WorkflowNode, { type: "interview" }>, form: InterviewForm): Patch[] {
  const c = node.config;
  const out: Patch[] = [];
  if (form.enabled !== node.enabled) out.push({ op: "toggle_node", node: node.id, enabled: form.enabled });
  if (form.prompt_additions !== c.prompt_additions) {
    out.push({ op: "edit_interview_prompt", node: node.id, prompt_additions: form.prompt_additions });
  }
  if (!equal(form.themes, c.themes)) out.push({ op: "set_interview_themes", node: node.id, themes: form.themes });
  if (!equal(form.rubric, c.rubric)) out.push({ op: "update_interview_rubric", node: node.id, rubric: form.rubric });
  if (form.turn_cap !== c.turn_cap) out.push({ op: "set_turn_cap", node: node.id, value: form.turn_cap });
  if (form.pass_threshold !== c.pass_threshold) out.push({ op: "set_pass_mark", node: node.id, value: form.pass_threshold });
  return out;
}

export function diffFormToPatches(base: Workflow, nodeId: string, form: NodeForm, options: DiffOptions = {}): Patch[] {
  const node = base.nodes.find((n) => n.id === nodeId);
  if (!node) throw new Error(`No node ${nodeId} in this workflow`);
  const newId = options.newId ?? defaultId;
  switch (node.type) {
    case "screening":
      return screening(node, form as ScreeningForm, newId);
    case "quiz":
      return quiz(node, form as QuizForm, newId);
    case "interview":
      return interview(node, form as InterviewForm);
    case "final": {
      const f = form as FinalForm;
      return f.notify_on_complete === node.config.notify_on_complete ? [] : [{ op: "set_notify", value: f.notify_on_complete }];
    }
  }
}

/** The form's starting values for a node (what the side panel loads). */
export function formFromNode(node: WorkflowNode): NodeForm {
  switch (node.type) {
    case "screening":
      return { cutoff: node.config.cutoff, criteria: node.config.criteria.map((c) => ({ ...c })) };
    case "quiz":
      return { enabled: node.enabled, ...node.config, questions: node.config.questions.map((q) => ({ ...q, options: [...q.options] })) };
    case "interview":
      return { enabled: node.enabled, ...node.config, themes: [...node.config.themes], rubric: node.config.rubric.map((r) => ({ ...r })) };
    case "final":
      return { notify_on_complete: node.config.notify_on_complete };
  }
}
