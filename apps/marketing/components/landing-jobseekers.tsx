import { Button } from "@hirevine/ui/components/button";
import { ArrowRight, Bell, CircleCheck, Clock, Download, Sparkles, Trash2 } from "lucide-react";
import Link from "next/link";
import type React from "react";

import { Faq, faqSchema, type FaqItem } from "@/components/faq";
import { HowItWorks, type Step } from "@/components/how-it-works";
import { EvidenceMock, InterviewMock, RedactionMock } from "@/components/mocks";
import { Reveal } from "@/components/reveal";
import { Screenshot } from "@/components/section";
import { StructuredData } from "@/components/structured-data";
import { CONTAINER, LINKS } from "@/lib/site";

const STEPS: Step[] = [
  {
    title: "Find a role and see every step up front",
    body: "Search open roles by skill and location. Each listing shows what the process involves — screening, a quiz, an AI interview — before you apply.",
    image: { src: "/screens/open-roles.png", alt: "Open roles with search by skill and location" },
  },
  {
    title: "Apply with your resume",
    body: "Upload a PDF or Word file and read exactly how it will be assessed. Your name and contact details are removed before any AI reads it.",
    image: { src: "/screens/apply.png", alt: "The application form with resume upload and how it's assessed" },
  },
  {
    title: "Take each step when it suits you",
    body: "A short timed quiz that saves as you go, and a spoken interview you can start whenever you're ready, from any browser with a microphone.",
    image: { src: "/screens/candidate-interview.png", alt: "The spoken AI interview with a live transcript" },
  },
  {
    title: "Always know where you stand",
    body: "Every application shows its status and your next step. You're notified in the app and by email when something needs you.",
    image: { src: "/screens/applications.png", alt: "My applications with statuses and next steps" },
  },
  {
    title: "Hear back, with reasons",
    body: "When the team decides, everyone who applied hears back at once — with feedback written for you and the parts of your resume it relied on.",
    image: { src: "/screens/journey-feedback.png", alt: "Released feedback with the resume lines it relied on" },
  },
];

const FAQ: FaqItem[] = [
  {
    q: "Is the interviewer a real person?",
    a: "No, and you're told before you start. An AI asks the questions, one at a time, about the role and the projects on your resume. A person on the hiring team reviews the result and makes the decision.",
  },
  {
    q: "What do I need for the AI interview?",
    a: "A browser with a microphone and a quiet room. Questions are read aloud and you answer by speaking, one take per question. You can take your time within the overall limit.",
  },
  {
    q: "Is my recording stored?",
    a: "No. Your answer is transcribed and the recording is discarded. Only the transcript is kept, and that's what the hiring team reads.",
  },
  {
    q: "Will the AI judge my accent or how I write?",
    a: "It's instructed not to, and never asks about age, family, religion, health, nationality or other personal matters. Scores have to point to what you actually said or wrote.",
  },
  {
    q: "When will I hear back?",
    a: "When the hiring team completes the role, everyone who applied gets their outcome and feedback at the same time. Until then you'll see your application's progress, but not scores or rankings.",
  },
  {
    q: "Can I delete my data?",
    a: "Yes. From your account page you can download everything stored about you, or delete your account and all of it. Data is also deleted automatically six months after a role is completed.",
  },
  {
    q: "Does it cost anything?",
    a: "No. Hirevine is free for jobseekers. It's currently in preview, so you'll mostly see roles from teams trying it out.",
  },
];

const TICKER = [
  "Hear back from every role",
  "Feedback written for you",
  "Told up front when it's AI",
  "Recordings never stored",
  "Your name hidden from the AI",
  "Interview on your schedule",
  "Download or delete your data",
];

const PROMISES = [
  { title: "You'll know when it's AI", body: "The interview tells you it's an AI before it starts. No surprises." },
  { title: "Only the job matters", body: "Never asked about age, family, religion, health, nationality or other personal matters." },
  { title: "Nothing is recorded for keeps", body: "Your spoken answers are transcribed and the audio is discarded." },
  { title: "Everyone hears back together", body: "No early leaks, no ghosting: outcomes go to every applicant at once." },
];

const CARD = "min-w-0 rounded-3xl border bg-card p-6 sm:p-8";

