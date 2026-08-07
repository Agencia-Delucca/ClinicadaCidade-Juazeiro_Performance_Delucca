"""
Coleta de metricas do Google Ads para as contas B2C da Clinica da Cidade.

Uso:
    python scripts/coleta_google.py --periodo LAST_30_DAYS
    python scripts/coleta_google.py --desde 2026-07-01 --ate 2026-07-31
    python scripts/coleta_google.py --periodo LAST_7_DAYS --nivel campaign

Saida: JSON agregado em relatorios/ (sem dado pessoal de lead).
"""

import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path

# Quando falhar com UNSUPPORTED_VERSION, suba o número. A negociação
# automática está em dashboard_coleta.py.
API_VERSION = "v25"
BASE_URL = f"https://googleads.googleapis.com/{API_VERSION}"
TOKEN_URL = "https://oauth2.googleapis.com/token"

RAIZ = Path(__file__).resolve().parent.parent
SAIDA = RAIZ / "relatorios"

# Micros: o Google devolve valores monetarios multiplicados por 1.000.000.
MICROS = 1_000_000


def carregar_env():
    caminho = RAIZ / ".env"
    if not caminho.exists():
        sys.exit(
            f"ERRO: {caminho} nao encontrado.\n"
            "Copie o .env.example para .env e preencha os valores."
        )
    env = {}
    for linha in caminho.read_text(encoding="utf-8").splitlines():
        linha = linha.strip()
        if not linha or linha.startswith("#") or "=" not in linha:
            continue
        chave, valor = linha.split("=", 1)
        env[chave.strip()] = valor.strip().strip('"').strip("'")
    return env


def obter_access_token(env):
    """Troca o refresh_token por um access_token valido por 1 hora."""
    faltando = [
        c
        for c in (
            "GOOGLE_ADS_CLIENT_ID",
            "GOOGLE_ADS_CLIENT_SECRET",
            "GOOGLE_ADS_REFRESH_TOKEN",
            "GOOGLE_ADS_DEVELOPER_TOKEN",
        )
        if not env.get(c)
    ]
    if faltando:
        sys.exit("ERRO: faltam no .env: " + ", ".join(faltando))

    dados = urllib.parse.urlencode(
        {
            "client_id": env["GOOGLE_ADS_CLIENT_ID"],
            "client_secret": env["GOOGLE_ADS_CLIENT_SECRET"],
            "refresh_token": env["GOOGLE_ADS_REFRESH_TOKEN"],
            "grant_type": "refresh_token",
        }
    ).encode("utf-8")

    try:
        with urllib.request.urlopen(TOKEN_URL, data=dados, timeout=30) as resposta:
            return json.loads(resposta.read())["access_token"]
    except urllib.error.HTTPError as erro:
        sys.exit(
            "ERRO ao renovar o access_token:\n"
            f"{erro.read().decode('utf-8')}\n"
            "Se o refresh_token expirou, rode: python scripts/gerar_refresh_token.py"
        )


def buscar(env, token, customer_id, query):
    """Executa uma GAQL, paginando ate o fim."""
    headers = {
        "Authorization": f"Bearer {token}",
        "developer-token": env["GOOGLE_ADS_DEVELOPER_TOKEN"],
        "Content-Type": "application/json",
    }
    mcc = env.get("GOOGLE_ADS_LOGIN_CUSTOMER_ID")
    if mcc:
        headers["login-customer-id"] = mcc

    resultados = []
    proxima = None
    while True:
        # A v21 nao aceita pageSize - a pagina e fixa em 10.000 linhas.
        corpo = {"query": query}
        if proxima:
            corpo["pageToken"] = proxima

        req = urllib.request.Request(
            f"{BASE_URL}/customers/{customer_id}/googleAds:search",
            data=json.dumps(corpo).encode("utf-8"),
            headers=headers,
        )
        try:
            with urllib.request.urlopen(req, timeout=120) as resposta:
                pagina = json.loads(resposta.read())
        except urllib.error.HTTPError as erro:
            sys.exit(
                f"ERRO na API Google Ads (conta {customer_id}):\n"
                f"{erro.read().decode('utf-8')[:2000]}"
            )

        resultados.extend(pagina.get("results", []))
        proxima = pagina.get("nextPageToken")
        if not proxima:
            return resultados


def montar_query(nivel, periodo, desde, ate):
    metricas = """
        metrics.cost_micros,
        metrics.impressions,
        metrics.clicks,
        metrics.ctr,
        metrics.average_cpc,
        metrics.conversions,
        metrics.cost_per_conversion,
        metrics.conversions_value
    """

    if nivel == "account":
        campos = f"customer.descriptive_name, {metricas}"
        origem = "customer"
    else:
        campos = f"""
            campaign.id, campaign.name, campaign.status,
            campaign.advertising_channel_type,
            {metricas}
        """
        origem = "campaign"

    if desde and ate:
        filtro = f"segments.date BETWEEN '{desde}' AND '{ate}'"
    else:
        filtro = f"segments.date DURING {periodo}"

    return f"SELECT {campos} FROM {origem} WHERE {filtro}"


