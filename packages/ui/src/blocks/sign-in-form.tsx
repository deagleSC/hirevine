"use client";

import { useState, type FormEvent, type ReactNode } from "react";

import { Alert, AlertDescription } from "@hirevine/ui/components/alert";
import { Button } from "@hirevine/ui/components/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@hirevine/ui/components/field";
import { Input } from "@hirevine/ui/components/input";
import { Spinner } from "@hirevine/ui/components/spinner";
import { cn } from "@hirevine/ui/lib/utils";

export interface SignInFormProps {
  title: string;
  description: string;
  /** Return an error message to show, or nothing on success. */
  onSubmit: (email: string, password: string) => Promise<string | void>;
  footer?: ReactNode;
  className?: string;
}

/** shadcn login-02 form wired to a submit callback. */
export function SignInForm({ title, description, onSubmit, footer, className }: SignInFormProps) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      const message = await onSubmit(String(form.get("email") ?? ""), String(form.get("password") ?? ""));
      if (message) setError(message);
    } finally {
      setPending(false);
    }
  }

  return (
    <form className={cn("flex flex-col gap-6", className)} onSubmit={handleSubmit}>
      <FieldGroup>
        <AuthFormHeading title={title} description={description} />
        {error ? <FormError message={error} /> : null}
        <Field>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input id="email" name="email" type="email" placeholder="you@example.com" autoComplete="email" required />
        </Field>
        <Field>
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </Field>
        <Field>
          <Button type="submit" disabled={pending}>
            {pending ? <Spinner /> : null}
            {pending ? "Signing in…" : "Sign in"}
          </Button>
          {footer ? <FieldDescription className="text-center">{footer}</FieldDescription> : null}
        </Field>
      </FieldGroup>
    </form>
  );
}

export function AuthFormHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col items-center gap-1 text-center">
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="text-sm text-balance text-muted-foreground">{description}</p>
    </div>
  );
}

export function FormError({ message }: { message: string }) {
  return (
    <Alert variant="destructive">
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
