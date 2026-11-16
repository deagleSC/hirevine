import { Badge } from "@hirevine/ui/components/badge";
import { Button } from "@hirevine/ui/components/button";
import {
  ArrowRight,
  BadgeCheck,
  Check,
  EyeOff,
  FileSearch,
  ListChecks,
  Megaphone,
  MessagesSquare,
  Mic,
  PenLine,
  Quote,
  ShieldCheck,
  Users,
  Workflow,
} from "lucide-react";
import Link from "next/link";

import { CtaBand } from "@/components/cta-band";
import { Faq, faqSchema, type FaqItem } from "@/components/faq";
import { FeatureRow, Screenshot, Section } from "@/components/section";
import { StructuredData } from "@/components/structured-data";
import { CONTACT_EMAIL, LINKS, MANAGER_URL, RESULTS, SITE_DESCRIPTION, SITE_NAME, siteUrl } from "@/lib/site";

const STEPS = [
  {
    icon: MessagesSquare,
    title: "Describe the role",
    body: "Tell Hirevine about the job in a chat. It asks for anything missing — skills, seniority, location — and drafts the listing.",
  },
  {
    icon: Workflow,
    title: "Review the pipeline",
    body: "Get a drafted pipeline: resume screening, an optional skills quiz and an optional AI interview. Edit any step by hand or by chat, then publish.",
  },
  {
    icon: Mic,
    title: "Candidates take each step",
    body: "Applicants upload a resume, take a timed quiz, and answer a spoken AI interview whose questions draw on their own experience.",
  },
  {
    icon: Quote,
    title: "Review the evidence",
    body: "Every score quotes the resume line or interview answer behind it. AI drafts each candidate's feedback; your team edits and decides.",
  },
  {
    icon: Megaphone,
    title: "Release outcomes together",
    body: "When you complete the campaign, every applicant gets their outcome and personal feedback at the same time.",
  },
];

const PRINCIPLES = [
  { icon: Quote, title: "Evidence or zero", body: "A score has to quote its source. Code checks the quote against the resume; if it can't be found, the score is zero." },
  { icon: EyeOff, title: "Names never reach the model", body: "Names, contact details, addresses and dates of birth are removed before any AI model reads a resume." },
  { icon: ShieldCheck, title: "Injection-resistant", body: "Hidden instructions and keyword stuffing in resumes are detected, flagged to the team and never count as evidence." },
  { icon: Users, title: "People decide", body: "AI suggests; your team can override any score, edits all feedback and makes every hiring decision." },
  { icon: BadgeCheck, title: "Fair release", body: "Nobody sees outcomes early. Results and feedback go to every applicant of a job at once." },
  { icon: FileSearch, title: "Disclosed and auditable", body: "Candidates are told when they talk to an AI. Recordings are transcribed and discarded; model calls are traced." },
];

const FAQ: FaqItem[] = [
  {
    q: "What does Hirevine actually do?",
    a: "It runs the screening steps of a hiring process: resume screening against your criteria, an optional timed skills quiz, and an optional spoken AI interview. It ranks applicants with the evidence behind every score and drafts personal feedback, and your team reviews, edits and decides.",
  },
  {
    q: "Does the AI make hiring decisions?",
    a: "No. AI scores and drafts; people decide. Managers can score any step by hand, override suggestions, and must review feedback before outcomes are released to candidates.",
  },
  {
    q: "How does the AI interview work?",
    a: "Candidates are told up front that the interviewer is an AI. Each question is read aloud and the candidate answers by speaking, one take per question. Answers are transcribed and the recordings discarded. Questions follow the role's themes and refer to projects from the candidate's own resume.",
  },
  {
    q: "How do you prevent bias?",
    a: "Personal details are removed before any model sees a resume, the models are instructed not to consider protected characteristics, accent or writing style, and every score must cite evidence. We run a bias audit that swaps names and gendered signals: 0% of 42 variants moved beyond run-to-run noise.",
  },
  {
    q: "What happens with candidate data?",
    a: "Resumes are stored in a private bucket, only redacted text goes to AI models, interview audio is never stored, and candidate data is deleted automatically 180 days after a campaign completes. Candidates can download or delete their data at any time.",
  },
  {
    q: "Which AI models do you use?",
    a: "Models are routed through OpenRouter: open-weight models (currently Google Gemma and NVIDIA Nemotron) for scoring and conversation, Whisper for transcription and ElevenLabs for the interviewer's voice. Each call is validated against a schema and counted against daily limits.",
  },
  {
    q: "How much does it cost?",
    a: "Hirevine is in its pilot phase and free for pilot teams. Paid plans will follow; pilot teams will get notice and their data stays theirs.",
  },
];

