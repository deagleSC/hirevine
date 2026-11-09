import * as React from "react";

import { Input } from "./input";
import { Label } from "./label";

export interface FieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  name: string;
  hint?: string;
}

export function Field({ label, name, hint, id, ...props }: FieldProps) {
  const inputId = id ?? name;
  const hintId = hint ? `${inputId}-hint` : undefined;
  return (
    <div className="grid gap-2">
      <Label htmlFor={inputId}>{label}</Label>
      <Input id={inputId} name={name} aria-describedby={hintId} {...props} />
      {hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
