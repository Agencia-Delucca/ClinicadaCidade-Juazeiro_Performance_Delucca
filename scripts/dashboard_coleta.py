"""
Coleta a série DIÁRIA por entidade das contas de Juazeiro do Norte.

O dashboard agrega no navegador, então aqui não se decide período: puxa-se
uma janela larga (padrão 90 dias) e o usuário escolhe o recorte na tela.

Uso:
    python scripts/dashboard_coleta.py                # 90 dias
    python scripts/dashboard_coleta.py --dias 120

Saída: dados-brutos/dashboard.json  (ignorado pelo git)
"""

import argparse
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
SAIDA = RAIZ / "dados-brutos"

GOOGLE_BASE = "https://googleads.googleapis.com"
# O Google aposenta versão da API a cada poucos meses e passa a bloquear em
# fases — primeiro uma fração das requisições, depois todas. Em vez de fixar
# uma versão que um dia falha sozinha, negocia-se na partida.
VERSOES_GOOGLE = ["v25", "v24", "v23", "v22"]
_versao_google = None

META_API = "https://graph.facebook.com/v21.0"
MICROS = 1_000_000
CONVERSA = "onsite_conversion.messaging_conversation_started_7d"

# Início do histórico mensal da Visão Executiva (campanha a campanha, por mês).
HIST_DESDE = "2026-01-01"

PADROES_ACAO = [
    ("ligacao", re.compile(r"call|liga[çc]", re.I)),
    ("whatsapp", re.compile(r"whats", re.I)),
    ("agendamento", re.compile(r"agendamento", re.I)),
]


def classificar_acao(nome):
    for rotulo, padrao in PADROES_ACAO:
        if padrao.search(nome or ""):
            return rotulo
    return "outros"


def carregar_env():
    caminho = RAIZ / ".env"
    if not caminho.exists():
        sys.exit(f"ERRO: {caminho} nao encontrado.")
    env = {}
    for linha in caminho.read_text(encoding="utf-8").splitlines():
        linha = linha.strip()
        if linha and not linha.startswith("#") and "=" in linha:
            k, v = linha.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


# ----------------------------------------------------------------- Google Ads


def google_token(env):
    dados = urllib.parse.urlencode(
        {
            "client_id": env["GOOGLE_ADS_CLIENT_ID"],
            "client_secret": env["GOOGLE_ADS_CLIENT_SECRET"],
            "refresh_token": env["GOOGLE_ADS_REFRESH_TOKEN"],
            "grant_type": "refresh_token",
        }
    ).encode()
    with urllib.request.urlopen(
        "https://oauth2.googleapis.com/token", data=dados, timeout=30
    ) as r:
        return json.loads(r.read())["access_token"]


def _cabecalhos_google(env, token):
    h = {
        "Authorization": f"Bearer {token}",
        "developer-token": env["GOOGLE_ADS_DEVELOPER_TOKEN"],
        "Content-Type": "application/json",
    }
    if env.get("GOOGLE_ADS_LOGIN_CUSTOMER_ID"):
        h["login-customer-id"] = env["GOOGLE_ADS_LOGIN_CUSTOMER_ID"]
    return h


def negociar_versao_google(env, token, cid):
    """Descobre a versão mais nova que a conta aceita, da mais recente para trás."""
    global _versao_google
    headers = _cabecalhos_google(env, token)
    corpo = json.dumps({"query": "SELECT customer.id FROM customer"}).encode()

    for versao in VERSOES_GOOGLE:
        req = urllib.request.Request(
            f"{GOOGLE_BASE}/{versao}/customers/{cid}/googleAds:search",
            data=corpo,
            headers=headers,
        )
        try:
            urllib.request.urlopen(req, timeout=60).read()
            _versao_google = versao
            print(f"API do Google Ads: {versao}")
            return versao
        except urllib.error.HTTPError as e:
            corpo_erro = e.read().decode("utf-8", "replace")
            if e.code == 404 or "UNSUPPORTED_VERSION" in corpo_erro:
                continue
            sys.exit(f"ERRO ao negociar versão da API do Google Ads:\n{corpo_erro[:1200]}")

    sys.exit(
        "ERRO: nenhuma versão da API do Google Ads foi aceita.\n"
        f"Tentadas: {', '.join(VERSOES_GOOGLE)}.\n"
        "O Google publicou uma versão nova — acrescente-a em VERSOES_GOOGLE."
    )


