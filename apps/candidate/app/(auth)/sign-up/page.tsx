"use client";

import { ensureProfile, messageFor, type ProfileCreate } from "@hirevine/api-client";
import { AuthFormHeading, FormError } from "@hirevine/ui/blocks/sign-in-form";
import { Alert, AlertDescription, AlertTitle } from "@hirevine/ui/components/alert";
import { Button } from "@hirevine/ui/components/button";
import { Checkbox } from "@hirevine/ui/components/checkbox";
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
    if (form.get("adult") !== "on") return setError("You must be 18 or older to use Hirevine.");
    const details: ProfileCreate = {
      role: "candidate",
      display_name: String(form.get("display_name") ?? "").trim(),
      org_name: null,
      adult_confirmed: true,
    };
    setPending(true);
    setError(null);
    try {
      const { data, error: signUpError } = await supabase().auth.signUp({
        email: String(form.get("email") ?? ""),
        password: String(form.get("password") ?? ""),
        options: { data: details, emailRedirectTo: `${window.location.origin}/applications` },
      });
      if (signUpError) return setError(signUpError.message);
      if (!data.session) return setCheckEmail(true);
      await ensureProfile(api, async () => details);
      router.replace("/applications");
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
        <AuthFormHeading title="Create your account" description="Apply to roles and follow every step in one place." />
        {error ? <FormError message={error} /> : null}
        <Field>
          <FieldLabel htmlFor="display_name">Your name</FieldLabel>
          <Input id="display_name" name="display_name" autoComplete="name" required maxLength={200} />
        </Field>
        <Field>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input id="email" name="email" type="email" autoComplete="email" placeholder="you@example.com" required />
        </Field>
        <Field>
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} />
          <FieldDescription>At least 8 characters.</FieldDescription>
        </Field>
        <Field orientation="horizontal">
          <Checkbox id="adult" name="adult" required />
          <FieldLabel htmlFor="adult" className="font-normal">
            I confirm I am 18 or older.
          </FieldLabel>
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
