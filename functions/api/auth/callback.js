export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    return new Response(
      JSON.stringify({
        error: "Autorização recusada pelo Mercado Livre.",
        details: error,
      }),
      {
        status: 400,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
        },
      }
    );
  }

  if (!code) {
    return new Response(
      JSON.stringify({
        error: "Código de autorização não encontrado.",
      }),
      {
        status: 400,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
        },
      }
    );
  }

  const clientId = env.ML_CLIENT_ID;
  const clientSecret = env.ML_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return new Response(
      JSON.stringify({
        error: "Credenciais do Mercado Livre não configuradas no Cloudflare.",
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
        },
      }
    );
  }

  const redirectUri =
    "https://garimpador-ml.pages.dev/api/auth/callback";

  const body = new URLSearchParams();

  body.set("grant_type", "authorization_code");
  body.set("client_id", clientId);
  body.set("client_secret", clientSecret);
  body.set("code", code);
  body.set("redirect_uri", redirectUri);

  try {
    const response = await fetch(
      "https://api.mercadolibre.com/oauth/token",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return new Response(
        JSON.stringify({
          error: "Mercado Livre recusou a troca do código.",
          status: response.status,
          details: data,
        }),
        {
          status: response.status,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
          },
        }
      );
    }

       const expiresAt = Date.now() + (data.expires_in * 1000);

    await env.DB.prepare(`
      INSERT INTO ml_tokens (
        id,
        user_id,
        access_token,
        refresh_token,
        expires_at,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        user_id = excluded.user_id,
        access_token = excluded.access_token,
        refresh_token = excluded.refresh_token,
        expires_at = excluded.expires_at,
        created_at = excluded.created_at
    `)
      .bind(
        1,
        String(data.user_id),
        data.access_token,
        data.refresh_token,
        expiresAt,
        Date.now()
      )
      .run();

    return Response.redirect(
  "https://garimpador-ml.pages.dev/?ml=connected",
  302
);
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: "Falha ao comunicar com o Mercado Livre.",
        details: String(error?.message || error),
      }),
      {
        status: 502,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
        },
      }
    );
  }
}