def google_buscar(env, token, cid, query):
    headers = _cabecalhos_google(env, token)
    res, tok = [], None

    while True:
        corpo = {"query": query}
        if tok:
            corpo["pageToken"] = tok
        req = urllib.request.Request(
            f"{GOOGLE_BASE}/{_versao_google}/customers/{cid}/googleAds:search",
            data=json.dumps(corpo).encode(),
            headers=headers,
        )
        try:
            with urllib.request.urlopen(req, timeout=240) as r:
                pag = json.loads(r.read())
        except urllib.error.HTTPError as e:
            corpo_erro = e.read().decode("utf-8", "replace")
            # O bloqueio por versão chega em fases: pode passar na negociação
            # e falhar no meio da coleta. Renegocia e refaz a consulta.
            if "UNSUPPORTED_VERSION" in corpo_erro:
                antiga = _versao_google
                VERSOES_GOOGLE.remove(antiga)
                print(f"    ({antiga} bloqueada no meio da coleta — renegociando)")
                negociar_versao_google(env, token, cid)
                res, tok = [], None
                continue
            sys.exit(f"ERRO Google Ads ({cid}):\n{corpo_erro[:1500]}")
        res.extend(pag.get("results", []))
        tok = pag.get("nextPageToken")
        if not tok:
            return res


def google_conta(env, token, cid, desde, ate):
    """Entidades + série diária. Só o que teve investimento na janela."""
    base = f"segments.date BETWEEN '{desde}' AND '{ate}'"
    ents, serie = {}, []

    # metrics.phone_calls é a "Ligações telefônicas" da interface do Google Ads:
    # a ligação em si. Não confundir com metrics.conversions, que conta ações de
    # conversão configuradas (WhatsApp, agendamento, clique em telefone) e dá
    # outro número. As metas do cliente são sobre ligação.
    q = f"""
        SELECT campaign.id, campaign.name, campaign.status,
               campaign.advertising_channel_type, campaign_budget.amount_micros,
               segments.date,
               metrics.cost_micros, metrics.impressions, metrics.clicks,
               metrics.phone_calls, metrics.conversions
        FROM campaign WHERE {base}
    """
    for l in google_buscar(env, token, cid, q):
        c, m, d = l["campaign"], l.get("metrics", {}), l["segments"]["date"]
        cid_c = f"gc{c['id']}"
        if cid_c not in ents:
            ents[cid_c] = {
                "id": cid_c,
                "nivel": "campanha",
                "nome": c.get("name"),
                "status": c.get("status"),
                "tipo": c.get("advertisingChannelType"),
                "orcamento": int(
                    (l.get("campaignBudget") or {}).get("amountMicros", 0) or 0
                ) / MICROS,
            }
        serie.append([
            cid_c, d,
            round(int(m.get("costMicros", 0) or 0) / MICROS, 2),
            int(m.get("impressions", 0) or 0),
            int(m.get("clicks", 0) or 0),
            int(m.get("phoneCalls", 0) or 0),
            0,  # alcance: o Google não expõe
            round(float(m.get("conversions", 0) or 0), 1),
        ])

    # Grupos de anúncios.
    q = f"""
        SELECT campaign.name, ad_group.id, ad_group.name, ad_group.status,
               segments.date,
               metrics.cost_micros, metrics.impressions, metrics.clicks,
               metrics.phone_calls, metrics.conversions
        FROM ad_group WHERE {base}
    """
    for l in google_buscar(env, token, cid, q):
        g, m, d = l["adGroup"], l.get("metrics", {}), l["segments"]["date"]
        custo = round(int(m.get("costMicros", 0) or 0) / MICROS, 2)
        if custo <= 0:
            continue
        gid = f"gg{g['id']}"
        if gid not in ents:
            ents[gid] = {
                "id": gid,
                "nivel": "grupo",
                "nome": g.get("name"),
                "status": g.get("status"),
                "pai": l["campaign"].get("name"),
            }
        serie.append([
            gid, d, custo,
            int(m.get("impressions", 0) or 0),
            int(m.get("clicks", 0) or 0),
            int(m.get("phoneCalls", 0) or 0),
            0,
            round(float(m.get("conversions", 0) or 0), 1),
        ])

    # Textos dos anúncios (sem série - só para a aba de legendas).
    anuncios = {}
    q = f"""
        SELECT campaign.name, ad_group.name, ad_group_ad.ad.id,
               ad_group_ad.ad.responsive_search_ad.headlines,
               ad_group_ad.ad.responsive_search_ad.descriptions,
               metrics.cost_micros, metrics.impressions
        FROM ad_group_ad WHERE {base}
    """
    for l in google_buscar(env, token, cid, q):
        ad = l["adGroupAd"]["ad"]
        rsa = ad.get("responsiveSearchAd") or {}
        if not rsa:
            continue
        m = l.get("metrics", {})
        a = anuncios.setdefault(
            ad["id"],
            {
                "campanha": l["campaign"].get("name"),
                "grupo": l["adGroup"].get("name"),
                "titulos": [h.get("text") for h in rsa.get("headlines", [])],
                "descricoes": [x.get("text") for x in rsa.get("descriptions", [])],
                "impressoes": 0,
                "gasto": 0.0,
            },
        )
        a["impressoes"] += int(m.get("impressions", 0) or 0)
        a["gasto"] += int(m.get("costMicros", 0) or 0) / MICROS

    return {
        "entidades": list(ents.values()),
        "serie": serie,
        "anuncios_texto": [
            dict(v, gasto=round(v["gasto"], 2))
            for v in anuncios.values()
            if v["impressoes"] > 0
        ],
    }


