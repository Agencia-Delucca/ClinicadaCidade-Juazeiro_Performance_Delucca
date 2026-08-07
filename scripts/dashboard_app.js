/* =============================================================
   Dashboard de Otimização — aplicação de tela.
   Todo cálculo acontece aqui: o Python só entrega série diária.
   ============================================================= */

const D = window.DADOS;
const METAS = D.metas;

const ORDEM_BALDES = [
  "Top Especialidades", "Demais Especialidades", "Exames", "Ultrassom",
  "Clínica Popular", "Branding", "Alcance / Engajamento", "Outras",
];

const ICONE = { bom: "●", atencao: "▲", ruim: "■", neutro: "○" };
const ROTULO = { bom: "Na meta", atencao: "Atenção", ruim: "Crítico", neutro: "—" };
const MIN_RANK = 10;

/* ------------------------------------------------------------- formatação */

const brl = (v, c = 2) =>
  v == null || isNaN(v)
    ? "—"
    : "R$ " + v.toLocaleString("pt-BR", { minimumFractionDigits: c, maximumFractionDigits: c });

const nu = (v, c = 0) =>
  v == null || isNaN(v)
    ? "—"
    : v.toLocaleString("pt-BR", { minimumFractionDigits: c, maximumFractionDigits: c });

const pct = (v, c = 2) => (v == null || isNaN(v) ? "—" : nu(v, c) + "%");
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (m) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])
  );
const dataBR = (iso) => (iso ? iso.slice(8, 10) + "/" + iso.slice(5, 7) + "/" + iso.slice(0, 4) : "—");
const diaBR = (iso) => (iso ? iso.slice(8, 10) + "/" + iso.slice(5, 7) : "");
const div = (a, b) => (b ? a / b : null);

function selo(nivel, texto) {
  return `<span class="selo ${nivel}"><i>${ICONE[nivel]}</i>${esc(texto || ROTULO[nivel])}</span>`;
}
function variacao(atual, ant) {
  if (!ant) return '<span class="d nulo">—</span>';
  const v = ((atual - ant) / ant) * 100;
  if (Math.abs(v) < 0.5) return '<span class="d nulo">estável</span>';
  return `<span class="d ${v > 0 ? "sobe" : "desce"}">${v > 0 ? "↑" : "↓"} ${nu(Math.abs(v))}%</span>`;
}

/* ----------------------------------------------------------------- estado */

const hoje = D.janela[1];
const estado = {
  praca: Object.keys(D.praças)[0],
  secao: "resumo",
  desde: null,
  ate: null,
  atalho: "30",
  f: {
    metaCamp: "", metaEsp: "",
    gooCamp: "", gooEsp: "",
    criEsp: "", criStatus: "",
    cobSit: "",
  },
};

function somaDias(iso, n) {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function difDias(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000) + 1;
}

function aplicarAtalho(valor) {
  estado.atalho = valor;
  if (valor === "custom") return;
  const n = parseInt(valor, 10);
  estado.ate = hoje;
  estado.desde = somaDias(hoje, -(n - 1));
  if (estado.desde < D.janela[0]) estado.desde = D.janela[0];
}
aplicarAtalho("30");

/* ------------------------------------------------------------- agregação */

const IDX = {};
for (const [chave, p] of Object.entries(D.praças)) {
  const porId = new Map();
  for (const l of p.serie) {
    if (!porId.has(l[0])) porId.set(l[0], []);
    porId.get(l[0]).push(l);
  }
  IDX[chave] = {
    porId,
    ents: new Map(p.entidades.map((e) => [e.id, e])),
  };
}

function zero() {
  return { gasto: 0, impressoes: 0, cliques: 0, resultado: 0, alcance: 0, secundario: 0 };
}

/** Soma a série de cada entidade dentro do intervalo. */
function agregar(praca, ini, fim) {
  const saida = new Map();
  for (const [id, linhas] of IDX[praca].porId) {
    const a = zero();
    let teve = false;
    for (const l of linhas) {
      if (l[1] < ini || l[1] > fim) continue;
      teve = true;
      a.gasto += l[2];
      a.impressoes += l[3];
      a.cliques += l[4];
      a.resultado += l[5];
      a.alcance += l[6] || 0;
      a.secundario += l[7] || 0;
    }
    if (teve) saida.set(id, a);
  }
  return saida;
}

/** Série diária somada por plataforma, para os gráficos. */
function serieDiaria(praca, ini, fim) {
  const dias = new Map();
  const ents = IDX[praca].ents;
  for (const l of D.praças[praca].serie) {
    if (l[1] < ini || l[1] > fim) continue;
    const e = ents.get(l[0]);
    if (!e || e.nivel !== "campanha") continue; // campanha evita dupla contagem
    if (!dias.has(l[1]))
      dias.set(l[1], { data: l[1], meta_gasto: 0, meta_res: 0, google_gasto: 0, google_res: 0 });
    const d = dias.get(l[1]);
    if (e.plataforma === "meta") {
      d.meta_gasto += l[2];
      d.meta_res += l[5];
    } else {
      d.google_gasto += l[2];
      d.google_res += l[5];
    }
  }
  return [...dias.values()]
    .sort((a, b) => a.data.localeCompare(b.data))
    .map((d) => ({
      ...d,
      gasto: d.meta_gasto + d.google_gasto,
      resultado: d.meta_res + d.google_res,
      cpl: div(d.meta_gasto + d.google_gasto, d.meta_res + d.google_res),
    }));
}

function diagnostico(gasto, resultado, cpl, alvo, topo) {
  if (topo) return ["neutro", "Topo de funil — avaliar por alcance, não por CPL"];
  if (gasto <= 0) return ["neutro", "Sem investimento no período"];
  if (!resultado)
    return gasto >= 50
      ? ["ruim", `${brl(gasto, 0)} sem nenhum resultado — pausar ou revisar`]
      : ["atencao", "Sem resultado, mas gasto baixo — observar"];
  if (cpl == null) return ["neutro", "—"];
  if (cpl > alvo * 2) return ["ruim", `CPL ${nu(cpl / alvo, 1)}× a meta — reduzir verba e revisar`];
  if (cpl > alvo) return ["atencao", `CPL ${nu(cpl / alvo, 1)}× a meta — otimizar segmentação`];
  return ["bom", "Dentro da meta — manter"];
}

/** Linhas prontas para tabela: entidade + métricas + comparação + diagnóstico. */
function linhas(praca, nivel, plataforma, agora, antes) {
  const alvo = plataforma === "meta" ? METAS.meta_cpl : METAS.google_cpl;
  const out = [];
  for (const [id, m] of agora) {
    const e = IDX[praca].ents.get(id);
    if (!e || e.nivel !== nivel || e.plataforma !== plataforma) continue;
    const cpl = div(m.gasto, m.resultado);
    const [lv, acao] = diagnostico(m.gasto, m.resultado, cpl, alvo, e.topo);
    const a = antes.get(id) || zero();
    out.push({
      ...e, ...m, cpl, nivel_dx: lv, acao,
      ant: a,
      ctr: div(m.cliques * 100, m.impressoes),
      cpc: div(m.gasto, m.cliques),
      cpm: div(m.gasto * 1000, m.impressoes),
      alvo,
    });
  }
  return out.sort((x, y) => y.gasto - x.gasto);
}

function resumo(lin) {
  const uteis = lin.filter((l) => !l.topo);
  const topo = lin.filter((l) => l.topo);
  const gasto = uteis.reduce((s, l) => s + l.gasto, 0);
  const resultado = uteis.reduce((s, l) => s + l.resultado, 0);
  return {
    gasto,
    resultado,
    cpl: div(gasto, resultado),
    gasto_topo: topo.reduce((s, l) => s + l.gasto, 0),
    impressoes: lin.reduce((s, l) => s + l.impressoes, 0),
    cliques: lin.reduce((s, l) => s + l.cliques, 0),
    na_meta: uteis.filter((l) => l.cpl != null && l.cpl <= l.alvo).length,
    total: uteis.length,
  };
}

