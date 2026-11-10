"use client";

import { CandidateShell } from "@/components/candidate-shell";
import { NavUser } from "@hirevine/ui/blocks/nav-user";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { useMe } from "@/lib/api";
import { supabase } from "@/lib/supabase";

export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const me = useMe();

  return (
    <CandidateShell
      subtitle="Candidate"
      footer={
        <NavUser
          user={me.data ? { name: me.data.display_name, subtitle: me.data.email } : undefined}
          onSignOut={async () => {
            await supabase().auth.signOut();
            queryClient.clear();
            router.replace("/sign-in");
            router.refresh();
          }}
        />
      }
    >
      {children}
    </CandidateShell>
  );
}
