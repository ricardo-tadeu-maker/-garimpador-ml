const REDIRECT_URI = "https://garimpador-ml.pages.dev/api/auth/callback";
const STATE_TTL_MS = 10 * 60 * 1000;

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function randomValue() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function onRequestGet({ env }) {
  if (!env.ML_CLIENT_ID) return json({ error: "ML_CLIENT_ID não configurado." }, 500);

  const state = randomValue();
  const now = Date.now();
  try {
    await env.DB.prepare(`
      INSERT INTO ml_oauth_states (id, state_hash, expires_at, created_at)
      VALUES (1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        state_hash = excluded.state_hash,
        expires_at = excluded.expires_at,
        created_at = excluded.created_at
    `).bind(await sha256(state), now + STATE_TTL_MS, now).run();
  } catch {
    return json({ error: "Não foi possível iniciar a autorização do Mercado Livre." }, 503);
  }

  const authUrl = new URL("https://auth.mercadolivre.com.br/authorization");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", env.ML_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("state", state);

  return new Response(null, {
    status: 302,
    headers: {
      Location: authUrl.toString(),
      "Set-Cookie": `ml_oauth_state=${state}; Max-Age=600; Path=/api/auth; HttpOnly; Secure; SameSite=Lax`,
    },
  });
}
