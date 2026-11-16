import { CircleAlert } from "lucide-react";
import type { ReactNode } from "react";

import { Alert, AlertDescription, AlertTitle } from "@hirevine/ui/components/alert";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@hirevine/ui/components/empty";
import { Skeleton } from "@hirevine/ui/components/skeleton";

/** shadcn Empty block for zero-data lists. */
export function EmptyState({
  icon,
  title,
  description,
  children,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <Empty className="border border-dashed">
      <EmptyHeader>
        {icon ? <EmptyMedia variant="icon">{icon}</EmptyMedia> : null}
        <EmptyTitle>{title}</EmptyTitle>
        {description ? <EmptyDescription>{description}</EmptyDescription> : null}
      </EmptyHeader>
      {children ? <EmptyContent>{children}</EmptyContent> : null}
    </Empty>
  );
}

export function ErrorState({ title = "Something went wrong", message }: { title?: string; message: string }) {
  return (
    <Alert variant="destructive">
      <CircleAlert />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

export function PageSkeleton() {
  return (
    <div className="grid gap-6" role="status" aria-label="Loading" aria-busy>
      <div className="space-y-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80" />
      </div>
      <Skeleton className="h-40 w-full rounded-xl" />
    </div>
  );
}

/**
 * A full-width status message for a page whose main task is done or unavailable: icon, title, short
 * description and actions. Actions sit to the right on wider screens and below on phones.
 */
export function StatusCard({
  icon,
  tone = "default",
  title,
  description,
  actions,
}: {
  icon?: ReactNode;
  tone?: "default" | "success";
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4 rounded-xl border bg-card p-5 text-card-foreground shadow-sm sm:flex-row sm:items-center sm:p-6">
      {icon ? (
        <span
          className={
            "flex size-10 shrink-0 items-center justify-center rounded-full [&_svg]:size-5 " +
            (tone === "success"
              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : "bg-primary/10 text-primary")
          }
          aria-hidden
        >
          {icon}
        </span>
      ) : null}
      <div className="grid min-w-0 flex-1 gap-1">
        <h2 className="font-semibold leading-snug">{title}</h2>
        {description ? <div className="text-sm text-muted-foreground">{description}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </section>
  );
}
