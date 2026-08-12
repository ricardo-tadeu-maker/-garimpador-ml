export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();

  if (!q) {
    return new Response(
      JSON.stringify({ error: "Digite um produto para pesquisar." }),
      {
        status: 400,
        headers: {
          "Content-Type": "application/json; charset=utf-8"
        }
      }
    );
  }

  const mlUrl =
    "https://api.mercadolibre.com/sites/MLB/search?q=" +
    encodeURIComponent(q) +
    "&limit=20";

  try {
    const response = await fetch(mlUrl, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "GarimpadorML/1.0"
      }
    });

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

    return new Response(
      JSON.stringify({
        error: "Falha ao consultar o Mercado Livre.",
        details: String(error?.message || error)
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
