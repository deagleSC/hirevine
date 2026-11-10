import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { EvidenceList, ResumeViewer, type EvidenceItem } from "../src/blocks/evidence";

const LINES = ["[NAME]", "Senior Backend Engineer", "Built a FastAPI payments API.", "Designed PostgreSQL schemas."];
const ITEMS: EvidenceItem[] = [
  { criterion_id: "py", name: "Python", weight: 5, must_have: true, score: 4, rationale: "APIs in Python.",
    quote: "Built a FastAPI payments API", line_no: 3, verified: true },
  { criterion_id: "pg", name: "PostgreSQL", weight: 3, must_have: true, score: 3, rationale: "Schemas.",
    quote: "Designed PostgreSQL schemas", line_no: 4, verified: true },
  { criterion_id: "k8s", name: "Kubernetes", weight: 2, must_have: true, score: 0, rationale: "Not mentioned.",
    quote: "", line_no: null, verified: false },
];

function Linked() {
  const [line, setLine] = useState<number | null>(null);
  return (
    <>
      <EvidenceList items={ITEMS} activeLine={line} onSelectLine={setLine} />
      <ResumeViewer lines={LINES} activeLine={line} citedLines={new Set([3, 4])} onSelectLine={setLine} />
    </>
  );
}

describe("EvidenceList + ResumeViewer", () => {
  it("highlights the cited resume line for every citation", () => {
    Element.prototype.scrollIntoView = vi.fn();
    render(<Linked />);
    for (const item of ITEMS.filter((i) => i.verified)) {
      fireEvent.click(screen.getByRole("button", { name: `L${item.line_no}` }));
      const line = document.getElementById(`resume-line-${item.line_no}`)!;
      expect(line).toHaveAttribute("aria-current", "true");
      expect(line).toHaveTextContent(item.quote);
      expect(document.querySelectorAll('[aria-current="true"]')).toHaveLength(1);
      expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    }
  });

  it("shows unverified criteria without a citation and flags a missing must-have", () => {
    render(<Linked />);
    expect(screen.getAllByRole("button", { name: /^L\d+$/ })).toHaveLength(2);
    expect(screen.getByText("No quoted evidence.")).toBeInTheDocument();
    expect(screen.getByText("Must-have missing")).toBeInTheDocument();
    expect(screen.getByLabelText("0 of 4")).toBeInTheDocument();
  });
});
