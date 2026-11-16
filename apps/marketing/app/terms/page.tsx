import type { Metadata } from "next";

import { PageHero, Prose } from "@/components/page-hero";
import { CANDIDATE_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Terms",
  description: "Terms for using Hirevine.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <>
      <PageHero eyebrow="Legal" title="Terms" intro="Last updated 16 November 2026. Draft for the preview, pending legal review." />
      <Prose>
        <h2>The preview</h2>
        <p>
          Hirevine is offered free as a preview for evaluation. It is not yet intended for live hiring with real applicants.
          Features, limits and availability may change, and data in the preview may be reset with notice.
        </p>
        <h2>Hiring teams</h2>
        <ul>
          <li>You are responsible for your hiring decisions. Hirevine's scores and drafts assist your team; they are not decisions.</li>
          <li>You must review AI-drafted feedback before releasing outcomes, and use Hirevine in line with employment and data-protection law where you hire.</li>
          <li>Don't add screening criteria or interview notes about protected characteristics.</li>
        </ul>
        <h2>Candidates</h2>
        <ul>
          <li>You must be 18 or older and submit your own, truthful information.</li>
          <li>Attempts to manipulate the AI, such as hidden instructions in a resume, are flagged to the hiring team.</li>
        </ul>
        <p>
          The full terms of use for the apps are at <a href={`${CANDIDATE_URL}/terms`}>Hirevine terms</a>.
        </p>
      </Prose>
    </>
  );
}
