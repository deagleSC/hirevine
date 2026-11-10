// Embeddings for the screening prefilter (backend plan §20.3): gte-small, 384-d, normalised.
// Called only by the API's screening job with a shared key. Deploy: `supabase functions deploy embed --no-verify-jwt`
// and set EMBED_FUNCTION_KEY as a function secret.

const session = new Supabase.ai.Session("gte-small");
const MAX_INPUTS = 32;
const MAX_CHARS = 2000;

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const key = Deno.env.get("EMBED_FUNCTION_KEY");
  if (!key || req.headers.get("x-embed-key") !== key) return new Response("Unauthorized", { status: 401 });

  let inputs: unknown;
  try {
    ({ inputs } = await req.json());
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  if (!Array.isArray(inputs) || inputs.length === 0 || inputs.length > MAX_INPUTS ||
      !inputs.every((t) => typeof t === "string")) {
    return new Response(`inputs must be 1-${MAX_INPUTS} strings`, { status: 400 });
  }
  const vectors = [];
  for (const text of inputs as string[]) {
    vectors.push(await session.run(text.slice(0, MAX_CHARS), { mean_pool: true, normalize: true }));
  }
  return Response.json({ model: "gte-small", dim: 384, vectors });
});
