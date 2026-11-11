"use client";

import { DashboardLayout } from "@hirevine/ui/blocks/dashboard-layout";
import type { NavItem } from "@hirevine/ui/blocks/nav-main";
import { NavUser } from "@hirevine/ui/blocks/nav-user";
import { useQueryClient } from "@tanstack/react-query";
import { FolderKanban, MessageSquarePlus, ChartColumn } from "lucide-react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { useMe } from "@/lib/api";
import { supabase } from "@/lib/supabase";

const nav: NavItem[] = [
  { title: "Jobs", url: "/", icon: FolderKanban },
  { title: "New job", url: "/jobs/new", icon: MessageSquarePlus },
  { title: "Analytics", url: "/analytics", icon: ChartColumn },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const me = useMe();

  return (
    <DashboardLayout
      subtitle="Hiring"
      homeHref="/"
      nav={nav}
      footer={
        <NavUser
          user={me.data ? { name: me.data.display_name, subtitle: me.data.org_name } : undefined}
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
    </DashboardLayout>
  );
}
