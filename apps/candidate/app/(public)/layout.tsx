import { CandidateShell } from "@/components/candidate-shell";
import { Button } from "@hirevine/ui/components/button";
import Link from "next/link";
import type { ReactNode } from "react";


export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <CandidateShell
      subtitle="Job search"
      actions={
        <>
          <Button asChild variant="ghost" size="sm">
            <Link href="/sign-in">Sign in</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/sign-up">Create account</Link>
          </Button>
        </>
      }
    >
      {children}
    </CandidateShell>
  );
}
