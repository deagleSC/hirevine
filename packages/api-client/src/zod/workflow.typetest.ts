/**
 * Compile-time contract: each Zod schema's output must be assignable to the generated
 * OpenAPI type (frontend plan §137). `tsc --noEmit` fails if the backend model changes
 * and the mirror does not.
 */
import type { components } from "../schema";
import type { Criterion, Patch, QuizQuestion, RubricItem, Workflow, WorkflowNode } from "./workflow";

type S = components["schemas"];
type Assignable<A, B> = [A] extends [B] ? true : false;
type Expect<T extends true> = T;

export type Checks = [
  Expect<Assignable<Criterion, S["Criterion"]>>,
  Expect<Assignable<QuizQuestion, S["QuizQuestion"]>>,
  Expect<Assignable<RubricItem, S["RubricItem"]>>,
  Expect<Assignable<WorkflowNode, S["ScreeningNode"] | S["QuizNode"] | S["InterviewNode"] | S["FinalNode"]>>,
  Expect<Assignable<Workflow, S["Workflow"]>>,
  Expect<Assignable<Patch, S["PatchRequest"]["patches"][number]>>,
  // And the other way for patches: every backend op has a Zod mirror.
  Expect<Assignable<S["PatchRequest"]["patches"][number]["op"], Patch["op"]>>,
];
