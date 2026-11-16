"use client";

import {
  Bot,
  Clock,
  Loader2,
  MessageSquareText,
  Mic as MicIcon,
  MicOff,
  PanelRightClose,
  PauseCircle,
  PhoneOff,
  Quote,
  Send,
  Square,
  User,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Alert, AlertDescription } from "@hirevine/ui/components/alert";
import { Button } from "@hirevine/ui/components/button";
import { Textarea } from "@hirevine/ui/components/textarea";
import { formatRemaining } from "@hirevine/ui/blocks/quiz-runner";
import { cn } from "@hirevine/ui/lib/utils";

export const MAX_ANSWER_CHARS = 2000;
/** Longest wait for the microphone's first audio before recording is shown as started anyway. */
const WARMUP_LIMIT_MS = 3000;
/** A spoken answer stops (and is sent) after this long. */
export const MAX_ANSWER_SECONDS = 180;

export interface ChatEntry {
  role: "interviewer" | "candidate";
  content: string;
}

export interface InterviewChatProps {
  transcript: ChatEntry[];
  /** The question streaming in right now, or null. */
  streaming: string | null;
  turnCap: number;
  questionsAsked: number;
  awaiting: "question" | "answer" | null;
  deadlineAt: string;
  serverNow: string;
  paused: boolean;
  /** A turn request is in flight (sending, or streaming the next question). */
  busy: boolean;
  /** The last turn's problem, shown above the answer box, with a retry when the answer is saved. */
  error?: { message: string; canRetry: boolean } | null;
  onSend: (message: string) => void;
  /** "voice": answers are recorded and sent with onSendAudio, and cannot be edited. */
  answerMode?: "voice" | "text";
  onSendAudio?: (audio: Blob) => void;
  /** The recorded answer is being transcribed (before the next question streams). */
  transcribing?: boolean;
  /** The question is being read aloud. */
  speaking?: boolean;
  onReplay?: () => void;
  onStopSpeaking?: () => void;
  onRetry: () => void;
  onFinish: () => void;
  /** Called once when the countdown reaches zero (the server closes the interview). */
  onExpire?: () => void;
}

/** Server-clock countdown; calls onExpire once at zero unless paused. */
function useCountdown(deadlineAt: string, serverNow: string, paused: boolean, onExpire?: () => void) {
  const skew = useMemo(() => Date.parse(serverNow) - Date.now(), [serverNow]);
  const [now, setNow] = useState(() => Date.now() + skew);
  const remaining = Date.parse(deadlineAt) - now;
  const expired = useRef(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() + skew), 1000);
    return () => clearInterval(id);
  }, [skew]);

  useEffect(() => {
    if (!paused && remaining <= 0 && !expired.current) {
      expired.current = true;
      onExpire?.();
    }
  }, [paused, remaining, onExpire]);

  return remaining;
}

function Clockface({ paused, remaining, className }: { paused: boolean; remaining: number; className?: string }) {
  if (paused) {
    return (
      <span className={cn("flex items-center gap-2 text-sm", className)}>
        <PauseCircle className="size-4" aria-hidden /> Paused — the clock is stopped
      </span>
    );
  }
  return (
    <div
      role="timer"
      aria-live="off"
      aria-label={`Time left ${formatRemaining(remaining)}`}
      className={cn("flex items-center gap-2 font-mono text-lg tabular-nums", remaining < 60_000 && "text-destructive", className)}
    >
      <Clock className="size-4" aria-hidden />
      {formatRemaining(remaining)}
    </div>
  );
}

