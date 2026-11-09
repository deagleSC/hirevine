"use client";

import { safeNextPath } from "@hirevine/api-client";
import { CenteredPage, SignInForm } from "@hirevine/ui";
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
        <p className="text-center text-sm text-muted-foreground">
          New to Hirevine?{" "}
          <Link className="text-primary underline-offset-4 hover:underline" href="/sign-up">
            Create an account
          </Link>
        </p>
      }
    />
  );
}

export default function SignInPage() {
  return (
    <CenteredPage>
      <Suspense>
        <SignIn />
      </Suspense>
    </CenteredPage>
  );
}