def google_historico(env, token, cid, desde, ate):
    """Série MENSAL por campanha, desde o início do ano — alimenta a tabela
    de histórico da Visão Executiva. Leve: uma linha por campanha por mês."""
    q = f"""
        SELECT campaign.name, segments.month,
               metrics.cost_micros, metrics.clicks, metrics.phone_calls
        FROM campaign WHERE segments.date BETWEEN '{desde}' AND '{ate}'
    """
    linhas = []
    for l in google_buscar(env, token, cid, q):
        m = l.get("metrics", {})
        gasto = round(int(m.get("costMicros", 0) or 0) / MICROS, 2)
        ligacoes = int(m.get("phoneCalls", 0) or 0)
        if gasto <= 0 and ligacoes <= 0:
            continue
        linhas.append({
            "campanha": l["campaign"].get("name"),
            "mes": (l["segments"]["month"] or "")[:7],
            "gasto": gasto,
            "cliques": int(m.get("clicks", 0) or 0),
            "ligacoes": ligacoes,
        })
    return linhas


# ------------------------------------------------------------------ Meta Ads


import time


# Códigos de limite de uso da Graph API. Chegam como HTTP 400, não 429,
# então não dá para depender do status.
CODIGOS_LIMITE = {4, 17, 32, 613, 80000, 80003, 80004}
ESPERA_LIMITE = [60, 120, 240, 480, 600]


def _classificar_erro_meta(codigo_http, corpo):
    """Devolve ('limite' | 'transitorio' | 'fatal', detalhe)."""
    try:
        erro = json.loads(corpo).get("error", {})
    except Exception:
        erro = {}

    if (
        erro.get("code") in CODIGOS_LIMITE
        or erro.get("is_transient")
        or "request limit" in corpo.lower()
    ):
        return "limite", erro.get("error_user_msg") or erro.get("message", "")
    if codigo_http in (429, 500, 502, 503) or "reduce the amount" in corpo:
        return "transitorio", erro.get("message", "")
    return "fatal", erro.get("message", corpo[:300])


def _abrir(url, tentativas=6):
    """
    A Graph API falha de três jeitos diferentes e cada um pede uma espera
    diferente: limite de uso do app (minutos), instabilidade (segundos) e
    erro real (não adianta insistir).
    """
    for n in range(tentativas):
        try:
            with urllib.request.urlopen(url, timeout=300) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            corpo = e.read().decode("utf-8", "replace")
            tipo, detalhe = _classificar_erro_meta(e.code, corpo)

            if tipo == "fatal" or n == tentativas - 1:
                extra = (
                    "\n\nO app excedeu a cota da Graph API. A janela de uso se "
                    "recompõe sozinha em alguns minutos — basta rodar de novo "
                    "mais tarde."
                    if tipo == "limite"
                    else ""
                )
                sys.exit(f"ERRO Meta:\n{corpo[:1000]}{extra}")

            espera = (
                ESPERA_LIMITE[min(n, len(ESPERA_LIMITE) - 1)]
                if tipo == "limite"
                else 5 * (n + 1)
            )
            rotulo = "limite de uso do app" if tipo == "limite" else f"HTTP {e.code}"
            print(f"    ({rotulo} — aguardando {espera}s e tentando de novo)")
            time.sleep(espera)
        except (urllib.error.URLError, OSError, json.JSONDecodeError) as e:
            if n == tentativas - 1:
                sys.exit(f"ERRO de rede na Meta após {tentativas} tentativas: {e}")
            espera = 5 * (n + 1)
            print(f"    ({type(e).__name__} — nova tentativa em {espera}s)")
            time.sleep(espera)


