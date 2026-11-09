import type { ApiClient } from "./client";
import { ApiError, unwrap } from "./errors";
import type { components } from "./schema";

export type Me = components["schemas"]["Me"];
export type ProfileCreate = components["schemas"]["ProfileCreate"];

/**
 * Return the signed-in user's profile, creating it on first sign-in from the details
 * captured at sign-up (Supabase user metadata). Covers sign-ups that needed email
 * confirmation before a session existed.
 */
export async function ensureProfile(
  api: ApiClient,
  getSignUpDetails: () => Promise<ProfileCreate | null>,
): Promise<Me> {
  try {
    return await unwrap(api.GET("/v1/me"));
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== "profile_missing") throw error;
  }
  const details = await getSignUpDetails();
  if (!details) {
    throw new ApiError(404, "profile_missing", "We couldn't find your sign-up details. Please sign up again.");
  }
  return unwrap(api.POST("/v1/me/profile", { body: details }));
}

/** Read the sign-up details we store in Supabase user metadata. */
export function profileFromMetadata(meta: Record<string, unknown> | undefined): ProfileCreate | null {
  if (!meta) return null;
  const role = meta.role;
  const displayName = meta.display_name;
  if ((role !== "manager" && role !== "candidate") || typeof displayName !== "string" || !displayName) {
    return null;
  }
  return {
    role,
    display_name: displayName,
    org_name: typeof meta.org_name === "string" ? meta.org_name : null,
    adult_confirmed: meta.adult_confirmed === true,
  };
}
