"""
Coleta de metricas do Meta Ads para as contas B2C da Clinica da Cidade.

Uso:
    python scripts/coleta_meta.py --periodo last_30d
    python scripts/coleta_meta.py --desde 2026-07-01 --ate 2026-07-31
    python scripts/coleta_meta.py --periodo last_7d --nivel campaign

Saida: JSON agregado em relatorios/ (sem dado pessoal de lead).
"""

import argparse
import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path

API_VERSION = "v21.0"
BASE_URL = f"https://graph.facebook.com/{API_VERSION}"

RAIZ = Path(__file__).resolve().parent.parent
SAIDA = RAIZ / "relatorios"

CAMPOS = [
    "spend",
    "impressions",
    "reach",
    "frequency",
    "clicks",
    "ctr",
    "cpc",
    "cpm",
    "actions",
    "cost_per_action_type",
]

# Acoes que representam contato real com a clinica.
ACOES_RELEVANTES = {
    "lead": "leads_formulario",
    "onsite_conversion.messaging_conversation_started_7d": "conversas_iniciadas",
    "onsite_conversion.messaging_first_reply": "primeiras_respostas",
    "link_click": "cliques_no_link",
    "landing_page_view": "views_pagina_destino",
    "video_view": "views_video",
}


def carregar_env():
    """Le o .env da raiz do projeto sem depender de biblioteca externa."""
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


def chamar_api(caminho, params):
    url = f"{BASE_URL}/{caminho}?{urllib.parse.urlencode(params)}"
    try:
        with urllib.request.urlopen(url, timeout=60) as resposta:
            return json.loads(resposta.read().decode("utf-8"))
    except urllib.error.HTTPError as erro:
        detalhe = erro.read().decode("utf-8", errors="replace")
        sys.exit(f"ERRO na API Meta ({erro.code}) em {caminho}:\n{detalhe}")


def resumir(bruto):
    """Extrai apenas as metricas que interessam, achatando o bloco 'actions'."""
    resumo = {
        "investimento": float(bruto.get("spend", 0) or 0),
        "impressoes": int(bruto.get("impressions", 0) or 0),
        "alcance": int(bruto.get("reach", 0) or 0),
        "frequencia": round(float(bruto.get("frequency", 0) or 0), 2),
        "cliques": int(bruto.get("clicks", 0) or 0),
        "ctr": round(float(bruto.get("ctr", 0) or 0), 3),
        "cpc": round(float(bruto.get("cpc", 0) or 0), 2),
        "cpm": round(float(bruto.get("cpm", 0) or 0), 2),
    }

    for acao in bruto.get("actions", []):
        rotulo = ACOES_RELEVANTES.get(acao.get("action_type"))
        if rotulo:
            resumo[rotulo] = int(float(acao.get("value", 0)))

    leads = resumo.get("leads_formulario", 0)
    conversas = resumo.get("conversas_iniciadas", 0)
    contatos = leads + conversas

    resumo["contatos_totais"] = contatos
    resumo["cpl_formulario"] = round(resumo["investimento"] / leads, 2) if leads else None
    resumo["custo_por_conversa"] = (
        round(resumo["investimento"] / conversas, 2) if conversas else None
    )
    resumo["custo_por_contato"] = (
        round(resumo["investimento"] / contatos, 2) if contatos else None
    )
    return resumo


def coletar(token, act_id, nivel, periodo, desde, ate):
    params = {
        "fields": ",".join(CAMPOS),
        "level": nivel,
        "limit": 500,
        "access_token": token,
    }
    if desde and ate:
        params["time_range"] = json.dumps({"since": desde, "until": ate})
    else:
        params["date_preset"] = periodo

    if nivel != "account":
        params["fields"] += ",campaign_name,adset_name,ad_name"

    dados = chamar_api(f"act_{act_id}/insights", params)
    return dados.get("data", [])


def main():
    parser = argparse.ArgumentParser(description="Coleta metricas do Meta Ads.")
    parser.add_argument("--periodo", default="last_30d", help="ex: last_7d, last_30d")
    parser.add_argument("--desde", help="YYYY-MM-DD")
    parser.add_argument("--ate", help="YYYY-MM-DD")
    parser.add_argument(
        "--nivel", default="account", choices=["account", "campaign", "adset", "ad"]
    )
    args = parser.parse_args()

    env = carregar_env()
    token = env.get("META_ACCESS_TOKEN")
    if not token:
        sys.exit("ERRO: META_ACCESS_TOKEN vazio no .env")

    contas = {
        "juazeiro": env.get("META_ACT_JUAZEIRO"),
    }

    relatorio = {
        "gerado_em": datetime.now().isoformat(timespec="seconds"),
        "nivel": args.nivel,
        "periodo": (
            f"{args.desde} a {args.ate}" if args.desde and args.ate else args.periodo
        ),
        "praças": {},
    }

    for praca, act_id in contas.items():
        if not act_id:
            print(f"AVISO: conta '{praca}' sem ID no .env - pulando.")
            continue

        print(f"Coletando {praca} (act_{act_id})...")
        linhas = coletar(token, act_id, args.nivel, args.periodo, args.desde, args.ate)

        if args.nivel == "account":
            relatorio["praças"][praca] = resumir(linhas[0]) if linhas else {}
        else:
            relatorio["praças"][praca] = [
                {
                    "campanha": linha.get("campaign_name"),
                    "conjunto": linha.get("adset_name"),
                    "anuncio": linha.get("ad_name"),
                    **resumir(linha),
                }
                for linha in linhas
            ]

    SAIDA.mkdir(parents=True, exist_ok=True)
    carimbo = datetime.now().strftime("%Y-%m-%d")
    destino = SAIDA / f"meta_{args.nivel}_{carimbo}.json"
    destino.write_text(
        json.dumps(relatorio, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    print(f"\nRelatorio salvo em: {destino.relative_to(RAIZ)}")
    if args.nivel == "account":
        for praca, dados in relatorio["praças"].items():
            if dados:
                print(
                    f"  {praca:12} R$ {dados['investimento']:>9,.2f} | "
                    f"{dados.get('contatos_totais', 0):>4} contatos | "
                    f"R$ {dados.get('custo_por_contato') or 0:>6,.2f} por contato"
                )


if __name__ == "__main__":
    main()
