/** Site-wide constants and URLs for the Hirevine marketing site. */

export const SITE_NAME = "Hirevine";
export const SITE_TAGLINE = "AI does the screening work; people make the decisions.";
export const SITE_DESCRIPTION =
  "Hirevine runs the screening for a role — resume review, a skills quiz and a spoken AI interview — with every score backed by quoted evidence, and leaves every decision and every word of feedback to your hiring team.";

export const KEYWORDS = [
  "AI hiring",
  "resume screening",
  "AI interview",
  "voice interview",
  "candidate feedback",
  "skills assessment",
  "hiring pipeline",
  "responsible AI recruiting",
  "Hirevine",
];

function url(name: string, fallback: string): string {
  return (process.env[name]?.trim() || fallback).replace(/\/+$/, "");
}

export function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return "http://localhost:3002";
}

export const MANAGER_URL = url("NEXT_PUBLIC_MANAGER_URL", "https://hirevine-manager.vercel.app");
export const CANDIDATE_URL = url("NEXT_PUBLIC_CANDIDATE_URL", "https://hirevine-candidate.vercel.app");
export const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() || null;

export const LINKS = {
  managerSignUp: `${MANAGER_URL}/sign-up`,
  managerSignIn: `${MANAGER_URL}/sign-in`,
  browseJobs: `${CANDIDATE_URL}/jobs`,
  candidateSignUp: `${CANDIDATE_URL}/sign-up`,
  github: "https://github.com/deagleSC/hirevine",
};

export const NAV = [
  { label: "How it works", href: "/#how-it-works" },
  { label: "Features", href: "/#features" },
  { label: "Responsible AI", href: "/responsible-ai" },
  { label: "For candidates", href: "/candidates" },
  { label: "Pricing", href: "/#pricing" },
];

export const FOOTER = [
  {
    title: "Product",
    links: [
      { label: "How it works", href: "/#how-it-works" },
      { label: "Features", href: "/#features" },
      { label: "Pricing", href: "/#pricing" },
      { label: "FAQ", href: "/#faq" },
    ],
  },
  {
    title: "People",
    links: [
      { label: "For hiring teams", href: "/#features" },
      { label: "For candidates", href: "/candidates" },
      { label: "Browse open roles", href: LINKS.browseJobs },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", href: "/about" },
      { label: "Responsible AI", href: "/responsible-ai" },
      { label: "Contact", href: "/#contact" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy", href: "/privacy" },
      { label: "Terms", href: "/terms" },
    ],
  },
];

/** Measured on synthetic data with the production code paths (see the repo README). */
export const RESULTS = [
  { value: "0.963", label: "Rank agreement with labelled resumes", note: "Spearman, 12 resumes in 3 bands" },
  { value: "0%", label: "Bias variants over tolerance", note: "42 name and signal swaps; mean change 0.72 pts" },
  { value: "100%", label: "Planted prompt injections flagged", note: "0 score changes across 12 attempts" },
  { value: "0.24", label: "Interview score std dev across re-runs", note: "Points on a 0–100 scale; target ≤ 5" },
];
