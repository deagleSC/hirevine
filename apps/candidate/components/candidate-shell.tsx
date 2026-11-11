"use client";

import { DashboardLayout, type DashboardLayoutProps } from "@hirevine/ui/blocks/dashboard-layout";
import type { NavItem } from "@hirevine/ui/blocks/nav-main";
import { ChartColumn, ScrollText, Search, UserRound } from "lucide-react";

const nav: NavItem[] = [
  { title: "Browse jobs", url: "/jobs", icon: Search },
  { title: "My applications", url: "/applications", icon: ScrollText },
  { title: "My analytics", url: "/analytics", icon: ChartColumn },
  { title: "Account", url: "/account", icon: UserRound },
];

/** Candidate app shell. Client-side so the nav icons stay out of RSC props. */
export function CandidateShell(props: Omit<DashboardLayoutProps, "nav" | "homeHref">) {
  return <DashboardLayout homeHref="/jobs" nav={nav} {...props} />;
}
