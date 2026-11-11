"use client";

import { qk, unwrap, type components } from "@hirevine/api-client";
import { useQuery } from "@tanstack/react-query";

import { api } from "./api";

export type CampaignAnalytics = components["schemas"]["CampaignAnalytics"];
export type Overview = components["schemas"]["Overview"];

export function useCampaignAnalytics(campaignId: string) {
  return useQuery({
    queryKey: qk.campaignAnalytics(campaignId),
    queryFn: () =>
      unwrap(api.GET("/v1/manager/analytics/campaigns/{campaign_id}", { params: { path: { campaign_id: campaignId } } })),
  });
}

export function useOverview() {
  return useQuery({ queryKey: qk.analyticsOverview(), queryFn: () => unwrap(api.GET("/v1/manager/analytics/overview")) });
}

export const pct = (share: number | null | undefined) => (share == null ? "—" : `${Math.round(share * 100)}%`);
export const BIN_LABELS = ["0–9", "10–19", "20–29", "30–39", "40–49", "50–59", "60–69", "70–79", "80–89", "90–100"];
export const STAGE_NAME: Record<string, string> = { screening: "Screening", quiz: "Quiz", interview: "Interview", final: "Final list" };

export function hours(h: number | null | undefined): string {
  if (h == null) return "—";
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${h.toFixed(h < 10 ? 1 : 0)} h`;
  return `${(h / 24).toFixed(1)} days`;
}
