export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();

  if (!q) {
    return new Response(
      JSON.stringify({ error: "Digite um produto para pesquisar." }),
      {
        status: 400,
        headers: { "Content-Type": "application/json; charset=utf-8" }
      }
    );
  }
const tokenRow = await env.DB.prepare(`
  SELECT access_token
  FROM ml_tokens
  WHERE id = 1
  LIMIT 1
`).first();

if (!tokenRow?.access_token) {
  return new Response(
    JSON.stringify({
      error: "Mercado Livre ainda não está conectado."
    }),
    {
      status: 401,
      headers: {
        "Content-Type": "application/json; charset=utf-8"
      }
    }
  );
}

const accessToken = tokenRow.access_token;
  const mlUrl =
    "https://api.mercadolibre.com/sites/MLB/search?q=" +
    encodeURIComponent(q) +
    "&limit=20";

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(mlUrl, {
      method: "GET",
     headers: {
  "Accept": "application/json",
  "Authorization": `Bearer ${accessToken}`
},
      
      signal: controller.signal
    });

    clearTimeout(timeout);

    const text = await response.text();

    if (!response.ok) {
      return new Response(
        JSON.stringify({
          error: "Mercado Livre retornou HTTP " + response.status,
          details: text.slice(0, 500)
        }),
        {
          status: 502,
          headers: {
            "Content-Type": "application/json; charset=utf-8"
          }
        }
      );
    }

    return new Response(text, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      }
    });

  } catch (error) {

    const message =
      error?.name === "AbortError"
        ? "Tempo limite de 15 segundos ao consultar o Mercado Livre."
        : String(error?.message || error);

    return new Response(
      JSON.stringify({
        error: "Falha ao consultar o Mercado Livre.",
        details: message
      }),
      {
        status: 502,
        headers: {
          "Content-Type": "application/json; charset=utf-8"
        }
      }
    );
  }
}
