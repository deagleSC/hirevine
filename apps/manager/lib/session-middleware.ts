import { decideRoute, type AppName } from "@hirevine/api-client";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { env, supabaseConfigured } from "./env";

/**
 * Refresh the Supabase session cookie and apply the app's route rules.
 * Redirects are for user experience only: the API and RLS enforce access.
 */
export async function handleSession(
  request: NextRequest,
  app: AppName,
  publicPaths: readonly string[],
  homePath: string,
): Promise<NextResponse> {
  if (!supabaseConfigured()) {
    return new NextResponse(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
      { status: 500 },
    );
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(env.supabaseUrl, env.supabaseKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const decision = decideRoute({
    app,
    pathname: request.nextUrl.pathname,
    signedIn: Boolean(user),
    role: user?.user_metadata?.role as string | undefined,
    publicPaths,
  });

  const redirect = (url: URL | string) => {
    const r = NextResponse.redirect(url);
    response.cookies.getAll().forEach((c) => r.cookies.set(c));
    return r;
  };

  switch (decision.type) {
    case "next":
      return response;
    case "sign-in": {
      const url = request.nextUrl.clone();
      url.pathname = "/sign-in";
      url.search = decision.next === homePath ? "" : `?next=${encodeURIComponent(decision.next)}`;
      return redirect(url);
    }
    case "home": {
      const url = request.nextUrl.clone();
      url.pathname = homePath;
      url.search = "";
      return redirect(url);
    }
    case "other-app":
      return redirect(env.otherAppUrl);
  }
}