function ErrorBanner({ error, busy, onRetry }: { error: InterviewChatProps["error"]; busy: boolean; onRetry: () => void }) {
  if (!error) return null;
  return (
    <Alert variant="destructive">
      <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
        <span>{error.message}</span>
        {error.canRetry ? (
          <Button size="sm" variant="outline" onClick={onRetry} disabled={busy}>
            Try again
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

/**
 * The candidate's AI interview (frontend plan §8.5). In voice mode it is a call with the AI
 * interviewer (see InterviewCall); in text mode, a chat: the transcript, the question streaming in
 * (announced politely to screen readers), a turn counter, the countdown, and one answer box.
 */
export function InterviewChat(props: InterviewChatProps) {
  if (props.answerMode === "voice") return <InterviewCall {...props} />;
  return <TextInterview {...props} />;
}

function TextInterview({
  transcript,
  streaming,
  turnCap,
  questionsAsked,
  awaiting,
  deadlineAt,
  serverNow,
  paused,
  busy,
  error,
  onSend,
  onRetry,
  onFinish,
  onExpire,
}: InterviewChatProps) {
  const [draft, setDraft] = useState("");
  const remaining = useCountdown(deadlineAt, serverNow, paused, onExpire);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
  }, [transcript.length, streaming]);

  const canSend = awaiting === "answer" && !busy && draft.trim().length > 0 && (paused || remaining > 0);
  const send = () => {
    if (!canSend) return;
    onSend(draft.trim());
    setDraft("");
  };
  const current = Math.min(Math.max(questionsAsked, 1), turnCap);

  return (
    <div className="flex flex-col gap-4">
      <div className="sticky top-0 z-10 -mx-4 flex flex-wrap items-center justify-between gap-3 border-b bg-background/95 px-4 py-3 backdrop-blur">
        <span className="text-sm font-medium">
          Question {current} of {turnCap}
        </span>
        <Clockface paused={paused} remaining={remaining} className={paused ? "text-muted-foreground" : undefined} />
      </div>

      <ol className="flex flex-col gap-3" aria-label="Interview transcript">
        {transcript.map((e, i) => (
          <Bubble key={i} entry={e} />
        ))}
        {streaming !== null ? (
          <li aria-live="polite" aria-busy={busy}>
            <Bubble entry={{ role: "interviewer", content: streaming }} pending as="div" />
          </li>
        ) : null}
      </ol>
      <div ref={end} />

      <ErrorBanner error={error} busy={busy} onRetry={onRetry} />

      <div className="grid gap-2">
        <label htmlFor="interview-answer" className="text-sm font-medium">
          Your answer
        </label>
        <Textarea
          id="interview-answer"
          value={draft}
          maxLength={MAX_ANSWER_CHARS}
          rows={5}
          disabled={awaiting !== "answer" || busy}
          placeholder={awaiting === "answer" ? "Type your answer…" : "Waiting for the next question…"}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground tabular-nums">
            {draft.length} / {MAX_ANSWER_CHARS}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onFinish} disabled={busy}>
              Finish interview
            </Button>
            <Button onClick={send} disabled={!canSend}>
              {busy ? <Loader2 className="animate-spin" /> : <Send />}
              Send answer
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ voice: the call

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((t) =>
    MediaRecorder.isTypeSupported?.(t),
  );
}

/**
 * Records one spoken answer and hands it over as is: one take per question, no editing. Recording
 * stops and sends at MAX_ANSWER_SECONDS. `level` (0–1) is the microphone's loudness while recording.
 */
function useAnswerRecorder(onSendAudio: (audio: Blob) => void, onStarted?: () => void) {
  const [recording, setRecording] = useState(false);
  const [starting, setStarting] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [micError, setMicError] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const meter = useRef<{ ctx: AudioContext; id: ReturnType<typeof setInterval> } | null>(null);
  const sendRef = useRef(onSendAudio);
  sendRef.current = onSendAudio;

  const stopMeter = useCallback(() => {
    if (!meter.current) return;
    clearInterval(meter.current.id);
    void meter.current.ctx.close().catch(() => undefined);
    meter.current = null;
    setLevel(0);
  }, []);

  const stop = useCallback(() => {
    if (rec.current?.state === "recording") rec.current.stop();
  }, []);

  useEffect(() => {
    if (!recording) return;
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 250);
    return () => clearInterval(id);
  }, [recording]);

  useEffect(() => {
    if (recording && elapsed >= MAX_ANSWER_SECONDS) stop();
  }, [recording, elapsed, stop]);

  // Unmount mid-answer: release the microphone without sending.
  useEffect(
    () => () => {
      const r = rec.current;
      rec.current = null;
      if (r) {
        r.ondataavailable = null;
        r.onstop = null;
        if (r.state === "recording") r.stop();
        r.stream.getTracks().forEach((t) => t.stop());
      }
      stopMeter();
    },
    [stopMeter],
  );

  const startMeter = (stream: MediaStream) => {
    if (typeof AudioContext === "undefined") return;
    try {
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      const id = setInterval(() => {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += v * v;
        setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 6));
      }, 100);
      meter.current = { ctx, id };
    } catch {
      // The meter is decoration; recording works without it.
    }
  };

  const start = async () => {
    setMicError(null);
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setMicError("This browser cannot record audio. Use a recent Chrome, Edge, Firefox or Safari.");
      return;
    }
    setStarting(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      onStarted?.();
      const mimeType = pickMimeType();
      const r = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks: Blob[] = [];
      // Some engines (WebKit) drop the first second or so of audio while the microphone warms up, so
      // the candidate is only told to speak once audio is actually arriving.
      let ready: () => void = () => undefined;
      const flowing = new Promise<void>((res) => (ready = res));
      r.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
        ready();
      };
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        stopMeter();
        rec.current = null;
        setRecording(false);
        sendRef.current(new Blob(chunks, { type: (r.mimeType || mimeType || "audio/webm").split(";")[0] }));
      };
      rec.current = r;
      r.start(250);
      await Promise.race([flowing, new Promise((res) => setTimeout(res, WARMUP_LIMIT_MS))]);
      if (rec.current !== r) return; // unmounted while warming up
      startMeter(stream);
      setElapsed(0);
      setRecording(true);
    } catch (e) {
      const denied = e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError");
      setMicError(
        denied
          ? "Microphone access is blocked. Allow it in your browser's site settings, then try again."
          : "No microphone was found. Connect one and try again.",
      );
    } finally {
      setStarting(false);
    }
  };

  return { recording, starting, elapsed, level, micError, start, stop };
}

