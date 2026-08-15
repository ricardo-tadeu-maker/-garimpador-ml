const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
};

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
}

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();

  if (!q) {
    return json({ error: "Digite um produto para pesquisar." }, 400);
  }

  const mlUrl =
    "https://api.mercadolibre.com/sites/MLB/search?q=" +
    encodeURIComponent(q) +
    "&limit=20";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(mlUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    const text = await response.text();

    if (!response.ok) {
      return json(
        {
          error: "Mercado Livre retornou HTTP " + response.status,
          details: text.slice(0, 500),
        },
        502
      );
    }

    return new Response(text, {
      status: 200,
      headers: {
        ...JSON_HEADERS,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const details =
      error?.name === "AbortError"
        ? "Tempo limite de 15 segundos ao consultar o Mercado Livre."
        : String(error?.message || error);

    return json(
      {
        error: "Falha ao consultar o Mercado Livre.",
        details,
      },
      502
    );
  } finally {
    clearTimeout(timeout);
  }
}