/* ------------------------------------------------------------- orçamento */

function cicloAtual() {
  const virada = D.orcamento.dia_virada || 1;
  const ref = new Date(hoje + "T12:00:00");
  let ini = new Date(ref.getFullYear(), ref.getMonth(), virada, 12);
  if (ref < ini) ini = new Date(ref.getFullYear(), ref.getMonth() - 1, virada, 12);
  const fim = new Date(ini.getFullYear(), ini.getMonth() + 1, virada, 12);
  fim.setDate(fim.getDate() - 1);
  return [ini.toISOString().slice(0, 10), fim.toISOString().slice(0, 10)];
}

function saldoDoCiclo(praca) {
  const cfg = (D.orcamento.praças || {})[praca] || {};
  const [ini, fim] = cicloAtual();
  const ag = agregar(praca, ini, fim);

  // Só campanhas: somar conjunto e anúncio junto contaria o mesmo gasto duas vezes.
  let gasto = 0, gastoMeta = 0, gastoGoogle = 0;
  for (const [id, m] of ag) {
    const e = IDX[praca].ents.get(id);
    if (!e || e.nivel !== "campanha") continue;
    gasto += m.gasto;
    if (e.plataforma === "meta") gastoMeta += m.gasto;
    else gastoGoogle += m.gasto;
  }

  const decorridos = difDias(ini, hoje);
  const totais = difDias(ini, fim);
  const orcado = cfg.mensal_total;

  const porPlataforma = [
    { nome: "Meta Ads", cls: "s-meta", orcado: cfg.mensal_meta, gasto: gastoMeta },
    { nome: "Google Ads", cls: "s-google", orcado: cfg.mensal_google, gasto: gastoGoogle },
  ].map((p) => ({
    ...p,
    saldo: p.orcado == null ? null : p.orcado - p.gasto,
    usado: p.orcado ? (p.gasto / p.orcado) * 100 : null,
  }));

  return {
    orcado, gasto, ini, fim, decorridos, totais,
    saldo: orcado == null ? null : orcado - gasto,
    porPlataforma,
  };
}

function mixEspecialidadeExame(praca, lin) {
  let esp = 0, exa = 0, outro = 0;
  for (const l of lin) {
    if (l.exame) exa += l.gasto;
    else if (l.especialidade) esp += l.gasto;
    else outro += l.gasto;
  }
  const total = esp + exa + outro;
  return { esp, exa, outro, total, pEsp: div(esp * 100, total), pExa: div(exa * 100, total) };
}

/* -------------------------------------------------------------- gráficos */

const GL = 760, GA = 240, ML = 48, MR = 12, MT = 14, MB = 26;

function escala(v) {
  const t = Math.max(...v, 0);
  if (t <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(t)));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10]) if (t <= mag * m) return mag * m;
  return mag * 10;
}
const fmtEixo = (v, tipo) =>
  tipo === "brl" ? (v >= 1000 ? "R$ " + nu(v / 1000) + "k" : "R$ " + nu(v)) : v >= 1000 ? nu(v / 1000, 1) + "k" : nu(v);

function eixoY(topo, tipo) {
  let s = "";
  for (let i = 0; i < 4; i++) {
    const v = (topo * i) / 3;
    const y = MT + (GA - MT - MB) * (1 - i / 3);
    s += `<line class="grade" x1="${ML}" y1="${y}" x2="${GL - MR}" y2="${y}"/>
          <text class="tick" x="${ML - 6}" y="${y + 3.5}" text-anchor="end">${fmtEixo(v, tipo)}</text>`;
  }
  return s;
}
function eixoX(dados) {
  if (!dados.length) return "";
  const passo = Math.max(1, Math.ceil(dados.length / 8));
  const larg = (GL - ML - MR) / dados.length;
  return dados
    .map((d, i) =>
      i % passo
        ? ""
        : `<text class="tick" x="${ML + larg * (i + 0.5)}" y="${GA - MB + 14}" text-anchor="middle">${diaBR(d.data)}</text>`
    )
    .join("");
}
function moldura(tit, sub, corpo, legenda = "") {
  return `<figure class="graf"><figcaption><span class="g-tit">${esc(tit)}</span>
    <span class="g-sub">${esc(sub)}</span>${legenda}</figcaption>
    <svg viewBox="0 0 ${GL} ${GA}" preserveAspectRatio="none" role="img" aria-label="${esc(tit)}">${corpo}</svg></figure>`;
}

function grafBarras(dados, series, tit, sub, tipo = "num") {
  if (!dados.length) return moldura(tit, sub, "");
  const topo = escala(dados.map((d) => series.reduce((s, [k]) => s + (d[k] || 0), 0)));
  const util = GA - MT - MB;
  const larg = (GL - ML - MR) / dados.length;
  const bw = Math.max(3, Math.min(larg - 3, 22));
  let marcas = "";
  dados.forEach((d, i) => {
    const x = ML + larg * (i + 0.5) - bw / 2;
    let y = GA - MB;
    for (const [k, rot, cls] of series) {
      const v = d[k] || 0;
      if (v <= 0) continue;
      const h = (util * v) / topo;
      y -= h;
      marcas += `<rect class="m ${cls}" x="${x}" y="${y}" width="${bw}" height="${Math.max(h, 1)}" rx="2"
        data-d="${diaBR(d.data)}" data-r="${rot}" data-v="${tipo === "brl" ? brl(v) : nu(v)}"/>`;
      y -= 2;
    }
  });
  const leg = series.map(([, r, c]) => `<span class="lg"><i class="${c}"></i>${r}</span>`).join("");
  return moldura(tit, sub, eixoY(topo, tipo) + marcas + eixoX(dados), `<span class="legenda">${leg}</span>`);
}

function grafLinha(dados, chave, tit, sub, alvo) {
  const pts = dados.map((d, i) => [i, d[chave]]).filter(([, v]) => v != null && v > 0);
  if (!pts.length) return moldura(tit, sub, "");
  const topo = escala(pts.map(([, v]) => v).concat(alvo ? [alvo * 1.2] : []));
  const util = GA - MT - MB;
  const larg = (GL - ML - MR) / dados.length;
  const X = (i) => ML + larg * (i + 0.5);
  const Y = (v) => MT + util * (1 - v / topo);
  const caminho = pts.map(([i, v], k) => (k ? "L" : "M") + X(i) + "," + Y(v)).join(" ");
  let marcas = `<path class="ln" d="${caminho}"/>`;
  for (const [i, v] of pts)
    marcas += `<circle class="pt m" cx="${X(i)}" cy="${Y(v)}" r="4"
      data-d="${diaBR(dados[i].data)}" data-r="Custo por contato" data-v="${brl(v)}"/>`;
  let alvoSvg = "";
  if (alvo) {
    const ya = Y(alvo);
    alvoSvg = `<line class="alvo" x1="${ML}" y1="${ya}" x2="${GL - MR}" y2="${ya}"/>
      <text class="rot-alvo" x="${GL - MR}" y="${ya - 6}" text-anchor="end">meta ${brl(alvo)}</text>`;
  }
  return moldura(tit, sub, eixoY(topo, "brl") + alvoSvg + marcas + eixoX(dados));
}

/* -------------------------------------------------------------- tabelas */

const COLS_META = [
  ["status", "Status"], ["nome", "Campanha"], ["orcamento", "Orçam."],
  ["resultado", "Result."], ["cpl", "Custo/result."], ["impressoes", "Impress."],
  ["alcance", "Alcance"], ["cpm", "CPM"], ["ctr", "CTR"], ["cliques", "Cliques"],
  ["cpc", "CPC"], ["gasto", "Gasto"], ["acao", "Ação"],
];
const COLS_GOOGLE = [
  ["status", "Status"], ["nome", "Campanha"], ["orcamento", "Orçam."],
  ["resultado", "Ligações"], ["cpl", "Custo/ligação"], ["secundario", "Conversões"],
  ["impressoes", "Impress."], ["cpm", "CPM"], ["ctr", "CTR"], ["cliques", "Cliques"],
  ["cpc", "CPC"], ["gasto", "Gasto"], ["acao", "Ação"],
];

