# HANDOFF — Prompt de contexto para IA sem memória

> **Copie este arquivo inteiro como primeiro prompt** para qualquer IA que vá trabalhar neste
> repositório sem contexto prévio. Ele explica o que é o projeto, o que já foi feito, como a
> nova interface funciona, e o que falta fazer. Depois de ler isto, leia o `CLAUDE.md` (mapa
> técnico completo do backend) e o `docs/PLANO-REFINAMENTO-VISUAL.md` (trabalho pendente).

---

## O QUE É ESTE PROJETO

**ROI-NADOS** é um painel de rastreamento de funil e vendas para infoprodutos vendidos com
tráfego do TikTok. Ele rastreia o lead de ponta a ponta (visita → checkout → compra), dispara
eventos server-side na CAPI (Events API) do TikTok, tem cloaker (filtro de bots), links de
checkout com A/B test, domínios personalizados, e mostra tudo numa dashboard. É **multi-tenant**
(cada conta tem seus pixels, links, gateways e leads). Roda em produção no **Railway**.

- **Idioma:** todo texto de UI e comentários em **português (PT-PT)**, moeda **EUR**, fuso `Europe/Lisbon`.
- **Repo Git:** `jeffpcdi/stripe-europe-checkout`, branch de trabalho `dashboard-com-react`.

## A REESTRUTURAÇÃO QUE FOI FEITA (o mais importante)

O projeto tem **duas gerações de front-end convivendo**:

1. **Legado (NÃO mexer, exceto rollback):** o backend inteiro é **Node.js puro + Express 4
   (CommonJS), sem build**, com módulos `.js` na raiz. A dashboard antiga é `dashboard-view.js` —
   uma **string HTML gigante de ~5200 linhas** com CSS e JS inline. Regra crítica do legado:
   dentro dessas strings **nunca** usar crase ou `${}` (quebra silenciosamente); concatenar com `+`.
   Ela continua acessível em `/dashboard?legacy=1` como rollback.

2. **Nova dashboard (onde o trabalho acontece):** foi **reescrita do zero como app Next.js 16 +
   React 19 + TypeScript + Tailwind v4** dentro da pasta **`dashboard/`** (app independente, com
   `package.json` próprio). É a interface oficial servida em `/dashboard`.

### Arquitetura de execução — um domínio, dois processos

```
                    domínio público (Railway, $PORT)
                                │
                        ┌───────▼────────┐
   funil público  ────► │   Express      │ ◄──── webhooks de pagamento
   (/go, /c, /t.js)     │   server.js    │
                        │  (TODAS as     │
                        │   APIs /api/*) │
                        └───────┬────────┘
                                │ proxy reverso de /dashboard/*
                        ┌───────▼────────┐
                        │  Next.js       │  porta interna 3001
                        │  dashboard/    │  (nunca exposta)
                        └────────────────┘
```

- **`start.js`** (raiz) é o start de produção: sobe o Next (`next start -p 3001`) e o Express
  (`$PORT`) no mesmo serviço. `npm start` roda isso.
- **`server.js`** tem `proxyToNextDashboard()` + `app.use('/dashboard', pageAuth, ...)`: valida a
  sessão e repassa a requisição ao Next. Tudo no mesmo domínio → **zero CORS**, cookie compartilhado.
- O Next tem **`basePath: '/dashboard'`** (`dashboard/next.config.mjs`) e rewrites de `/api/*`,
  `/assets/*` e `/logout` para o Express (relevante em dev).
- **Auth:** `dashboard/proxy.ts` (middleware do Next) só checa a PRESENÇA do cookie `dash_session`
  e redireciona para `/login` (página do Express) se faltar. A validação real é do Express em cada
  chamada de API — um 401 faz `lib/api.ts` redirecionar ao login.
- **REGRA DE OURO:** o Next é **só apresentação**. Nunca criar API routes no Next; toda API nova
  nasce no Express (`server.js`). Nunca acessar `:3001` direto no navegador — sempre
  `http://localhost:3000/dashboard` via proxy.

