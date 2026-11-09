"use client";

import { Button } from "@hirevine/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

import { supabase } from "@/lib/supabase";

export function SignOutButton() {
  const router = useRouter();
  const queryClient = useQueryClient();
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={async () => {
        await supabase().auth.signOut();
        queryClient.clear();
        router.replace("/jobs");
        router.refresh();
      }}
    >
      Sign out
    </Button>
  );
}
