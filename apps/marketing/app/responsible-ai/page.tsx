import type { Metadata } from "next";

import { PageHero } from "@/components/page-hero";
import { Section } from "@/components/section";
import { LINKS, RESULTS } from "@/lib/site";

export const metadata: Metadata = {
  title: "Responsible AI",
  description: "How Hirevine keeps AI screening explainable and fair: quoted evidence, redaction, injection defences, human decisions, and measured results.",
  alternates: { canonical: "/responsible-ai" },
};

const RULES = [
  {
    title: "Every score quotes its evidence",
    body: "Resume scores must quote the line they rest on, and code checks that the quote is really in the resume. A score whose quote can't be found is set to zero. Interview scores must cite the answers they're based on, or they can't be positive.",
  },
  {
    title: "Personal details are removed first",
    body: "Names, emails, phone numbers, links, addresses and dates of birth are stripped from resume text before any model reads it. A test fails if a name or phone number reappears.",
  },
  {
    title: "Instructions hidden in resumes don't work",
    body: "Text that tries to instruct the AI, white-on-white keyword stuffing and similar tricks are detected, flagged to the hiring team, and never count as evidence.",
  },
  {
    title: "People make every decision",
    body: "AI suggests a score and a recommendation. Managers can score any step by hand, override suggestions and must review feedback before release. We track how often teams agree with the AI.",
  },
  {
    title: "Outcomes are released together",
    body: "No candidate sees a score or outcome before the hiring team completes the campaign; then everyone gets theirs at the same time, with the evidence behind it.",
  },
  {
    title: "Candidates know when it's AI",
    body: "The AI interview is disclosed before it starts. It never asks about protected characteristics, and the recording is transcribed and discarded.",
  },
];

const EVALS = [
  { name: "Resume screening", what: "12 labelled resumes in three bands, ranked by the screening model against human labels.", result: "Spearman 0.963; precision@4 100%; quotes found first try 100%." },
  { name: "Bias audit", what: "6 resumes × 3 name swaps in 2 layouts, plus gendered signals such as pronouns and \"mother of two\".", result: "0% of 42 variants beyond run-to-run noise; mean change 0.72 points, max 4.0." },
  { name: "Prompt injection", what: "4 resumes × 3 planted instructions, including hidden keyword stuffing.", result: "Scores changed 0%; flagged 100%." },
  { name: "Interview scoring", what: "6 labelled transcripts scored 3 times each.", result: "Run-to-run std dev 0.24 points (max 1.46); all 6 in their labelled band." },
  { name: "Pipeline editing by chat", what: "40 natural-language edit requests compared with the equivalent hand edit.", result: "98% produced the same change (39 of 40)." },
];

export default function ResponsibleAiPage() {
  return (
    <>
      <PageHero
        eyebrow="Responsible AI"
        title="Screening you can explain to every candidate"
        intro="Hiring is high-stakes, so Hirevine's AI works under rules enforced in code, and we measure whether they hold."
      />
      <Section eyebrow="The rules" title="What the AI must do, and can't do">
        <div className="grid gap-4 md:grid-cols-2">
          {RULES.map((r, i) => (
            <div key={r.title} className="grid content-start gap-2 rounded-xl border bg-card p-6">
              <span className="text-sm font-semibold text-primary tabular-nums">0{i + 1}</span>
              <h2 className="text-lg font-semibold">{r.title}</h2>
              <p className="text-sm leading-relaxed text-muted-foreground">{r.body}</p>
            </div>
          ))}
        </div>
      </Section>
      <Section muted eyebrow="Measured" title="How we test it" intro="Each evaluation runs the production code paths against a real model on synthetic data — no real applicants. Reports are versioned in the repository.">
        <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {RESULTS.map((r) => (
            <div key={r.label} className="grid content-start gap-1 rounded-xl border bg-card p-5">
              <span className="text-3xl font-bold tracking-tight text-primary tabular-nums">{r.value}</span>
              <span className="text-sm font-medium">{r.label}</span>
            </div>
          ))}
        </div>
        <div className="overflow-hidden rounded-xl border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">Evaluation</th>
                <th scope="col" className="hidden px-4 py-3 font-semibold md:table-cell">Setup</th>
                <th scope="col" className="px-4 py-3 font-semibold">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {EVALS.map((e) => (
                <tr key={e.name} className="align-top">
                  <th scope="row" className="px-4 py-3 font-medium">{e.name}</th>
                  <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">{e.what}</td>
                  <td className="px-4 py-3">{e.result}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          What the evals changed: an early run found hidden keyword stuffing raised two weak resumes by 75 points, so flagged lines no
          longer count as evidence; interview scoring went through three prompt versions before citations were reliable.{" "}
          <a href={LINKS.github} className="font-medium text-primary hover:underline">Read the reports on GitHub</a>.
        </p>
      </Section>
    </>
  );
}
