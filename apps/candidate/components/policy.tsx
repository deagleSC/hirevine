import { PageHeader } from "@hirevine/ui/blocks/dashboard-layout";
import { Alert, AlertDescription } from "@hirevine/ui/components/alert";
import Link from "next/link";
import type { ReactNode } from "react";

/** Shared frame for the policy pages: title, the draft notice, readable prose and cross-links. */
export function PolicyPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <div className="max-w-3xl">
      <PageHeader title={title} description={`Last updated ${updated}`} />
      <Alert className="mb-6">
        <AlertDescription>
          Draft for the pilot. This text is pending legal review and may change before Hirevine is used with real applicants.
        </AlertDescription>
      </Alert>
      <div className="grid gap-5 text-sm leading-relaxed [&_h2]:mt-2 [&_h2]:text-base [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_ul]:grid [&_ul]:gap-1">
        {children}
      </div>
      <p className="mt-8 text-xs text-muted-foreground">
        <Link className="underline" href="/privacy">Privacy</Link> · <Link className="underline" href="/terms">Terms</Link> ·{" "}
        <Link className="underline" href="/ai-evaluation">How AI evaluation works</Link>
      </p>
    </div>
  );
}
