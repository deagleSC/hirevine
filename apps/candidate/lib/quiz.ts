"use client";

import { ApiError, qk, unwrap, type components } from "@hirevine/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "./api";

export type QuizState = components["schemas"]["QuizState"];

const forApp = (appId: string) => ({ params: { path: { application_id: appId } } });

export function useQuiz(appId: string) {
  return useQuery({
    queryKey: qk.myQuiz(appId),
    queryFn: () => unwrap(api.GET("/v1/candidate/applications/{application_id}/quiz", forApp(appId))),
    // The attempt is the source of truth: never show a stale cached copy after a reload.
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
}

export function useQuizActions(appId: string) {
  const qc = useQueryClient();
  const set = (s: QuizState) => qc.setQueryData(qk.myQuiz(appId), s);
  const start = useMutation({
    mutationFn: () => unwrap(api.POST("/v1/candidate/applications/{application_id}/quiz/start", forApp(appId))),
    onSuccess: set,
  });
  const submit = useMutation({
    // The server's deadline job may have submitted first; then reading the state is the answer.
    mutationFn: () =>
      unwrap(api.POST("/v1/candidate/applications/{application_id}/quiz/submit", forApp(appId))).catch((e: unknown) => {
        if (e instanceof ApiError && e.code === "quiz_submitted") {
          return unwrap(api.GET("/v1/candidate/applications/{application_id}/quiz", forApp(appId)));
        }
        throw e;
      }),
    onSuccess: (s) => {
      set(s);
      void qc.invalidateQueries({ queryKey: qk.myApplications() });
    },
  });
  const save = (answers: Record<string, number>) =>
    unwrap(api.PUT("/v1/candidate/applications/{application_id}/quiz/answers", { ...forApp(appId), body: { answers } })).then(
      () => undefined,
    );
  return { start, submit, save };
}
