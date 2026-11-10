import { isTakingLong, readMaybeProcessing, type Processing } from "@hirevine/api-client";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProcessingState } from "../src/blocks/processing-state";

/** A mocked 202 from an async endpoint, read the way pages read it. */
function from202(body: Processing): Processing {
  const out = readMaybeProcessing<unknown>({ data: body as never, response: new Response(null, { status: 202 }) });
  if (typeof out !== "object" || out === null || !("status" in out)) throw new Error("expected processing");
  return out as Processing;
}

describe("ProcessingState", () => {
  it("renders processing from a mocked 202", () => {
    const p = from202({ status: "processing" });
    render(<ProcessingState status={p.status} title="Screening your resume" />);
    expect(screen.getByRole("status")).toHaveAttribute("data-status", "processing");
    expect(screen.getByText("Screening your resume")).toBeInTheDocument();
    expect(screen.getByText(/usually takes a minute or two/)).toBeInTheDocument();
  });

  it("renders queued_budget from a mocked 202", () => {
    const p = from202({ status: "queued_budget" });
    render(<ProcessingState status={p.status} title="Screening your resume" />);
    expect(screen.getByText("Queued, will process tomorrow")).toBeInTheDocument();
    expect(screen.queryByText("Screening your resume")).not.toBeInTheDocument();
  });

  it("says when processing is taking longer than usual", () => {
    const p = from202({ status: "processing", queued_at: "2026-11-10T11:50:00Z" });
    const now = Date.parse("2026-11-10T12:00:00Z");
    render(<ProcessingState status={p.status} takingLong={isTakingLong(p, now)} />);
    expect(screen.getByText("Taking longer than usual")).toBeInTheDocument();
  });
});
