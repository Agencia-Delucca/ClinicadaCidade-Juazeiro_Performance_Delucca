"""
Gera o refresh_token do Google Ads via fluxo OAuth local.

Pre-requisito: ter GOOGLE_ADS_CLIENT_ID e GOOGLE_ADS_CLIENT_SECRET preenchidos
no .env. O cliente OAuth precisa ser do tipo "App para computador" (Desktop app).

Uso:
    python scripts/gerar_refresh_token.py

O script abre o navegador, voce autoriza com a conta Google que tem acesso as
contas de anuncio, e o refresh_token e gravado direto no .env.

Nenhuma senha passa pelo script - a autenticacao acontece inteiramente no
navegador, no dominio do Google.
"""

import http.server
import json
import secrets
import socket
import sys
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
CAMINHO_ENV = RAIZ / ".env"

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
ESCOPO = "https://www.googleapis.com/auth/adwords"

resultado = {}


def ler_env():
    if not CAMINHO_ENV.exists():
        sys.exit(f"ERRO: {CAMINHO_ENV} nao encontrado.")
    env = {}
    for linha in CAMINHO_ENV.read_text(encoding="utf-8").splitlines():
        linha = linha.strip()
        if linha and not linha.startswith("#") and "=" in linha:
            chave, valor = linha.split("=", 1)
            env[chave.strip()] = valor.strip()
    return env


def gravar_no_env(chave, valor):
    """Atualiza a chave no .env preservando o resto do arquivo."""
    linhas = CAMINHO_ENV.read_text(encoding="utf-8").splitlines()
    achou = False
    for i, linha in enumerate(linhas):
        if linha.strip().startswith(f"{chave}="):
            linhas[i] = f"{chave}={valor}"
            achou = True
            break
    if not achou:
        linhas.append(f"{chave}={valor}")
    CAMINHO_ENV.write_text("\n".join(linhas) + "\n", encoding="utf-8")


def porta_livre():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        query = urllib.parse.urlparse(self.path).query
        params = urllib.parse.parse_qs(query)

        resultado["code"] = params.get("code", [None])[0]
        resultado["state"] = params.get("state", [None])[0]
        resultado["error"] = params.get("error", [None])[0]

        if resultado["code"]:
            corpo = "<h2>Autorizacao concluida.</h2><p>Pode fechar esta aba.</p>"
        else:
            corpo = f"<h2>Falhou</h2><p>{resultado['error']}</p>"

        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(f"<html><body>{corpo}</body></html>".encode("utf-8"))

    def log_message(self, *args):
        pass  # silencia o log do servidor


def main():
    env = ler_env()
    client_id = env.get("GOOGLE_ADS_CLIENT_ID")
    client_secret = env.get("GOOGLE_ADS_CLIENT_SECRET")

    if not client_id or not client_secret:
        sys.exit(
            "ERRO: preencha GOOGLE_ADS_CLIENT_ID e GOOGLE_ADS_CLIENT_SECRET no .env\n"
            "Eles vem do Cloud Console em: APIs e servicos > Credenciais >\n"
            "IDs do cliente OAuth 2.0 (tipo 'App para computador')."
        )

    porta = porta_livre()
    redirect_uri = f"http://localhost:{porta}"
    estado = secrets.token_urlsafe(16)

    servidor = http.server.HTTPServer(("127.0.0.1", porta), Handler)

    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": ESCOPO,
        "access_type": "offline",
        "prompt": "consent",  # forca retorno do refresh_token
        "state": estado,
    }
    url = f"{AUTH_URL}?{urllib.parse.urlencode(params)}"

    print("Abrindo o navegador para autorizacao...")
    print("Use a conta Google que tem acesso a conta CDC - Juazeiro do Norte.\n")
    print(f"Se nao abrir sozinho, acesse:\n{url}\n")
    webbrowser.open(url)

    print("Aguardando autorizacao...")
    servidor.handle_request()  # bloqueia ate o Google redirecionar de volta
    servidor.server_close()

    if resultado.get("error"):
        sys.exit(f"ERRO na autorizacao: {resultado['error']}")

    if resultado.get("state") != estado:
        sys.exit("ERRO: state divergente - possivel interferencia. Abortado.")

    dados = urllib.parse.urlencode(
        {
            "code": resultado["code"],
            "client_id": client_id,
            "client_secret": client_secret,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
        }
    ).encode("utf-8")

    try:
        with urllib.request.urlopen(TOKEN_URL, data=dados, timeout=30) as resposta:
            tokens = json.loads(resposta.read().decode("utf-8"))
    except urllib.error.HTTPError as erro:
        sys.exit(f"ERRO ao trocar o code por token:\n{erro.read().decode('utf-8')}")

    refresh_token = tokens.get("refresh_token")
    if not refresh_token:
        sys.exit(
            "ERRO: o Google nao devolveu refresh_token.\n"
            "Costuma acontecer quando o app ja foi autorizado antes. Revogue o acesso em\n"
            "https://myaccount.google.com/permissions e rode de novo."
        )

    gravar_no_env("GOOGLE_ADS_REFRESH_TOKEN", refresh_token)
    print("\nOK: refresh_token gerado e gravado no .env")
    print("Falta so o GOOGLE_ADS_LOGIN_CUSTOMER_ID (ID da MCC, sem hifens).")


if __name__ == "__main__":
    main()
