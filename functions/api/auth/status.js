export async function onRequestGet({ env }) {
  const token = await env.DB.prepare(
    "SELECT expires_at FROM ml_tokens WHERE id = 1"
  ).first();

  return new Response(JSON.stringify({
    connected: Boolean(token?.expires_at),
    expires_at: token?.expires_at || null,
  }), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