/** A round call-control button with its label underneath. */
function CallControl({
  label,
  onClick,
  disabled,
  tone = "default",
  pressed,
  large,
  children,
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  tone?: "default" | "primary" | "danger" | "recording";
  pressed?: boolean;
  large?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        aria-pressed={pressed}
        className={cn(
          "flex items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950 disabled:cursor-not-allowed disabled:opacity-40 [&_svg]:size-5",
          large ? "size-16 [&_svg]:size-6" : "size-12",
          tone === "default" && "bg-white/10 text-white hover:bg-white/20",
          tone === "primary" && "bg-primary text-primary-foreground hover:bg-primary/90",
          tone === "danger" && "bg-red-600 text-white hover:bg-red-500",
          tone === "recording" && "bg-red-600 text-white ring-4 ring-red-600/30 hover:bg-red-500",
        )}
      >
        {children}
      </button>
      <span aria-hidden className="max-w-24 text-center text-[11px] leading-tight text-neutral-400">
        {label}
      </span>
    </div>
  );
}

/** The microphone's loudness as five bars. */
function LevelBars({ level, active }: { level: number; active: boolean }) {
  return (
    <span className="flex h-4 items-end gap-0.5" aria-hidden>
      {[0.2, 0.45, 0.7, 0.45, 0.2].map((w, i) => (
        <span
          key={i}
          className={cn("w-1 rounded-full transition-[height] duration-100", active ? "bg-emerald-400" : "bg-neutral-600")}
          style={{ height: `${Math.max(18, Math.min(100, (active ? level / w : 0) * 100))}%` }}
        />
      ))}
    </span>
  );
}

/**
 * The voice interview as a call with the AI interviewer: a stage with the interviewer (rings while
 * it speaks), the current question as a caption, the candidate's own tile with a microphone meter,
 * and call controls. The transcript sits in a collapsible panel on the right (below on small screens).
 */
