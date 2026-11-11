"use client";

import { qk, unwrap, type components } from "@hirevine/api-client";
import { useQuery } from "@tanstack/react-query";

import { api } from "./api";

export type CandidateAnalytics = components["schemas"]["CandidateAnalytics"];

export function useMyAnalytics() {
  return useQuery({ queryKey: qk.myAnalytics(), queryFn: () => unwrap(api.GET("/v1/candidate/analytics")) });
}
