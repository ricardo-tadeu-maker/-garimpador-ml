const TOKEN_REFRESH_WINDOW_MS = 60 * 1000;
const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };

function json(body, status) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

async function readJson(response) {
  const text = await response.text();
  try {
    return { data: JSON.parse(text), text };
  } catch {
    return { data: null, text };
  }
}

async function invalidateToken(env, refreshToken) {
  await env.DB.prepare(
    "DELETE FROM ml_tokens WHERE id = 1 AND refresh_token = ?"
  ).bind(refreshToken).run();
}

async function refreshAccessToken(env, tokenRow) {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: env.ML_CLIENT_ID || "",
    client_secret: env.ML_CLIENT_SECRET || "",
    refresh_token: tokenRow.refresh_token,
  });

  if (!env.ML_CLIENT_ID || !env.ML_CLIENT_SECRET) {
    return { error: "config" };
  }

  let response;
  try {
    response = await fetch("https://api.mercadolibre.com/oauth/token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
  } catch (error) {
    return { error: "temporary", details: String(error?.message || error) };
  }

  const { data } = await readJson(response);
  if (!response.ok || !data?.access_token || !data?.refresh_token) {
    // Um refresh token pode ser usado apenas uma vez. Se outra requisição já o
    // trocou, usa o registro mais novo em vez de apagar a conexão válida.
    const current = await env.DB.prepare(
      "SELECT access_token, refresh_token, expires_at FROM ml_tokens WHERE id = 1"
    ).first();

    if (current?.refresh_token && current.refresh_token !== tokenRow.refresh_token) {
      return { token: current.access_token };
    }

    if (response.status === 400 || response.status === 401) {
      await invalidateToken(env, tokenRow.refresh_token);
      return { error: "invalid" };
    }

    return { error: "temporary", details: data?.message || data?.error };
  }

  const expiresAt = Date.now() + Number(data.expires_in || 0) * 1000;
  const update = await env.DB.prepare(`
    UPDATE ml_tokens
    SET access_token = ?, refresh_token = ?, expires_at = ?
    WHERE id = 1 AND refresh_token = ?
  `).bind(
    data.access_token,
    data.refresh_token,
    expiresAt,
    tokenRow.refresh_token
  ).run();

  if (update.meta?.changes) {
    return { token: data.access_token };
  }

  const current = await env.DB.prepare(
    "SELECT access_token FROM ml_tokens WHERE id = 1"
  ).first();
  return current?.access_token ? { token: current.access_token } : { error: "invalid" };
}

async function getAccessToken(env, forceRefresh = false) {
  const tokenRow = await env.DB.prepare(`
    SELECT access_token, refresh_token, expires_at
    FROM ml_tokens
    WHERE id = 1
    LIMIT 1
  `).first();

  if (!tokenRow?.access_token || !tokenRow?.refresh_token) {
    return { error: "disconnected" };
  }

  const expiresSoon = Number(tokenRow.expires_at) <= Date.now() + TOKEN_REFRESH_WINDOW_MS;
  if (!forceRefresh && !expiresSoon) {
    return { token: tokenRow.access_token };
  }

  return refreshAccessToken(env, tokenRow);
}

async function searchMercadoLivre(url, accessToken) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    return await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();

  if (!q) return json({ error: "Digite um produto para pesquisar." }, 400);

  let token = await getAccessToken(env);
  if (token.error === "disconnected" || token.error === "invalid") {
    return json({ error: "Mercado Livre não está conectado ou a autorização expirou. Conecte novamente." }, 401);
  }
  if (token.error === "config") return json({ error: "Credenciais do Mercado Livre não configuradas." }, 500);
  if (token.error) return json({ error: "Não foi possível renovar a conexão com o Mercado Livre." }, 503);

  const mlUrl = "https://api.mercadolibre.com/sites/MLB/search?q=" + encodeURIComponent(q) + "&limit=20";
  try {
    let response = await searchMercadoLivre(mlUrl, token.token);
    let retriedAfterAuthFailure = false;

    if (response.status === 401 || response.status === 403) {
      token = await getAccessToken(env, true);
      if (token.error === "disconnected" || token.error === "invalid") {
        return json({ error: "A autorização do Mercado Livre expirou ou foi revogada. Conecte novamente." }, 401);
      }
      if (token.error) return json({ error: "Não foi possível renovar a conexão com o Mercado Livre." }, 503);
      response = await searchMercadoLivre(mlUrl, token.token);
      retriedAfterAuthFailure = true;
    }

    const text = await response.text();
    if (!response.ok) {
      if (retriedAfterAuthFailure && (response.status === 401 || response.status === 403)) {
        await env.DB.prepare("DELETE FROM ml_tokens WHERE id = 1 AND access_token = ?")
          .bind(token.token).run();
        return json({ error: "A autorização do Mercado Livre foi recusada. Conecte novamente." }, 401);
      }
      return json({ error: "Mercado Livre retornou HTTP " + response.status, details: text.slice(0, 500) }, 502);
    }

    return new Response(text, {
      status: 200,
      headers: { ...JSON_HEADERS, "Cache-Control": "no-store" },
    });
  } catch (error) {
    const details = error?.name === "AbortError" ? "Tempo limite de 15 segundos ao consultar o Mercado Livre." : String(error?.message || error);
    return json({ error: "Falha ao consultar o Mercado Livre.", details }, 502);
  }
}
