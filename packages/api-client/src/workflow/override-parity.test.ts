/**
 * Parity between hand edits and chat edits (Phase 4 exit check). Each case in
 * apps/api/evals/datasets/override.json pairs a natural-language request with the
 * side-panel form edit for the same change. This test pins `expected` to what
 * diffFormToPatches produces for those forms; the backend eval (evals/override_eval.py)
 * then holds the chat agent to the same patches.
 *
 * UPDATE_PARITY=1 rewrites `expected` after an intentional change to diffFormToPatches.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { PatchSchema, WorkflowSchema, type Patch } from "../zod/workflow";
import { diffFormToPatches, type NodeForm } from "./diff-form";

const FILE = fileURLToPath(new URL("../../../../apps/api/evals/datasets/override.json", import.meta.url));

interface Case {
  id: string;
  instruction: string;
  forms: { node: string; form: NodeForm }[];
  expected: Patch[] | null;
}
const data = JSON.parse(readFileSync(FILE, "utf8")) as { base: unknown; cases: Case[] };
const base = WorkflowSchema.parse(data.base);

function patchesFor(c: Case): Patch[] {
  let n = 0;
  const newId = (p: string) => `${p}new${++n}`;
  return c.forms.flatMap(({ node, form }) => diffFormToPatches(base, node, form, { newId }));
}

describe("hand-edit patches for the override eval", () => {
  if (process.env.UPDATE_PARITY === "1") {
    it("rewrites expected", () => {
      for (const c of data.cases) c.expected = patchesFor(c);
      writeFileSync(FILE, `${JSON.stringify(data, null, 2)}\n`);
    });
    return;
  }

  it.each(data.cases.map((c) => [c.id, c] as const))("%s matches diffFormToPatches", (_id, c) => {
    expect(c.expected, "run with UPDATE_PARITY=1 to fill expected").not.toBeNull();
    const got = patchesFor(c);
    for (const p of got) PatchSchema.parse(p);
    expect(got).toEqual(c.expected);
  });

  it("every case either changes something or is a deliberate no-op", () => {
    const noOps = data.cases.filter((c) => c.forms.length === 0).map((c) => c.id);
    for (const c of data.cases) if (c.forms.length) expect(patchesFor(c).length, c.id).toBeGreaterThan(0);
    expect(noOps.length).toBeGreaterThan(0);
  });
});
