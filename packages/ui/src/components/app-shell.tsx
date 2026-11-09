import * as React from "react";

import { cn } from "../lib/cn";

export interface AppShellProps {
  product: string;
  nav?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/** Shared page frame: top bar with product name, navigation and account actions. */
export function AppShell({ product, nav, actions, children, className }: AppShellProps) {
  return (
    <div className="min-h-dvh">
      <header className="border-b bg-card">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
          <span className="font-semibold">{product}</span>
          {nav ? <nav className="flex flex-1 items-center gap-4 text-sm">{nav}</nav> : <div className="flex-1" />}
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </div>
      </header>
      <main className={cn("mx-auto max-w-6xl px-4 py-8", className)}>{children}</main>
    </div>
  );
}

export function CenteredPage({ children }: { children: React.ReactNode }) {
  return <main className="flex min-h-dvh items-center justify-center px-4 py-10">{children}</main>;
}
