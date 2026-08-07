"""
Transforma a coleta bruta no pacote que vai embutido no HTML.

A classificação (grupo temático, especialidade, exame) acontece aqui, uma vez,
em Python — o navegador só filtra e soma.
"""

import json
from pathlib import Path

from dashboard_taxonomia import (
    ESPECIALIDADES,
    EXAMES,
    detectar_balde,
    detectar_especialidade,
    detectar_exame,
)

RAIZ = Path(__file__).resolve().parent.parent
METAS = {"meta_cpl": 3.50, "google_cpl": 3.00}

# Baldes do Meta que NÃO são captação de lead (não geram mensagem): ficam fora
# do histórico mensal, inclusive no investimento. No Google todas as campanhas
# geram ligação, então entram todas.
META_FORA_CAPTACAO = {"Alcance / Engajamento", "Branding"}

# Série normalizada, 8 posições:
# [id, data, gasto, impressões, cliques, resultado, alcance, secundario]
#
# "resultado" é o que a meta cobra: ligações telefônicas no Google
# (metrics.phone_calls) e conversas iniciadas no Meta.
# "secundario" guarda a outra leitura — conversões configuradas no Google,
# leads de formulário no Meta — para consulta, sem entrar no CPL.
COLUNAS_SERIE = [
    "id", "data", "gasto", "impressoes", "cliques", "resultado", "alcance", "secundario",
]


def carregar_orcamento():
    caminho = RAIZ / "config" / "orcamento.json"
    if not caminho.exists():
        return {"dia_virada": 1, "praças": {}}
    dados = json.loads(caminho.read_text(encoding="utf-8"))
    dados.pop("_leia", None)
    return dados


def classificar(ent):
    """Anexa grupo temático, especialidade e exame a partir dos nomes."""
    contexto = [
        ent.get("nome") or "",
        ent.get("campanha") or "",
        ent.get("conjunto") or "",
        ent.get("pai") or "",
        ent.get("objetivo") or "",
    ]
    ent["balde"] = detectar_balde(*contexto)
    ent["especialidade"] = detectar_especialidade(*contexto)
    ent["exame"] = detectar_exame(*contexto)
    ent["topo"] = ent["balde"] == "Alcance / Engajamento"
    return ent


def historico_mensal(hist):
    """Consolida o histórico por mês: Meta só com campanhas de captação
    (mensagens), Google com todas. O navegador só formata."""
    meses = {}

    def mes(chave):
        return meses.setdefault(chave, {
            "meta_msg": 0, "meta_gasto": 0.0, "meta_imp": 0,
            "goo_lig": 0, "goo_gasto": 0.0, "goo_cliques": 0,
        })

    for r in hist.get("meta", []):
        if detectar_balde(r.get("campanha")) in META_FORA_CAPTACAO:
            continue
        m = mes(r["mes"])
        m["meta_msg"] += r.get("mensagens", 0)
        m["meta_gasto"] += r.get("gasto", 0)
        m["meta_imp"] += r.get("impressoes", 0)

    for r in hist.get("google", []):
        m = mes(r["mes"])
        m["goo_lig"] += r.get("ligacoes", 0)
        m["goo_gasto"] += r.get("gasto", 0)
        m["goo_cliques"] += r.get("cliques", 0)

    return [
        dict(mes=k, **{c: round(v, 2) if isinstance(v, float) else v
                       for c, v in dados.items()})
        for k, dados in sorted(meses.items())
    ]


def montar(bruto):
    praças = {}
    tops = set()

    for chave, v in bruto["praças"].items():
        entidades, serie = [], []

        for plataforma, dados in [("google", v["google"]), ("meta", v["meta"])]:
            for ent in dados["entidades"]:
                ent["plataforma"] = plataforma
                entidades.append(classificar(ent))
            for linha in dados["serie"]:
                # Defesa contra série antiga em cache com menos colunas.
                serie.append(linha + [0] * (len(COLUNAS_SERIE) - len(linha)))

        for ent in entidades:
            if ent.get("especialidade") and ent["balde"] == "Top Especialidades":
                tops.add(ent["especialidade"])

        praças[chave] = {
            "rotulo": v["rotulo"],
            "entidades": entidades,
            "serie": serie,
            "anuncios_texto": v["google"].get("anuncios_texto", []),
            "historico_mensal": historico_mensal(v.get("historico", {})),
            "geo": v.get("geo", {"meta": [], "google": []}),
        }

    return {
        "gerado_em": bruto["gerado_em"],
        "janela": bruto["janela"],
        "metas": METAS,
        "orcamento": carregar_orcamento(),
        "colunas_serie": COLUNAS_SERIE,
        "catalogo": {
            "especialidades": sorted(ESPECIALIDADES),
            "exames": sorted(EXAMES),
            "top_propostas": sorted(tops),
        },
        "praças": praças,
    }
