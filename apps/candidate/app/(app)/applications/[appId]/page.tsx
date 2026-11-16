"use client";

import { messageFor, qk, unwrap } from "@hirevine/api-client";
import { PageHeader } from "@hirevine/ui/blocks/dashboard-layout";
import { ErrorState, PageSkeleton, StatusCard } from "@hirevine/ui/blocks/states";
import { StatusBadge } from "@hirevine/ui/blocks/status-badge";
import { Button } from "@hirevine/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, CircleDot, Clock, Inbox } from "lucide-react";
import Link from "next/link";
import { use } from "react";

import { api } from "@/lib/api";

const NEXT_STEP = {
  received: "We have your application and will start reviewing your resume shortly.",
  in_review: "Your application is being reviewed. We'll let you know as soon as there is a next step.",
  action_required: "You have a step to complete.",
  outcome_released: "The hiring team has released the outcome.",
} as const;

/** Neutral progress only: no scores or ranks before release (§8.3). */
export default function ApplicationPage({ params }: { params: Promise<{ appId: string }> }) {
  const { appId } = use(params);
  const app = useQuery({
    queryKey: qk.myApplication(appId),
    queryFn: () => unwrap(api.GET("/v1/candidate/applications/{application_id}", { params: { path: { application_id: appId } } })),
  });

  if (app.isError) return <ErrorState message={messageFor(app.error)} />;
  if (app.isPending) return <PageSkeleton />;
  const a = app.data;

  const ICON = {
    received: <Inbox />,
    in_review: <Clock />,
    action_required: <CircleDot />,
    outcome_released: <CheckCircle2 />,
  } as const;
  const action =
    a.status === "outcome_released" ? (
      <Button asChild>
        <Link href={`/applications/${a.id}/feedback`}>View outcome and feedback</Link>
      </Button>
    ) : a.next_action ? (
      <Button asChild>
        <Link href={`/applications/${a.id}/${a.next_action}`}>
          {a.next_action === "quiz"
            ? a.action_deadline_at ? "Continue quiz" : "Take quiz"
            : a.action_deadline_at ? "Continue interview" : "Start interview"}
        </Link>
      </Button>
    ) : null;

  return (
    <>
      <PageHeader
        title={a.job_title}
        description={`Applied ${new Date(a.created_at).toLocaleDateString()}`}
        badge={<StatusBadge status={a.status} />}
        back={{ href: "/applications", label: "My applications" }}
      />
      <StatusCard
        icon={ICON[a.status]}
        tone={a.status === "outcome_released" ? "success" : "default"}
        title="Next step"
        description={
          <>
            {NEXT_STEP[a.status]}
            {a.action_deadline_at ? (
              <span className="mt-1 block">
                In progress — finish before{" "}
                {new Date(a.action_deadline_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.
              </span>
            ) : null}
          </>
        }
        actions={action}
      />
    </>
  );
}
