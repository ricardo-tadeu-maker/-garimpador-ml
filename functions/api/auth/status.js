export async function onRequestGet({ env }) {
  const token = await env.DB.prepare(
    "SELECT access_token, expires_at FROM ml_tokens WHERE id = 1"
  ).first();

  const connected = Boolean(
    token?.access_token &&
    token?.expires_at &&
    Number(token.expires_at) > Date.now()
  );

  return new Response(JSON.stringify({
    connected,
    expires_at: token?.expires_at || null,
  }), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}