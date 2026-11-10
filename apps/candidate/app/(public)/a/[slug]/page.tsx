"use client";

import { messageFor, unwrap } from "@hirevine/api-client";
import { ErrorState, PageSkeleton } from "@hirevine/ui/blocks/states";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { use, useEffect } from "react";

import { api } from "@/lib/api";

/** Share links: resolve the slug, then show the job page. */
export default function ShareLinkPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const router = useRouter();
  const job = useQuery({
    queryKey: ["share", slug],
    queryFn: () => unwrap(api.GET("/v1/public/share/{slug}", { params: { path: { slug } } })),
    retry: false,
  });

  useEffect(() => {
    if (job.data) router.replace(`/jobs/${job.data.id}`);
  }, [job.data, router]);

  if (job.isError) return <ErrorState title="Link not active" message={messageFor(job.error)} />;
  return <PageSkeleton />;
}
