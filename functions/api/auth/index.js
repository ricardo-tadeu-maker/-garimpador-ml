export async function onRequestGet({ env }) {
  const clientId = env.ML_CLIENT_ID;

  if (!clientId) {
    return new Response(
      JSON.stringify({
        error: "ML_CLIENT_ID não configurado."
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json; charset=utf-8"
        }
      }
    );
  }

  const redirectUri =
    "https://garimpador-ml.pages.dev/api/auth/callback";

  const authUrl =
    "https://auth.mercadolivre.com.br/authorization" +
    "?response_type=code" +
    "&client_id=" +
    encodeURIComponent(clientId) +
    "&redirect_uri=" +
    encodeURIComponent(redirectUri);

  return Response.redirect(authUrl, 302);
}
