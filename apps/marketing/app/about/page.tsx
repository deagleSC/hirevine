import type { Metadata } from "next";

import { CtaBand } from "@/components/cta-band";
import { PageHero, Prose } from "@/components/page-hero";
import { LINKS } from "@/lib/site";

export const metadata: Metadata = {
  title: "About",
  description: "Why Hirevine exists and how it's built.",
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  return (
    <>
      <PageHero
        eyebrow="About"
        title="Faster screening shouldn't mean less fair"
        intro="Hirevine exists because most applicants never hear back, and most hiring teams don't have time to read every resume carefully. AI can do the reading — if it shows its work and people stay in charge."
      />
      <Prose>
        <h2>What we believe</h2>
        <ul>
          <li><strong className="text-foreground">Evidence over vibes.</strong> A score without a reason can't be checked, challenged or explained to a candidate.</li>
          <li><strong className="text-foreground">People decide.</strong> The AI drafts and ranks; the hiring team reviews, edits and makes the call.</li>
          <li><strong className="text-foreground">Everyone hears back.</strong> Every applicant gets an outcome and feedback written for them, released at the same time as everyone else's.</li>
          <li><strong className="text-foreground">Measure, don't promise.</strong> Fairness and consistency are tested against labelled data, and the reports are public.</li>
        </ul>
        <h2>How it's built</h2>
        <p>
          Two web apps — one for hiring teams, one for candidates — talk to a single API that is the only gateway to the database
          and the only caller of AI models. Row-level security in Postgres backs up every permission check. Background steps run
          on a job queue that receives record IDs only, never resumes or answers. Models are routed through OpenRouter, with
          schema-validated outputs, daily usage caps and a fallback model.
        </p>
        <p>
          The architecture decisions, evaluation reports and source are on <a href={LINKS.github}>GitHub</a>.
        </p>
        <h2>Where we are</h2>
        <p>
          Hirevine is in its pilot phase. Pilot teams use it free while we refine the product with them; paid plans will follow
          with notice.
        </p>
      </Prose>
      <CtaBand title="Try Hirevine on your next role" body="Create a pilot account and have a screening pipeline ready in minutes." />
    </>
  );
}
