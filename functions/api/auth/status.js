export async function onRequestGet({ env }) {
  const token = await env.DB.prepare(
    "SELECT expires_at FROM ml_tokens WHERE id = 1"
  ).first();

  const expiresAt = Number(token?.expires_at || 0);
  const now = Date.now();
  const refreshWindowMs = 60 * 1000;
  const tokenStatus = !expiresAt ? "disconnected"
    : expiresAt <= now ? "expired"
    : expiresAt <= now + refreshWindowMs ? "expires_soon"
    : "valid";

  return new Response(JSON.stringify({
    // Um access token expirado ainda pode ser renovado pelo refresh token; a
    // conexão OAuth só deixa de existir quando não há registro no D1.
    connected: Boolean(token?.expires_at),
    expires_at: token?.expires_at || null,
    token_status: tokenStatus,
  }), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
