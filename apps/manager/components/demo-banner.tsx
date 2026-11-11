"use client";

import { Alert, AlertDescription } from "@hirevine/ui/components/alert";
import { FlaskConical } from "lucide-react";

import { useCampaign } from "@/lib/campaigns";

/** Shown on every page of a pre-run demo campaign: its candidates are synthetic. */
export function DemoBanner({ campaignId }: { campaignId: string }) {
  const c = useCampaign(campaignId);
  if (!c.data?.is_demo) return null;
  return (
    <Alert className="border-amber-500/50">
      <FlaskConical />
      <AlertDescription>
        Demo campaign: the candidates, resumes and answers are synthetic, created to show the full pipeline. No real person applied.
      </AlertDescription>
    </Alert>
  );
}
