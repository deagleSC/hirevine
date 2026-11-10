import { describe, expect, it } from "vitest";

import { PatchSchema, WorkflowSchema, type Patch, type Workflow } from "../zod/workflow";
import { diffFormToPatches, formFromNode, type InterviewForm, type QuizForm, type ScreeningForm } from "./diff-form";

const base: Workflow = WorkflowSchema.parse({
  schema_version: 1,
  nodes: [
    {
      type: "screening",
      id: "n1",
      config: {
        cutoff: 60,
        criteria: [
          { id: "c1", name: "React", weight: 3, must_have: true },
          { id: "c2", name: "SQL", weight: 2, must_have: false },
        ],
      },
    },
    {
      type: "quiz",
      id: "n2",
      enabled: true,
      config: {
        pass_mark: 60,
        time_limit_min: 20,
        questions: [
          { id: "q1", prompt: "What is JSX?", options: ["A", "B", "C"], answer_index: 0, explanation: "", difficulty: "easy" },
        ],
      },
    },
    {
      type: "interview",
      id: "n3",
      enabled: true,
      config: { prompt_additions: "", themes: [], turn_cap: 6, rubric: [], pass_threshold: 60 },
    },
    { type: "final", id: "n4", config: { notify_on_complete: true, ranking: "weighted_mean" } },
  ],
  edges: [
    ["n1", "n2"],
    ["n2", "n3"],
    ["n3", "n4"],
  ],
});

const node = (id: string) => base.nodes.find((n) => n.id === id)!;
let counter = 0;
const newId = (p: string) => `${p}new${++counter}`;

function diff(id: string, edit: (f: never) => void): Patch[] {
  counter = 0;
  const form = structuredClone(formFromNode(node(id)));
  edit(form as never);
  const patches = diffFormToPatches(base, id, form, { newId });
  for (const p of patches) PatchSchema.parse(p); // every patch is valid on its own
  return patches;
}

describe("diffFormToPatches", () => {
  it.each(["n1", "n2", "n3", "n4"])("an untouched %s form yields no patches", (id) => {
    expect(diff(id, () => {})).toEqual([]);
  });

  describe("screening", () => {
    it("cutoff only", () => {
      expect(diff("n1", (f: ScreeningForm) => (f.cutoff = 75))).toEqual([{ op: "set_cutoff", node: "n1", value: 75 }]);
    });

    it("updates only the fields that changed", () => {
      expect(diff("n1", (f: ScreeningForm) => (f.criteria[1]!.weight = 5))).toEqual([
        { op: "update_criterion", node: "n1", criterion_id: "c2", fields: { weight: 5 } },
      ]);
    });

    it("adds new rows with fresh ids, before removals", () => {
      const patches = diff("n1", (f: ScreeningForm) => {
        f.criteria = [{ name: "Go", weight: 4, must_have: false }];
      });
      expect(patches).toEqual([
        { op: "add_criterion", node: "n1", criterion: { id: "cnew1", name: "Go", weight: 4, must_have: false } },
        { op: "remove_criterion", node: "n1", criterion_id: "c1" },
        { op: "remove_criterion", node: "n1", criterion_id: "c2" },
      ]);
    });

    it("reordering alone yields nothing (no reorder op in v1)", () => {
      expect(diff("n1", (f: ScreeningForm) => f.criteria.reverse())).toEqual([]);
    });
  });

  describe("quiz", () => {
    it("toggle, pass mark and time limit", () => {
      const patches = diff("n2", (f: QuizForm) => {
        f.enabled = false;
        f.pass_mark = 70;
        f.time_limit_min = 30;
      });
      expect(patches).toEqual([
        { op: "toggle_node", node: "n2", enabled: false },
        { op: "set_pass_mark", node: "n2", value: 70 },
        { op: "set_time_limit", node: "n2", value: 30 },
      ]);
    });

    it("an edited question is one replace", () => {
      const patches = diff("n2", (f: QuizForm) => (f.questions[0]!.answer_index = 2));
      expect(patches).toEqual([
        {
          op: "replace_quiz_question",
          node: "n2",
          question_id: "q1",
          question: { id: "q1", prompt: "What is JSX?", options: ["A", "B", "C"], answer_index: 2, explanation: "", difficulty: "easy" },
        },
      ]);
    });

    it("removes before adding, so a reworded question never collides with itself", () => {
      const patches = diff("n2", (f: QuizForm) => {
        f.questions = [{ prompt: "What is JSX?", options: ["X", "Y", "Z"], answer_index: 1, explanation: "", difficulty: "medium" }];
      });
      expect(patches.map((p) => p.op)).toEqual(["remove_quiz_question", "add_quiz_question"]);
    });
  });

  describe("interview", () => {
    it("each changed field maps to its op; pass_threshold uses set_pass_mark", () => {
      const patches = diff("n3", (f: InterviewForm) => {
        f.prompt_additions = "Ask about on-call";
        f.themes = ["reliability"];
        f.rubric = [{ id: "r1", name: "Depth", weight: 3, description: "" }];
        f.turn_cap = 8;
        f.pass_threshold = 55;
      });
      expect(patches).toEqual([
        { op: "edit_interview_prompt", node: "n3", prompt_additions: "Ask about on-call" },
        { op: "set_interview_themes", node: "n3", themes: ["reliability"] },
        { op: "update_interview_rubric", node: "n3", rubric: [{ id: "r1", name: "Depth", weight: 3, description: "" }] },
        { op: "set_turn_cap", node: "n3", value: 8 },
        { op: "set_pass_mark", node: "n3", value: 55 },
      ]);
    });
  });

  it("final: notify switch", () => {
    expect(diff("n4", (f: { notify_on_complete: boolean }) => (f.notify_on_complete = false))).toEqual([
      { op: "set_notify", value: false },
    ]);
  });

  it("new ids never collide with existing ones", () => {
    const patches = diffFormToPatches(
      base,
      "n1",
      { cutoff: 60, criteria: [...(formFromNode(node("n1")) as ScreeningForm).criteria, { name: "Go", weight: 1, must_have: false }] },
      { newId: () => (counter++ < 2 ? "c1" : "c9") },
    );
    expect(patches).toEqual([{ op: "add_criterion", node: "n1", criterion: { id: "c9", name: "Go", weight: 1, must_have: false } }]);
  });

  it("rejects an unknown node", () => {
    expect(() => diffFormToPatches(base, "nope", { notify_on_complete: true })).toThrow();
  });
});
