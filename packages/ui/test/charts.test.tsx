import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BarList, ChartCard, ColumnChart, Meter } from "../src/blocks/charts";

describe("charts", () => {
  it("bar list scales to the largest value and names every bar for assistive tech", () => {
    render(<BarList ariaLabel="Funnel" data={[{ label: "screening", value: 10 }, { label: "quiz", value: 5, sub: "50% drop-off" }]} />);
    expect(screen.getByLabelText("screening: 10")).toBeInTheDocument();
    expect(screen.getByLabelText("quiz: 5, 50% drop-off")).toBeInTheDocument();
    const bars = document.querySelectorAll<HTMLElement>(".bg-primary");
    expect([...bars].map((b) => b.style.width)).toEqual(["100%", "50%"]);
  });

  it("column chart shows a tooltip on hover and on keyboard focus", () => {
    render(<ColumnChart ariaLabel="Scores" data={[{ label: "0–9", value: 1 }, { label: "90–100", value: 3 }]} reference={{ at: 1, label: "Cutoff 60" }} />);
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.focus(screen.getByRole("button", { name: "90–100: 3" }));
    expect(screen.getByRole("tooltip")).toHaveTextContent("390–100");
    fireEvent.pointerLeave(screen.getByRole("button", { name: "90–100: 3" }));
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(screen.getByText("Cutoff 60")).toBeInTheDocument();
  });

  it("every chart card can switch to a table", () => {
    render(
      <ChartCard title="Funnel" table={{ columns: ["Stage", "Reached"], rows: [["screening", 10]] }}>
        <div>chart</div>
      </ChartCard>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Show table" }));
    expect(screen.getByRole("columnheader", { name: "Reached" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "10" })).toBeInTheDocument();
    expect(screen.queryByText("chart")).toBeNull();
  });

  it("meter reports its value", () => {
    render(<Meter value={2} max={3} label="Stages reached" />);
    expect(screen.getByRole("meter", { name: "Stages reached" })).toHaveAttribute("aria-valuenow", "2");
  });
});
