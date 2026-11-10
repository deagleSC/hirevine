"use client";

import { Button } from "@hirevine/ui/components/button";
import Link from "next/link";
import type { ReactNode } from "react";

import { CandidateShell } from "./candidate-shell";
import { CandidateUserMenu, useSignedIn } from "./user-menu";

/** Shell for pages guests can see: account menu when signed in, sign-in buttons otherwise. */
export function PublicShell({ children }: { children: ReactNode }) {
  const signedIn = useSignedIn();

  return (
    <CandidateShell
      subtitle={signedIn ? "Candidate" : "Job search"}
      footer={signedIn ? <CandidateUserMenu /> : undefined}
      actions={
        signedIn === false ? (
          <>
            <Button asChild variant="ghost" size="sm">
              <Link href="/sign-in">Sign in</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/sign-up">Create account</Link>
            </Button>
          </>
        ) : undefined
      }
    >
      {children}
    </CandidateShell>
  );
}
