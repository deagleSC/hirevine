"use client";

import { qk, unwrap, type components } from "@hirevine/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "./api";

export type CampaignMonitor = components["schemas"]["CampaignMonitor"];
export type ApplicationRow = components["schemas"]["ApplicationRow"];
export type ApplicationDetail = components["schemas"]["ApplicationDetail"];
export type FinalReport = components["schemas"]["FinalReport"];
export type FinalRow = components["schemas"]["FinalRow"];
export type FeedbackView = components["schemas"]["FeedbackView"];
export type FeedbackPatch = components["schemas"]["FeedbackPatch"];
export type Recommendation = NonNullable<FeedbackPatch["recommendation"]>;
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

export function useFinalReport(campaignId: string) {
  return useQuery({
    queryKey: qk.finalReport(campaignId),
    queryFn: () => unwrap(api.GET("/v1/manager/campaigns/{campaign_id}/final", { params: { path: { campaign_id: campaignId } } })),
    // Drafts land in the background while the campaign is open.
    refetchInterval: (q) => (q.state.data?.status === "open" && q.state.data.rows.some((r) => r.feedback_status === "drafting") ? 10_000 : false),
  });
}

/** Partial feedback updates (autosave sends only what changed). Keeps the detail and final list fresh. */
export function useSaveFeedback(campaignId: string, appId: string) {
  const qc = useQueryClient();
  return (patch: FeedbackPatch) =>
    unwrap(
      api.PATCH("/v1/manager/campaigns/{campaign_id}/applications/{application_id}/feedback", {
        params: { path: { campaign_id: campaignId, application_id: appId } },
        body: patch,
      }),
    ).then((fb) => {
      qc.setQueryData<ApplicationDetail>(qk.application(campaignId, appId), (d) => (d ? { ...d, feedback: fb } : d));
      void qc.invalidateQueries({ queryKey: qk.finalReport(campaignId) });
      return fb;
    });
}

export function useManualScore(campaignId: string, appId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { node_id: string; score: number; note: string }) =>
      unwrap(
        api.POST("/v1/manager/campaigns/{campaign_id}/applications/{application_id}/manual-score", {
          params: { path: { campaign_id: campaignId, application_id: appId } },
          body,
        }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.application(campaignId, appId) });
      void qc.invalidateQueries({ queryKey: qk.campaign(campaignId) });
      void qc.invalidateQueries({ queryKey: qk.finalReport(campaignId) });
    },
  });
}

export function useCompleteCampaign(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { confirm_title: string; notify: boolean }) =>
      unwrap(api.POST("/v1/manager/campaigns/{campaign_id}/complete", { params: { path: { campaign_id: campaignId } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.campaign(campaignId) }),
  });
}

/** A neutral label so the table can be read without names (§7.4); the name shows too when returned. */
export function candidateLabel(id: string, name?: string | null): string {
  const tag = `Candidate #${id.replace(/-/g, "").slice(0, 4).toUpperCase()}`;
  return name ? `${name} · ${tag}` : tag;
}
