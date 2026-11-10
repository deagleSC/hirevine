import { Clock, Hourglass } from "lucide-react";
import type { ReactNode } from "react";

import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@hirevine/ui/components/empty";
import { Spinner } from "@hirevine/ui/components/spinner";

export type ProcessingStateStatus = "processing" | "queued_budget";

export interface ProcessingStateProps {
  status: ProcessingStateStatus;
  /** Still processing well past the usual time (see `isTakingLong` in @hirevine/api-client). */
  takingLong?: boolean;
  /** What is being worked on, e.g. "Screening your resume". */
  title?: string;
  children?: ReactNode;
}

const COPY = {
  processing: {
    title: "Processing",
    description: "This usually takes a minute or two. This page updates on its own.",
  },
  takingLong: {
    title: "Taking longer than usual",
    description: "It's still being worked on. You can leave this page; the result will be here when it's ready.",
  },
  queued_budget: {
    title: "Queued, will process tomorrow",
    description:
      "We've reached today's processing limit. This is saved and will be processed automatically after midnight UTC.",
  },
} as const;

/** Standard async state for background work (frontend plan §151, §329). */
export function ProcessingState({ status, takingLong = false, title, children }: ProcessingStateProps) {
  const copy = status === "queued_budget" ? COPY.queued_budget : takingLong ? COPY.takingLong : COPY.processing;
  const icon =
    status === "queued_budget" ? <Clock /> : takingLong ? <Hourglass /> : <Spinner className="size-6" role="presentation" aria-hidden />;

  return (
    <Empty className="border border-dashed" role="status" aria-live="polite" data-status={status}>
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon}</EmptyMedia>
        <EmptyTitle>{status === "processing" && !takingLong && title ? title : copy.title}</EmptyTitle>
        <EmptyDescription>{copy.description}</EmptyDescription>
      </EmptyHeader>
      {children ? <EmptyContent>{children}</EmptyContent> : null}
    </Empty>
  );
}
