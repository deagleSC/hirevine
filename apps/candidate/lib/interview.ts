"use client";

import { ApiError, qk, readSSE, unwrap, type components } from "@hirevine/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "./api";
import { env } from "./env";
import { supabase } from "./supabase";

export type InterviewState = components["schemas"]["InterviewState"];

type TurnEvent =
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
  const [error, setError] = useState<{ message: string; canRetry: boolean } | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const send = useCallback(
    async (turn: number, message?: string) => {
      if (abort.current) return;
      const ctrl = new AbortController();
      abort.current = ctrl;
      setBusy(true);
      setError(null);
      setStreaming("");
      if (message !== undefined) {
        // Show the answer straight away; the server's state replaces this when the turn is done.
        qc.setQueryData<InterviewState>(qk.myInterview(appId), (s) =>
          s ? { ...s, awaiting: "question", transcript: [...(s.transcript ?? []), { role: "candidate", content: message }] } : s,
        );
      }
      try {
        const token = (await supabase().auth.getSession()).data.session?.access_token;
        const res = await fetch(`${env.apiUrl}/v1/candidate/applications/${appId}/interview/turn`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ turn, message: message ?? null }),
          signal: ctrl.signal,
        });
        await readSSE<TurnEvent>(res, (e) => {
          if (e.type === "token") setStreaming((t) => (t ?? "") + e.text);
          else if (e.type === "error") setError({ message: e.message, canRetry: true });
          else qc.setQueryData(qk.myInterview(appId), e.state);
        });
      } catch (e) {
        if (ctrl.signal.aborted) return;
        if (e instanceof ApiError && ["stale_turn", "interview_finished", "interview_closed"].includes(e.code)) {
          setError(e.code === "stale_turn" ? { message: e.message, canRetry: false } : null);
        } else {
          setError({ message: e instanceof ApiError ? e.message : "Connection lost. Your saved answers are safe.", canRetry: true });
        }
        await qc.invalidateQueries({ queryKey: qk.myInterview(appId) });
      } finally {
        if (abort.current === ctrl) abort.current = null;
        setStreaming(null);
        setBusy(false);
      }
    },
    [appId, qc],
  );

  return { send, streaming, busy, error };
}
