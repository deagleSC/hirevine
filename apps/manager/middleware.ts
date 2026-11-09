import type { NextRequest } from "next/server";

import { handleSession } from "./lib/session-middleware";

export function middleware(request: NextRequest) {
  return handleSession(request, "manager", [], "/");
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
