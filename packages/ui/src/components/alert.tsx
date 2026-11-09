import * as React from "react";

import { cn } from "../lib/cn";

const tones = {
  info: "border-border bg-muted text-foreground",
  error: "border-destructive/40 bg-destructive/10 text-destructive",
  success: "border-success/40 bg-success/10 text-success",
} as const;

export function Alert({
  tone = "info",
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { tone?: keyof typeof tones }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn("rounded-md border px-4 py-3 text-sm", tones[tone], className)}
      {...props}
    />
  );
}