def meta_get(caminho, params, token):
    return _abrir(
        f"{META_API}/{caminho}?{urllib.parse.urlencode(dict(params, access_token=token))}"
    )


def meta_paginado(caminho, params, token):
    dados = []
    resp = meta_get(caminho, params, token)
    dados.extend(resp.get("data", []))
    while resp.get("paging", {}).get("next"):
        resp = _abrir(resp["paging"]["next"])
        dados.extend(resp.get("data", []))
    return dados


def fatias(desde, ate, tamanho=30):
    """Quebra a janela em blocos - a Meta não aguenta 90 dias diários de uma vez."""
    d0 = date.fromisoformat(desde)
    d1 = date.fromisoformat(ate)
    while d0 <= d1:
        fim = min(d0 + timedelta(days=tamanho - 1), d1)
        yield d0.isoformat(), fim.isoformat()
        d0 = fim + timedelta(days=1)


def meta_lote(ids, campos, token):
    saida = []
    ids = [i for i in ids if i]
    for i in range(0, len(ids), 40):
        r = meta_get("", {"ids": ",".join(ids[i:i + 40]), "fields": campos}, token)
        saida.extend(r.values())
    return saida


CAMPOS = ("campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,"
          "spend,impressions,reach,clicks,actions")


def meta_conta(act_id, token, desde, ate):
    ents, serie = {}, []

    # Blocos menores no nível de anúncio: é o que multiplica linhas.
    for nivel, prefixo, bloco in [
        ("campaign", "mc", 30),
        ("adset", "ma", 20),
        ("ad", "mn", 10),
    ]:
        linhas = []
        for f0, f1 in fatias(desde, ate, bloco):
            linhas += meta_paginado(
                f"act_{act_id}/insights",
                {
                    "level": nivel,
                    "fields": CAMPOS,
                    "time_range": json.dumps({"since": f0, "until": f1}),
                    "time_increment": 1,
                    "limit": 100,
                },
                token,
            )
        for x in linhas:
            bruto = x.get(f"{nivel}_id")
            if not bruto:
                continue
            eid = prefixo + bruto
            if eid not in ents:
                ents[eid] = {
                    "id": eid,
                    "ref": bruto,
                    "nivel": {"campaign": "campanha", "adset": "conjunto", "ad": "anuncio"}[nivel],
                    "nome": x.get(f"{nivel}_name"),
                    "campanha": x.get("campaign_name"),
                    "conjunto": x.get("adset_name"),
                }
            acoes = {a["action_type"]: float(a["value"]) for a in x.get("actions", [])}
            serie.append([
                eid, x.get("date_start"),
                round(float(x.get("spend", 0) or 0), 2),
                int(x.get("impressions", 0) or 0),
                int(x.get("clicks", 0) or 0),
                int(acoes.get(CONVERSA, 0)),
                int(x.get("reach", 0) or 0),
                int(acoes.get("lead", 0)),  # leads de formulário, para referência
            ])

    # Estrutura: status, orçamento, objetivo e criativo.
    camps = meta_paginado(
        f"act_{act_id}/campaigns",
        {"fields": "id,name,status,effective_status,objective,daily_budget,lifetime_budget",
         "limit": 100},
        token,
    )
    conjs = meta_paginado(
        f"act_{act_id}/adsets",
        {"fields": "id,name,status,effective_status,optimization_goal,destination_type,"
                   "daily_budget,lifetime_budget,campaign_id", "limit": 100},
        token,
    )
    ids_anuncio = [e["ref"] for e in ents.values() if e["nivel"] == "anuncio"]
    anuncios = meta_lote(
        ids_anuncio,
        "id,name,status,effective_status,adset_id,campaign_id,"
        "creative{thumbnail_url,instagram_permalink_url,body,title}",
        token,
    )

    def orc(x):
        return round(
            max(int(x.get("daily_budget", 0) or 0), int(x.get("lifetime_budget", 0) or 0)) / 100,
            2,
        )

    extras = {}
    for c in camps:
        extras["mc" + c["id"]] = {"status": c.get("status"), "orcamento": orc(c),
                                  "objetivo": c.get("objective")}
    for a in conjs:
        extras["ma" + a["id"]] = {"status": a.get("status"), "orcamento": orc(a),
                                  "objetivo": a.get("optimization_goal"),
                                  "destino": a.get("destination_type")}
    for a in anuncios:
        cr = a.get("creative") or {}
        extras["mn" + a["id"]] = {
            "status": a.get("status"),
            "thumb": cr.get("thumbnail_url"),
            "permalink": cr.get("instagram_permalink_url"),
            "titulo": cr.get("title"),
            "corpo": cr.get("body"),
        }

    for eid, dados in extras.items():
        if eid in ents:
            ents[eid].update(dados)

    return {"entidades": list(ents.values()), "serie": serie}


