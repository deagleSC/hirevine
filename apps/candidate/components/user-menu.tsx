"use client";

import { NavUser } from "@hirevine/ui/blocks/nav-user";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useMe } from "@/lib/api";
import { supabase } from "@/lib/supabase";

/** `undefined` while checking, then whether a Supabase session exists. Follows sign-in/out. */
export function useSignedIn() {
  const [signedIn, setSignedIn] = useState<boolean>();
  useEffect(() => {
    const auth = supabase().auth;
    void auth.getSession().then(({ data }) => setSignedIn(!!data.session));
    const { data } = auth.onAuthStateChange((_event, session) => setSignedIn(!!session));
    return () => data.subscription.unsubscribe();
  }, []);
  return signedIn;
}

/** Sidebar account menu for a signed-in candidate. */
export function CandidateUserMenu() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const me = useMe();

  return (
    <NavUser
      user={me.data ? { name: me.data.display_name, subtitle: me.data.email } : undefined}
      onSignOut={async () => {
        await supabase().auth.signOut();
        queryClient.clear();
        router.replace("/sign-in");
        router.refresh();
      }}
    />
  );
}
