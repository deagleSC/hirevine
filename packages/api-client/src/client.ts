import createClient, { type Middleware } from "openapi-fetch";

import type { paths } from "./schema";

export type ApiClient = ReturnType<typeof createClient<paths>>;

export interface ApiClientOptions {
  baseUrl: string;
  /** Current Supabase access token, or null when signed out. */
  getToken: () => Promise<string | null>;
  /** Called when the API says this user belongs in the other app (403 wrong_app). */
  onWrongApp?: (role: string | undefined) => void;
  /** Called on 401, so the app can send the user to sign in. */
  onUnauthenticated?: () => void;
  fetch?: typeof fetch;
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const client = createClient<paths>({ baseUrl: options.baseUrl, fetch: options.fetch });

  const auth: Middleware = {
    async onRequest({ request }) {
      const token = await options.getToken();
      if (token) request.headers.set("Authorization", `Bearer ${token}`);
      return request;
    },
    async onResponse({ response }) {
      if (response.status === 401) {
        options.onUnauthenticated?.();
      } else if (response.status === 403 && options.onWrongApp) {
        const body = (await response.clone().json().catch(() => null)) as {
          error?: { code?: string; details?: { role?: string } };
        } | null;
        if (body?.error?.code === "wrong_app") options.onWrongApp(body.error.details?.role);
      }
      return response;
    },
  };

  client.use(auth);
  return client;
}
