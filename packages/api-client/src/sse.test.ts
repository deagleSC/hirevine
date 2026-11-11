import { describe, expect, it } from "vitest";

import { ApiError } from "./errors";
import { readSSE } from "./sse";

function streamed(chunks: string[], init: ResponseInit = {}): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
  return new Response(body, { headers: { "content-type": "text/event-stream" }, ...init });
}

describe("readSSE", () => {
  it("parses events split across chunks, in order", async () => {
    const got: unknown[] = [];
    await readSSE(
      streamed(['data: {"type":"token","te', 'xt":"Hel"}\n\ndata: {"type":"token","text":"lo"}\n', "\n: ping\n\n", 'data: {"type":"done"}']),
      (e) => got.push(e),
    );
    expect(got).toEqual([{ type: "token", text: "Hel" }, { type: "token", text: "lo" }, { type: "done" }]);
  });

  it("throws the API error for a non-2xx response", async () => {
    const res = new Response(JSON.stringify({ error: { code: "stale_turn", message: "Reload." } }), { status: 409 });
    await expect(readSSE(res, () => undefined)).rejects.toMatchObject({ code: "stale_turn", status: 409 });
    await expect(readSSE(new Response("nope", { status: 500 }), () => undefined)).rejects.toBeInstanceOf(ApiError);
  });
});
