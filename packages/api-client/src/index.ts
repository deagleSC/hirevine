export { createApiClient, type ApiClient, type ApiClientOptions } from "./client";
export { ApiError, messageFor, toApiError, unwrap } from "./errors";
export { ensureProfile, profileFromMetadata, type Me, type ProfileCreate } from "./profile";
export { decideRoute, matchesPath, safeNextPath, type AppName, type RouteDecision, type RouteInput } from "./routing";
export { qk } from "./query-keys";
export type { components, paths } from "./schema";
