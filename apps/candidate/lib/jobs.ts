"use client";

import { qk, unwrap, type components } from "@hirevine/api-client";
import { useQuery } from "@tanstack/react-query";

import { api } from "./api";

export type PublicJob = components["schemas"]["PublicJob"];
export type PublicJobDetail = components["schemas"]["PublicJobDetail"];
export type PublicStage = components["schemas"]["PublicStage"];
export type TrackerItem = components["schemas"]["TrackerItem"];

export function usePublicJobs(params: { q?: string; location?: string; seniority?: string }) {
  return useQuery({
    queryKey: qk.publicJobs(params),
    queryFn: () => unwrap(api.GET("/v1/public/jobs", { params: { query: { ...params, limit: 50 } } })),
  });
}

export function usePublicJob(jobId: string) {
  return useQuery({
    queryKey: qk.publicJob(jobId),
    queryFn: () => unwrap(api.GET("/v1/public/jobs/{job_id}", { params: { path: { job_id: jobId } } })),
  });
}

export function useConsentInfo() {
  return useQuery({ queryKey: ["consent"], queryFn: () => unwrap(api.GET("/v1/public/consent")), staleTime: Infinity });
}

export const STAGE_COPY: Record<PublicStage["type"], (s: PublicStage) => { title: string; detail: string }> = {
  screening: () => ({
    title: "Resume screening",
    detail: "Your resume is checked against the role's criteria, with an AI assisting and quoting the lines it relies on.",
  }),
  quiz: (s) => ({
    title: "Skills quiz",
    detail: `A timed multiple-choice quiz${s.time_limit_min ? ` (${s.time_limit_min} minutes)` : ""}.`,
  }),
  interview: (s) => ({
    title: "AI interview",
    detail: `A short written interview${s.turn_cap ? ` of up to ${s.turn_cap} questions` : ""}.`,
  }),
  final: () => ({ title: "Hiring team review", detail: "A person reviews the results and makes the decision." }),
};
