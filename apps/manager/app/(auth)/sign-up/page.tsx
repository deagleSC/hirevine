"use client";

import { ensureProfile, messageFor, type ProfileCreate } from "@hirevine/api-client";
import { AuthFormHeading, FormError } from "@hirevine/ui/blocks/sign-in-form";
import { Alert, AlertDescription, AlertTitle } from "@hirevine/ui/components/alert";
import { Button } from "@hirevine/ui/components/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@hirevine/ui/components/field";
import { Input } from "@hirevine/ui/components/input";
import { Spinner } from "@hirevine/ui/components/spinner";
import { MailCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { api } from "@/lib/api";
import { supabase } from "@/lib/supabase";

export default function SignUpPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [checkEmail, setCheckEmail] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const details: ProfileCreate = {
      role: "manager",
      display_name: String(form.get("display_name") ?? "").trim(),
      org_name: String(form.get("org_name") ?? "").trim(),
      adult_confirmed: true,
    };
    setPending(true);
    setError(null);
    try {
      const { data, error: signUpError } = await supabase().auth.signUp({
        email: String(form.get("email") ?? ""),
        password: String(form.get("password") ?? ""),
        options: { data: details, emailRedirectTo: `${window.location.origin}/` },
      });
      if (signUpError) return setError(signUpError.message);
      if (!data.session) return setCheckEmail(true); // email confirmation is on
      await ensureProfile(api, async () => details);
      router.replace("/");
      router.refresh();
    } catch (e) {
      setError(messageFor(e));
    } finally {
      setPending(false);
    }
  }

  if (checkEmail) {
    return (
      <Alert>
        <MailCheck />
        <AlertTitle>Check your email</AlertTitle>
        <AlertDescription>Confirm your account from the link we sent, then sign in.</AlertDescription>
      </Alert>
    );
  }

  return (
    <form className="flex flex-col gap-6" onSubmit={onSubmit}>
      <FieldGroup>
        <AuthFormHeading
          title="Create your hiring account"
          description="Set up your organization to start screening candidates."
        />
        {error ? <FormError message={error} /> : null}
        <Field>
          <FieldLabel htmlFor="display_name">Your name</FieldLabel>
          <Input id="display_name" name="display_name" autoComplete="name" required maxLength={200} />
        </Field>
        <Field>
          <FieldLabel htmlFor="org_name">Organization</FieldLabel>
          <Input id="org_name" name="org_name" autoComplete="organization" required maxLength={200} />
        </Field>
        <Field>
          <FieldLabel htmlFor="email">Work email</FieldLabel>
          <Input id="email" name="email" type="email" autoComplete="email" placeholder="you@company.com" required />
        </Field>
        <Field>
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} />
          <FieldDescription>At least 8 characters.</FieldDescription>
        </Field>
        <Field>
          <Button type="submit" disabled={pending}>
            {pending ? <Spinner /> : null}
            {pending ? "Creating account…" : "Create account"}
          </Button>
          <FieldDescription className="text-center">
            Already have an account? <Link href="/sign-in">Sign in</Link>
          </FieldDescription>
        </Field>
      </FieldGroup>
    </form>
  );
}
