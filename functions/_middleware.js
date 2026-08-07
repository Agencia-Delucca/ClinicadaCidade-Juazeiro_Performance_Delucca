/**
 * Trava de acesso do dashboard.
 *
 * Roda na borda da Cloudflare antes de qualquer arquivo ser servido, entao
 * nada do conteudo vaza para quem nao autenticou.
 *
 * Usuario e senha vem de variaveis de ambiente do projeto no Cloudflare
 * (DASH_USUARIO e DASH_SENHA) - nunca do codigo.
 */

const REALM = "Dashboard CDC Juazeiro";

/** Comparacao em tempo constante: nao vaza o tamanho do acerto por timing. */
function iguaisEmTempoConstante(a, b) {
  const ba = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (ba.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ba.length; i++) diff |= ba[i] ^ bb[i];
  return diff === 0;
}

function pedirSenha() {
  return new Response("Acesso restrito. Autenticação necessária.", {
    status: 401,
    headers: {
      "WWW-Authenticate": `Basic realm="${REALM}", charset="UTF-8"`,
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export async function onRequest(context) {
  const { request, env, next } = context;

  // Sem credencial configurada o site nao sobe aberto por acidente.
  if (!env.DASH_USUARIO || !env.DASH_SENHA) {
    return new Response(
      "Dashboard sem credenciais configuradas. Defina DASH_USUARIO e DASH_SENHA " +
        "nas variáveis de ambiente do projeto no Cloudflare.",
      { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }
    );
  }

  const cabecalho = request.headers.get("Authorization") || "";
  if (!cabecalho.startsWith("Basic ")) return pedirSenha();

  let usuario, senha;
  try {
    const decodificado = atob(cabecalho.slice(6));
    const corte = decodificado.indexOf(":");
    if (corte < 0) return pedirSenha();
    usuario = decodificado.slice(0, corte);
    senha = decodificado.slice(corte + 1);
  } catch {
    return pedirSenha();
  }

  const ok =
    iguaisEmTempoConstante(usuario, env.DASH_USUARIO) &&
    iguaisEmTempoConstante(senha, env.DASH_SENHA);

  if (!ok) return pedirSenha();

  const resposta = await next();
  const saida = new Response(resposta.body, resposta);

  // Dado de cliente: fora de buscador, fora de cache compartilhado.
  saida.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  saida.headers.set("Cache-Control", "private, no-store");
  saida.headers.set("X-Content-Type-Options", "nosniff");
  saida.headers.set("Referrer-Policy", "no-referrer");
  return saida;
}
