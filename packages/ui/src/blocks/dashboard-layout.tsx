"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Separator } from "@hirevine/ui/components/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@hirevine/ui/components/sidebar";

import { HirevineMark } from "./hirevine-mark";
import { NavMain, type NavItem } from "./nav-main";

export interface DashboardLayoutProps {
  /** Small line under the product name, e.g. "Hiring" or "Candidate". */
  subtitle: string;
  homeHref: string;
  nav: NavItem[];
  /** Sidebar footer, usually <NavUser />. */
  footer?: ReactNode;
  /** Right side of the top bar. */
  actions?: ReactNode;
  children: ReactNode;
}

/** App shell from shadcn sidebar-07: icon-collapsible sidebar with an inset content area. */
export function DashboardLayout({ subtitle, homeHref, nav, footer, actions, children }: DashboardLayoutProps) {
  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" asChild>
                <Link href={homeHref}>
                  <HirevineMark size={32} className="size-8 rounded-lg shadow-none" />
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold">Hirevine</span>
                    <span className="truncate text-xs text-muted-foreground">{subtitle}</span>
                  </div>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <NavMain items={nav} />
        </SidebarContent>
        {footer ? <SidebarFooter>{footer}</SidebarFooter> : null}
        <SidebarRail />
      </Sidebar>
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center justify-between gap-2 px-4 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
          <div className="flex items-center gap-2">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
          </div>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </header>
        <div className="mx-auto flex w-full min-w-0 max-w-[96rem] flex-1 flex-col gap-6 p-4 pt-0 md:p-6 md:pt-0">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}

/**
 * Page title block used at the top of every dashboard page. `back` renders a small link above the
 * title (instead of a "Back to …" button that wraps under the title on phones).
 */
export function PageHeader({
  title,
  description,
  actions,
  back,
  badge,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
  /** Status shown next to the title. */
  badge?: ReactNode;
}) {
  return (
    <div className="grid gap-2">
      {back ? (
        <Link
          href={back.href}
          className="inline-flex w-fit items-center gap-1 rounded-sm text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          {back.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-xl font-semibold tracking-tight break-words sm:text-2xl">{title}</h1>
            {badge}
          </div>
          {description ? <div className="text-sm text-muted-foreground">{description}</div> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

/** Main column plus a side column on large screens; stacks on smaller ones. */
export function SplitLayout({ children, aside, asideWidth = "22rem" }: {
  children: ReactNode;
  aside: ReactNode;
  asideWidth?: string;
}) {
  return (
    <div
      className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_var(--aside)]"
      style={{ ["--aside" as string]: asideWidth }}
    >
      <div className="grid min-w-0 gap-6">{children}</div>
      <aside className="grid min-w-0 gap-6">{aside}</aside>
    </div>
  );
}
