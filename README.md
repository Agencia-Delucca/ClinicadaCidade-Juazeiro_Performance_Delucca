# Clínica da Cidade — Juazeiro do Norte · Performance

Acompanhamento de performance das campanhas da Clínica da Cidade na praça de
**Juazeiro do Norte/CE**, em Meta Ads e Google Ads.

Gestão: Agência Delucca.

---

## ⚠️ Regras de dado deste repositório

Este repositório **não armazena credenciais nem dado pessoal**.

| Nunca commitar | Pode commitar |
|---|---|
| `.env`, tokens, `google-ads.yaml` | Scripts de coleta e análise |
| Nome, telefone, e-mail de lead | Métricas agregadas (CPL, CTR, CPM) |
| Exportações brutas de lead | Relatórios consolidados |
| Qualquer dado de saúde de paciente | Documentação e decisões |

Clínica é dado de saúde — categoria sensível na LGPD (Art. 5º, II). Registro de lead
individualizado não entra aqui, nem em repositório privado.

O `.gitignore` já bloqueia `.env`, `dados-brutos/`, `*.csv` e `*.xlsx` por padrão.

---

## Contas

| Praça | Meta Ads | Google Ads |
|---|---|---|
| Juazeiro do Norte | Clinica da Cidade Juazeiro (`1443591460581462`) | CDC - Juazeiro do Norte (`154-455-7293`) |

Acesso ao Google Ads via MCC `3626205833` (Agência Delucca - Performance).

---

## Configuração

1. Copie o template de variáveis:

   ```bash
   cp .env.example .env
   ```

2. Preencha o `.env` com os valores reais. Ele fica **apenas na sua máquina**.

3. Não é preciso instalar dependência: os scripts usam só a biblioteca padrão do Python
   (testado no Python 3.14).

---

## Uso

Resumo por conta, últimos 30 dias:

```bash
python scripts/coleta_meta.py --periodo last_30d
python scripts/coleta_google.py --periodo LAST_30_DAYS
```

Quebra por campanha: acrescente `--nivel campaign`. Período customizado:
`--desde 2026-07-01 --ate 2026-07-31`.

As saídas vão para `relatorios/` em JSON agregado.

---

## Dashboard de otimização

Gera um HTML autocontido cruzando Google Ads e Meta Ads da praça.

```bash
python scripts/dashboard.py
```

Períodos:

```bash
python scripts/dashboard.py --dias 7
python scripts/dashboard.py --desde 2026-08-01 --ate 2026-08-04
```

A comparação é automática: o período anterior de mesma duração.

Saída: `dashboard/index.html` — abre direto no navegador, sem servidor.

**Metas configuradas** (em `scripts/dashboard_pacote.py`):

| Plataforma | Métrica | Meta |
|---|---|---|
| Meta Ads | custo por conversa iniciada | R$ 3,50 |
| Google Ads | custo por ligação | R$ 3,00 |

### Estrutura

Navegação lateral por seção. A *Visão executiva* é uma leitura narrativa, na
ordem em que as perguntas aparecem numa reunião de otimização:

| Bloco | Pergunta que responde |
|---|---|
| O que está acontecendo | KPIs e desempenho por canal, com o topo de funil separado |
| Onde está o problema | Funil impressão → clique → contato, com o gargalo destacado |
| Como está evoluindo | Contatos por dia, investimento por dia e custo por contato contra a meta |
| Onde está o resultado | Melhores criativos, dinheiro sem retorno e campanhas fora da meta |
| Qual ação tomar | Insights do período e alertas ordenados por dinheiro em jogo |

As demais seções são aprofundamentos: **Meta Ads**, **Google Ads**,
**Criativos** (com miniatura e link para o post), **Cobertura** (especialidades
e famílias de exame em três estados) e **Legendas** (títulos e textos de todos
os anúncios).

**Gráficos:** SVG inline, sem biblioteca externa. Paleta validada para
daltonismo e contraste nos temas claro e escuro.

### Ajustes

- **Metas de CPL:** `METAS` em `scripts/dashboard_pacote.py`
- **Apelidos de especialidade e exame:** `scripts/dashboard_taxonomia.py`
- **Investimento mensal contratado:** `config/orcamento.json`

⚠️ As miniaturas dos criativos vêm da CDN da Meta com URL que expira. Se as
imagens sumirem, é só rodar `python scripts/dashboard.py` de novo.

---

## Publicação

Dashboard publicado em **Cloudflare Pages** com senha na borda
(`functions/_middleware.js`) e atualização automática diária às 7h via GitHub
Actions. Detalhes em `docs/publicacao.md`.

## Status das integrações

| API | Status | Observação |
|---|---|---|
| Meta Ads | ✅ Funcionando | Token do conector "Delucca API Connector" |
| Google Ads | ✅ Funcionando | Via MCC `3626205833` (Agência Delucca - Performance) |

Se o `refresh_token` do Google for revogado, regere com:

```bash
python scripts/gerar_refresh_token.py
```

---

## Estrutura

```
.
├── scripts/       # coleta via API + geração do dashboard
├── functions/     # trava de senha do Cloudflare Pages
├── relatorios/    # saídas agregadas (versionadas)
├── dados-brutos/  # ignorado pelo git
├── config/        # orçamento mensal contratado
└── docs/          # contas, decisões e publicação
```
