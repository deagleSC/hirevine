/** Errors from the API's envelope: {"error": {"code", "message", "details"}}. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface Envelope {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

function isEnvelope(body: unknown): body is Envelope {
  if (typeof body !== "object" || body === null || !("error" in body)) return false;
  const err = (body as { error: unknown }).error;
  return typeof err === "object" && err !== null && typeof (err as { code?: unknown }).code === "string";
}

export function toApiError(status: number, body: unknown): ApiError {
  if (isEnvelope(body)) {
    return new ApiError(status, body.error.code, body.error.message, body.error.details);
  }
  if (status === 0) return new ApiError(0, "network_error", "Can't reach the server. Check your connection.");
  return new ApiError(status, `http_${status}`, "Something went wrong. Please try again.");
}

/** Await an openapi-fetch call and return its data, or throw an ApiError. */
export async function unwrap<T>(
  call: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  let result: { data?: T; error?: unknown; response: Response };
  try {
    result = await call;
  } catch {
    throw toApiError(0, null);
  }
  if (result.error !== undefined || !result.response.ok) {
    throw toApiError(result.response.status, result.error);
  }
  return result.data as T;
}

/** Plain-language message for an error, for toasts and inline alerts. */
export function messageFor(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return "Something went wrong. Please try again.";
}
