import { Button } from "@hirevine/ui/components/button";
import { ArrowRight, Bell, Clock, Download, FileText, Mic, MessageSquareQuote } from "lucide-react";
import type { Metadata } from "next";

import { InterviewMock } from "@/components/mocks";
import { PageHero } from "@/components/page-hero";
import { Reveal } from "@/components/reveal";
import { Screenshot, Section } from "@/components/section";
import { LINKS } from "@/lib/site";

export const metadata: Metadata = {
  title: "For candidates",
  description: "Apply once, follow every step, take the quiz and spoken interview on your schedule, and get personal feedback with reasons.",
  alternates: { canonical: "/candidates" },
};

const STEPS = [
  { icon: FileText, title: "Apply with your resume", body: "Upload a PDF or Word file. Before any AI reads it, your name, contact details, address and date of birth are removed." },
  { icon: Clock, title: "Take the skills quiz", body: "If the role has one: a short, timed multiple-choice quiz. Answers save as you go, so a dropped connection doesn't cost you." },
  { icon: Mic, title: "Talk to the AI interviewer", body: "You're told it's an AI before you start. Questions are read aloud and you answer by speaking, one take each. Only the transcript is kept." },
  { icon: Bell, title: "Get notified", body: "In-app and by email when there's a next step for you, and when outcomes are released." },
  { icon: MessageSquareQuote, title: "Read your feedback", body: "Everyone who applied hears back at the same time, with feedback written for you and the parts of your resume and answers it relied on." },
  { icon: Download, title: "Own your data", body: "Download everything stored about you, or delete your account and all of it, from your account page at any time." },
];

export default function CandidatesPage() {
  return (
    <>
      <PageHero
        eyebrow="For candidates"
        title="A hiring process that tells you where you stand"
        intro="No more applying into silence. Follow every application in one place, complete each step when it suits you, and get real feedback when the team decides."
      >
        <div className="mt-2 flex flex-wrap gap-3">
          <Button asChild size="lg">
            <a href={LINKS.browseJobs}>
              Browse open roles <ArrowRight />
            </a>
          </Button>
          <Button asChild size="lg" variant="outline">
            <a href={LINKS.candidateSignUp}>Create an account</a>
          </Button>
        </div>
      </PageHero>
      <Section eyebrow="Your journey" title="What applying through Hirevine looks like">
        <ol className="grid gap-x-10 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
          {STEPS.map((s, i) => (
            <Reveal as="li" key={s.title} delay={(i % 3) * 90} className="grid content-start gap-3 border-t pt-6">
              <div className="flex items-center gap-3">
                <span className="text-4xl font-bold tracking-tight text-primary/25 tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                <s.icon className="size-5 text-primary" aria-hidden />
              </div>
              <h2 className="text-lg font-semibold">{s.title}</h2>
              <p className="text-sm leading-relaxed text-muted-foreground">{s.body}</p>
            </Reveal>
          ))}
        </ol>
      </Section>
      <Section muted eyebrow="The AI interview" title="Spoken, fair and on your schedule">
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
          <div className="grid gap-4 text-muted-foreground">
            <p>
              The interview feels like a short call. The interviewer asks one question at a time about the role and about the
              projects on your resume, and you answer out loud. A live transcript sits beside the call so you can see what was
              heard.
            </p>
            <p>
              It never asks about age, family, religion, health, nationality or other personal matters, and it is told not to
              judge accent or writing style. Your answers are scored against the hiring team's published rubric, and a person
              on the team reviews the result.
            </p>
            <p className="text-sm">Use a quiet room and allow microphone access when asked. Recordings are never stored.</p>
          </div>
          <Reveal delay={100} className="mx-auto w-full max-w-md">
            <InterviewMock className="p-6" />
          </Reveal>
        </div>
      </Section>
      <Section eyebrow="Open roles" title="Find your next role">
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
          <Screenshot src="/screens/open-roles.png" alt="Open roles on Hirevine" />
          <div className="grid gap-4">
            <p className="text-muted-foreground">
              Search open roles by skill and location, read what each step involves before you apply, and track every
              application from one account.
            </p>
            <Button asChild className="w-fit">
              <a href={LINKS.browseJobs}>
                Browse open roles <ArrowRight />
              </a>
            </Button>
          </div>
        </div>
      </Section>
    </>
  );
}
