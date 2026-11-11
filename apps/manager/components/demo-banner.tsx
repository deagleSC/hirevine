"use client";

import { Alert, AlertDescription } from "@hirevine/ui/components/alert";
import { FlaskConical } from "lucide-react";

import { useCampaign } from "@/lib/campaigns";

/** Shown on every campaign page: that a demo's candidates are synthetic, or that retention deleted the data. */
export function DemoBanner({ campaignId }: { campaignId: string }) {
  const c = useCampaign(campaignId);
  if (c.data?.purged_at) {
    return (
      <Alert>
        <AlertDescription>
          Candidate data for this campaign was deleted on {new Date(c.data.purged_at).toLocaleDateString()}, six months after it
          was completed (retention policy).
        </AlertDescription>
      </Alert>
    );
  }
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
