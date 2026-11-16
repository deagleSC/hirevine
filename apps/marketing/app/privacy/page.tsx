import type { Metadata } from "next";

import { PageHero, Prose } from "@/components/page-hero";
import { CANDIDATE_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy",
  description: "Privacy for this website and for the Hirevine apps.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <>
      <PageHero eyebrow="Legal" title="Privacy" intro="Last updated 16 November 2026. Draft for the preview, pending legal review." />
      <Prose>
        <h2>This website</h2>
        <p>
          This marketing site does not use cookies, analytics or tracking, and has no forms. Your browser may store your light or
          dark theme choice locally. Our hosting provider (Vercel) keeps standard server logs, such as IP addresses and request
          times, to operate and secure the service.
        </p>
        <h2>The Hirevine apps</h2>
        <p>
          When you sign up as a hiring team or apply to a job, the Hirevine apps process your account details, applications,
          resumes, quiz answers and interview transcripts to run each hiring step. Personal details are removed from resume text
          before any AI model reads it, interview recordings are transcribed and not stored, and candidate data is deleted
          automatically after the hiring process ends.
        </p>
        <p>
          The full notice — what is collected, who processes it and how long it is kept — is in the app:{" "}
          <a href={`${CANDIDATE_URL}/privacy`}>Hirevine privacy notice</a> and{" "}
          <a href={`${CANDIDATE_URL}/ai-evaluation`}>how AI evaluation works</a>.
        </p>
        <h2>Your choices</h2>
        <ul>
          <li>Candidates can download or delete all their data from their account page at any time.</li>
          <li>Hiring teams control their jobs and can complete campaigns, which starts the retention clock.</li>
        </ul>
      </Prose>
    </>
  );
}
