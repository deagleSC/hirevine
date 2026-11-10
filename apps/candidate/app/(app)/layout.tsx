import type { ReactNode } from "react";

import { CandidateShell } from "@/components/candidate-shell";
import { CandidateUserMenu } from "@/components/user-menu";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <CandidateShell subtitle="Candidate" footer={<CandidateUserMenu />}>
      {children}
    </CandidateShell>
  );
}
