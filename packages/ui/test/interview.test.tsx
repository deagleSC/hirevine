import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InterviewChat, InterviewScores, TranscriptView, type InterviewChatProps } from "../src/blocks/interview";

const NOW = "2026-11-11T10:00:00.000Z";
const plus = (s: number) => new Date(Date.parse(NOW) + s * 1000).toISOString();
const T = [
  { role: "interviewer" as const, content: "Tell me about an API you designed." },
  { role: "candidate" as const, content: "A FastAPI ledger." },
  { role: "interviewer" as const, content: "How did you test it?" },
];

function chat(over: Partial<InterviewChatProps> = {}) {
  const props: InterviewChatProps = {
    transcript: T, streaming: null, turnCap: 6, questionsAsked: 2, awaiting: "answer", deadlineAt: plus(600),
    serverNow: NOW, paused: false, busy: false, error: null, onSend: vi.fn(), onRetry: vi.fn(), onFinish: vi.fn(),
    onExpire: vi.fn(), ...over,
  };
  return { props, ...render(<InterviewChat {...props} />) };
}

describe("InterviewChat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
  });
  afterEach(() => vi.useRealTimers());

  it("restores a resumed transcript with the turn counter and time left", () => {
    chat();
    expect(screen.getByText("Question 2 of 6")).toBeInTheDocument();
    expect(screen.getByText("A FastAPI ledger.")).toBeInTheDocument();
    expect(screen.getByRole("timer")).toHaveTextContent("10:00");
  });

  it("sends a trimmed answer, counts characters, and blocks sending while a reply streams", () => {
    const { props, rerender } = chat();
    const box = screen.getByLabelText("Your answer");
    expect(screen.getByRole("button", { name: /Send answer/ })).toBeDisabled();
    fireEvent.change(box, { target: { value: "  Pytest with Postgres.  " } });
    expect(screen.getByText("25 / 2000")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Send answer/ }));
    expect(props.onSend).toHaveBeenCalledWith("Pytest with Postgres.");

    rerender(<InterviewChat {...props} busy awaiting="question" streaming="What would you" />);
    expect(screen.getByLabelText("Your answer")).toBeDisabled();
    expect(screen.getByRole("button", { name: /Send answer/ })).toBeDisabled();
    expect(screen.getByText("What would you").closest("[aria-live]")).toHaveAttribute("aria-live", "polite");
  });

  it("offers a retry when the answer is saved but the next question failed", () => {
    const { props } = chat({ awaiting: "question", error: { message: "The interviewer is busy.", canRetry: true } });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(props.onRetry).toHaveBeenCalled();
  });

  it("calls onExpire once at the deadline, but not while paused", async () => {
    const { props } = chat({ deadlineAt: plus(2) });
    await act(async () => vi.advanceTimersByTime(3_000));
    await act(async () => vi.advanceTimersByTime(3_000));
    expect(props.onExpire).toHaveBeenCalledTimes(1);

    const paused = chat({ deadlineAt: plus(-5), paused: true });
    await act(async () => vi.advanceTimersByTime(2_000));
    expect(paused.props.onExpire).not.toHaveBeenCalled();
    expect(screen.getByText(/the clock is stopped/)).toBeInTheDocument();
  });
});