function StatusMock() {
  const rows = [
    { role: "Frontend Engineer", status: "Take quiz", tone: "action" },
    { role: "Backend Engineer", status: "In review", tone: "muted" },
    { role: "Data Analyst", status: "Outcome released", tone: "done" },
  ];
  return (
    <div aria-hidden className="relative grid gap-2 text-sm">
      {rows.map((r) => (
        <div key={r.role} className="flex items-center justify-between gap-3 rounded-xl border bg-background px-4 py-3">
          <span className="truncate font-medium">{r.role}</span>
          <span
            className={
              r.tone === "action"
                ? "rounded-full bg-primary px-2.5 py-0.5 text-xs font-medium text-primary-foreground"
                : r.tone === "done"
                  ? "flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300"
                  : "flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground"
            }
          >
            {r.tone === "done" ? <CircleCheck className="size-3" /> : r.tone === "muted" ? <Clock className="size-3" /> : null}
            {r.status}
          </span>
        </div>
      ))}
      <div className="hv-float absolute -right-2 -bottom-6 flex items-center gap-2 rounded-lg bg-foreground px-3 py-2 text-xs text-background shadow-lg">
        <Bell className="size-3.5" /> Your quiz for Frontend Engineer is ready
      </div>
    </div>
  );
}