def meta_historico(act_id, token, desde, ate):
    """Série MENSAL por campanha desde o início do ano (nível campanha,
    time_increment=monthly — uma chamada só, paginada)."""
    dados = meta_paginado(
        f"act_{act_id}/insights",
        {
            "level": "campaign",
            "fields": "campaign_name,spend,impressions,actions",
            "time_range": json.dumps({"since": desde, "until": ate}),
            "time_increment": "monthly",
            "limit": 100,
        },
        token,
    )
    linhas = []
    for x in dados:
        acoes = {a["action_type"]: float(a["value"]) for a in x.get("actions", [])}
        gasto = round(float(x.get("spend", 0) or 0), 2)
        mensagens = int(acoes.get(CONVERSA, 0))
        if gasto <= 0 and mensagens <= 0:
            continue
        linhas.append({
            "campanha": x.get("campaign_name"),
            "mes": (x.get("date_start") or "")[:7],
            "gasto": gasto,
            "impressoes": int(x.get("impressions", 0) or 0),
            "mensagens": mensagens,
        })
    return linhas


# ---------------------------------------------------------------------- main


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--dias", type=int, default=90,
                   help="tamanho da janela de dados disponível na tela")
    args = p.parse_args()

    env = carregar_env()
    ate = date.today() - timedelta(days=1)
    desde = ate - timedelta(days=args.dias - 1)
    print(f"Janela: {desde} a {ate} ({args.dias} dias)\n")

    token_g = google_token(env)
    token_m = env["META_ACCESS_TOKEN"]
    negociar_versao_google(env, token_g, env["GOOGLE_CID_JUAZEIRO"])

    contas = {
        "juazeiro": (env["GOOGLE_CID_JUAZEIRO"], env["META_ACT_JUAZEIRO"], "Juazeiro do Norte"),
    }

    saida = {
        "gerado_em": datetime.now().isoformat(timespec="seconds"),
        "janela": [desde.isoformat(), ate.isoformat()],
        "praças": {},
    }

    for praca, (gcid, mact, rotulo) in contas.items():
        print(f"[{rotulo}] Google Ads...")
        g = google_conta(env, token_g, gcid, desde.isoformat(), ate.isoformat())
        print(f"    {len(g['entidades'])} entidades · {len(g['serie'])} linhas diárias")

        print(f"[{rotulo}] Meta Ads...")
        m = meta_conta(mact, token_m, desde.isoformat(), ate.isoformat())
        print(f"    {len(m['entidades'])} entidades · {len(m['serie'])} linhas diárias")

        print(f"[{rotulo}] Histórico mensal desde {HIST_DESDE}...")
        gh = google_historico(env, token_g, gcid, HIST_DESDE, ate.isoformat())
        mh = meta_historico(mact, token_m, HIST_DESDE, ate.isoformat())
        print(f"    {len(gh)} linhas Google · {len(mh)} linhas Meta")

        saida["praças"][praca] = {
            "rotulo": rotulo, "google": g, "meta": m,
            "historico": {"google": gh, "meta": mh},
        }

    SAIDA.mkdir(parents=True, exist_ok=True)
    destino = SAIDA / "dashboard.json"
    destino.write_text(json.dumps(saida, ensure_ascii=False), encoding="utf-8")
    print(f"\nSalvo: {destino.relative_to(RAIZ)}  ({destino.stat().st_size/1024:,.0f} KB)")


if __name__ == "__main__":
    main()
