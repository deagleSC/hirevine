import { describe, expect, it } from "vitest";

import {
  POLL_PROCESSING_MS,
  POLL_QUEUED_BUDGET_MS,
  isProcessing,
  isTakingLong,
  pollInterval,
  readMaybeProcessing,
} from "./processing";

const mocked = (status: number, body: unknown) => ({
  data: body as never,
  response: new Response(JSON.stringify(body), { status }),
});

describe("processing helpers", () => {
  it("reads a mocked 202 processing response", () => {
    const out = readMaybeProcessing(mocked(202, { status: "processing", job_run_id: "r1" }));
    expect(out).toEqual({ status: "processing", job_run_id: "r1" });
    expect(pollInterval(out)).toBe(POLL_PROCESSING_MS);
  });

  it("reads a mocked 202 queued_budget response and polls slowly", () => {
    const out = readMaybeProcessing(mocked(202, { status: "queued_budget" }));
    expect(isProcessing(out)).toBe(true);
    expect(pollInterval(out)).toBe(POLL_QUEUED_BUDGET_MS);
  });

  it("treats a 202 without a body as processing", () => {
    expect(readMaybeProcessing({ response: new Response(null, { status: 202 }) })).toEqual({ status: "processing" });
  });

  it("stops polling once the result arrives", () => {
    const out = readMaybeProcessing(mocked(200, { score: 72 }));
    expect(out).toEqual({ score: 72 });
    expect(pollInterval(out)).toBe(false);
  });

  it("throws API errors instead of returning them", () => {
    const err = { error: { code: "not_found" } };
    expect(() => readMaybeProcessing({ error: err, response: new Response(null, { status: 404 }) })).toThrow();
  });

  it("flags processing that has run longer than five minutes", () => {
    const now = Date.parse("2026-11-10T12:00:00Z");
    expect(isTakingLong({ status: "processing", queued_at: "2026-11-10T11:54:00Z" }, now)).toBe(true);
    expect(isTakingLong({ status: "processing", queued_at: "2026-11-10T11:58:00Z" }, now)).toBe(false);
    expect(isTakingLong({ status: "queued_budget", queued_at: "2026-11-10T09:00:00Z" }, now)).toBe(false);
  });
});
