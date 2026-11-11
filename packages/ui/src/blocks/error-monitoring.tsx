"use client";

import { useEffect } from "react";

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const PHONE = /\+?\(?\d[\d\s().-]{8,}\d/g;

function scrub<T>(value: T): T {
  if (typeof value === "string") return value.replace(EMAIL, "[EMAIL]").replace(PHONE, "[PHONE]") as T;
  if (Array.isArray(value)) return value.map(scrub) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, scrub(v)])) as T;
  }
  return value;
}

/**
 * Browser error monitoring (Sentry), off unless a DSN is configured. Loaded after the page is idle
 * so it adds nothing to first-load JS. No personal data: no user identity, no URL query strings,
 * and emails/phone numbers are masked in every event.
 */
export function ErrorMonitoring({ dsn, app, environment, release }: { dsn?: string; app: string; environment?: string; release?: string }) {
  useEffect(() => {
    if (!dsn) return;
    let cancelled = false;
    const start = () =>
      void import("@sentry/browser").then((Sentry) => {
        if (cancelled) return;
        Sentry.init({
          dsn,
          environment: environment || "production",
          release: release || undefined,
          sendDefaultPii: false,
          initialScope: { tags: { app } },
          beforeSend(event) {
            if (event.request?.url) event.request.url = event.request.url.split("?")[0];
            delete event.user;
            return scrub(event);
          },
          beforeBreadcrumb(crumb) {
            if (crumb.data?.url && typeof crumb.data.url === "string") crumb.data.url = crumb.data.url.split("?")[0];
            return scrub(crumb);
          },
        });
      });
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
    if (idle) idle(start);
    else setTimeout(start, 1500);
    return () => {
      cancelled = true;
    };
  }, [dsn, app, environment, release]);
  return null;
}
