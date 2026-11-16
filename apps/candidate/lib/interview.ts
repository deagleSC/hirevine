"use client";

import { ApiError, qk, readSSE, unwrap, type components } from "@hirevine/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "./api";
import { env } from "./env";
import { supabase } from "./supabase";

export type InterviewState = components["schemas"]["InterviewState"];

type TurnEvent =
  | { type: "answer"; text: string }
  | { type: "token"; text: string }
  | { type: "error"; code: string; message: string; retry_after?: number }
  | { type: "done"; state: InterviewState };

const forApp = (appId: string) => ({ params: { path: { application_id: appId } } });

export function useInterview(appId: string) {
  return useQuery({
    queryKey: qk.myInterview(appId),
    queryFn: () => unwrap(api.GET("/v1/candidate/applications/{application_id}/interview", forApp(appId))),
    // The session on the server is the source of truth: always reload it after a refresh.
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
}

export function useInterviewActions(appId: string) {
  const qc = useQueryClient();
  const set = (s: InterviewState) => qc.setQueryData(qk.myInterview(appId), s);
  const start = useMutation({
    mutationFn: () => unwrap(api.POST("/v1/candidate/applications/{application_id}/interview/start", forApp(appId))),
    onSuccess: set,
  });
  const finish = useMutation({
    mutationFn: () => unwrap(api.POST("/v1/candidate/applications/{application_id}/interview/finish", forApp(appId))),
    onSuccess: (s) => {
      set(s);
      void qc.invalidateQueries({ queryKey: qk.myApplications() });
    },
  });
  return { start, finish };
}

/**
 * One streamed turn at a time: send an answer (or nothing, to ask for the current question), show
 * the question as it streams, then replace the cached state with the server's. Aborted on unmount.
 */
export function useInterviewTurn(appId: string) {
  const qc = useQueryClient();
  const [streaming, setStreaming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<{ message: string; canRetry: boolean } | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const send = useCallback(
    async (turn: number, message?: string, audio?: Blob) => {
      if (abort.current) return;
      const ctrl = new AbortController();
      abort.current = ctrl;
      setBusy(true);
      setError(null);
      // Show the answer straight away; the server's state replaces this when the turn is done.
      const showAnswer = (content: string) =>
        qc.setQueryData<InterviewState>(qk.myInterview(appId), (s) =>
          s ? { ...s, awaiting: "question", transcript: [...(s.transcript ?? []), { role: "candidate", content }] } : s,
        );
      if (audio) setTranscribing(true);
      else {
        setStreaming("");
        if (message !== undefined) showAnswer(message);
      }
      try {
        const token = (await supabase().auth.getSession()).data.session?.access_token;
        const auth: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
        const base = `${env.apiUrl}/v1/candidate/applications/${appId}/interview`;
        const res = audio
          ? await fetch(`${base}/turn-voice?turn=${turn}`, {
              method: "POST",
              headers: { "Content-Type": audio.type || "audio/webm", ...auth },
              body: audio,
              signal: ctrl.signal,
            })
          : await fetch(`${base}/turn`, {
              method: "POST",
              headers: { "Content-Type": "application/json", ...auth },
              body: JSON.stringify({ turn, message: message ?? null }),
              signal: ctrl.signal,
            });
        await readSSE<TurnEvent>(res, (e) => {
          if (e.type === "answer") {
            setTranscribing(false);
            setStreaming("");
            showAnswer(e.text);
          } else if (e.type === "token") setStreaming((t) => (t ?? "") + e.text);
          else if (e.type === "error") setError({ message: e.message, canRetry: true });
          else qc.setQueryData(qk.myInterview(appId), e.state);
        });
      } catch (e) {
        if (ctrl.signal.aborted) return;
        if (e instanceof ApiError && audio && e.code !== "stale_turn" && !e.code.startsWith("interview_")) {
          // The recording was refused before anything was saved: the question is still open.
          setError({ message: e.message, canRetry: false });
        } else if (e instanceof ApiError && ["stale_turn", "interview_finished", "interview_closed"].includes(e.code)) {
          setError(e.code === "stale_turn" ? { message: e.message, canRetry: false } : null);
        } else {
          setError({ message: e instanceof ApiError ? e.message : "Connection lost. Your saved answers are safe.", canRetry: true });
        }
        await qc.invalidateQueries({ queryKey: qk.myInterview(appId) });
      } finally {
        if (abort.current === ctrl) abort.current = null;
        setStreaming(null);
        setTranscribing(false);
        setBusy(false);
      }
    },
    [appId, qc],
  );

  const sendAudio = useCallback((turn: number, audio: Blob) => send(turn, undefined, audio), [send]);
  return { send, sendAudio, streaming, busy, transcribing, error };
}

/**
 * Reads the open question aloud (server TTS). `play` is called once per new question; failures are
 * silent because the question is always on screen too. Each question has its own URL
 * (`?question=N`), so the browser's HTTP cache can never hand back an earlier question's audio.
 */
export function useQuestionAudio(appId: string) {
  const [speaking, setSpeaking] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const cache = useRef(new Map<number, string>());
  const seq = useRef(0);

  const stop = useCallback(() => {
    seq.current++;
    audio.current?.pause();
    audio.current = null;
    setSpeaking(false);
  }, []);

  useEffect(
    () => () => {
      stop();
      cache.current.forEach((u) => URL.revokeObjectURL(u));
    },
    [stop],
  );

  const play = useCallback(
    async (question: number) => {
      stop();
      const mine = ++seq.current;
      setSpeaking(true);
      try {
        let url = cache.current.get(question);
        if (!url) {
          const token = (await supabase().auth.getSession()).data.session?.access_token;
          const res = await fetch(`${env.apiUrl}/v1/candidate/applications/${appId}/interview/speech?question=${question}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          if (!res.ok) throw new Error(`speech ${res.status}`);
          url = URL.createObjectURL(await res.blob());
          cache.current.set(question, url);
        }
        if (mine !== seq.current) return;
        const el = new Audio(url);
        audio.current = el;
        el.onended = el.onerror = () => {
          if (audio.current === el) {
            audio.current = null;
            setSpeaking(false);
          }
        };
        await el.play();
      } catch {
        if (mine === seq.current) setSpeaking(false);
      }
    },
    [appId, stop],
  );

  return { play, stop, speaking };
}