export function InterviewCall({
  transcript,
  streaming,
  turnCap,
  questionsAsked,
  awaiting,
  deadlineAt,
  serverNow,
  paused,
  busy,
  error,
  onSendAudio,
  transcribing = false,
  speaking = false,
  onReplay,
  onStopSpeaking,
  onRetry,
  onFinish,
  onExpire,
}: InterviewChatProps) {
  const remaining = useCountdown(deadlineAt, serverNow, paused, onExpire);
  const [showTranscript, setShowTranscript] = useState(true);
  const mic = useAnswerRecorder((a) => onSendAudio?.(a), onStopSpeaking);
  const end = useRef<HTMLLIElement>(null);
  const canAnswer = awaiting === "answer" && !busy && (paused || remaining > 0);
  const current = Math.min(Math.max(questionsAsked, 1), turnCap);
  const lastQuestion = [...transcript].reverse().find((e) => e.role === "interviewer")?.content ?? "";
  const caption = streaming !== null ? streaming : awaiting === "answer" ? lastQuestion : "";

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "nearest" });
  }, [transcript.length, showTranscript]);

  const aiState = speaking
    ? "Speaking…"
    : streaming !== null
      ? "Asking…"
      : transcribing || busy
        ? "Thinking…"
        : awaiting === "answer"
          ? "Listening"
          : "Connecting…";
  const left = MAX_ANSWER_SECONDS - mic.elapsed;
  const status = mic.starting
    ? "Getting the microphone ready…"
    : mic.recording
      ? `Recording… ${formatRemaining(mic.elapsed * 1000)} (stops at ${formatRemaining(MAX_ANSWER_SECONDS * 1000)})`
      : transcribing
        ? "Transcribing your answer…"
        : busy
          ? "Waiting for the next question…"
          : speaking
            ? "The interviewer is speaking…"
            : canAnswer
              ? "Press Record when you are ready. You get one take per question."
              : "Waiting for the next question…";

  return (
    <div className={cn("grid gap-4", showTranscript && "lg:grid-cols-[minmax(0,1fr)_20rem]")}>
      <section
        aria-label="Interview call"
        className="flex min-h-[32rem] flex-col overflow-hidden rounded-2xl bg-neutral-950 text-neutral-50 shadow-sm"
      >
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div className="flex items-center gap-3 text-sm">
            <span className="flex items-center gap-1.5 rounded-full bg-red-600/90 px-2 py-0.5 text-xs font-medium">
              <span className="size-1.5 rounded-full bg-white" aria-hidden />
              Live
            </span>
            <span className="font-medium">
              Question {current} of {turnCap}
            </span>
          </div>
          <Clockface paused={paused} remaining={remaining} className={cn("text-base", paused ? "text-neutral-300" : "text-neutral-100", !paused && remaining < 60_000 && "text-red-400")} />
        </header>

        <div className="relative flex flex-1 flex-col items-center justify-center gap-6 px-6 pb-8 pt-24 sm:py-10">
          <div className="relative flex size-36 items-center justify-center">
            {speaking ? (
              <>
                <span className="absolute inset-0 animate-ping rounded-full bg-primary/25 [animation-duration:1.6s]" aria-hidden />
                <span className="absolute -inset-3 animate-pulse rounded-full border-2 border-primary/40" aria-hidden />
              </>
            ) : null}
            <span
              className={cn(
                "relative flex size-28 items-center justify-center rounded-full bg-gradient-to-br from-primary/80 to-primary/40 ring-4 transition-all",
                speaking ? "ring-primary/60" : "ring-white/10",
              )}
            >
              <Bot className="size-12 text-white" aria-hidden />
            </span>
          </div>
          <div className="text-center">
            <p className="text-sm font-medium">AI interviewer</p>
            <p className="text-xs text-neutral-400" aria-live="polite">
              {aiState}
            </p>
          </div>

          <div className="min-h-20 w-full max-w-2xl text-center" aria-live="polite" aria-busy={streaming !== null}>
            {caption ? (
              <p className="text-balance text-lg leading-relaxed text-neutral-100 sm:text-xl">{caption}</p>
            ) : transcribing || busy ? (
              <Loader2 className="mx-auto size-5 animate-spin text-neutral-400" aria-label="Preparing the next question" />
            ) : null}
          </div>

          <div className="absolute right-3 top-3 flex w-32 flex-col gap-2 rounded-xl border border-white/10 bg-neutral-900/90 p-2.5 shadow-lg sm:w-40 sm:p-3">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-xs font-medium">
                <span className="flex size-6 items-center justify-center rounded-full bg-white/10">
                  <User className="size-3.5" aria-hidden />
                </span>
                You
              </span>
              {mic.recording ? <MicIcon className="size-3.5 text-emerald-400" aria-hidden /> : <MicOff className="size-3.5 text-neutral-500" aria-hidden />}
            </div>
            <LevelBars level={mic.level} active={mic.recording} />
          </div>
        </div>

        <div className="grid gap-3 border-t border-white/10 px-4 pb-4 pt-3">
          <p className={cn("flex min-h-5 items-center justify-center gap-2 text-center text-sm", mic.recording ? "font-medium text-white" : "text-neutral-400")} aria-live="polite">
            {mic.recording ? <span className="size-2.5 animate-pulse rounded-full bg-red-500" aria-hidden /> : null}
            {transcribing || mic.starting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {status}
          </p>
          {mic.recording && left <= 15 ? <p className="text-center text-xs text-red-400">{left}s left for this answer</p> : null}
          {mic.micError ? (
            <Alert variant="destructive">
              <AlertDescription>{mic.micError}</AlertDescription>
            </Alert>
          ) : null}
          <ErrorBanner error={error} busy={busy} onRetry={onRetry} />
          <div className="flex flex-wrap items-start justify-center gap-5">
            {onReplay ? (
              <CallControl
                label={speaking ? "Stop audio" : "Replay question"}
                onClick={speaking ? onStopSpeaking : onReplay}
                disabled={!canAnswer || mic.recording}
              >
                {speaking ? <VolumeX /> : <Volume2 />}
              </CallControl>
            ) : null}
            {mic.recording ? (
              <CallControl label="Stop and send" onClick={mic.stop} tone="recording" large>
                <Square />
              </CallControl>
            ) : (
              <CallControl label="Record answer" onClick={() => void mic.start()} disabled={!canAnswer || mic.starting} tone="primary" large>
                {mic.starting || busy ? <Loader2 className="animate-spin" /> : <MicIcon />}
              </CallControl>
            )}
            <CallControl
              label={showTranscript ? "Hide transcript" : "Show transcript"}
              onClick={() => setShowTranscript((v) => !v)}
              pressed={showTranscript}
            >
              <MessageSquareText />
            </CallControl>
            <CallControl label="Finish interview" onClick={onFinish} disabled={busy || mic.recording} tone="danger">
              <PhoneOff />
            </CallControl>
          </div>
        </div>
      </section>

      {showTranscript ? (
        <aside aria-label="Transcript" className="flex max-h-[40rem] min-h-0 flex-col rounded-2xl border bg-card lg:max-h-none">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h2 className="text-sm font-medium">Transcript</h2>
            <Button size="icon" variant="ghost" className="size-7" onClick={() => setShowTranscript(false)} aria-label="Collapse transcript">
              <PanelRightClose />
            </Button>
          </div>
          <ol className="flex flex-1 flex-col gap-3 overflow-y-auto p-4 text-sm" aria-label="Interview transcript">
            {transcript.length === 0 ? <li className="text-muted-foreground">The transcript appears here as you talk.</li> : null}
            {transcript.map((e, i) => (
              <li key={i} className="grid gap-0.5">
                <span className="text-xs font-medium text-muted-foreground">{e.role === "interviewer" ? "AI interviewer" : "You"}</span>
                <span className={cn("whitespace-pre-wrap", e.role === "candidate" && "text-foreground", e.role === "interviewer" && "text-foreground/85")}>
                  {e.content}
                </span>
              </li>
            ))}
            {transcribing ? (
              <li className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" aria-hidden /> Transcribing…
              </li>
            ) : null}
            <li ref={end} aria-hidden />
          </ol>
        </aside>
      ) : null}
    </div>
  );
}

