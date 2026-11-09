/**
 * Route decisions for each app's middleware. Pure, so it is unit-tested.
 * Redirects are for user experience only: the API's role guards and RLS enforce access.
 */
export type AppName = "manager" | "candidate";

export interface RouteInput {
  app: AppName;
  pathname: string;
  signedIn: boolean;
  /** Role from the user's sign-up metadata; may be missing. */
  role: string | null | undefined;
  /** Paths that work signed out, besides /sign-in and /sign-up. "/x" also matches "/x/...". */
  publicPaths: readonly string[];
}

export type RouteDecision =
  | { type: "next" }
  | { type: "sign-in"; next: string }
  | { type: "other-app" }
  | { type: "home" };

const AUTH_PATHS = ["/sign-in", "/sign-up"];

export function matchesPath(pathname: string, base: string): boolean {
  if (base === "/") return pathname === "/";
  return pathname === base || pathname.startsWith(`${base}/`);
}

export function decideRoute(input: RouteInput): RouteDecision {
  const isAuthPage = AUTH_PATHS.some((p) => matchesPath(input.pathname, p));
  const isPublic = isAuthPage || input.publicPaths.some((p) => matchesPath(input.pathname, p));

  if (!input.signedIn) {
    return isPublic ? { type: "next" } : { type: "sign-in", next: input.pathname };
  }
  if (input.role && input.role !== input.app) return { type: "other-app" };
  if (isAuthPage && input.role === input.app) return { type: "home" };
  return { type: "next" };
}

/** Only allow same-site relative paths as post-sign-in destinations (no open redirects). */
export function safeNextPath(next: string | null | undefined, fallback = "/"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}