## OS ARQUIVOS DO BACKEND (Express — raiz do repo)

Todos os módulos `.js` vivem na raiz, um por responsabilidade (detalhes completos no `CLAUDE.md` §4–§18):

| Arquivo | Responsabilidade |
|---|---|
| `server.js` (~2200 linhas) | Express, TODAS as rotas, webhooks, middleware de leads, `/go/:slug` (cloaking), proxy da dashboard |
| `auth.js` / `auth-view.js` | Auth multi-usuário e-mail+senha (scrypt), sessões no Neon, cookie `dash_session`; páginas /login /register |
| `db.js` | Camada Neon Postgres (SQL puro, sem ORM, multi-tenant); tabelas criadas no boot |
| `redis.js` | Upstash Redis via HTTP (dedup, presença, filas, cache ASN); fallback em memória |
| `stats.js` | Cache quente de leads/eventos + write-through pro Neon — é o que alimenta `/api/stats` |
| `config.js` | Config editável na dash (Pushcut, shortlinks, domínios, cloak), por conta |
| `tiktok-events.js` | CAPI do TikTok v1.3: hash de PII, EMQ, retry + fila durável no Redis |
| `pixel-store.js` / `link-store.js` / `gateway-store.js` | CRUD de pixels, links de checkout (A/B) e gateways (webhook por token) |
| `bot-filter.js` / `ua.js` | Cloaker com score 0–100 (bot → white page), lookup de ASN, parse de UA |
| `presence.js` / `pulse-client.js` | Visitantes online (heartbeat `/api/pulse`) |
| `domain-provider.js` | Automação de Custom Domains no Railway (GraphQL) |
| `pushcut.js` | Notificações push de venda |
| `tracker-view.js` | Snippet `/t.js` injetado em páginas externas |
| `dashboard-view.js` / `lp-view.js` / `legal-view.js` / `vision-view.js` | Views legadas (HTML como string) |
| `start.js` | Start de produção (Next + Express juntos) |
| `test/*.test.js` | Testes de regressão em Node puro (`npm test`) |

**APIs que a dashboard nova consome** (todas no Express, autenticadas por sessão): `/api/stats`,
`/api/live`, `/api/health`, `/api/me`, `/api/links`, `/api/pixels` (+ `health`, `log`, `emq-trend`),
`/api/gateways`, `/api/conversion/log`, `/api/cloak-config`, `/api/cloak/stats`, `/api/cloak/entries`,
`/api/domains` (+ `verify`), `/api/pushcut-config`, `/api/notes`, `/api/shortlinks`, `/api/public-token`.

## OS ARQUIVOS DA NOVA DASHBOARD (`dashboard/`)