function Bubble({ entry, pending, as = "li" }: { entry: ChatEntry; pending?: boolean; as?: "li" | "div" }) {
  const ai = entry.role === "interviewer";
  const Tag = as;
  return (
    <Tag className={cn("flex gap-3", !ai && "flex-row-reverse")}>
      <span className={cn("mt-1 flex size-7 shrink-0 items-center justify-center rounded-full", ai ? "bg-primary/10" : "bg-muted")}>
        {ai ? <Bot className="size-4" aria-label="AI interviewer" /> : <User className="size-4" aria-label="You" />}
      </span>
      <p
        className={cn(
          "max-w-[85%] whitespace-pre-wrap rounded-xl px-3.5 py-2.5 text-sm",
          ai ? "bg-muted/60" : "bg-primary text-primary-foreground",
        )}
      >
        {entry.content || (pending ? <Loader2 className="size-4 animate-spin" aria-label="Writing the next question" /> : null)}
      </p>
    </Tag>
  );
}

// ------------------------------------------------------------------ manager views

export interface TranscriptTurn extends ChatEntry {
  n: number;
}

/** Numbered interview turns (frontend plan §5 `TranscriptView`); cited turns are marked. */
export function TranscriptView({
  turns,
  cited,
  activeTurn,
  onSelect,
}: {
  turns: TranscriptTurn[];
  cited?: ReadonlySet<number>;
  activeTurn?: number | null;
  onSelect?: (n: number) => void;
}) {
  const refs = useRef(new Map<number, HTMLLIElement>());
  useEffect(() => {
    if (activeTurn != null) refs.current.get(activeTurn)?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [activeTurn]);
  if (!turns.length) return <p className="text-sm text-muted-foreground">No turns yet.</p>;
  return (
    <ol className="flex flex-col gap-2 text-sm">
      {turns.map((t) => (
        <li
          key={t.n}
          ref={(el) => {
            if (el) refs.current.set(t.n, el);
          }}
          data-turn={t.n}
          data-active={activeTurn === t.n || undefined}
          className={cn(
            "grid grid-cols-[2.5rem_1fr] gap-2 rounded-md px-2 py-1.5",
            cited?.has(t.n) && "bg-amber-500/10",
            activeTurn === t.n && "ring-2 ring-primary",
          )}
        >
          <button
            type="button"
            className="h-fit text-left font-mono text-xs text-muted-foreground tabular-nums hover:underline"
            onClick={() => onSelect?.(t.n)}
            aria-label={`Turn ${t.n}`}
          >
            T{t.n}
          </button>
          <div>
            <span className="mr-1.5 text-xs font-medium text-muted-foreground">{t.role === "interviewer" ? "AI" : "Candidate"}</span>
            <span className="whitespace-pre-wrap">{t.content}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}

export interface InterviewScoreItem {
  item_id: string;
  name: string;
  weight: number;
  score: number;
  rationale: string;
  turns: number[];
  verified: boolean;
}

/** Rubric scores with turn citations; a chip selects the cited turn in the transcript. */
export function InterviewScores({
  items,
  activeTurn,
  onSelectTurn,
}: {
  items: InterviewScoreItem[];
  activeTurn?: number | null;
  onSelectTurn: (n: number) => void;
}) {
  if (!items.length) return <p className="text-sm text-muted-foreground">Not scored yet.</p>;
  return (
    <ul className="flex flex-col gap-3">
      {items.map((it) => (
        <li key={it.item_id} className="rounded-lg border p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">
              {it.name} <span className="text-xs font-normal text-muted-foreground">× {it.weight}</span>
            </span>
            <span className="text-xs tabular-nums text-muted-foreground" aria-label={`${it.score} of 4`}>
              {it.score}/4
            </span>
          </div>
          <p className="mt-1 text-muted-foreground">{it.rationale}</p>
          <div className="mt-2 flex flex-wrap gap-1">
            {it.turns.length ? (
              it.turns.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => onSelectTurn(n)}
                  aria-pressed={activeTurn === n}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-xs tabular-nums hover:bg-accent",
                    activeTurn === n && "border-primary bg-primary/10",
                  )}
                >
                  <Quote className="size-3" aria-hidden />T{n}
                </button>
              ))
            ) : (
              <span className="text-xs text-amber-700 dark:text-amber-400">No supporting answer</span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