function medidor(cpl, alvo) {
  if (cpl == null) return '<span class="mut">—</span>';
  const r = Math.min(cpl / alvo, 3) / 3;
  const lv = cpl <= alvo ? "bom" : cpl <= alvo * 2 ? "atencao" : "ruim";
  return `<div class="med" title="Meta: ${brl(alvo)}"><div class="med-b ${lv}" style="width:${r * 100}%"></div><div class="med-alvo"></div></div>`;
}

function celula(l, c) {
  const ativo = (l.status || "") === "ENABLED" || (l.status || "") === "ACTIVE";
  switch (c) {
    case "status":
      return `<span class="st ${ativo ? "ativo" : "pausado"}">${ativo ? "ATIVO" : "PAUSADO"}</span>`;
    case "nome": {
      const sub = l.campanha && l.campanha !== l.nome ? l.campanha : l.pai || l.balde || "";
      const tags =
        (l.especialidade ? `<span class="tag">${esc(l.especialidade)}</span>` : "") +
        (l.exame ? `<span class="tag exa">${esc(l.exame)}</span>` : "");
      return `<div class="nome">${esc(l.nome)}${sub ? `<span class="sub">${esc(sub)}</span>` : ""}${tags ? `<span class="tags">${tags}</span>` : ""}</div>`;
    }
    case "orcamento": return brl(l.orcamento || 0);
    case "cpc": case "cpm": case "gasto": return brl(l[c]);
    case "cpl": return `<div class="cpl-cel">${brl(l.cpl)}${medidor(l.cpl, l.alvo)}</div>`;
    case "resultado": return `${nu(l.resultado)} ${variacao(l.resultado, l.ant.resultado)}`;
    case "secundario":
      return l.secundario
        ? `<span class="mut" title="Conversões configuradas — WhatsApp, agendamento, clique em telefone. Não entram no custo por ligação.">${nu(l.secundario, 1)}</span>`
        : '<span class="mut">—</span>';
    case "impressoes": case "alcance": case "cliques": return nu(l[c]);
    case "ctr": return pct(l.ctr);
    case "acao": return `${selo(l.nivel_dx)}<span class="acao">${esc(l.acao)}</span>`;
    default: return esc(l[c]);
  }
}

function tabela(lin, cols, vazio = "Nada registrado com os filtros atuais.") {
  if (!lin.length) return `<p class="mut vazio">${vazio}</p>`;
  return `<div class="rolagem"><table class="tb"><thead><tr>${cols
    .map(([, t]) => `<th>${esc(t)}</th>`)
    .join("")}</tr></thead><tbody>${lin
    .map((l) => `<tr>${cols.map(([c]) => `<td class="c-${c}">${celula(l, c)}</td>`).join("")}</tr>`)
    .join("")}</tbody></table></div>`;
}

/* ------------------------------------------------------- seções de tela */

function cartaoKpi(rot, val, sub, lv, forte) {
  return `<div class="kpi${forte ? " forte" : ""}"><div class="k-rot">${esc(rot)}</div>
    <div class="k-val">${val}</div><div class="k-sub">${sub} ${lv ? selo(lv) : ""}</div></div>`;
}
const nivelCpl = (cpl, alvo) => (cpl == null ? null : cpl <= alvo ? "bom" : cpl <= alvo * 2 ? "atencao" : "ruim");

/** Card de canal: investimento, leads e custo por lead. Usado na visão
 *  executiva e no topo das páginas de plataforma. */
function cartaoCanal(nome, cls, r, alvo, rotuloResultado, nota) {
  const lv = nivelCpl(r.cpl, alvo);
  const rodape =
    nota != null
      ? `<div class="cn-pe">${nota}</div>`
      : r.gasto_topo > 0
      ? `<div class="cn-pe">+ ${brl(r.gasto_topo)} em topo de funil, fora deste cálculo</div>`
      : "";
  return `<div class="canal ${cls}">
    <div class="cn-topo">${esc(nome)} ${lv ? selo(lv) : ""}
      <span class="cn-alvo">meta ${brl(alvo)}</span></div>
    <div class="cn-linha">
      <div><span class="cn-v">${brl(r.gasto)}</span><span class="cn-r">Investido em contato</span></div>
      <div><span class="cn-v">${nu(r.resultado)}</span><span class="cn-r">${esc(rotuloResultado)}</span></div>
      <div><span class="cn-v">${brl(r.cpl)}</span><span class="cn-r">Custo por lead</span></div>
    </div>${rodape}</div>`;
}

function blocoSaldo(praca, mix) {
  const s = saldoDoCiclo(praca);
  const ritmo = s.decorridos ? s.gasto / s.decorridos : 0;
  const projecao = ritmo * s.totais;

  let cartaoOrc;
  if (s.orcado == null) {
    cartaoOrc = `<div class="kpi alerta-cfg"><div class="k-rot">Saldo em conta</div>
      <div class="k-val cfg">configurar</div>
      <div class="k-sub">Informe o investimento mensal em <code>config/orcamento.json</code>
      para este card funcionar</div></div>`;
  } else {
    const usado = div(s.gasto * 100, s.orcado) || 0;
    // Ruim só quando já estourou; atenção quando o ritmo projeta estourar.
    const lv = usado > 100 ? "ruim" : projecao > s.orcado * 1.05 ? "atencao" : "bom";
    const linhas = s.porPlataforma
      .filter((p) => p.orcado != null)
      .map(
        (p) => `<div class="orc-linha"><span class="orc-nome"><i class="${p.cls}"></i>${p.nome}</span>
          <span class="orc-barra"><i style="width:${Math.min(p.usado || 0, 100)}%"></i></span>
          <span class="orc-val">${brl(p.saldo)}<em>de ${brl(p.orcado)}</em></span></div>`
      )
      .join("");
    cartaoOrc = `<div class="kpi forte largo"><div class="k-rot">Saldo em conta</div>
      <div class="k-val">${brl(s.saldo)}</div>
      <div class="barra-orc"><div class="bo-b ${lv}" style="width:${Math.min(usado, 100)}%"></div></div>
      <div class="k-sub">${brl(s.gasto)} gastos de ${brl(s.orcado)} · ${pct(usado, 1)} usado ${selo(lv)}</div>
      <div class="orc-detalhe">${linhas}</div></div>`;
  }

  const restam = s.totais - s.decorridos;
  const porDiaRestante = s.saldo != null && restam > 0 ? s.saldo / restam : null;

  return `<div class="grade-orc">
    ${cartaoOrc}
    <div class="kpi"><div class="k-rot">Ritmo de gasto</div>
      <div class="k-val">${brl(ritmo)}<span class="k-un">/dia</span></div>
      <div class="k-sub">Ciclo ${dataBR(s.ini)} a ${dataBR(s.fim)} · dia ${s.decorridos} de ${s.totais}
      ${s.orcado != null ? `<br>Projeção do mês: <b>${brl(projecao)}</b>` : ""}
      ${porDiaRestante != null ? `<br>Cabe <b>${brl(porDiaRestante)}/dia</b> nos ${restam} dias restantes` : ""}</div></div>
    <div class="kpi"><div class="k-rot">Especialidades × Exames</div>
      <div class="k-val">${pct(mix.pEsp, 0)}<span class="k-un"> / ${pct(mix.pExa, 0)}</span></div>
      <div class="mix"><div class="mx-esp" style="width:${mix.pEsp || 0}%"></div>
        <div class="mx-exa" style="width:${mix.pExa || 0}%"></div></div>
      <div class="k-sub">${brl(mix.esp)} em especialidade · ${brl(mix.exa)} em exames
      ${mix.outro > 0 ? `· ${brl(mix.outro)} não classificado` : ""}</div></div>
  </div>`;
}

