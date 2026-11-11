import type { ReactNode } from "react";

import { CandidateShell } from "@/components/candidate-shell";
import { NotificationsBell } from "@/components/notifications-bell";
import { CandidateUserMenu } from "@/components/user-menu";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <CandidateShell subtitle="Candidate" footer={<CandidateUserMenu />} actions={<NotificationsBell />}>
      {children}
    </CandidateShell>
  );
}
