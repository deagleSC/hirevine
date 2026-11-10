"use client";

import { qk, unwrap, type components } from "@hirevine/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "./api";

export type CampaignMonitor = components["schemas"]["CampaignMonitor"];
export type ApplicationRow = components["schemas"]["ApplicationRow"];
export type ApplicationDetail = components["schemas"]["ApplicationDetail"];
export type StageStatus = "pending" | "in_progress" | "passed" | "failed" | "needs_review";
export type Filters = { node?: string; status?: StageStatus; flag?: string };

const POLL_MS = 15_000;

export function useCampaign(campaignId: string) {
  return useQuery({
    queryKey: qk.campaign(campaignId),
    queryFn: () => unwrap(api.GET("/v1/manager/campaigns/{campaign_id}", { params: { path: { campaign_id: campaignId } } })),
    refetchInterval: (q) => (q.state.data?.status === "open" ? POLL_MS : false),
  });
}

export function useCampaignApplications(campaignId: string, filters: Filters, open: boolean) {
  return useQuery({
    queryKey: qk.campaignApplications(campaignId, filters),
    queryFn: () =>
      unwrap(
        api.GET("/v1/manager/campaigns/{campaign_id}/applications", {
          params: { path: { campaign_id: campaignId }, query: { ...filters, limit: 200 } },
        }),
      ),
    refetchInterval: open ? POLL_MS : false,
  });
}

export function useApplication(campaignId: string, appId: string) {
  return useQuery({
    queryKey: qk.application(campaignId, appId),
    queryFn: () =>
      unwrap(
        api.GET("/v1/manager/campaigns/{campaign_id}/applications/{application_id}", {
          params: { path: { campaign_id: campaignId, application_id: appId } },
        }),
      ),
    // While screening runs, refresh until the result lands.
    refetchInterval: (q) => (q.state.data && ["queued", "running"].includes(q.state.data.job_status ?? "") ? 5_000 : false),
  });
}

export function useRetry(campaignId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (appId: string) =>
      unwrap(
        api.POST("/v1/manager/campaigns/{campaign_id}/applications/{application_id}/retry", {
          params: { path: { campaign_id: campaignId, application_id: appId } },
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.campaign(campaignId) }),
  });
}

/** A neutral label so the table can be read without names (§7.4); the name shows too when returned. */
export function candidateLabel(id: string, name?: string | null): string {
  const tag = `Candidate #${id.replace(/-/g, "").slice(0, 4).toUpperCase()}`;
  return name ? `${name} · ${tag}` : tag;
}
