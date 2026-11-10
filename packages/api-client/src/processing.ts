/**
 * Async work (frontend plan §135, §329). Endpoints that start background work answer
 * `202 { status: "processing" | "queued_budget" }` until the result is ready. Pages poll
 * with React Query's `refetchInterval`, using these helpers to decide when to stop.
 */

export type ProcessingStatus = "processing" | "queued_budget";

export interface Processing {
  status: ProcessingStatus;
  /** job_runs.id of the work being waited on. */
  job_run_id?: string;
  /** When the work was queued (ISO 8601). Drives "Taking longer than usual". */
  queued_at?: string;
}

/** Poll every 5 s while processing (§135). queued_budget waits for tomorrow, so poll slowly. */
export const POLL_PROCESSING_MS = 5_000;
export const POLL_QUEUED_BUDGET_MS = 5 * 60_000;
/** Jobs start right away, so anything still processing after this is unusual (§329). */
export const TAKING_LONG_MS = 5 * 60_000;

export function isProcessing(value: unknown): value is Processing {
  if (typeof value !== "object" || value === null) return false;
  const status = (value as { status?: unknown }).status;
  return status === "processing" || status === "queued_budget";
}

/**
 * For React Query: `refetchInterval: (q) => pollInterval(q.state.data)`.
 * Returns false once the data is a finished result, which stops polling.
 */
export function pollInterval(data: unknown): number | false {
  if (!isProcessing(data)) return false;
  return data.status === "queued_budget" ? POLL_QUEUED_BUDGET_MS : POLL_PROCESSING_MS;
}

export function isTakingLong(p: Processing, now: number = Date.now()): boolean {
  if (p.status !== "processing" || !p.queued_at) return false;
  const queued = Date.parse(p.queued_at);
  return Number.isFinite(queued) && now - queued > TAKING_LONG_MS;
}

/**
 * Read a response that is either the finished result (200) or a processing marker (202).
 * Use as the queryFn body: `readMaybeProcessing<Result>(await api.GET(...))`.
 */
export function readMaybeProcessing<T>(res: { data?: T; response: Response; error?: unknown }): T | Processing {
  if (res.response.status === 202) {
    if (isProcessing(res.data)) return res.data;
    return { status: "processing" };
  }
  if (res.error !== undefined || res.data === undefined) {
    throw res.error ?? new Error(`Unexpected empty response (${res.response.status})`);
  }
  return res.data;
}
