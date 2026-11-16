import type React from "react";
import { Button } from "@hirevine/ui/components/button";
import { ArrowRight, ArrowUpRight, Check, Sparkles } from "lucide-react";
import Link from "next/link";

import { Faq, faqSchema, type FaqItem } from "@/components/faq";
import { HowItWorks, type Step } from "@/components/how-it-works";
import { EvidenceMock, InjectionMock, InterviewMock, PipelineMock, QuizMock, RedactionMock, ReleaseMock } from "@/components/mocks";
import { CountUp, Reveal } from "@/components/reveal";
import { Screenshot } from "@/components/section";
import { StructuredData } from "@/components/structured-data";
import { CONTACT_EMAIL, CONTAINER, LINKS, RESULTS, SITE_DESCRIPTION, SITE_NAME, siteUrl } from "@/lib/site";

const STEPS: Step[] = [
  {
    title: "Describe the role in a chat",
    body: "Say who you're hiring in plain words. Hirevine asks for anything missing — must-have skills, seniority, location — and drafts the listing.",
    image: { src: "/screens/new-job.png", alt: "The new job chat asking for the role description" },
  },
  {
    title: "Get a pipeline you can edit",
    body: "Hirevine proposes resume criteria and a cutoff, a timed skills quiz and an interview rubric. Change any step on the canvas or by asking in chat, then publish.",
    image: { src: "/screens/workflow-editor.png", alt: "The pipeline editor with screening settings" },
  },
  {
    title: "Candidates take each step",
    body: "Applicants upload a resume, take the quiz, and answer a spoken AI interview that asks about the projects on their own resume.",
    image: { src: "/screens/candidate-interview.png", alt: "The voice AI interview with a live transcript" },
  },
  {
    title: "Review evidence, not guesses",
    body: "Every score quotes the resume line or interview answer it rests on. Flags show what needs a person. You can override anything.",
    image: { src: "/screens/campaign.png", alt: "Campaign view with candidates, stages and match scores" },
  },
  {
    title: "Release outcomes together",
    body: "Edit the AI-drafted feedback, complete the campaign, and every applicant gets their outcome and reasons at the same moment.",
    image: { src: "/screens/final-released.png", alt: "The final list after outcomes were released" },
  },
];

const FAQ: FaqItem[] = [
  {
    q: "What does Hirevine do?",
    a: "It runs the screening steps of a hiring process: resume screening against your criteria, an optional timed skills quiz, and an optional spoken AI interview. It ranks applicants with the evidence behind every score and drafts personal feedback; your team reviews, edits and decides.",
  },
  {
    q: "Is it ready for real hiring?",
    a: "Not yet. Hirevine is in preview: you can try the full flow end to end, but the legal terms are drafts and limits are conservative. We'll announce when it's ready for live hiring.",
  },
  {
    q: "Does the AI make hiring decisions?",
    a: "No. AI scores and drafts; people decide. Managers can score any step by hand, override suggestions, and must review feedback before outcomes are released to candidates.",
  },
  {
    q: "How does the AI interview work?",
    a: "Candidates are told up front that the interviewer is an AI. Each question is read aloud and the candidate answers by speaking, one take per question. Answers are transcribed and recordings discarded. Questions follow the role's themes and refer to projects from the candidate's own resume.",
  },
  {
    q: "How do you prevent bias?",
    a: "Personal details are removed before any model sees a resume, models are told not to consider protected characteristics, accent or writing style, and every score must cite evidence. Our bias audit swaps names and gendered signals: 0% of 42 variants moved beyond run-to-run noise.",
  },
  {
    q: "What happens with candidate data?",
    a: "Resumes are stored in a private bucket, only redacted text goes to AI models, interview audio is never stored, and candidate data is deleted automatically 180 days after a campaign completes. Candidates can download or delete their data at any time.",
  },
  {
    q: "Which AI models do you use?",
    a: "Models are routed through OpenRouter: open-weight models (currently Google Gemma and NVIDIA Nemotron) for scoring and conversation, Whisper for transcription and ElevenLabs for the interviewer's voice.",
  },
];

