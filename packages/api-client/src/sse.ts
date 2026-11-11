/** Server-sent events over a fetch Response (frontend plan §4: the interview's streamed turns). */
import { ApiError, toApiError } from "./errors";

/**
 * Read `data:` events from a streamed response, calling `onEvent` with each parsed JSON payload in
 * order. Resolves when the stream ends. A non-2xx response throws its ApiError before any event.
 * Comment lines and other SSE fields are ignored; an event may span several network chunks.
 */
export async function readSSE<T = unknown>(response: Response, onEvent: (event: T) => void): Promise<void> {
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    throw toApiError(response.status, body);
  }
  if (!response.body) throw new ApiError(0, "network_error", "The server sent an empty response.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const flush = (block: string) => {
    const data = block
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).replace(/^ /, ""))
      .join("\n");
    if (data) onEvent(JSON.parse(data) as T);
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    let at: number;
    while ((at = buffer.indexOf("\n\n")) !== -1) {
      flush(buffer.slice(0, at));
      buffer = buffer.slice(at + 2);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) flush(buffer);
}