export function JobseekerLanding({ toggle }: { toggle: React.ReactNode }) {
  return (
    <>
      <StructuredData data={faqSchema(FAQ)} />

      {/* Hero */}
      <section className="relative isolate overflow-hidden">
        <div className="hv-grid absolute inset-0 -z-10 [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]" aria-hidden />
        <div className="absolute top-[-12rem] left-1/2 -z-10 h-[34rem] w-[60rem] max-w-[200vw] -translate-x-1/2 rounded-full bg-sky-400/20 blur-3xl" aria-hidden />
        <div className={`${CONTAINER} grid gap-14 pt-14 pb-16 sm:pt-20 lg:pt-24`}>
          <div className="mx-auto grid max-w-4xl justify-items-center gap-6 text-center">
            {toggle}
            <Reveal delay={80}>
              <h1 className="text-[2.6rem] leading-[1.05] font-bold tracking-tight text-balance sm:text-6xl lg:text-7xl">
                Apply once. <span className="hv-gradient-text">Know where you stand.</span>
              </h1>
            </Reveal>
            <Reveal delay={160}>
              <p className="max-w-2xl text-lg text-pretty text-muted-foreground sm:text-xl">
                Follow every application in one place, take the quiz and spoken interview when it suits you, and get real
                feedback — with reasons — from every role you apply to.
              </p>
            </Reveal>
            <Reveal delay={240} className="flex w-full flex-col justify-center gap-3 sm:w-auto sm:flex-row">
              <Button asChild size="lg" className="h-12 px-6 text-base">
                <a href={LINKS.browseJobs}>
                  Browse open roles <ArrowRight />
                </a>
              </Button>
              <Button asChild size="lg" variant="outline" className="h-12 bg-background/60 px-6 text-base backdrop-blur">
                <a href={LINKS.candidateSignUp}>Create a free account</a>
              </Button>
            </Reveal>
          </div>

          <Reveal delay={320} className="relative mx-auto w-full max-w-6xl">
            <Screenshot src="/screens/journey-feedback.png" alt="A candidate's released feedback with the resume lines it relied on" priority />
            <div className="hv-float absolute -top-6 -left-2 hidden w-64 rounded-xl border bg-card/95 p-3 text-xs shadow-xl backdrop-blur md:block lg:-left-10" aria-hidden>
              <p className="mb-1.5 flex items-center gap-1.5 font-semibold">
                <CircleCheck className="size-4 text-emerald-500" /> Shortlisted
              </p>
              <p className="text-muted-foreground">“Great work on the Python services. We&apos;d like to talk about next steps.”</p>
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
            <h2 className="mt-2 text-4xl font-bold tracking-tight text-balance sm:text-5xl">From applying to hearing back, in one place.</h2>
          </Reveal>
          <HowItWorks steps={STEPS} />
        </div>
      </section>

      {/* Bento */}
      <section id="features" className="scroll-mt-16 bg-muted/30 py-20 sm:py-28">
        <div className={CONTAINER}>
          <Reveal className="mb-12 grid max-w-3xl gap-3">
            <p className="text-sm font-semibold text-primary">Built for applicants</p>
            <h2 className="text-4xl font-bold tracking-tight text-balance sm:text-5xl">A process that respects your time.</h2>
            <p className="text-lg text-muted-foreground">
              You see what&apos;s coming, do each step when you can, and find out why — not just whether.
            </p>
          </Reveal>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-6">
            <Reveal className="relative overflow-hidden rounded-3xl bg-neutral-950 p-6 text-neutral-100 sm:p-8 md:col-span-3">
              <div className="grid gap-8 lg:grid-cols-2 lg:items-center [&>*]:min-w-0">
                <div className="grid gap-3">
                  <h3 className="text-2xl font-semibold tracking-tight">An interview on your schedule</h3>
                  <p className="text-sm text-neutral-400">
                    Start when you&apos;re ready. Questions are read aloud and you answer by speaking — about the work on your own
                    resume.
                  </p>
                </div>
                <InterviewMock className="ring-white/15" />
              </div>
            </Reveal>
            <Reveal delay={80} className={`${CARD} pb-12 md:col-span-3`}>
              <h3 className="mb-2 text-2xl font-semibold tracking-tight">Every application, at a glance</h3>
              <p className="mb-6 text-sm text-muted-foreground">Status and next step for each role, with a nudge when something needs you.</p>
              <StatusMock />
            </Reveal>
            <Reveal className={`${CARD} md:col-span-2`}>
              <h3 className="mb-2 text-xl font-semibold tracking-tight">Read on merit</h3>
              <p className="mb-6 text-sm text-muted-foreground">Your name and contact details are removed before any AI reads your resume.</p>
              <RedactionMock />
            </Reveal>
            <Reveal delay={80} className={`${CARD} pb-12 md:col-span-2`}>
              <h3 className="mb-2 text-xl font-semibold tracking-tight">Feedback with reasons</h3>
              <p className="mb-6 text-sm text-muted-foreground">See the lines of your resume and the answers the review relied on.</p>
              <EvidenceMock />
            </Reveal>
            <Reveal delay={160} className={`${CARD} md:col-span-2`}>
              <h3 className="mb-2 text-xl font-semibold tracking-tight">Your data, your call</h3>
              <p className="mb-6 text-sm text-muted-foreground">Download everything we hold about you, or delete it all, any time.</p>
              <div aria-hidden className="grid gap-2 text-sm">
                <div className="flex items-center gap-3 rounded-xl border bg-background px-4 py-3">
                  <Download className="size-4 text-primary" /> Download my data
                </div>
                <div className="flex items-center gap-3 rounded-xl border border-destructive/30 bg-background px-4 py-3 text-destructive">
                  <Trash2 className="size-4" /> Delete my account
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* Promises (dark) */}
      <section className="relative isolate overflow-hidden bg-neutral-950 py-20 text-neutral-100 sm:py-28">
        <div className="hv-grid absolute inset-0 -z-10 opacity-40 [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" aria-hidden />
        <div className="absolute -bottom-40 left-1/2 -z-10 h-80 w-[50rem] max-w-[200vw] -translate-x-1/2 rounded-full bg-sky-500/25 blur-3xl" aria-hidden />
        <div className={CONTAINER}>
          <Reveal className="grid max-w-3xl gap-3">
            <p className="text-sm font-semibold text-sky-400">Our promises to applicants</p>
            <h2 className="text-4xl font-bold tracking-tight text-balance sm:text-5xl">Fair to you, by design.</h2>
          </Reveal>
          <ol className="mt-14 grid gap-px overflow-hidden rounded-2xl bg-white/10 sm:grid-cols-2 lg:grid-cols-4">
            {PROMISES.map((p, i) => (
              <Reveal as="li" key={p.title} delay={i * 90} className="grid content-start gap-3 bg-neutral-950 p-6 sm:p-8">
                <span className="text-4xl font-bold tracking-tight text-white/20 tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="text-lg font-semibold">{p.title}</h3>
                <p className="text-sm text-neutral-400">{p.body}</p>
              </Reveal>
            ))}
          </ol>
          <Reveal className="mt-8">
            <Link href="/responsible-ai" className="inline-flex items-center gap-1.5 text-sm font-medium text-sky-400 hover:text-sky-300">
              How the AI is kept fair <ArrowRight className="size-4" />
            </Link>
          </Reveal>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="scroll-mt-16 py-20 sm:py-28">
        <div className={`${CONTAINER} grid gap-10 lg:grid-cols-[1fr_2fr] lg:gap-20`}>
          <Reveal className="grid content-start gap-3">
            <p className="text-sm font-semibold text-primary">FAQ</p>
            <h2 className="text-4xl font-bold tracking-tight">Questions from applicants.</h2>
            <p className="text-muted-foreground">
              Hiring for a team instead?{" "}
              <Link href="/" className="font-medium text-primary hover:underline">See Hirevine for hiring teams</Link>.
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
          <div className="absolute top-1/2 left-1/2 -z-10 h-72 w-[42rem] max-w-[200vw] -translate-x-1/2 -translate-y-1/2 rounded-full bg-sky-500/40 blur-3xl" aria-hidden />
          <h2 className="mx-auto max-w-3xl text-4xl font-bold tracking-tight text-balance sm:text-6xl">Your next role, without the silence.</h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-neutral-300">Browse open roles and apply in minutes. It&apos;s free for jobseekers.</p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Button asChild size="lg" className="h-12 px-6 text-base">
              <a href={LINKS.browseJobs}>
                Browse open roles <ArrowRight />
              </a>
            </Button>
            <Button asChild size="lg" variant="ghost" className="h-12 px-6 text-base text-neutral-100 hover:bg-white/10 hover:text-white">
              <a href={LINKS.candidateSignUp}>Create a free account</a>
            </Button>
          </div>
        </Reveal>
      </section>
    </>
  );
}