const TICKER = [
  "Every score quotes its evidence",
  "Names removed before AI reads a resume",
  "Spoken interviews grounded in the resume",
  "Recordings never stored",
  "People make every decision",
  "Feedback for every applicant",
  "Outcomes released to everyone at once",
];

const BENTO_CARD = "min-w-0 rounded-3xl border bg-card p-6 sm:p-8";

export function HiringLanding({ toggle }: { toggle: React.ReactNode }) {
  return (
    <>
      <StructuredData
        data={{
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: SITE_NAME,
          applicationCategory: "BusinessApplication",
          operatingSystem: "Web",
          url: siteUrl(),
          description: SITE_DESCRIPTION,
          offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        }}
      />
      <StructuredData data={faqSchema(FAQ)} />

      {/* Hero */}
      <section className="relative isolate overflow-hidden">
        <div className="hv-grid absolute inset-0 -z-10 [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]" aria-hidden />
        <div className="absolute top-[-12rem] left-1/2 -z-10 h-[34rem] w-[60rem] max-w-[200vw] -translate-x-1/2 rounded-full bg-primary/20 blur-3xl" aria-hidden />
        <div className={`${CONTAINER} grid gap-14 pt-14 pb-16 sm:pt-20 lg:pt-24`}>
          <div className="mx-auto grid max-w-4xl justify-items-center gap-6 text-center">
            {toggle}
            <Reveal>
              <a
                href={LINKS.tryPreview}
                className="group inline-flex items-center gap-2 rounded-full border bg-background/70 py-1 pr-3 pl-1 text-sm backdrop-blur transition-colors hover:border-primary/50"
              >
                <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">Preview</span>
                <span className="text-muted-foreground">Try the full hiring flow today</span>
                <ArrowRight className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </a>
            </Reveal>
            <Reveal delay={80}>
              <h1 className="text-[2.6rem] leading-[1.05] font-bold tracking-tight text-balance sm:text-6xl lg:text-7xl">
                Screen every applicant fairly. <span className="hv-gradient-text">Decide every hire yourself.</span>
              </h1>
            </Reveal>
            <Reveal delay={160}>
              <p className="max-w-2xl text-lg text-pretty text-muted-foreground sm:text-xl">
                Resume screening, skills quizzes and spoken AI interviews — with every score backed by quoted evidence and every
                decision left to your team.
              </p>
            </Reveal>
            <Reveal delay={240} className="flex w-full flex-col justify-center gap-3 sm:w-auto sm:flex-row">
              <Button asChild size="lg" className="h-12 px-6 text-base">
                <a href={LINKS.tryPreview}>
                  Try the preview <ArrowRight />
                </a>
              </Button>
              <Button asChild size="lg" variant="outline" className="h-12 bg-background/60 px-6 text-base backdrop-blur">
                <Link href="#how-it-works">See how it works</Link>
              </Button>
            </Reveal>
          </div>

          <Reveal delay={320} className="relative mx-auto w-full max-w-6xl">
            <Screenshot src="/screens/final-released.png" alt="Hirevine final list: candidates ranked by overall score with stage scores and recommendations" priority />
            <div className="hv-float absolute -top-6 -left-2 hidden w-64 rounded-xl border bg-card/95 p-3 text-xs shadow-xl backdrop-blur md:block lg:-left-10" aria-hidden>
              <p className="mb-1.5 font-semibold">Why 86%?</p>
              <p className="rounded bg-primary/10 px-2 py-1 font-mono text-[11px] ring-1 ring-primary/30">
                “Built Python services on PostgreSQL handling 2k requests per second.”
              </p>
              <p className="mt-1.5 text-muted-foreground">Quoted from resume line 5 · verified</p>
            </div>
            <div className="hv-float-slow absolute -right-2 -bottom-10 hidden w-60 md:block lg:-right-10">
              <InterviewMock className="p-3" />
            </div>
          </Reveal>
        </div>

        <div className="relative overflow-hidden border-y bg-muted/30 py-4 [mask-image:linear-gradient(90deg,transparent,black_10%,black_90%,transparent)]">
          <div className="hv-marquee flex w-max gap-10" aria-hidden>
            {[...TICKER, ...TICKER].map((t, i) => (
              <span key={i} className="flex items-center gap-2 text-sm whitespace-nowrap text-muted-foreground">
                <Sparkles className="size-3.5 text-primary" />
                {t}
              </span>
            ))}
          </div>
          <ul className="sr-only">
            {TICKER.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="scroll-mt-16 py-20 sm:py-28">
        <div className={CONTAINER}>
          <Reveal className="mb-12 max-w-2xl lg:mb-4">
            <p className="text-sm font-semibold text-primary">How it works</p>
            <h2 className="mt-2 text-4xl font-bold tracking-tight text-balance sm:text-5xl">From a job description to explained outcomes.</h2>
          </Reveal>
          <HowItWorks steps={STEPS} />
        </div>
      </section>

      {/* Bento */}
      <section id="features" className="scroll-mt-16 bg-muted/30 py-20 sm:py-28">
        <div className={CONTAINER}>
          <Reveal className="mb-12 grid max-w-3xl gap-3">
            <p className="text-sm font-semibold text-primary">For hiring teams</p>
            <h2 className="text-4xl font-bold tracking-tight text-balance sm:text-5xl">The screening work, done carefully.</h2>
            <p className="text-lg text-muted-foreground">
              Every part of the pipeline is built to be checked: what the AI read, what it quoted, and why it scored.
            </p>
          </Reveal>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-6">
            <Reveal className={`${BENTO_CARD} md:col-span-4`}>
              <div className="grid grid-cols-1 gap-10 lg:grid-cols-2 lg:items-center [&>*]:min-w-0">
                <div className="grid gap-3">
                  <h3 className="text-2xl font-semibold tracking-tight">Scores that show their work</h3>
                  <p className="text-muted-foreground">
                    Every resume score quotes the line it rests on, and code checks the quote is really there. No quote, no points.
                  </p>
                </div>
                <div className="pb-6">
                  <EvidenceMock />
                </div>
              </div>
            </Reveal>
            <Reveal delay={80} className="relative overflow-hidden rounded-3xl bg-neutral-950 p-6 text-neutral-100 sm:p-8 md:col-span-2">
              <h3 className="text-2xl font-semibold tracking-tight">An interview that has read the resume</h3>
              <p className="mt-2 text-sm text-neutral-400">Spoken questions about the candidate's own projects. Only the transcript is kept.</p>
              <div className="hv-wave mt-8 flex h-16 items-center justify-center gap-1.5" aria-hidden>
                {Array.from({ length: 18 }, (_, i) => (
                  <span key={i} className="h-full w-1.5 rounded-full bg-gradient-to-t from-primary to-sky-400" style={{ animationDelay: `${(i % 6) * 0.12}s` }} />
                ))}
              </div>
            </Reveal>
            <Reveal className={`${BENTO_CARD} md:col-span-2`}>
              <h3 className="mb-2 text-xl font-semibold tracking-tight">Names never reach the model</h3>
              <p className="mb-6 text-sm text-muted-foreground">Personal details are stripped before any AI reads a resume.</p>
              <RedactionMock />
            </Reveal>
            <Reveal delay={80} className={`${BENTO_CARD} md:col-span-2`}>
              <h3 className="mb-2 text-xl font-semibold tracking-tight">Tricks get flagged</h3>
              <p className="mb-6 text-sm text-muted-foreground">Hidden instructions and keyword stuffing never count as evidence.</p>
              <InjectionMock />
            </Reveal>
            <Reveal delay={160} className={`${BENTO_CARD} md:col-span-2`}>
              <h3 className="mb-2 text-xl font-semibold tracking-tight">A quiz written for the role</h3>
              <p className="mb-6 text-sm text-muted-foreground">Timed multiple choice, generated from your criteria and graded against the key.</p>
              <QuizMock />
            </Reveal>
            <Reveal className={`${BENTO_CARD} md:col-span-3`}>
              <h3 className="mb-2 text-xl font-semibold tracking-tight">A pipeline per role</h3>
              <p className="mb-6 text-sm text-muted-foreground">Drafted from your description, edited on a canvas or by chat, with full undo history.</p>
              <PipelineMock />
            </Reveal>
            <Reveal delay={80} className={`${BENTO_CARD} pb-12 md:col-span-3`}>
              <h3 className="mb-2 text-xl font-semibold tracking-tight">Everyone hears back, at once</h3>
              <p className="mb-6 text-sm text-muted-foreground">Feedback you've reviewed goes to every applicant when you complete the campaign.</p>
              <ReleaseMock />
            </Reveal>
          </div>
        </div>
      </section>

      {/* Proof */}
      <section className="relative isolate overflow-hidden bg-neutral-950 py-20 text-neutral-100 sm:py-28">
        <div className="hv-grid absolute inset-0 -z-10 opacity-40 [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" aria-hidden />
        <div className="absolute -bottom-40 left-1/2 -z-10 h-80 w-[50rem] max-w-[200vw] -translate-x-1/2 rounded-full bg-primary/25 blur-3xl" aria-hidden />
        <div className={CONTAINER}>
          <Reveal className="grid max-w-3xl gap-3">
            <p className="text-sm font-semibold text-sky-400">Measured, not promised</p>
            <h2 className="text-4xl font-bold tracking-tight text-balance sm:text-5xl">We test the AI the way you&apos;d audit a hire.</h2>
            <p className="text-lg text-neutral-400">Real runs of the production code against labelled, synthetic applicants.</p>
          </Reveal>
          <div className="mt-14 grid gap-px overflow-hidden rounded-2xl bg-white/10 sm:grid-cols-2 lg:grid-cols-4">
            {RESULTS.map((r, i) => (
              <Reveal key={r.label} delay={i * 90} className="grid content-start gap-2 bg-neutral-950 p-6 sm:p-8">
                <CountUp value={r.value} className="text-5xl font-bold tracking-tight tabular-nums" />
                <span className="text-sm font-medium text-neutral-200">{r.label}</span>
                <span className="text-xs text-neutral-500">{r.note}</span>
              </Reveal>
            ))}
          </div>
          <Reveal className="mt-8">
            <Link href="/responsible-ai" className="inline-flex items-center gap-1.5 text-sm font-medium text-sky-400 hover:text-sky-300">
              How we test, and what the tests changed <ArrowUpRight className="size-4" />
            </Link>
          </Reveal>
        </div>
      </section>

      {/* Analytics */}
      <section className="py-20 sm:py-28">
        <div className={`${CONTAINER} grid items-center gap-12 lg:grid-cols-[1.25fr_1fr] lg:gap-20`}>
          <Reveal>
            <Screenshot src="/screens/analytics-campaign.png" alt="Campaign analytics: funnel, cutoff impact, score distribution and time per stage" />
          </Reveal>
          <Reveal delay={100} className="grid gap-5">
            <p className="text-sm font-semibold text-primary">Analytics</p>
            <h2 className="text-4xl font-bold tracking-tight text-balance">See the whole funnel before you change it.</h2>
            <p className="text-lg text-muted-foreground">
              Per-campaign funnels, score distributions against the pass mark, time per stage, and what a different cutoff would
              do. Across every job: volume, time to shortlist, and how often your team agrees with the AI.
            </p>
            <ul className="grid gap-2.5">
              {["Cutoff impact before you move it", "Drop-off at every stage", "AI agreement and unedited-draft rates", "A table view behind every chart"].map((t) => (
                <li key={t} className="flex items-center gap-3">
                  <Check className="size-5 shrink-0 rounded-full bg-primary/10 p-1 text-primary" aria-hidden />
                  {t}
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </section>

      {/* Availability */}
      <section id="pricing" className="scroll-mt-16 bg-muted/30 py-20 sm:py-28">
        <div className={`${CONTAINER} grid gap-10 lg:grid-cols-[1fr_1.1fr] lg:items-center lg:gap-20`}>
          <Reveal className="grid gap-4">
            <p className="text-sm font-semibold text-primary">Availability</p>
            <h2 className="text-4xl font-bold tracking-tight text-balance sm:text-5xl">Free to try while in preview.</h2>
            <p className="text-lg text-muted-foreground">
              The whole flow works today, from job chat to released feedback. It isn&apos;t ready for live hiring yet: explore it
              with test roles and sample resumes, and tell us what you&apos;d need.
            </p>
          </Reveal>
          <Reveal delay={100} className="relative overflow-hidden rounded-3xl border bg-card p-6 shadow-xl sm:p-10">
            <div className="absolute -top-20 -right-20 size-56 rounded-full bg-primary/15 blur-3xl" aria-hidden />
            <div className="relative flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Preview access</p>
                <p className="text-5xl font-bold tracking-tight">$0</p>
              </div>
              <span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary">No card needed</span>
            </div>
            <ul className="relative mt-8 grid gap-3 sm:grid-cols-2">
              {["Job chat and pipeline editor", "Resume screening with evidence", "Timed skills quizzes", "Voice AI interviews", "AI-drafted, editable feedback", "Campaign analytics"].map((f) => (
                <li key={f} className="flex items-center gap-2.5 text-sm">
                  <Check className="size-4 shrink-0 text-primary" aria-hidden />
                  {f}
                </li>
              ))}
            </ul>
            <div className="relative mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <a href={LINKS.tryPreview}>
                  Try the preview <ArrowRight />
                </a>
              </Button>
              <Button asChild size="lg" variant="ghost">
                <a href="#faq">Read the FAQ</a>
              </Button>
            </div>
          </Reveal>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="scroll-mt-16 py-20 sm:py-28">
        <div className={`${CONTAINER} grid gap-10 lg:grid-cols-[1fr_2fr] lg:gap-20`}>
          <Reveal className="grid content-start gap-3">
            <p className="text-sm font-semibold text-primary">FAQ</p>
            <h2 className="text-4xl font-bold tracking-tight">Questions, answered.</h2>
            <p className="text-muted-foreground">
              Something else?{" "}
              {CONTACT_EMAIL ? (
                <a href={`mailto:${CONTACT_EMAIL}`} className="font-medium text-primary hover:underline">Email us</a>
              ) : (
                <a href={`${LINKS.github}/issues`} className="font-medium text-primary hover:underline">Ask on GitHub</a>
              )}
              .
            </p>
          </Reveal>
          <Reveal delay={80}>
            <Faq items={FAQ} />
          </Reveal>
        </div>
      </section>

      {/* CTA */}
      <section id="contact" className="scroll-mt-16 px-4 pb-20 sm:px-6 sm:pb-28 lg:px-8">
        <Reveal className="relative isolate mx-auto max-w-7xl overflow-hidden rounded-[2rem] bg-neutral-950 px-6 py-16 text-center text-neutral-100 sm:px-12 sm:py-24">
          <div className="hv-grid absolute inset-0 -z-10 opacity-30" aria-hidden />
          <div className="absolute top-1/2 left-1/2 -z-10 h-72 w-[42rem] max-w-[200vw] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/40 blur-3xl" aria-hidden />
          <h2 className="mx-auto max-w-3xl text-4xl font-bold tracking-tight text-balance sm:text-6xl">See your next role through Hirevine.</h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-neutral-300">
            Create a preview account, describe a role, and have a screening pipeline ready in minutes.
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Button asChild size="lg" className="h-12 px-6 text-base">
              <a href={LINKS.tryPreview}>
                Try the preview <ArrowRight />
              </a>
            </Button>
            <Button asChild size="lg" variant="ghost" className="h-12 px-6 text-base text-neutral-100 hover:bg-white/10 hover:text-white">
              <Link href="/responsible-ai">How we keep it fair</Link>
            </Button>
          </div>
        </Reveal>
      </section>
    </>
  );
}
