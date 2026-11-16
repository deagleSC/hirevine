import type { Metadata } from "next";

import { AudienceToggle, type Audience } from "@/components/audience-toggle";
import { HiringLanding } from "@/components/landing-hiring";
import { JobseekerLanding } from "@/components/landing-jobseekers";

type Props = { searchParams: Promise<{ for?: string }> };

function audienceOf(v: string | undefined): Audience {
  return v === "jobseekers" ? "jobseekers" : "hiring";
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  if (audienceOf((await searchParams).for) !== "jobseekers") return {};
  return {
    title: "Hirevine for jobseekers — apply once, know where you stand",
    description:
      "Apply with your resume, take the quiz and spoken interview on your schedule, and get personal feedback with reasons from every role.",
    alternates: { canonical: "/?for=jobseekers" },
  };
}

export default async function Home({ searchParams }: Props) {
  const audience = audienceOf((await searchParams).for);
  const toggle = <AudienceToggle value={audience} />;
  return audience === "jobseekers" ? <JobseekerLanding key="jobseekers" toggle={toggle} /> : <HiringLanding key="hiring" toggle={toggle} />;
}
