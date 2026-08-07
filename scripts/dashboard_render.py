"""
Monta o HTML do dashboard.

O Python só entrega a casca e o pacote de dados; quem desenha e filtra é o
dashboard_app.js, no navegador. É isso que permite escolher qualquer período
e cruzar filtros sem gerar um arquivo por combinação.

Uso:
    python scripts/dashboard_render.py
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from dashboard_pacote import montar  # noqa: E402

RAIZ = Path(__file__).resolve().parent.parent
ENTRADA = RAIZ / "dados-brutos" / "dashboard.json"
AQUI = Path(__file__).resolve().parent

SECOES = [
    ("resumo", "Visão executiva", "◉"),
    ("meta", "Meta Ads", "◈"),
    ("google", "Google Ads", "◆"),
    ("criativos", "Criativos", "▣"),
    ("cobertura", "Cobertura", "▦"),
    ("legendas", "Legendas", "▤"),
]

ATALHOS = [
    ("7", "Últimos 7 dias"),
    ("14", "Últimos 14 dias"),
    ("30", "Últimos 30 dias"),
    ("60", "Últimos 60 dias"),
    ("90", "Últimos 90 dias"),
    ("custom", "Personalizado"),
]


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--saida", default="dashboard/index.html")
    args = p.parse_args()

    if not ENTRADA.exists():
        sys.exit(f"ERRO: {ENTRADA} nao encontrado. Rode dashboard_coleta.py antes.")

    pacote = montar(json.loads(ENTRADA.read_text(encoding="utf-8")))
    janela = pacote["janela"]

    praças = "".join(
        f'<button class="praca {"ativa" if i == 0 else ""}" data-pag="{k}">'
        f'<span class="pr-ponto"></span>{v["rotulo"]}</button>'
        for i, (k, v) in enumerate(pacote["praças"].items())
    )
    menu = "".join(
        f'<button class="item {"ativa" if i == 0 else ""}" data-sec="{s}">'
        f'<span class="ic">{ic}</span>{t}</button>'
        for i, (s, t, ic) in enumerate(SECOES)
    )
    atalhos = "".join(
        f'<option value="{v}"{" selected" if v == "30" else ""}>{r}</option>'
        for v, r in ATALHOS
    )

    metas = pacote["metas"]
    orc_ok = any(
        (c or {}).get("mensal_total") is not None
        for c in pacote["orcamento"].get("praças", {}).values()
    )
    aviso_orc = (
        ""
        if orc_ok
        else '<div class="aviso">Investimento mensal não configurado — o card de '
        "saldo fica inativo até preencher <code>config/orcamento.json</code>.</div>"
    )

    doc = f"""<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Dashboard de Otimização — Clínica da Cidade Juazeiro</title>
<style>{(AQUI / "dashboard_estilo.css").read_text(encoding="utf-8")}</style>
</head><body>
<div class="app">
  <aside class="lateral">
    <div class="marca">
      <div class="mc-nome">Clínica da Cidade</div>
      <div class="mc-sub">Juazeiro do Norte · Performance</div>
    </div>
    <div class="grupo"><div class="gr-rot">Praça</div>{praças}</div>
    <nav class="grupo"><div class="gr-rot">Seções</div>{menu}</nav>
    <div class="lat-rodape">
      <div class="lr-rot">Metas</div>
      <div class="lr-linha"><span>Conversa (Meta)</span><b>R$ {metas["meta_cpl"]:.2f}</b></div>
      <div class="lr-linha"><span>Ligação (Google)</span><b>R$ {metas["google_cpl"]:.2f}</b></div>
    </div>
  </aside>

  <main class="principal">
    <header class="cabecalho">
      <div>
        <h1>Dashboard de Otimização</h1>
        <div class="sub" id="subtitulo">—</div>
      </div>
      <div class="periodo" id="periodoTxt"></div>
    </header>

    <div class="barra-periodo">
      <label>Atalho<select id="atalho">{atalhos}</select></label>
      <label>De<input type="date" id="de" min="{janela[0]}" max="{janela[1]}"></label>
      <label>Até<input type="date" id="ate" min="{janela[0]}" max="{janela[1]}"></label>
      <button id="aplicar" class="aplicar">Aplicar</button>
      <span class="janela-nota">Dados disponíveis de {janela[0][8:10]}/{janela[0][5:7]}/{janela[0][:4]}
        a {janela[1][8:10]}/{janela[1][5:7]}/{janela[1][:4]}</span>
    </div>
    {aviso_orc}

    <div id="conteudo"></div>

    <footer class="rodape">
      Atualizado automaticamente todo dia às 7h. Para rodar manualmente:
      <code>python scripts/dashboard.py</code>.
      Especialidades marcadas como TOP são a proposta a partir do que já roda em
      campanhas Top Especialidades e WP-Prioridade.
    </footer>
  </main>
</div>
<div id="dica" class="dica"></div>
<script>window.DADOS={json.dumps(pacote, ensure_ascii=False, separators=(",", ":"))};</script>
<script>{(AQUI / "dashboard_app.js").read_text(encoding="utf-8")}</script>
</body></html>"""

    destino = RAIZ / args.saida
    destino.parent.mkdir(parents=True, exist_ok=True)
    destino.write_text(doc, encoding="utf-8")
    print(f"Dashboard: {destino.relative_to(RAIZ)}  ({destino.stat().st_size/1024:,.0f} KB)")
    if not orc_ok:
        print("AVISO: config/orcamento.json sem valores — o card de saldo ficará inativo.")


if __name__ == "__main__":
    main()
