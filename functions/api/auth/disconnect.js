const TOKEN_REFRESH_WINDOW_MS = 60 * 1000;

function cookieValue(request, name) {
  const match = request.headers.get("Cookie")?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

async function sha256(value) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function response(body, status, clearCookie) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...(clearCookie ? { "Set-Cookie": "ml_connection=; Max-Age=0; Path=/api/auth; HttpOnly; Secure; SameSite=Strict" } : {}),
    },
  });
}

async function refreshToken(env, token) {
  if (!env.ML_CLIENT_ID || !env.ML_CLIENT_SECRET) return null;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: env.ML_CLIENT_ID,
    client_secret: env.ML_CLIENT_SECRET,
    refresh_token: token.refresh_token,
  });
  const refresh = await fetch("https://api.mercadolibre.com/oauth/token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const data = await refresh.json();
  if (!refresh.ok || !data.access_token || !data.refresh_token) return null;

  const update = await env.DB.prepare(`
    UPDATE ml_tokens
    SET access_token = ?, refresh_token = ?, expires_at = ?
    WHERE id = 1 AND refresh_token = ?
  `).bind(
    data.access_token,
    data.refresh_token,
    Date.now() + Number(data.expires_in || 0) * 1000,
    token.refresh_token
  ).run();

  if (update.meta?.changes) return data.access_token;
  const current = await env.DB.prepare("SELECT access_token FROM ml_tokens WHERE id = 1").first();
  return current?.access_token || null;
}

async function revoke(env, token, accessToken) {
  return fetch(
    `https://api.mercadolibre.com/users/${encodeURIComponent(token.user_id)}/applications/${encodeURIComponent(env.ML_CLIENT_ID)}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } }
  );
}

export async function onRequestPost({ request, env }) {
  const secret = cookieValue(request, "ml_connection");
  const token = await env.DB.prepare(
    "SELECT user_id, access_token, refresh_token, expires_at FROM ml_tokens WHERE id = 1"
  ).first();
  const control = await env.DB.prepare("SELECT secret_hash FROM ml_connection_controls WHERE id = 1").first();

  if (!token) return response({ connected: false }, 200, true);
  if (!secret || !control || control.secret_hash !== await sha256(secret)) {
    return response({ error: "Não autorizado a desconectar esta conexão." }, 403, false);
  }
  if (!env.ML_CLIENT_ID || !env.ML_CLIENT_SECRET) {
    return response({ error: "Credenciais do Mercado Livre não configuradas." }, 500, false);
  }

  try {
    let accessToken = token.access_token;
    if (Number(token.expires_at) <= Date.now() + TOKEN_REFRESH_WINDOW_MS) {
      accessToken = await refreshToken(env, token);
      if (!accessToken) return response({ error: "Não foi possível renovar a conexão para desconectar." }, 502, false);
    }

    let revokeResponse = await revoke(env, token, accessToken);
    if (revokeResponse.status === 401 || revokeResponse.status === 403) {
      accessToken = await refreshToken(env, token);
      if (accessToken) revokeResponse = await revoke(env, token, accessToken);
    }

    // Credenciais já invalidadas pelo Mercado Livre não precisam permanecer no D1.
    if (!revokeResponse.ok && revokeResponse.status !== 401 && revokeResponse.status !== 403 && revokeResponse.status !== 404) {
      return response({ error: "Não foi possível revogar a conexão no Mercado Livre. Tente novamente." }, 502, false);
    }

    await env.DB.batch([
      env.DB.prepare("DELETE FROM ml_tokens WHERE id = 1 AND access_token = ?").bind(accessToken),
      env.DB.prepare("DELETE FROM ml_connection_controls WHERE id = 1 AND secret_hash = ?").bind(control.secret_hash),
    ]);
    return response({ connected: false }, 200, true);
  } catch {
    return response({ error: "Não foi possível comunicar com o Mercado Livre para desconectar." }, 502, false);
  }
}
