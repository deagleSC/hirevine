"use client";

import { qk, unwrap, type Patch, type components } from "@hirevine/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "./api";

export type Job = components["schemas"]["Job"];
export type JdChatState = components["schemas"]["JdChatState"];
export type WorkflowVersion = components["schemas"]["WorkflowVersion"];
export type VersionSummary = components["schemas"]["VersionSummary"];
export type Preview = components["schemas"]["Preview"];
export type Applied = components["schemas"]["Applied"];
export type OverrideResult = components["schemas"]["OverrideResult"];
export type Published = components["schemas"]["Published"];

const forJob = (jobId: string) => ({ params: { path: { job_id: jobId } } });

export function useJobs() {
  return useQuery({ queryKey: qk.jobs(), queryFn: () => unwrap(api.GET("/v1/manager/jobs")) });
}

export function useJob(jobId: string) {
  return useQuery({ queryKey: qk.job(jobId), queryFn: () => unwrap(api.GET("/v1/manager/jobs/{job_id}", forJob(jobId))) });
}

export function fetchWorkflow(jobId: string) {
  return unwrap(api.GET("/v1/manager/jobs/{job_id}/workflow", forJob(jobId))) as Promise<WorkflowVersion>;
}

export function useWorkflow(jobId: string) {
  return useQuery({ queryKey: qk.workflow(jobId), queryFn: () => fetchWorkflow(jobId) });
}

export function useWorkflowVersions(jobId: string, enabled: boolean) {
  return useQuery({
    queryKey: qk.workflowVersions(jobId),
    queryFn: () => unwrap(api.GET("/v1/manager/jobs/{job_id}/workflow/versions", forJob(jobId))),
    enabled,
  });
}

export function useJdChat(threadId: string | null) {
  return useQuery({
    queryKey: qk.jdChat(threadId ?? ""),
    queryFn: () =>
      unwrap(api.GET("/v1/manager/jobs/chat/{thread_id}", { params: { path: { thread_id: threadId! } } })) as Promise<JdChatState>,
    enabled: !!threadId,
  });
}

export function useSendJdMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { thread_id?: string; message: string }) =>
      unwrap(api.POST("/v1/manager/jobs/chat", { body })) as Promise<JdChatState>,
    onSuccess: (state) => qc.setQueryData(qk.jdChat(state.thread_id), state),
  });
}

export function useConfirmJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (threadId: string) =>
      unwrap(api.POST("/v1/manager/jobs/chat/{thread_id}/confirm", { params: { path: { thread_id: threadId } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.jobs() }),
  });
}

export function previewPatches(jobId: string, baseVersion: number, patches: Patch[]) {
  return unwrap(
    api.POST("/v1/manager/jobs/{job_id}/workflow/preview", { ...forJob(jobId), body: { base_version: baseVersion, patches } }),
  ) as Promise<Preview>;
}

export function applyPatches(jobId: string, baseVersion: number, patches: Patch[], source: "panel" | "chat") {
  return unwrap(
    api.POST("/v1/manager/jobs/{job_id}/workflow/apply", { ...forJob(jobId), body: { base_version: baseVersion, patches, source } }),
  ) as Promise<Applied>;
}

export function undoWorkflow(jobId: string) {
  return unwrap(api.POST("/v1/manager/jobs/{job_id}/workflow/undo", forJob(jobId))) as Promise<Applied>;
}

export function overrideChat(jobId: string, message: string, threadId?: string) {
  return unwrap(
    api.POST("/v1/manager/jobs/{job_id}/workflow/chat", { ...forJob(jobId), body: { message, thread_id: threadId } }),
  ) as Promise<OverrideResult>;
}

export function usePublish(jobId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(api.POST("/v1/manager/jobs/{job_id}/publish", forJob(jobId))),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.job(jobId) });
      void qc.invalidateQueries({ queryKey: qk.jobs() });
    },
  });
}

export function candidateAppUrl(): string {
  return process.env.NEXT_PUBLIC_OTHER_APP_URL ?? "http://localhost:3001";
}

