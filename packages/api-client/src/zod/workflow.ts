/**
 * Zod mirrors of the backend workflow and patch models (apps/api/app/domain/workflow.py,
 * patches.py). Forms validate with these before anything is sent. `workflow.typetest.ts`
 * fails `tsc` if a schema drifts from the generated OpenAPI types.
 */
import { z } from "zod";

const id = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);
const name = z.string().trim().min(1).max(200);
const percent = z.number().int().min(0).max(100);
const weight = z.number().int().min(1).max(5);

export const CriterionSchema = z.strictObject({ id, name, weight, must_have: z.boolean() });

export const QuizQuestionSchema = z
  .strictObject({
    id,
    prompt: z.string().trim().min(1).max(1000),
    options: z.array(z.string().trim().min(1).max(300)).min(3).max(5),
    answer_index: z.number().int(),
    explanation: z.string().max(1000),
    difficulty: z.enum(["easy", "medium", "hard"]),
  })
  .refine((q) => q.answer_index >= 0 && q.answer_index < q.options.length, {
    message: "Pick the correct option",
    path: ["answer_index"],
  })
  .refine((q) => new Set(q.options.map((o) => o.toLowerCase())).size === q.options.length, {
    message: "Options must be distinct",
    path: ["options"],
  });

export const RubricItemSchema = z.strictObject({ id, name, weight, description: z.string().max(500) });

export const ScreeningConfigSchema = z.strictObject({
  cutoff: percent,
  criteria: z.array(CriterionSchema).min(1, "Add at least one criterion").max(20),
});
export const QuizConfigSchema = z.strictObject({
  pass_mark: percent,
  time_limit_min: z.number().int().min(5).max(120),
  questions: z.array(QuizQuestionSchema).max(30),
});
export const InterviewConfigSchema = z.strictObject({
  prompt_additions: z.string().max(2000),
  themes: z.array(name).max(10),
  turn_cap: z.number().int().min(3).max(10),
  rubric: z.array(RubricItemSchema).max(10),
  pass_threshold: percent,
});
export const FinalConfigSchema = z.strictObject({
  notify_on_complete: z.boolean(),
  ranking: z.literal("weighted_mean"),
});

export const ScreeningNodeSchema = z.strictObject({ type: z.literal("screening"), id, config: ScreeningConfigSchema });
export const QuizNodeSchema = z.strictObject({ type: z.literal("quiz"), id, enabled: z.boolean(), config: QuizConfigSchema });
export const InterviewNodeSchema = z.strictObject({
  type: z.literal("interview"),
  id,
  enabled: z.boolean(),
  config: InterviewConfigSchema,
});
export const FinalNodeSchema = z.strictObject({ type: z.literal("final"), id, config: FinalConfigSchema });
export const NodeSchema = z.discriminatedUnion("type", [ScreeningNodeSchema, QuizNodeSchema, InterviewNodeSchema, FinalNodeSchema]);

export const WorkflowSchema = z.strictObject({
  schema_version: z.literal(1),
  nodes: z.array(NodeSchema),
  edges: z.array(z.tuple([z.string(), z.string()])),
});

// ------------------------------------------------------------------- patches
const op = <T extends string, S extends z.ZodRawShape>(name: T, shape: S) =>
  z.strictObject({ op: z.literal(name), ...shape });

export const PatchSchema = z.discriminatedUnion("op", [
  op("set_cutoff", { node: id, value: percent }),
  op("set_pass_mark", { node: id, value: percent }),
  op("set_time_limit", { node: id, value: z.number().int().min(5).max(120) }),
  op("add_criterion", { node: id, criterion: CriterionSchema }),
  op("update_criterion", {
    node: id,
    criterion_id: id,
    fields: z.strictObject({ name: name.optional(), weight: weight.optional(), must_have: z.boolean().optional() }),
  }),
  op("remove_criterion", { node: id, criterion_id: id }),
  op("add_quiz_question", { node: id, question: QuizQuestionSchema }),
  op("replace_quiz_question", { node: id, question_id: id, question: QuizQuestionSchema }),
  op("remove_quiz_question", { node: id, question_id: id }),
  op("edit_interview_prompt", { node: id, prompt_additions: z.string().max(2000) }),
  op("set_interview_themes", { node: id, themes: z.array(name).max(10) }),
  op("update_interview_rubric", { node: id, rubric: z.array(RubricItemSchema).max(10) }),
  op("set_turn_cap", { node: id, value: z.number().int().min(3).max(10) }),
  op("toggle_node", { node: id, enabled: z.boolean() }),
  op("set_notify", { value: z.boolean() }),
]);

export type Criterion = z.infer<typeof CriterionSchema>;
export type QuizQuestion = z.infer<typeof QuizQuestionSchema>;
export type RubricItem = z.infer<typeof RubricItemSchema>;
export type WorkflowNode = z.infer<typeof NodeSchema>;
export type Workflow = z.infer<typeof WorkflowSchema>;
export type Patch = z.infer<typeof PatchSchema>;
export type PatchOp = Patch["op"];