```
dashboard/
├── next.config.mjs          # basePath /dashboard, allowedDevOrigins, rewrites → Express
├── proxy.ts                 # guard de sessão (presença do cookie dash_session)
├── app/
│   ├── layout.tsx           # root layout: fontes, bg preto, metadata
│   ├── globals.css          # ★ DESIGN SYSTEM INTEIRO: tokens, keyframes, classes utilitárias
│   └── (dashboard)/
│       ├── layout.tsx       # shell: sidebar + header + main
│       ├── page.tsx         # /            → Visão Geral
│       ├── live/            # /live        → Ao Vivo (feed tempo real)
│       ├── geo/             # /geo         → Geografia (globo 3D)
│       ├── funnel/          # /funnel      → Funil + tabela de leads
│       ├── activity/        # /activity    → Atividade (log de eventos)
│       ├── links/           # /links       → Links de Checkout
│       ├── cloak/           # /cloak       → Filtro de Bots (cloaker)
│       ├── domains/         # /domains     → Domínios personalizados
│       ├── pixels/          # /pixels      → Pixel TikTok (saúde + EMQ)
│       ├── gateways/        # /gateways    → Gateways de pagamento
│       └── config/          # /config      → Configurações
├── components/
│   ├── shell/               # sidebar.tsx (nav lateral), header.tsx, mobile-nav.tsx, subnav.tsx, topnav.tsx
│   ├── overview/            # kpi-card, revenue-chart (Recharts), period-picker, health-card, mini-stat
│   ├── live/                # live-view (feed + presença)
│   ├── geo/                 # geo-view + globe.tsx (globe.gl/three, lazy)
│   ├── funnel/              # funnel-view + leads-table
│   ├── activity/            # activity-view
│   ├── links/ pixels/ gateways/ domains/ cloak/ config/   # views + editores por página
│   ├── glass-card.tsx       # card glass base
│   ├── count-up.tsx         # números animados
│   ├── sparkline.tsx        # mini-gráficos dos KPIs
│   ├── skeleton.tsx         # loading states
│   └── status-badge.tsx / section-title.tsx / view-placeholder.tsx
├── lib/
│   ├── api.ts               # ★ hooks SWR (useStats, useLive, useLinks…), fetcher com credentials,
│   │                        #   redirect no 401, mutações POST/PUT/DELETE
│   ├── types.ts             # tipos TS espelhando os JSONs do Express
│   ├── metrics.ts           # deriva KPIs, funil e séries do /api/stats
│   ├── format.ts            # formatação PT (moeda EUR, números, datas)
│   ├── navigation.ts        # fonte única do menu (seções Métricas/Gestão/Sistema)
│   ├── country-coords.ts    # coordenadas p/ o globo
│   └── utils.ts             # cn() etc.
└── public/                  # logo e estáticos próprios do Next
```

**Stack:** Next.js 16 App Router (`experimental.viewTransition`), React 19, TypeScript, Tailwind v4
(sem `tailwind.config` — tokens no `globals.css`), SWR (polling), Recharts, globe.gl, lucide-react.

## A NOVA INTERFACE VISUAL (detalhe por detalhe)

Tema **"Glitch TikTok"** — capturado 1:1 da identidade do legado, definido em `dashboard/app/globals.css`:

### Paleta (tokens CSS — NUNCA usar cor hardcoded em componente)
| Cor | Valor | Uso permitido |
|---|---|---|
| Fundo | `#08080a` preto neutro | fundo global (NUNCA azulado) |
| Ciano neon | `#25f4ee` | interação: links, item ativo, foco, métricas |
| Rosa | `#fe2c55` | "ao vivo", atenção, perigo, recusas |
| Verde | `#22c55e` | **SÓ dinheiro/sucesso** (receita, aprovado) |
| Dourado | `#fbbf24` | avisos, checkout, atenção leve |
| Texto | `#f4f4f5` primário / `#a1a1aa` secundário | hierarquia 100% / 64% / 40% |
| `--brand-grad` | degradê ciano→rosa | **RESERVADO**: logo, card-herói de Receita, anel do globo |

### Linguagem visual
- **Glassmorphism escuro:** cards translúcidos (`glass-card.tsx`) com `backdrop-blur`, borda
  branca 8–12%, raios 14px (cards) e 10px (elementos internos).
- **Atmosfera:** orbes de aurora (ciano/rosa desfocados) derivando lentamente ao fundo + grelha
  de pontos sutil. Sem gradientes berrantes; o neon é acento, não fundo.
- **Tipografia:** sans para texto, **mono para números/labels** (labels uppercase 11px com
  letter-spacing, números tabulares). Fontes mínimo 11px.
- **Layout:** **sidebar fixa à esquerda** (substituiu as pills do topo do legado) com logo neon,
  seções **MÉTRICAS / GESTÃO / SISTEMA** e indicador ativo com a barra gradiente ciano-rosa;
  header por página (título, data, badge "Ao vivo" pulsante); KPIs em grelha 4→2→1; mobile usa
  `mobile-nav.tsx`.
