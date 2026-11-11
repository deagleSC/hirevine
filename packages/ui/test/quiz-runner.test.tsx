import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QuizResults, QuizRunner, formatRemaining } from "../src/blocks/quiz-runner";

const QUESTIONS = [
  { id: "q1", prompt: "What does an index speed up?", options: ["Reads", "Writes", "Backups"] },
  { id: "q2", prompt: "Which isolation level is the default in Postgres?", options: ["Serializable", "Read committed", "Repeatable read"] },
];
const NOW = "2026-11-11T10:00:00.000Z";
const plus = (s: number) => new Date(Date.parse(NOW) + s * 1000).toISOString();

describe("QuizRunner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
  });
  afterEach(() => vi.useRealTimers());

  it("resumes from saved answers and autosaves only what changed", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <QuizRunner questions={QUESTIONS} initialAnswers={{ q1: 0 }} deadlineAt={plus(600)} serverNow={NOW}
        onSave={onSave} onSubmit={vi.fn()} />,
    );
    // A reloaded page shows the saved choice and the remaining time.
    expect(screen.getByRole("radio", { name: "Reads" })).toBeChecked();
    expect(screen.getByText("1 of 2 answered")).toBeInTheDocument();
    expect(screen.getByRole("timer")).toHaveTextContent("10:00");

    fireEvent.click(screen.getByRole("radio", { name: "Read committed" }));
    fireEvent.click(screen.getByRole("radio", { name: "Serializable" }));
    expect(onSave).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(700));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({ q2: 0 });
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  it("corrects for clock skew and auto-submits once at the deadline, after flushing", async () => {
    const order: string[] = [];
    const onSave = vi.fn(async () => void order.push("save"));
    const onSubmit = vi.fn(async (auto: boolean) => void order.push(`submit:${auto}`));
    // The server is 30 s ahead of this browser: 90 s left by its clock, not 120 s.
    render(
      <QuizRunner questions={QUESTIONS} initialAnswers={{}} deadlineAt={plus(120)} serverNow={plus(30)}
        onSave={onSave} onSubmit={onSubmit} saveDelayMs={5000} />,
    );
    expect(screen.getByRole("timer")).toHaveTextContent("1:30");
    fireEvent.click(screen.getByRole("radio", { name: "Reads" }));
    await act(async () => vi.advanceTimersByTime(89_000));
    expect(screen.getByRole("timer")).toHaveTextContent("0:01");
    expect(onSubmit).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(2_000));
    expect(order).toEqual(["save", "submit:true"]);
    await act(async () => vi.advanceTimersByTime(5_000));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("asks before a manual submit and names unanswered questions", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <QuizRunner questions={QUESTIONS} initialAnswers={{ q1: 1 }} deadlineAt={plus(600)} serverNow={NOW}
        onSave={vi.fn()} onSubmit={onSubmit} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Submit answers" }));
    expect(screen.getByText(/1 question is unanswered/)).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Submit" })));
    expect(onSubmit).toHaveBeenCalledWith(false);
  });

  it("formats the remaining time", () => {
    expect(formatRemaining(0)).toBe("0:00");
    expect(formatRemaining(-5)).toBe("0:00");
    expect(formatRemaining(61_001)).toBe("1:02");
  });
});

describe("QuizResults", () => {
  it("marks the chosen and correct options", () => {
    render(<QuizResults items={[
      { question_id: "q1", prompt: "P1", options: ["a", "b", "c"], chosen: 2, answer_index: 1, correct: false, explanation: "Because b." },
      { question_id: "q2", prompt: "P2", options: ["a", "b", "c"], chosen: null, answer_index: 0, correct: false, explanation: "" },
    ]} />);
    expect(screen.getByText("Incorrect")).toBeInTheDocument();
    expect(screen.getByText("Unanswered")).toBeInTheDocument();
    expect(screen.getByText("Because b.")).toBeInTheDocument();
  });
});
