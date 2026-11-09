import { AppShell } from "@hirevine/ui";
import Link from "next/link";
import type { ReactNode } from "react";

import { SignOutButton } from "./sign-out-button";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell
      product="Hirevine"
      nav={
        <Link href="/" className="text-muted-foreground hover:text-foreground">
          Jobs
        </Link>
      }
      actions={<SignOutButton />}
    >
      {children}
    </AppShell>
  );
}
