"use client";

import { ensureProfile, messageFor, type ProfileCreate } from "@hirevine/api-client";
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  CenteredPage,
  Field,
} from "@hirevine/ui";
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

  return (
    <CenteredPage>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Create your account</CardTitle>
          <CardDescription>Apply to roles and follow every step in one place.</CardDescription>
        </CardHeader>
        {checkEmail ? (
          <CardContent>
            <Alert tone="success">Check your email to confirm your account, then sign in.</Alert>
          </CardContent>
        ) : (
          <form onSubmit={onSubmit}>
            <CardContent className="grid gap-4">
              {error ? <Alert tone="error">{error}</Alert> : null}
              <Field label="Your name" name="display_name" autoComplete="name" required maxLength={200} />
              <Field label="Email" name="email" type="email" autoComplete="email" required />
              <Field
                label="Password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                hint="At least 8 characters."
              />
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="adult" required className="mt-0.5 h-4 w-4" />
                <span>I confirm I am 18 or older.</span>
              </label>
            </CardContent>
            <CardFooter className="flex-col items-stretch gap-3">
              <Button type="submit" disabled={pending}>
                {pending ? "Creating account…" : "Create account"}
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                Already have an account?{" "}
                <Link className="text-primary underline-offset-4 hover:underline" href="/sign-in">
                  Sign in
                </Link>
              </p>
            </CardFooter>
          </form>
        )}
      </Card>
    </CenteredPage>
  );
}