function opcoes(lista, sel, rotuloVazio) {
  return (
    `<option value="">${esc(rotuloVazio)}</option>` +
    lista.map((v) => `<option value="${esc(v)}"${v === sel ? " selected" : ""}>${esc(v)}</option>`).join("")
  );
}

function barraFiltros(campos) {
  return `<div class="filtros">${campos.join("")}</div>`;
}

const MES_NOME = ["", "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

function tabelaHistorico(praca) {
  const hist = D.praças[praca].historico_mensal || [];
  if (!hist.length) return '<p class="mut">Sem histórico coletado ainda.</p>';

  const anoJanela = D.janela[1].slice(0, 4);
  const mesAtual = D.janela[1].slice(0, 7);

  const linhas = hist.map((h) => {
    const leads = h.meta_msg + h.goo_lig;
    const inv = h.meta_gasto + h.goo_gasto;
    const nome =
      MES_NOME[parseInt(h.mes.slice(5, 7), 10)] +
      (h.mes.slice(0, 4) !== anoJanela ? " " + h.mes.slice(0, 4) : "") +
      (h.mes === mesAtual ? " (parcial)" : "");
    return `<tr>
      <td>${esc(nome)}</td>
      <td>${nu(h.meta_msg)}</td><td>${brl(div(h.meta_gasto, h.meta_msg))}</td>
      <td>${brl(h.meta_gasto)}</td><td>${nu(h.meta_imp)}</td>
      <td>${nu(h.goo_lig)}</td><td>${brl(div(h.goo_gasto, h.goo_lig))}</td>
      <td>${brl(h.goo_gasto)}</td><td>${nu(h.goo_cliques)}</td>
      <td>${brl(div(h.goo_gasto, h.goo_cliques))}</td>
      <td class="ht-b">${nu(leads)}</td><td class="ht-b">${brl(div(inv, leads))}</td>
      <td class="ht-b">${brl(inv)}</td></tr>`;
  }).join("");

  return `<div class="rolagem"><table class="tb tb-hist">
    <thead>
      <tr class="ht-grupos"><th></th>
        <th colspan="4" class="gh gh-meta">Meta Ads</th>
        <th colspan="5" class="gh gh-google">Google Ads</th>
        <th colspan="3" class="gh gh-total">Total</th></tr>
      <tr><th>Mês</th>
        <th>Mensagens</th><th>Custo</th><th>Investimento</th><th>Impressões</th>
        <th>Ligações</th><th>Custo</th><th>Investimento</th><th>Cliques</th><th>CPC</th>
        <th>Leads</th><th>Custo</th><th>Investimento</th></tr>
    </thead><tbody>${linhas}</tbody></table></div>
    <p class="ht-nota">No Meta Ads entram só as campanhas de captação (que geram mensagem) —
    impulsionamento, tráfego, engajamento, alcance e reconhecimento ficam de fora, inclusive
    no investimento. No Google Ads entram todas as campanhas. "Custo" é por mensagem, por
    ligação e por lead total.</p>`;
}

function tabelaCidades(praca) {
  const geo = D.praças[praca].geo || {};
  const ini = estado.desde, fim = estado.ate;
  const semAcento = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

  const somar = (serie) => {
    const por = new Map();
    for (const [local, data, gasto, res] of serie || []) {
      if (data < ini || data > fim) continue;
      const nome = local.replace(" (state)", "");
      if (!por.has(nome)) por.set(nome, { gasto: 0, res: 0 });
      const a = por.get(nome);
      a.gasto += gasto;
      a.res += res;
    }
    return por;
  };

  const coluna = (rotulo, sub, cls, itens, unidade, extra) => {
    const max = itens.length ? Math.max(...itens.map((c) => c.gasto)) : 0;
    // As plataformas nem sempre abrem o RESULTADO por região; só mostra a
    // linha de resultados quando veio algum número, para não exibir zeros.
    const temRes = itens.some((c) => c.res > 0);
    const linhas = itens.map((c) => `
      <div class="gb-linha">
        <span class="gb-nome" title="${esc(c.local)}">${esc(c.local)}</span>
        <span class="gb-trilho"><i class="${cls}" style="width:${max ? Math.max((c.gasto / max) * 100, 1.5) : 0}%"></i></span>
        <span class="gb-val">${brl(c.gasto, 0)}${temRes ? `<em>${nu(c.res)} ${unidade}</em>` : ""}</span>
      </div>`).join("");
    return `<div class="geo-col">
      <div class="geo-tit"><i class="${cls}"></i>${rotulo}<span>${esc(sub)}</span></div>
      ${itens.length ? linhas : '<p class="mut">Sem entrega registrada no período.</p>'}
      ${extra || ""}
    </div>`;
  };

  // Meta: a Graph API só abre a entrega por ESTADO. Mostra Ceará e consolida
  // o vazamento numa linha só; as cidades vêm da segmentação ativa.
  const ce = { local: "Ceará", gasto: 0, res: 0 };
  const fora = { gasto: 0, res: 0, n: 0 };
  for (const [nome, a] of somar(geo.meta)) {
    if (semAcento(nome) === "ceara") {
      ce.gasto += a.gasto; ce.res += a.res;
    } else {
      fora.gasto += a.gasto; fora.res += a.res; fora.n++;
    }
  }
  const metaItens = [];
  if (ce.gasto > 0 || ce.res > 0) metaItens.push(ce);
  if (fora.gasto > 0)
    metaItens.push({ local: "Fora do Ceará", gasto: fora.gasto, res: fora.res });
  const cidadesMeta = geo.meta_cidades || [];
  const chips = cidadesMeta.length
    ? `<div class="geo-cidades"><b>Cidades impactadas no Ceará:</b> ${cidadesMeta.map(esc).join(" · ")}</div>`
    : "";

  const gooItens = [...somar(geo.google).entries()]
    .map(([local, a]) => ({ local, ...a }))
    .sort((a, b) => b.gasto - a.gasto)
    .slice(0, 12);

  return `<div class="grade-geo">
    ${coluna("Meta Ads", "entrega por estado + cidades da campanha", "s-meta", metaItens, "msgs", chips)}
    ${coluna("Google Ads", "por cidade · top 12 por investimento", "s-google", gooItens, "lig.")}
  </div>
  <p class="ht-nota">Local REAL de entrega no período selecionado. A Meta só reporta a entrega
  por estado — as cidades listadas são as segmentadas nas campanhas ativas; "Fora do Ceará"
  soma entregas em outros estados (localização estimada pela Meta). No Google, parte do
  investimento não recebe cidade atribuída, então a soma das barras pode ficar abaixo do total.</p>`;
}

function secResumo(ctx) {
  const { praca, mCamp, mConj, gCamp, gGrupos, resM, resG, serie } = ctx;
  // O mix sai de conjunto/grupo: é ali que o nome cita a especialidade,
  // não no nome da campanha.
  const mix = mixEspecialidadeExame(praca, [...mConj, ...gGrupos]);
  const total = resM.gasto + resM.gasto_topo + resG.gasto + resG.gasto_topo;

  const rank = rankings(ctx);

  return `
    <div class="bloco">
      <h2>Controle de investimento<span>ciclo mensal e distribuição do gasto</span></h2>
      ${blocoSaldo(praca, mix)}
    </div>
    <div class="bloco">
      <h2>O que está acontecendo<span>volume e eficiência no período selecionado</span></h2>
      <div class="grade-kpi">
        ${cartaoKpi("Investimento no período", brl(total), `Meta ${brl(resM.gasto + resM.gasto_topo)} · Google ${brl(resG.gasto + resG.gasto_topo)}`, null, true)}
        ${cartaoKpi("Contatos gerados", nu(resM.resultado + resG.resultado), `${nu(resM.resultado)} conversas · ${nu(resG.resultado)} ligações telefônicas`, null, true)}
        ${cartaoKpi("Custo por conversa", brl(resM.cpl), `Meta: ${brl(METAS.meta_cpl)}`, nivelCpl(resM.cpl, METAS.meta_cpl))}
        ${cartaoKpi("Custo por ligação", brl(resG.cpl), `Meta: ${brl(METAS.google_cpl)}`, nivelCpl(resG.cpl, METAS.google_cpl))}
        ${cartaoKpi("Campanhas na meta", nu(resM.na_meta + resG.na_meta), `de ${resM.total + resG.total} com investimento`)}
        ${cartaoKpi("Topo de funil", brl(resM.gasto_topo + resG.gasto_topo), "Alcance e engajamento — fora do CPL")}
      </div>
      <div class="grade-canal">
        ${cartaoCanal("Meta Ads", "c-meta", resM, METAS.meta_cpl, "Conversas")}
        ${cartaoCanal("Google Ads", "c-google", resG, METAS.google_cpl, "Ligações telefônicas")}
      </div>
    </div>
    <div class="bloco">
      <h2>Como está evoluindo<span>dia a dia do período selecionado</span></h2>
      <div class="grade-graf">
        ${grafBarras(serie, [["meta_res", "Meta Ads", "s-meta"], ["google_res", "Google Ads", "s-google"]], "Contatos por dia", "conversas no Meta + ligações no Google")}
        ${grafBarras(serie, [["meta_gasto", "Meta Ads", "s-meta"], ["google_gasto", "Google Ads", "s-google"]], "Investimento por dia", "as duas plataformas somadas", "brl")}
        ${grafLinha(serie, "cpl", "Custo por contato, por dia", "investimento total ÷ contatos do dia", (METAS.meta_cpl + METAS.google_cpl) / 2)}
      </div>
    </div>
    <div class="bloco">
      <h2>Histórico mensal<span>mês a mês desde janeiro — independe do filtro de período</span></h2>
      ${tabelaHistorico(praca)}
    </div>
    <div class="bloco">
      <h2>Onde está o resultado<span>e onde o dinheiro está parado</span></h2>
      ${rank}
    </div>
    <div class="bloco">
      <h2>Regiões impactadas<span>onde os anúncios entregaram de verdade — investimento e resultados por local</span></h2>
      ${tabelaCidades(praca)}
    </div>
    <div class="bloco">
      <h2>Qual ação tomar<span>alertas priorizados por dinheiro em jogo</span></h2>
      ${alertas(ctx)}
    </div>`;
}

function rankings(ctx) {
  const { criativos, mCamp, gCamp } = ctx;
  const bons = criativos.filter((c) => c.resultado >= MIN_RANK && c.cpl).sort((a, b) => a.cpl - b.cpl).slice(0, 6);
  const zerados = criativos.filter((c) => c.gasto >= 20 && !c.resultado).sort((a, b) => b.gasto - a.gasto);
  const ruins = [...mCamp, ...gCamp].filter((c) => c.nivel_dx === "ruim" && !c.topo).sort((a, b) => b.gasto - a.gasto);

  const cartao = (tit, sub, itens, render, vazio) =>
    `<div class="rank"><div class="rk-tit">${tit}</div><div class="rk-sub">${esc(sub)}</div>
     ${itens.length ? itens.map(render).join("") : `<p class="mut vazio">${esc(vazio)}</p>`}</div>`;

  const rCri = (c, k) => {
    const img = c.thumb
      ? `<img src="${esc(c.thumb)}" alt="" loading="lazy">`
      : '<span class="mini-sem"></span>';
    const alvo = c.permalink ? `<a href="${esc(c.permalink)}" target="_blank" rel="noopener">${img}</a>` : img;
    return `<div class="rk-item"><span class="rk-n">${k + 1}</span>${alvo}
      <div class="rk-txt"><span class="rk-nome">${esc(c.nome)}</span>
      <span class="rk-met">${brl(c.cpl)} · ${nu(c.resultado)} conversa${c.resultado === 1 ? "" : "s"}</span></div></div>`;
  };
  const rZer = (c, k) =>
    `<div class="rk-item"><span class="rk-n ruim">${k + 1}</span><div class="rk-txt">
      <span class="rk-nome">${esc(c.nome)}</span>
      <span class="rk-met ruim">${brl(c.gasto)} · zero conversa</span></div></div>`;
  const rCam = (c, k) =>
    `<div class="rk-item"><span class="rk-n ruim">${k + 1}</span><div class="rk-txt">
      <span class="rk-nome">${esc(c.nome)}</span>
      <span class="rk-met ruim">${brl(c.gasto)} · ${c.cpl ? "CPL " + brl(c.cpl) : "sem resultado"}</span></div></div>`;

  return `<div class="grade-rank">
    ${cartao("🏆 Criativos mais eficientes", `menor custo por conversa, com ao menos ${MIN_RANK} conversas`, bons, rCri, `Nenhum criativo atingiu ${MIN_RANK} conversas.`)}
    ${cartao("🔥 Dinheiro sem retorno", `${brl(zerados.reduce((s, c) => s + c.gasto, 0))} em ${zerados.length} criativo${zerados.length === 1 ? "" : "s"} com zero conversa${zerados.length > 6 ? " · 6 maiores" : ""}`, zerados.slice(0, 6), rZer, "Nenhum criativo queimando verba.")}
    ${cartao("⚠️ Campanhas fora da meta", `${brl(ruins.reduce((s, c) => s + c.gasto, 0))} em ${ruins.length} campanha${ruins.length === 1 ? "" : "s"}${ruins.length > 6 ? " · 6 maiores" : ""}`, ruins.slice(0, 6), rCam, "Todas dentro da meta.")}
  </div>`;
}

function alertas(ctx) {
  const { mCamp, gCamp, criativos, praca } = ctx;
  const itens = [];

  // Ritmo de verba: sobra e estouro custam dinheiro dos dois lados.
  const s = saldoDoCiclo(praca);
  if (s.orcado != null && s.decorridos >= 3) {
    const projecao = (s.gasto / s.decorridos) * s.totais;
    const desvio = (projecao - s.orcado) / s.orcado;
    if (desvio < -0.1) {
      itens.push({
        nivel: "atencao",
        titulo: `Ritmo projeta ${brl(s.orcado - projecao)} de verba não investida`,
        detalhe: `No ritmo de ${brl(s.gasto / s.decorridos)}/dia o mês fecha em ${brl(projecao)}, `
          + `contra ${brl(s.orcado)} contratados. Para usar tudo, cabem ${brl(s.saldo / (s.totais - s.decorridos))}/dia `
          + `nos ${s.totais - s.decorridos} dias restantes. Leitura do dia ${s.decorridos} do ciclo — ainda dá tempo de corrigir.`,
      });
    } else if (desvio > 0.05) {
      itens.push({
        nivel: "ruim",
        titulo: `Ritmo projeta estouro de ${brl(projecao - s.orcado)}`,
        detalhe: `No ritmo de ${brl(s.gasto / s.decorridos)}/dia o mês fecha em ${brl(projecao)}, `
          + `acima dos ${brl(s.orcado)} contratados. Reduzir para ${brl(s.saldo / (s.totais - s.decorridos))}/dia `
          + `nos ${s.totais - s.decorridos} dias restantes mantém dentro do orçamento.`,
      });
    }
  }
  const topo = [...mCamp, ...gCamp].filter((c) => c.topo && c.gasto > 0);
  const gastoTopo = topo.reduce((s, c) => s + c.gasto, 0);
  if (gastoTopo > 100)
    itens.push({
      nivel: "atencao",
      titulo: `${brl(gastoTopo)} em alcance e engajamento`,
      detalhe: `${topo.length} campanhas de topo de funil, ${topo.filter((c) => !c.resultado).length} sem nenhuma conversa. Se o objetivo é marca, tudo bem — mas não deve entrar no cálculo de CPL.`,
    });

  for (const [nome, lin, alvo] of [["Meta", mCamp, METAS.meta_cpl], ["Google", gCamp, METAS.google_cpl]]) {
    const ruins = lin.filter((c) => c.nivel_dx === "ruim" && !c.topo).sort((a, b) => b.gasto - a.gasto);
    if (ruins.length)
      itens.push({
        nivel: "ruim",
        titulo: `${nome}: ${brl(ruins.reduce((s, c) => s + c.gasto, 0))} em ${ruins.length} campanha${ruins.length === 1 ? "" : "s"} fora da meta`,
        detalhe: "Maiores: " + ruins.slice(0, 3).map((p) => `${p.nome.slice(0, 34)} (${brl(p.gasto, 0)}${p.cpl ? ", CPL " + brl(p.cpl) : ", sem resultado"})`).join(" · "),
      });
    const boas = lin.filter((c) => c.nivel_dx === "bom" && c.resultado >= 10);
    if (boas.length)
      itens.push({
        nivel: "bom",
        titulo: `${nome}: ${boas.length} campanha${boas.length === 1 ? "" : "s"} dentro da meta de ${brl(alvo)}`,
        detalhe: "Melhores: " + boas.sort((a, b) => a.cpl - b.cpl).slice(0, 3).map((m) => `${m.nome.slice(0, 34)} (CPL ${brl(m.cpl)}, ${nu(m.resultado)} resultados)`).join(" · "),
      });
  }
  const ordem = { ruim: 0, atencao: 1, bom: 2 };
  itens.sort((a, b) => ordem[a.nivel] - ordem[b.nivel]);
  if (!itens.length) return '<p class="mut">Nenhum alerta no período.</p>';
  return `<div class="alertas">${itens
    .map((a) => `<div class="al ${a.nivel}"><div class="al-t">${selo(a.nivel)} ${esc(a.titulo)}</div><div class="al-d">${esc(a.detalhe)}</div></div>`)
    .join("")}</div>`;
}

/* ------------------------------------------------- seções de plataforma */

function listaDe(lin, campo) {
  return [...new Set(lin.map((l) => l[campo]).filter(Boolean))].sort();
}

function secPlataforma(ctx, plat) {
  const meta = plat === "meta";
  const camps = meta ? ctx.mCamp : ctx.gCamp;
  const filhos = meta ? ctx.mConj : ctx.gGrupos;
  const cols = meta ? COLS_META : COLS_GOOGLE;
  const fC = meta ? estado.f.metaCamp : estado.f.gooCamp;
  const fE = meta ? estado.f.metaEsp : estado.f.gooEsp;
  const idC = meta ? "metaCamp" : "gooCamp";
  const idE = meta ? "metaEsp" : "gooEsp";

  const passa = (l) =>
    (!fC || l.nome === fC || l.campanha === fC || l.pai === fC) &&
    (!fE || l.especialidade === fE || l.exame === fE);

  const campsF = camps.filter(passa);
  const filhosF = filhos.filter(passa);
  const opcCamp = listaDe(camps, "nome");
  const opcEsp = [...new Set([...camps, ...filhos].flatMap((l) => [l.especialidade, l.exame]).filter(Boolean))].sort();

  const filtros = barraFiltros([
    `<label>Campanha<select data-f="${idC}">${opcoes(opcCamp, fC, "Todas as campanhas")}</select></label>`,
    `<label>Especialidade ou exame<select data-f="${idE}">${opcoes(opcEsp, fE, "Todas")}</select></label>`,
    fC || fE ? `<button class="limpar" data-limpar="${idC},${idE}">✕ Limpar</button>` : "",
  ]);

  const r = resumo(campsF);
  const alvo = meta ? METAS.meta_cpl : METAS.google_cpl;

  let baldes = "";
  if (meta) {
    for (const b of ORDEM_BALDES) {
      const g = filhosF.filter((c) => c.balde === b);
      if (!g.length) continue;
      const gasto = g.reduce((s, c) => s + c.gasto, 0);
      const res = g.reduce((s, c) => s + c.resultado, 0);
      const naMeta = g.filter((c) => c.cpl != null && c.cpl <= alvo).length;
      baldes += `<details class="dobra"${b === "Top Especialidades" ? " open" : ""}>
        <summary><span class="db-nome">${b}</span><span class="db-res">${g.length} conjuntos ·
        ${brl(gasto)} · ${nu(res)} conversas · CPL ${brl(div(gasto, res))} · ${naMeta} na meta</span></summary>
        ${tabela(g, cols)}</details>`;
    }
  }

  const rotRes = meta ? "Conversas" : "Ligações telefônicas";
  const filtrado = fC || fE;
  const melhor = campsF
    .filter((c) => c.cpl != null && c.resultado >= 5 && !c.topo)
    .sort((a, b) => a.cpl - b.cpl)[0];

  const nota = filtrado
    ? `Recorte filtrado${fC ? ` · campanha: ${esc(fC)}` : ""}${fE ? ` · ${esc(fE)}` : ""}`
    : null;

  return `
    <div class="bloco">
      <h2>${meta ? "Meta Ads" : "Google Ads"}<span>${dataBR(estado.desde)} a ${dataBR(estado.ate)}
        · meta de ${brl(alvo)} por ${meta ? "conversa iniciada" : "ligação telefônica"}</span></h2>
      ${filtros}
      <div class="grade-topo">
        ${cartaoCanal(meta ? "Meta Ads" : "Google Ads", meta ? "c-meta" : "c-google", r, alvo, rotRes, nota)}
        <div class="grade-kpi compacta">
          ${cartaoKpi("Campanhas", nu(campsF.length),
            `${nu(r.total)} com investimento${r.gasto_topo > 0 ? " · " + brl(r.gasto_topo) + " em topo de funil" : ""}`)}
          ${cartaoKpi("Dentro da meta", nu(r.na_meta),
            `de ${nu(r.total)} · ${pct(div(r.na_meta * 100, r.total), 0)}`,
            r.total ? (r.na_meta / r.total >= 0.5 ? "bom" : r.na_meta ? "atencao" : "ruim") : null)}
          ${cartaoKpi("Melhor campanha", melhor ? brl(melhor.cpl) : "—",
            melhor ? esc(melhor.nome.slice(0, 40)) : "Nenhuma com 5+ resultados",
            melhor ? nivelCpl(melhor.cpl, alvo) : null)}
        </div>
      </div>
      ${tabela(campsF, cols)}
    </div>
    <div class="bloco">
      <h2>${meta ? "Conjuntos por grupo temático" : "Grupos de anúncios"}<span>${meta ? "alcance e engajamento aparecem separados" : "somente grupos com investimento no período"}</span></h2>
      ${meta ? baldes || '<p class="mut vazio">Nenhum conjunto com os filtros atuais.</p>' : tabela(filhosF, cols)}
    </div>`;
}

function secCriativos(ctx) {
  const { criativos } = ctx;
  const fE = estado.f.criEsp;
  const fS = estado.f.criStatus;
  const lista = criativos.filter(
    (c) =>
      (!fE || c.especialidade === fE || c.exame === fE) &&
      (!fS || c.nivel_dx === fS)
  );
  const opcEsp = [...new Set(criativos.flatMap((c) => [c.especialidade, c.exame]).filter(Boolean))].sort();

  const botao = (v, rot, cls) =>
    `<button class="chip ${cls}${fS === v ? " on" : ""}" data-f="criStatus" data-v="${v}">${rot}</button>`;

  const filtros = barraFiltros([
    `<label>Especialidade ou exame<select data-f="criEsp">${opcoes(opcEsp, fE, "Todas")}</select></label>`,
    `<span class="chips">Qualidade
      ${botao("bom", "● Na meta", "bom")}
      ${botao("atencao", "▲ Atenção", "aten")}
      ${botao("ruim", "■ Crítico", "ruim")}</span>`,
    fE || fS ? `<button class="limpar" data-limpar="criEsp,criStatus">✕ Limpar</button>` : "",
  ]);

  const cartoes = lista
    .map((c) => {
      const img = c.thumb
        ? `<img src="${esc(c.thumb)}" alt="" loading="lazy">`
        : '<div class="sem-img">sem imagem</div>';
      const alvo = c.permalink
        ? `<a href="${esc(c.permalink)}" target="_blank" rel="noopener" title="Abrir no Instagram">${img}<span class="lupa">↗</span></a>`
        : img;
      const ativo = c.status === "ACTIVE";
      return `<div class="cri n-${c.nivel_dx}"><div class="cri-img">${alvo}</div>
        <div class="cri-corpo">
          <div class="cri-top"><span class="st ${ativo ? "ativo" : "pausado"}">${ativo ? "ATIVO" : "PAUSADO"}</span>${selo(c.nivel_dx)}
            ${c.especialidade ? `<span class="tag">${esc(c.especialidade)}</span>` : ""}
            ${c.exame ? `<span class="tag exa">${esc(c.exame)}</span>` : ""}</div>
          <div class="cri-nome">${esc(c.nome)}</div>
          <div class="cri-camp">${esc(c.campanha || "")} › ${esc(c.conjunto || "")}</div>
          <div class="cri-met"><span><b>${brl(c.gasto)}</b> gasto</span>
            <span><b>${nu(c.resultado)}</b> conversas</span>
            <span><b>${brl(c.cpl)}</b> por conversa</span>
            <span><b>${pct(c.ctr)}</b> CTR</span></div>
          <div class="cri-leg">${esc((c.corpo || "").slice(0, 170))}</div>
        </div></div>`;
    })
    .join("");

  return `<div class="bloco">
    <h2>Criativos com entrega<span>clique na imagem para abrir no Instagram</span></h2>
    ${filtros}
    <div class="resumo-filtro">${lista.length} de ${criativos.length} criativos ·
      ${brl(lista.reduce((s, c) => s + c.gasto, 0))} investido ·
      ${nu(lista.reduce((s, c) => s + c.resultado, 0))} conversas</div>
    ${lista.length ? `<div class="grade-cri">${cartoes}</div>` : '<p class="mut vazio">Nenhum criativo com os filtros atuais.</p>'}
  </div>`;
}

function secCobertura(ctx) {
  const { praca, mConj, gGrupos, criativos } = ctx;
  const todas = [...mConj, ...gGrupos];

  const montar = (catalogo, campo) => {
    const mapa = new Map(catalogo.map((n) => [n, { item: n, conj: 0, cri: 0, gasto: 0, resultado: 0, baldes: new Set() }]));
    for (const l of todas) {
      const alvo = l[campo];
      if (!alvo || !mapa.has(alvo)) continue;
      const m = mapa.get(alvo);
      m.conj++;
      m.gasto += l.gasto;
      m.resultado += l.resultado;
      m.baldes.add(l.balde);
    }
    for (const c of criativos) {
      const alvo = c[campo];
      if (alvo && mapa.has(alvo)) mapa.get(alvo).cri++;
    }
    return [...mapa.values()].map((m) => ({
      ...m,
      cpl: div(m.gasto, m.resultado),
      top: D.catalogo.top_propostas.includes(m.item),
      situacao: m.gasto > 0 ? "entregando" : m.conj > 0 ? "sem_entrega" : "ausente",
    }));
  };

  const render = (itens, titulo, mostrarTop) => {
    const ordem = { entregando: 0, sem_entrega: 1, ausente: 2 };
    const cont = { entregando: 0, sem_entrega: 0, ausente: 0 };
    itens.forEach((i) => cont[i.situacao]++);
    const f = estado.f.cobSit;
    const vis = itens
      .filter((i) => !f || i.situacao === f)
      .sort((a, b) => ordem[a.situacao] - ordem[b.situacao] || b.gasto - a.gasto);

    // Chip zerado não vira botão morto: fica desabilitado, com o número à vista.
    const chip = (v, rot, cls) =>
      `<button class="cb ${cls}${f === v ? " on" : ""}" data-f="cobSit" data-v="${v}"
        ${cont[v] ? "" : "disabled"}>${cont[v]} ${rot}</button>`;

    const linha = (i) => {
      const tag = mostrarTop && i.top ? '<span class="tag-top">TOP</span>' : "";
      const nome = `<td class="nome">${esc(i.item)} ${tag}</td>`;
      if (i.situacao === "entregando")
        return `<tr><td>${selo("bom", "Entregando")}</td>${nome}<td>${nu(i.conj)}</td><td>${nu(i.cri)}</td>
          <td>${brl(i.gasto)}</td><td>${nu(i.resultado)}</td><td>${brl(i.cpl)}</td></tr>`;
      if (i.situacao === "sem_entrega")
        return `<tr class="fraca"><td>${selo("atencao", "Sem entrega")}</td>${nome}<td>${nu(i.conj)}</td><td>${nu(i.cri)}</td>
          <td colspan="3" class="mut">Conjunto ativo que não gastou nada no período — verificar orçamento, lance ou aprovação</td></tr>`;
      return `<tr class="fraca"><td>${selo("ruim", "Sem campanha")}</td>${nome}
        <td colspan="5" class="mut">Nenhum conjunto — candidato a arte nova</td></tr>`;
    };

    return `<div class="cob">
      <div class="cob-res">
        ${chip("entregando", "entregando", "bom")}
        ${chip("sem_entrega", "sem entrega", "aten")}
        ${chip("ausente", "sem campanha", "ruim")}
        ${f ? `<button class="limpar" data-limpar="cobSit">✕ Ver todos</button>` : ""}
        <span class="mut">de ${itens.length} ${titulo}</span>
      </div>
      ${vis.length
        ? `<div class="rolagem"><table class="tb"><thead><tr><th>Situação</th><th>${titulo}</th>
        <th>Conj. ativos</th><th>Criativos</th><th>Gasto</th><th>Resultado</th><th>Custo/result.</th>
        </tr></thead><tbody>${vis.map(linha).join("")}</tbody></table></div>`
        : `<p class="mut vazio">Nenhum item nesta situação no período selecionado.</p>`}</div>`;
  };

  return `<div class="bloco">
      <h2>Especialidades<span>as 39 do catálogo do site cruzadas com o que roda no período</span></h2>
      ${render(montar(D.catalogo.especialidades, "especialidade"), "especialidades", true)}
    </div>
    <div class="bloco">
      <h2>Exames<span>famílias de exame com e sem cobertura</span></h2>
      ${render(montar(D.catalogo.exames, "exame"), "famílias de exame", false)}
    </div>`;
}

function secLegendas(ctx) {
  const { criativos, praca } = ctx;
  const porCamp = new Map();
  for (const c of criativos) {
    const k = c.campanha || "(sem campanha)";
    if (!porCamp.has(k)) porCamp.set(k, []);
    porCamp.get(k).push(c);
  }
  const meta = [...porCamp.entries()]
    .sort((a, b) => b[1].reduce((s, c) => s + c.gasto, 0) - a[1].reduce((s, c) => s + c.gasto, 0))
    .map(
      ([camp, itens]) => `<details class="dobra"><summary><span class="db-nome">${esc(camp)}</span>
        <span class="db-res">${itens.length} criativos</span></summary>
        <div class="rolagem"><table class="tb"><thead><tr><th>Anúncio</th><th>Título</th><th>Texto</th><th>Preview</th></tr></thead>
        <tbody>${itens
          .map(
            (c) => `<tr><td class="nome">${esc(c.nome)}</td><td>${esc(c.titulo || "—")}</td>
            <td class="txt">${esc(c.corpo || "—")}</td>
            <td>${c.permalink ? `<a href="${esc(c.permalink)}" target="_blank" rel="noopener">ver</a>` : "—"}</td></tr>`
          )
          .join("")}</tbody></table></div></details>`
    )
    .join("");

  const textos = D.praças[praca].anuncios_texto;
  const porCampG = new Map();
  for (const a of textos) {
    const k = a.campanha || "(sem campanha)";
    if (!porCampG.has(k)) porCampG.set(k, []);
    porCampG.get(k).push(a);
  }
  const google = [...porCampG.entries()]
    .sort((a, b) => b[1].reduce((s, c) => s + c.gasto, 0) - a[1].reduce((s, c) => s + c.gasto, 0))
    .map(
      ([camp, itens]) => `<details class="dobra"><summary><span class="db-nome">${esc(camp)}</span>
        <span class="db-res">${itens.length} anúncios</span></summary>
        <div class="rolagem"><table class="tb"><thead><tr><th>Grupo</th><th>Títulos</th><th>Descrições</th><th>Impressões</th><th>Gasto</th></tr></thead>
        <tbody>${itens
          .sort((a, b) => b.gasto - a.gasto)
          .map(
            (a) => `<tr><td class="nome">${esc(a.grupo)}</td><td class="txt">${a.titulos.map(esc).join(" · ")}</td>
            <td class="txt">${a.descricoes.map(esc).join(" · ")}</td><td>${nu(a.impressoes)}</td><td>${brl(a.gasto)}</td></tr>`
          )
          .join("")}</tbody></table></div></details>`
    )
    .join("");

  return `<div class="bloco">
    <h2>Legendas dos anúncios<span>textos no ar, separados por campanha</span></h2>
    <div class="subabas"><button class="sab ativa" data-sub="lm">Meta Ads</button>
      <button class="sab" data-sub="lg">Google Ads</button></div>
    <div class="sub" data-sub="lm">${meta || '<p class="mut">Sem criativos no período.</p>'}</div>
    <div class="sub oculta" data-sub="lg">${google || '<p class="mut">Sem anúncios de texto no período.</p>'}
      <p class="mut nota">Textos do Google não têm série diária — a lista cobre a janela inteira de ${dataBR(D.janela[0])} a ${dataBR(D.janela[1])}.</p></div>
  </div>`;
}

/* ------------------------------------------------------------- desenho */

function contexto() {
  const praca = estado.praca;
  const dur = difDias(estado.desde, estado.ate);
  const antesFim = somaDias(estado.desde, -1);
  const antesIni = somaDias(antesFim, -(dur - 1));

  const agora = agregar(praca, estado.desde, estado.ate);
  const antes = agregar(praca, antesIni, antesFim);

  const mCamp = linhas(praca, "campanha", "meta", agora, antes);
  const mConj = linhas(praca, "conjunto", "meta", agora, antes);
  const criativos = linhas(praca, "anuncio", "meta", agora, antes).filter((c) => c.gasto > 0);
  const gCamp = linhas(praca, "campanha", "google", agora, antes);
  const gGrupos = linhas(praca, "grupo", "google", agora, antes).filter((c) => c.gasto > 0);

  return {
    praca, mCamp, mConj, criativos, gCamp, gGrupos,
    resM: resumo(mCamp), resG: resumo(gCamp),
    serie: serieDiaria(praca, estado.desde, estado.ate),
    comp: [antesIni, antesFim],
  };
}

function desenhar() {
  const ctx = contexto();
  const rot = D.praças[estado.praca].rotulo;

  document.getElementById("subtitulo").textContent =
    `${rot} · Google Ads e Meta Ads`;
  document.getElementById("periodoTxt").innerHTML =
    `<div class="pd-linha"><span>Período</span><b>${dataBR(estado.desde)} — ${dataBR(estado.ate)}</b></div>
     <div class="pd-linha"><span>Comparado com</span><b>${dataBR(ctx.comp[0])} — ${dataBR(ctx.comp[1])}</b></div>
     <div class="pd-linha mut"><span>Atualizado</span><b>${esc(D.gerado_em.replace("T", " às "))}</b></div>`;

  const alvo = document.getElementById("conteudo");
  const s = estado.secao;
  alvo.innerHTML =
    s === "resumo" ? secResumo(ctx)
    : s === "meta" ? secPlataforma(ctx, "meta")
    : s === "google" ? secPlataforma(ctx, "google")
    : s === "criativos" ? secCriativos(ctx)
    : s === "cobertura" ? secCobertura(ctx)
    : secLegendas(ctx);

  ligarEventos();
  window.scrollTo({ top: 0 });
}

/* -------------------------------------------------------------- eventos */

function ligarEventos() {
  document.querySelectorAll("[data-f]").forEach((el) => {
    if (el.tagName === "SELECT") {
      el.onchange = () => {
        estado.f[el.dataset.f] = el.value;
        desenhar();
      };
    } else {
      el.onclick = () => {
        const campo = el.dataset.f;
        estado.f[campo] = estado.f[campo] === el.dataset.v ? "" : el.dataset.v;
        desenhar();
      };
    }
  });
  document.querySelectorAll("[data-limpar]").forEach((b) => {
    b.onclick = () => {
      b.dataset.limpar.split(",").forEach((k) => (estado.f[k] = ""));
      desenhar();
    };
  });
  document.querySelectorAll(".sab").forEach((b) => {
    b.onclick = () => {
      const bl = b.closest(".bloco");
      bl.querySelectorAll(".sab").forEach((x) => x.classList.toggle("ativa", x === b));
      bl.querySelectorAll(".sub").forEach((x) => x.classList.toggle("oculta", x.dataset.sub !== b.dataset.sub));
    };
  });
  document.querySelectorAll("table.tb thead th").forEach((th, i) => {
    let asc = false;
    th.onclick = () => {
      const corpo = th.closest("table").tBodies[0];
      const ls = [...corpo.rows];
      const val = (tr) => {
        const t = (tr.cells[i]?.innerText || "").trim();
        const n = parseFloat(t.replace(/[R$\s%]/g, "").replace(/\./g, "").replace(",", "."));
        return isNaN(n) ? t.toLowerCase() : n;
      };
      ls.sort((a, b) => {
        const x = val(a), y = val(b);
        return typeof x === "number" && typeof y === "number"
          ? asc ? x - y : y - x
          : asc ? String(x).localeCompare(y) : String(y).localeCompare(x);
      });
      asc = !asc;
      ls.forEach((l) => corpo.appendChild(l));
    };
  });

  const dica = document.getElementById("dica");
  document.querySelectorAll(".graf .m").forEach((m) => {
    m.addEventListener("mousemove", (ev) => {
      dica.textContent = `${m.dataset.d} · ${m.dataset.r}: ${m.dataset.v}`;
      dica.classList.add("on");
      const l = dica.offsetWidth;
      let x = ev.clientX + 14;
      if (x + l > window.innerWidth - 8) x = ev.clientX - l - 14;
      dica.style.left = x + "px";
      dica.style.top = ev.clientY - 34 + "px";
    });
    m.addEventListener("mouseleave", () => dica.classList.remove("on"));
  });
}

function ligarNavegacao() {
  document.querySelectorAll(".praca").forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll(".praca").forEach((x) => x.classList.toggle("ativa", x === b));
      estado.praca = b.dataset.pag;
      Object.keys(estado.f).forEach((k) => (estado.f[k] = ""));
      desenhar();
    };
  });
  document.querySelectorAll(".item").forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll(".item").forEach((x) => x.classList.toggle("ativa", x === b));
      estado.secao = b.dataset.sec;
      desenhar();
    };
  });

  const selAtalho = document.getElementById("atalho");
  const inpDe = document.getElementById("de");
  const inpAte = document.getElementById("ate");

  function sincronizarCampos() {
    inpDe.value = estado.desde;
    inpAte.value = estado.ate;
    selAtalho.value = estado.atalho;
    inpDe.disabled = inpAte.disabled = estado.atalho !== "custom";
  }
  sincronizarCampos();

  selAtalho.onchange = () => {
    aplicarAtalho(selAtalho.value);
    sincronizarCampos();
    if (selAtalho.value !== "custom") desenhar();
  };
  document.getElementById("aplicar").onclick = () => {
    if (inpDe.value && inpAte.value && inpDe.value <= inpAte.value) {
      estado.desde = inpDe.value < D.janela[0] ? D.janela[0] : inpDe.value;
      estado.ate = inpAte.value > D.janela[1] ? D.janela[1] : inpAte.value;
      estado.atalho = "custom";
      sincronizarCampos();
      desenhar();
    } else {
      alert("Escolha uma data inicial menor ou igual à final.");
    }
  };
}

ligarNavegacao();
desenhar();