- **Peça central:** o **globo 3D** de tráfego (textura blue-marble servida localmente em
  `/assets/`, polígonos de países via `countries.geojson`, pontos de tráfego, zoom, fullscreen).
  A lib `globe.gl` importa `three` (~1MB) — manter **lazy-loaded**.
- **Animações:** CountUp nos números, skeletons nos loadings, transições suaves. Escala de
  durações alvo: 120/240/400ms.

### Páginas e o que mostram
1. **Visão Geral (`/`)** — 4 KPIs (Receita com card-herói gradiente, Vendas, Leads, Aprovação) +
   cards secundários + gráfico de receita (Recharts, área ciano) com seletor de período (Hoje/7d/30d)
   + painel de saúde do sistema (DB/Redis/CAPI) + top países.
2. **Ao Vivo (`/live`)** — visitantes online agora (presença via polling), feed de eventos.
3. **Geografia (`/geo`)** — globo 3D + tabela de países.
4. **Funil (`/funnel`)** — etapas Visitaram → Checkout → Compraram com taxas + tabela de leads
   com busca/filtros/paginação.
5. **Atividade (`/activity`)** — log cronológico de conversões, disparos de pixel e decisões do cloaker.
6. **Links / Cloak / Domínios / Pixels / Gateways** — CRUDs de gestão (editores em painéis).
7. **Configurações (`/config`)** — Pushcut, token público, notas, sessão (sair).

## TRABALHO PENDENTE — plano de refinamento visual

`docs/PLANO-REFINAMENTO-VISUAL.md` contém **206 alterações numeradas** em 28 blocos (A–AB),
com **12 fases de execução** (commit por fase) e critérios de validação. Destaques:
- **Bloco R (fazer PRIMEIRO):** correções de coerência encontradas em auditoria visual — barra
  azul fora da paleta no funil, sparkline verde na Receita, switches sem trilha, textos truncados,
  códigos de país crus, espaçamentos inconsistentes.
- **Bloco S:** opções de front-end para o usuário (densidade, sidebar recolhível, ocultar valores,
  atalhos de teclado, exportar CSV…).
- Blocos por página (T–W), responsividade (X), performance (Y), formatação de dados (Z),
  tours interativos (H), acessibilidade (Q).

## COMO RODAR E TESTAR

```bash
# Terminal 1 — Express (porta 3000)
npm run dev

# Terminal 2 — Next em dev com HMR (porta 3001)
cd dashboard && npm run dev -- -p 3001

# Acessar SEMPRE pelo proxy:
#   http://localhost:3000/__dev/login   → loga sozinho (só em dev) e cai em /dashboard
#   http://localhost:3000/dashboard     → dashboard nova
#   http://localhost:3000/dashboard?legacy=1 → dashboard antiga (rollback)

# Build de produção / testes
npm run build   # build do Next (dashboard/)
npm test        # regressão do backend
```

- Valide visualmente com screenshots página a página antes de dar algo como pronto.
- Sem hot-reload no Express: reinicie o processo após editar módulos `.js` da raiz.
- `GET /api/status` (público) diagnostica banco/Redis sem expor segredos.

## REGRAS INEGOCIÁVEIS (resumo)

1. Next = apresentação; Express = dados/auth/APIs. Nada de API route no Next.
2. Tokens de cor do `globals.css` sempre; verde só para dinheiro; `--brand-grad` só nos 3 usos reservados.
3. UI e comentários em PT-PT; EUR; `Europe/Lisbon`.
4. No código legado (strings HTML): nunca crase/`${}` dentro do HTML.
5. Não quebrar o rollback `?legacy=1` nem as rotas públicas do funil.
6. Ao terminar mudanças relevantes, atualizar `CLAUDE.md` (e este arquivo se a arquitetura mudar).
7. Commits pequenos por fase; nunca push direto na `main`.
