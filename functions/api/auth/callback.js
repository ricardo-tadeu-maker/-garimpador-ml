const REDIRECT_URI = "https://garimpador-ml.pages.dev/api/auth/callback";
const CONNECTION_COOKIE_MAX_AGE = 60 * 60 * 24 * 180;

function json(body, status, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

function cookieValue(request, name) {
  const match = request.headers.get("Cookie")?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function randomValue() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(value) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  const savedState = cookieValue(request, "ml_oauth_state");
  const clearStateCookie = "ml_oauth_state=; Max-Age=0; Path=/api/auth; HttpOnly; Secure; SameSite=Lax";

  const stateRow = await env.DB.prepare(
    "SELECT state_hash, expires_at FROM ml_oauth_states WHERE id = 1"
  ).first();
  const validState = returnedState && savedState && returnedState === savedState && stateRow &&
    Number(stateRow.expires_at) > Date.now() && stateRow.state_hash === await sha256(returnedState);

  if (!validState) {
    return json({ error: "Estado de autorização inválido ou expirado. Inicie a conexão novamente." }, 400, { "Set-Cookie": clearStateCookie });
  }

  // Consome o state antes de trocar o código, evitando reutilização do callback.
  await env.DB.prepare("DELETE FROM ml_oauth_states WHERE id = 1 AND state_hash = ?")
    .bind(stateRow.state_hash).run();

  const error = url.searchParams.get("error");
  if (error) return json({ error: "Autorização recusada pelo Mercado Livre.", details: error }, 400, { "Set-Cookie": clearStateCookie });
  if (!code) return json({ error: "Código de autorização não encontrado." }, 400, { "Set-Cookie": clearStateCookie });
  if (!env.ML_CLIENT_ID || !env.ML_CLIENT_SECRET) {
    return json({ error: "Credenciais do Mercado Livre não configuradas no Cloudflare." }, 500, { "Set-Cookie": clearStateCookie });
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: env.ML_CLIENT_ID,
    client_secret: env.ML_CLIENT_SECRET,
    code,
    redirect_uri: REDIRECT_URI,
  });

  try {
    const response = await fetch("https://api.mercadolibre.com/oauth/token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const data = await response.json();
    if (!response.ok || !data.access_token || !data.refresh_token || !data.user_id) {
      return json({ error: "Mercado Livre recusou a troca do código.", status: response.status, details: data }, response.status, { "Set-Cookie": clearStateCookie });
    }

    const connectionSecret = randomValue();
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(`
      INSERT INTO ml_tokens (
        id, user_id, access_token, refresh_token, expires_at, created_at
      ) VALUES (1, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        user_id = excluded.user_id,
        access_token = excluded.access_token,
        refresh_token = excluded.refresh_token,
        expires_at = excluded.expires_at,
        created_at = excluded.created_at
    `).bind(
      String(data.user_id), data.access_token, data.refresh_token,
      now + Number(data.expires_in || 0) * 1000, now
      ),
      env.DB.prepare(`
        INSERT INTO ml_connection_controls (id, connection_secret_hash, secret_hash, created_at)
        VALUES (1, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          secret_hash = excluded.secret_hash,
          created_at = excluded.created_at
      ).bind(await sha256(connectionSecret), await sha256(connectionSecret), now),
    ]);

    const headers = new Headers({ Location: "https://garimpador-ml.pages.dev/?ml=connected" });
    headers.append("Set-Cookie", clearStateCookie);
    headers.append("Set-Cookie", `ml_connection=${connectionSecret}; Max-Age=${CONNECTION_COOKIE_MAX_AGE}; Path=/api/auth; HttpOnly; Secure; SameSite=Strict`);
    return new Response(null, { status: 302, headers });
  } catch (error) {
    return json({ error: "Falha ao comunicar com o Mercado Livre.", details: String(error?.message || error) }, 502, { "Set-Cookie": clearStateCookie });
  }
}
