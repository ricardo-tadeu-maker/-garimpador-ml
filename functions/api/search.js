const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
};

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
}

export async function onRequestGet({ env }) {
  try {
    const tokenRow = await env.DB.prepare(`
      SELECT access_token, refresh_token, expires_at
      FROM ml_tokens
      WHERE id = 1
      LIMIT 1
    `).first();

    if (!tokenRow?.access_token) {
      return json({
        diagnostico: "sem_token",
        mensagem: "Não existe access_token salvo no banco."
      }, 401);
    }

    const response = await fetch("https://api.mercadolibre.com/users/me", {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${tokenRow.access_token}`,
      },
    });

    const text = await response.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { resposta: text.slice(0, 300) };
    }

    return json({
      diagnostico: "teste_token",
      http_status: response.status,
      ok: response.ok,
      resposta: data?.message || data?.error || data?.status || "sem_mensagem",
      token_salvo: true,
      tem_refresh_token: Boolean(tokenRow.refresh_token),
      token_expira_em: tokenRow.expires_at || null
    }, response.ok ? 200 : 502);

  } catch (error) {
    return json({
      diagnostico: "erro_interno",
      mensagem: String(error?.message || error)
    }, 500);
  }
}