describe("InterviewChat voice answers", () => {
  class FakeRecorder {
    static isTypeSupported = (t: string) => t === "audio/webm;codecs=opus";
    state = "inactive";
    mimeType: string;
    ondataavailable: ((e: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    constructor(
      public stream: { getTracks: () => { stop: () => void }[] },
      opts?: { mimeType?: string },
    ) {
      this.mimeType = opts?.mimeType ?? "";
    }
    start() {
      this.state = "recording";
      // Audio starts arriving shortly after start, as in a real browser.
      setTimeout(() => this.ondataavailable?.({ data: new Blob(["head"], { type: "audio/webm" }) }), 0);
    }
    stop() {
      this.state = "inactive";
      this.ondataavailable?.({ data: new Blob(["voice"], { type: "audio/webm" }) });
      this.onstop?.();
    }
  }
  const trackStop = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("MediaRecorder", FakeRecorder);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: trackStop }] }) },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("records one take, sends it as webm, releases the mic and stops the question audio", async () => {
    const onSendAudio = vi.fn();
    const onStopSpeaking = vi.fn();
    chat({ answerMode: "voice", onSendAudio, onStopSpeaking, onReplay: vi.fn() });
    expect(screen.queryByLabelText("Your answer")).not.toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Record answer/ })));
    // "Recording" is only shown once the microphone delivers audio.
    expect(await screen.findByText(/^Recording…/)).toBeInTheDocument();
    expect(onStopSpeaking).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Finish interview/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Stop and send/ }));
    expect(onSendAudio).toHaveBeenCalledTimes(1);
    const blob = onSendAudio.mock.calls[0]![0] as Blob;
    expect(blob.type).toBe("audio/webm");
    expect(trackStop).toHaveBeenCalled();
  });

  it("is a call: the question is the caption, the transcript panel collapses, and the AI's state shows", async () => {
    const { props, rerender } = chat({ answerMode: "voice", onSendAudio: vi.fn(), speaking: true, onReplay: vi.fn() });
    const call = screen.getByRole("region", { name: "Interview call" });
    expect(within(call).getByText("How did you test it?")).toBeInTheDocument();
    expect(within(call).getByText("Speaking…")).toBeInTheDocument();
    const panel = screen.getByRole("complementary", { name: "Transcript" });
    expect(within(panel).getByText("A FastAPI ledger.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Collapse transcript" }));
    expect(screen.queryByRole("complementary", { name: "Transcript" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show transcript" }));
    expect(screen.getByRole("complementary", { name: "Transcript" })).toBeInTheDocument();

    // While the next question streams, it is the caption and is not yet in the transcript.
    rerender(<InterviewChat {...props} answerMode="voice" speaking={false} busy awaiting="question" streaming="What would you" />);
    expect(within(call).getByText("What would you")).toBeInTheDocument();
    expect(within(screen.getByRole("complementary", { name: "Transcript" })).queryByText("What would you")).not.toBeInTheDocument();
    expect(within(call).getByText("Asking…")).toBeInTheDocument();
  });

  it("explains a blocked microphone and shows transcription progress", async () => {
    (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockRejectedValue(new DOMException("no", "NotAllowedError"));
    const { props, rerender } = chat({ answerMode: "voice", onSendAudio: vi.fn() });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Record answer/ })));
    expect(screen.getByText(/Microphone access is blocked/)).toBeInTheDocument();
    rerender(<InterviewChat {...props} answerMode="voice" busy transcribing awaiting="question" />);
    expect(screen.getByText("Transcribing your answer…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Record answer/ })).toBeDisabled();
  });
});

describe("manager views", () => {
  it("numbers turns, marks cited ones, and selects a turn from a score's citation", () => {
    const onSelectTurn = vi.fn();
    render(
      <InterviewScores
        items={[
          { item_id: "r1", name: "API design", weight: 3, score: 3, rationale: "Clear.", turns: [2], verified: true },
          { item_id: "r2", name: "Testing", weight: 1, score: 0, rationale: "None.", turns: [], verified: false },
        ]}
        onSelectTurn={onSelectTurn}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "T2" }));
    expect(onSelectTurn).toHaveBeenCalledWith(2);
    expect(screen.getByText("No supporting answer")).toBeInTheDocument();

    const { container } = render(<TranscriptView turns={T.map((t, i) => ({ ...t, n: i + 1 }))} cited={new Set([2])} activeTurn={2} />);
    const active = container.querySelector('[data-turn="2"]');
    expect(active).toHaveAttribute("data-active", "true");
    expect(active?.className).toContain("bg-amber-500/10");
  });
});
