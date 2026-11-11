import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CompleteCampaignDialog, FeedbackEditor, type FeedbackValue } from "../src/blocks/report";

const VALUE: FeedbackValue = {
  ai_draft: "Thank you for applying. Your Python work stood out.",
  ai_recommendation: "yes",
  edited_text: null,
  recommendation: null,
  manager_note: null,
  excluded: false,
};

describe("FeedbackEditor", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("starts from the AI draft and autosaves only after typing stops", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<FeedbackEditor value={VALUE} onSave={onSave} />);
    const box = screen.getByLabelText("Feedback the candidate will see");
    expect(box).toHaveValue(VALUE.ai_draft);
    expect(screen.getByText("AI draft")).toBeInTheDocument();

    fireEvent.change(box, { target: { value: "Edited once" } });
    fireEvent.change(box, { target: { value: "Edited twice" } });
    await act(async () => vi.advanceTimersByTime(900));
    expect(onSave).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(200));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({ edited_text: "Edited twice" });
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  it("saves the exclude switch at once and shows a failed save", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("offline"));
    render(<FeedbackEditor value={VALUE} onSave={onSave} />);
    await act(async () => fireEvent.click(screen.getByRole("switch", { name: "Exclude from the final list" })));
    expect(onSave).toHaveBeenCalledWith({ excluded: true });
    expect(screen.getByText(/Not saved/)).toBeInTheDocument();
  });
});

describe("CompleteCampaignDialog", () => {
  it("states the consequences and only completes once the job title is typed", () => {
    const onConfirm = vi.fn();
    render(
      <CompleteCampaignDialog
        open
        onOpenChange={vi.fn()}
        jobTitle="Platform Engineer"
        total={12}
        unedited={3}
        inProgress={1}
        notifyDefault
        pending={false}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByText(/cannot be undone/)).toBeInTheDocument();
    expect(screen.getByText(/released to all 12 candidates/)).toBeInTheDocument();
    expect(screen.getByText(/3 still have an unedited AI draft/)).toBeInTheDocument();
    const go = screen.getByRole("button", { name: /Complete and release/ });
    expect(go).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/to confirm/), { target: { value: "platform engineer " } });
    fireEvent.click(screen.getByRole("switch", { name: /Notify candidates/ }));
    fireEvent.click(go);
    expect(onConfirm).toHaveBeenCalledWith({ confirm_title: "platform engineer ", notify: false });
  });
});
