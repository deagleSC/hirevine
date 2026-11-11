"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { ErrorMonitoring } from "@hirevine/ui/blocks/error-monitoring";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } } }),
  );
  return (
    <QueryClientProvider client={client}>
      <ErrorMonitoring
        dsn={process.env.NEXT_PUBLIC_SENTRY_DSN}
        app="manager"
        environment={process.env.NEXT_PUBLIC_VERCEL_ENV}
        release={process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA}
      />
      {children}
    </QueryClientProvider>
  );
}
