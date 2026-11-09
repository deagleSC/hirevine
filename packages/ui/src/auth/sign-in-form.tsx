"use client";

import * as React from "react";

import { Alert } from "../components/alert";
import { Button } from "../components/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "../components/card";
import { Field } from "../components/field";

export interface SignInFormProps {
  title: string;
  description: string;
  /** Return an error message to show, or nothing on success. */
  onSubmit: (email: string, password: string) => Promise<string | void>;
  footer?: React.ReactNode;
}

export function SignInForm({ title, description, onSubmit, footer }: SignInFormProps) {
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
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
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit} noValidate={false}>
        <CardContent className="grid gap-4">
          {error ? <Alert tone="error">{error}</Alert> : null}
          <Field label="Email" name="email" type="email" autoComplete="email" required />
          <Field label="Password" name="password" type="password" autoComplete="current-password" required />
        </CardContent>
        <CardFooter className="flex-col items-stretch gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? "Signing in…" : "Sign in"}
          </Button>
          {footer}
        </CardFooter>
      </form>
    </Card>
  );
}
