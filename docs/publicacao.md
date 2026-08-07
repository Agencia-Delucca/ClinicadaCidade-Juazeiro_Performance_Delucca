# Publicação do dashboard — Cloudflare Pages

O dashboard fica em **Cloudflare Pages**, protegido por senha e atualizado
automaticamente todo dia às 7h pelo GitHub Actions.

```
GitHub Actions (7h, diário)
  ├─ roda scripts/dashboard.py    → coleta as contas e gera o HTML
  └─ wrangler pages deploy         → publica no Cloudflare

Cloudflare Pages
  └─ functions/_middleware.js      → exige usuário e senha antes de servir
```

URL de produção: **https://cdc-juazeiro-dashboard.pages.dev**

## Por que senha, e não site aberto

O dashboard mostra investimento, CPL, estrutura de campanha e criativos de um
cliente. Publicado sem trava, isso fica acessível a qualquer pessoa com o link e
indexável pelo Google — incluindo concorrentes do cliente.

A trava roda na borda da Cloudflare, **antes** de qualquer arquivo ser servido.
Não existe janela em que o conteúdo fique exposto. O middleware também devolve
`X-Robots-Tag: noindex` e `Cache-Control: private, no-store`.

Se as credenciais não estiverem configuradas, o site responde `503` em vez de
abrir sem proteção — falha fechada, de propósito.

## Configuração inicial (uma vez só)

### 1. Criar o projeto no Pages

```bash
npx wrangler pages project create cdc-juazeiro-dashboard --production-branch=main
```

### 2. Definir usuário e senha

No painel da Cloudflare: **Workers & Pages → cdc-juazeiro-dashboard → Settings →
Variables and Secrets**, ambiente de produção:

| Variável | Valor |
|---|---|
| `DASH_USUARIO` | o usuário que o time vai digitar |
| `DASH_SENHA` | a senha (marque como **Secret**) |

### 3. Primeiro deploy

```bash
python scripts/dashboard.py
npx wrangler pages deploy dashboard --project-name=cdc-juazeiro-dashboard
```

### 4. Secrets do GitHub Actions

Em **Settings → Secrets and variables → Actions → New repository secret**,
no repositório:

| Secret | Onde obter |
|---|---|
| `META_ACCESS_TOKEN` | mesmo valor do `.env` local |
| `META_ACT_JUAZEIRO` | `1443591460581462` |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | mesmo valor do `.env` local |
| `GOOGLE_ADS_CLIENT_ID` | idem |
| `GOOGLE_ADS_CLIENT_SECRET` | idem |
| `GOOGLE_ADS_REFRESH_TOKEN` | idem |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | `3626205833` |
| `GOOGLE_CID_JUAZEIRO` | `1544557293` |
| `CLOUDFLARE_ACCOUNT_ID` | painel da Cloudflare, barra lateral direita |
| `CLOUDFLARE_API_TOKEN` | My Profile → API Tokens, permissão **Cloudflare Pages: Edit** |

O workflow monta o `.env` a partir desses secrets, roda a coleta, publica e
apaga o `.env` do runner ao final — inclusive se algum passo falhar.

## Uso no dia a dia

Publicar manualmente, fora do horário agendado:

```bash
python scripts/dashboard.py && npx wrangler pages deploy dashboard --project-name=cdc-juazeiro-dashboard
```

Rodar o workflow sob demanda: aba **Actions** do repositório → *Atualizar
dashboard* → **Run workflow**.

## Trocar a senha

Basta alterar `DASH_SENHA` nas variáveis do projeto no Cloudflare. Tem efeito
no próximo carregamento, sem precisar republicar.
