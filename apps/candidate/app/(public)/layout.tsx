import { AppShell, Button } from "@hirevine/ui";
import Link from "next/link";
import type { ReactNode } from "react";

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell
      product="Hirevine"
      nav={
        <Link href="/jobs" className="text-muted-foreground hover:text-foreground">
          Jobs
        </Link>
      }
      actions={
        <Button asChild variant="outline" size="sm">
          <Link href="/applications">My applications</Link>
        </Button>
      }
    >
      {children}
    </AppShell>
  );
}