def resumir(metricas):
    custo = int(metricas.get("costMicros", 0)) / MICROS
    conversoes = float(metricas.get("conversions", 0) or 0)
    return {
        "investimento": round(custo, 2),
        "impressoes": int(metricas.get("impressions", 0) or 0),
        "cliques": int(metricas.get("clicks", 0) or 0),
        "ctr": round(float(metricas.get("ctr", 0) or 0) * 100, 3),
        "cpc": round(int(metricas.get("averageCpc", 0) or 0) / MICROS, 2),
        "conversoes": round(conversoes, 1),
        "custo_por_conversao": round(custo / conversoes, 2) if conversoes else None,
        "valor_conversoes": round(float(metricas.get("conversionsValue", 0) or 0), 2),
    }


def somar(linhas):
    """Agrega as linhas diarias que a API devolve em um total unico."""
    total = {
        "investimento": 0.0,
        "impressoes": 0,
        "cliques": 0,
        "conversoes": 0.0,
        "valor_conversoes": 0.0,
    }
    for linha in linhas:
        m = resumir(linha.get("metrics", {}))
        total["investimento"] += m["investimento"]
        total["impressoes"] += m["impressoes"]
        total["cliques"] += m["cliques"]
        total["conversoes"] += m["conversoes"]
        total["valor_conversoes"] += m["valor_conversoes"]

    total["investimento"] = round(total["investimento"], 2)
    total["conversoes"] = round(total["conversoes"], 1)
    total["valor_conversoes"] = round(total["valor_conversoes"], 2)
    total["ctr"] = (
        round(total["cliques"] / total["impressoes"] * 100, 3)
        if total["impressoes"]
        else 0
    )
    total["cpc"] = (
        round(total["investimento"] / total["cliques"], 2) if total["cliques"] else 0
    )
    total["custo_por_conversao"] = (
        round(total["investimento"] / total["conversoes"], 2)
        if total["conversoes"]
        else None
    )
    return total


def main():
    parser = argparse.ArgumentParser(description="Coleta metricas do Google Ads.")
    parser.add_argument(
        "--periodo", default="LAST_30_DAYS", help="ex: LAST_7_DAYS, LAST_30_DAYS"
    )
    parser.add_argument("--desde", help="YYYY-MM-DD")
    parser.add_argument("--ate", help="YYYY-MM-DD")
    parser.add_argument("--nivel", default="account", choices=["account", "campaign"])
    args = parser.parse_args()

    env = carregar_env()
    token = obter_access_token(env)

    contas = {
        "juazeiro": env.get("GOOGLE_CID_JUAZEIRO"),
    }

    relatorio = {
        "gerado_em": datetime.now().isoformat(timespec="seconds"),
        "fonte": "google_ads",
        "nivel": args.nivel,
        "periodo": (
            f"{args.desde} a {args.ate}" if args.desde and args.ate else args.periodo
        ),
        "praças": {},
    }

    query = montar_query(args.nivel, args.periodo, args.desde, args.ate)

    for praca, cid in contas.items():
        if not cid:
            print(f"AVISO: conta '{praca}' sem ID no .env - pulando.")
            continue

        print(f"Coletando {praca} ({cid})...")
        linhas = buscar(env, token, cid, query)

        if args.nivel == "account":
            relatorio["praças"][praca] = somar(linhas)
        else:
            # Agrupa as linhas diarias por campanha.
            por_campanha = {}
            for linha in linhas:
                camp = linha.get("campaign", {})
                chave = camp.get("id")
                if chave not in por_campanha:
                    por_campanha[chave] = {
                        "campanha": camp.get("name"),
                        "status": camp.get("status"),
                        "tipo": camp.get("advertisingChannelType"),
                        "linhas": [],
                    }
                por_campanha[chave]["linhas"].append(linha)

            relatorio["praças"][praca] = sorted(
                [
                    {
                        "campanha": dados["campanha"],
                        "status": dados["status"],
                        "tipo": dados["tipo"],
                        **somar(dados["linhas"]),
                    }
                    for dados in por_campanha.values()
                ],
                key=lambda c: c["investimento"],
                reverse=True,
            )

    SAIDA.mkdir(parents=True, exist_ok=True)
    carimbo = datetime.now().strftime("%Y-%m-%d")
    destino = SAIDA / f"google_{args.nivel}_{carimbo}.json"
    destino.write_text(
        json.dumps(relatorio, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    print(f"\nRelatorio salvo em: {destino.relative_to(RAIZ)}")
    if args.nivel == "account":
        for praca, dados in relatorio["praças"].items():
            print(
                f"  {praca:12} R$ {dados['investimento']:>9,.2f} | "
                f"{dados['conversoes']:>6.1f} conversoes | "
                f"R$ {dados['custo_por_conversao'] or 0:>7,.2f} por conversao"
            )


if __name__ == "__main__":
    main()
