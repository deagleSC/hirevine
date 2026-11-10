"use client";

import { safeNextPath } from "@hirevine/api-client";
import { SignInForm } from "@hirevine/ui/blocks/sign-in-form";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { supabase } from "@/lib/supabase";

function SignIn() {
  const router = useRouter();
  const next = safeNextPath(useSearchParams().get("next"));

  return (
    <SignInForm
      title="Sign in to Hirevine"
      description="For hiring managers and recruiters."
      onSubmit={async (email, password) => {
        const { error } = await supabase().auth.signInWithPassword({ email, password });
        if (error) return error.message;
        router.replace(next);
        router.refresh();
      }}
      footer={
        <>
          New to Hirevine? <Link href="/sign-up">Create an account</Link>
        </>
      }
    />
  );
}

export default function SignInPage() {
  return (
    <Suspense>
      <SignIn />
    </Suspense>
  );
}
