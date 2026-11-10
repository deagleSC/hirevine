"use client";

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
        <div className="flex flex-1 flex-col gap-6 p-6 pt-0">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}

/** Page title block used at the top of every dashboard page. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
