import type { NextRequest } from "next/server";

import { handleSession } from "./lib/session-middleware";

// Pages that work signed out (browse and share links, policy pages).
const PUBLIC_PATHS = ["/", "/jobs", "/a", "/privacy", "/terms", "/ai-evaluation"];

export function middleware(request: NextRequest) {
  return handleSession(request, "candidate", PUBLIC_PATHS, "/applications");
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