const PLANS = [
  {
    name: "Pilot",
    price: "Free",
    note: "while we're in pilot",
    badge: "Available now",
    features: ["Jobs, campaigns and analytics", "Resume screening, skills quiz and voice AI interview", "Evidence-backed scores and AI-drafted feedback", "Email invitations and outcome notices"],
    cta: { label: "Start a pilot", href: LINKS.managerSignUp },
    highlight: true,
  },
  {
    name: "Team",
    price: "Coming soon",
    note: "for growing hiring teams",
    badge: "Planned",
    features: ["Everything in Pilot", "Multiple managers per organisation", "Higher AI usage limits", "Email support"],
    cta: { label: "Talk to us", href: "#contact" },
  },
  {
    name: "Enterprise",
    price: "Custom",
    note: "for regulated or high-volume hiring",
    badge: "Planned",
    features: ["Company knowledge base for questions", "SSO and data residency options", "Custom retention and audit exports", "Integrations with your ATS"],
    cta: { label: "Contact us", href: "#contact" },
  },
];

export default function Home() {
  const url = siteUrl();
  return (
    <>
      <StructuredData
        data={{
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: SITE_NAME,
          applicationCategory: "BusinessApplication",
          operatingSystem: "Web",
          url,
          description: SITE_DESCRIPTION,
          offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        }}
      />
      <StructuredData data={faqSchema(FAQ)} />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-x-0 top-0 -z-10 h-[36rem] bg-[radial-gradient(ellipse_at_top,var(--color-primary)_0%,transparent_60%)] opacity-15" aria-hidden />
        <div className="mx-auto grid max-w-6xl gap-12 px-4 pt-16 pb-12 sm:px-6 sm:pt-24">
          <div className="mx-auto grid max-w-3xl justify-items-center gap-6 text-center">
            <Badge variant="secondary" className="gap-1.5 px-3 py-1">
              <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden />
              Now in pilot · free for early teams
            </Badge>
            <h1 className="text-4xl font-bold tracking-tight text-balance sm:text-5xl lg:text-6xl">
              Screen every applicant fairly. <span className="text-primary">Decide every hire yourself.</span>
            </h1>
            <p className="max-w-2xl text-lg text-pretty text-muted-foreground">
              Hirevine runs resume screening, skills quizzes and spoken AI interviews for your roles. Every score quotes its
              evidence, every candidate gets real feedback, and every decision stays with your team.
            </p>
            <div className="flex w-full flex-col justify-center gap-3 sm:w-auto sm:flex-row">
              <Button asChild size="lg">
                <a href={LINKS.managerSignUp}>
                  Start a pilot <ArrowRight />
                </a>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="#how-it-works">See how it works</Link>
              </Button>
            </div>
            <ul className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
              {["No credit card", "Names hidden from AI", "Feedback for every applicant"].map((t) => (
                <li key={t} className="flex items-center gap-1.5">
                  <Check className="size-4 text-primary" aria-hidden /> {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="mx-auto w-full max-w-5xl">
            <Screenshot src="/screens/final-released.png" alt="Hirevine final list: candidates ranked by overall score with stage scores and recommendations" priority />
          </div>
        </div>
      </section>

      {/* How it works */}
      <Section
        id="how-it-works"
        eyebrow="How it works"
        title="From a job description to fair, explained outcomes"
        intro="One pipeline per role. AI does the repetitive screening; your team reviews the evidence and makes the calls."
        muted
      >
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {STEPS.map((s, i) => (
            <li key={s.title} className="relative grid content-start gap-3 rounded-xl border bg-card p-5 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <s.icon className="size-5" aria-hidden />
                </span>
                <span className="text-sm font-semibold text-muted-foreground tabular-nums">0{i + 1}</span>
              </div>
              <h3 className="font-semibold">{s.title}</h3>
              <p className="text-sm text-muted-foreground">{s.body}</p>
            </li>
          ))}
        </ol>
      </Section>

      {/* Features */}
      <Section id="features" eyebrow="For hiring teams" title="Everything between the job post and the shortlist">
        <div className="grid gap-20 sm:gap-28">
          <FeatureRow
            eyebrow="Pipeline builder"
            title="A screening pipeline drafted from a conversation"
            body="Describe the role and Hirevine proposes the steps, criteria, cutoffs, quiz and interview rubric. Change anything on the visual editor or just ask in chat, preview the diff, and undo whenever you like."
            points={["Weighted criteria with must-haves", "Timed skills quiz generated for the role", "Interview themes and scoring rubric", "Version history with one-click undo"]}
            image={{ src: "/screens/workflow-editor.png", alt: "Pipeline editor with resume screening and final review steps" }}
          />
          <FeatureRow
            reverse
            eyebrow="Voice AI interview"
            title="A first-round interview that knows the candidate's resume"
            body="Candidates join a call-style interview at a time that suits them. The AI interviewer asks one question at a time about the projects and tools on their own resume, follows up on their answers, and scores the transcript against your rubric."
            points={["Questions read aloud, answers spoken", "Grounded in the candidate's redacted resume", "Live transcript; recordings never stored", "Consistent scoring: 0.24 pt std dev across re-runs"]}
            image={{ src: "/screens/candidate-interview.png", alt: "The voice AI interview as a call with a live transcript panel" }}
          />
          <FeatureRow
            eyebrow="Evidence-first review"
            title="See why, not just a number"
            body="Each applicant's page shows the scores for every step with the exact resume lines and interview answers they rest on. Flags highlight anything that needs a person: missing evidence, unusual text, or a model that couldn't finish."
            points={["Citations you can click to the source line", "Prompt-injection and keyword-stuffing flags", "Manual scoring and overrides at every step", "AI-drafted feedback you edit before release"]}
            image={{ src: "/screens/campaign.png", alt: "Campaign view with applicants, stages, statuses and match scores" }}
          />
          <FeatureRow
            reverse
            eyebrow="Analytics"
            title="Know where your funnel leaks"
            body="Per-campaign funnels, score distributions with the pass mark, time per stage, and what would change at a different cutoff. Across all jobs: applications per week, time to shortlist and how often your team agrees with the AI."
            points={["Cutoff impact before you change it", "Drop-off per stage", "AI agreement and unedited-draft rates", "Every chart has a table view"]}
            image={{ src: "/screens/analytics-campaign.png", alt: "Campaign analytics with funnel, cutoff impact and score distribution" }}
          />
        </div>
      </Section>

      {/* Responsible AI */}
      <Section
        eyebrow="Responsible by design"
        title="Built so you can explain every outcome"
        intro="Automated screening is only useful if it's fair and explainable. These rules are enforced in code, and we measure them."
        muted
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PRINCIPLES.map((p) => (
            <div key={p.title} className="grid content-start gap-2 rounded-xl border bg-card p-5">
              <p.icon className="size-5 text-primary" aria-hidden />
              <h3 className="font-semibold">{p.title}</h3>
              <p className="text-sm text-muted-foreground">{p.body}</p>
            </div>
          ))}
        </div>
        <div className="mt-12 grid gap-4 rounded-2xl border bg-card p-6 sm:grid-cols-2 sm:p-8 lg:grid-cols-4">
          {RESULTS.map((r) => (
            <div key={r.label} className="grid content-start gap-1">
              <span className="text-3xl font-bold tracking-tight text-primary tabular-nums">{r.value}</span>
              <span className="text-sm font-medium">{r.label}</span>
              <span className="text-xs text-muted-foreground">{r.note}</span>
            </div>
          ))}
        </div>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          Measured on synthetic data with the production code. <Link href="/responsible-ai" className="font-medium text-primary hover:underline">How we test →</Link>
        </p>
      </Section>

      {/* Candidates teaser */}
      <Section>
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
          <Screenshot src="/screens/journey-feedback.png" alt="A candidate's released feedback with the resume lines the review relied on" />
          <div className="grid gap-4">
            <p className="text-sm font-semibold text-primary">For candidates</p>
            <h2 className="text-3xl font-bold tracking-tight text-balance">Every applicant hears back, with reasons</h2>
            <p className="text-muted-foreground">
              Candidates follow each step in one place, take the quiz and interview when it suits them, and receive personal
              feedback that points to what in their resume and answers made the difference.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button asChild variant="outline">
                <Link href="/candidates">What candidates experience</Link>
              </Button>
              <Button asChild variant="ghost">
                <a href={LINKS.browseJobs}>
                  Browse open roles <ArrowRight />
                </a>
              </Button>
            </div>
          </div>
        </div>
      </Section>

      {/* Pricing */}
      <Section id="pricing" eyebrow="Pricing" title="Free while we're in pilot" intro="Run real hiring with Hirevine today. Paid plans come later, with notice." center muted>
        <div className="grid gap-4 lg:grid-cols-3">
          {PLANS.map((p) => (
            <div
              key={p.name}
              className={
                "flex flex-col gap-6 rounded-2xl border bg-card p-6 " + (p.highlight ? "border-primary shadow-lg ring-1 ring-primary" : "")
              }
            >
              <div className="grid gap-1">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold">{p.name}</h3>
                  <Badge variant={p.highlight ? "default" : "secondary"}>{p.badge}</Badge>
                </div>
                <p className="text-3xl font-bold tracking-tight">{p.price}</p>
                <p className="text-sm text-muted-foreground">{p.note}</p>
              </div>
              <ul className="grid flex-1 content-start gap-2 text-sm">
                {p.features.map((f) => (
                  <li key={f} className="flex gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                    {f}
                  </li>
                ))}
              </ul>
              <Button asChild variant={p.highlight ? "default" : "outline"}>
                <a href={p.cta.href}>{p.cta.label}</a>
              </Button>
            </div>
          ))}
        </div>
      </Section>

      {/* FAQ */}
      <Section id="faq" eyebrow="FAQ" title="Questions hiring teams ask" center>
        <Faq items={FAQ} />
      </Section>

      {/* Contact */}
      <div id="contact" className="scroll-mt-20">
        <CtaBand
          title="Run your next role on Hirevine"
          body="Create a free pilot account, describe a role, and have a screening pipeline ready to publish in minutes."
        />
        <div className="mx-auto -mt-8 mb-16 flex max-w-6xl flex-wrap items-center justify-center gap-x-6 gap-y-2 px-4 text-sm text-muted-foreground sm:px-6">
          <span className="flex items-center gap-1.5">
            <PenLine className="size-4" aria-hidden /> Questions or a pilot for a larger team?
          </span>
          {CONTACT_EMAIL ? (
            <a href={`mailto:${CONTACT_EMAIL}`} className="font-medium text-primary hover:underline">
              Email us
            </a>
          ) : (
            <a href={`${LINKS.github}/issues`} className="font-medium text-primary hover:underline">
              Open an issue on GitHub
            </a>
          )}
          <a href={MANAGER_URL} className="flex items-center gap-1.5 hover:text-foreground">
            <ListChecks className="size-4" aria-hidden /> Already a pilot team? Sign in
          </a>
        </div>
      </div>
    </>
  );
}
