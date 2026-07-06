# CLAUDE.md — ROI-NADOS

> **Instruções para IAs (LEIA PRIMEIRO):** Este arquivo é o mapa mental completo do projeto.
> Leia-o inteiro antes de mexer em qualquer coisa. É a fonte de verdade sobre stack,
> arquitetura, convenções e armadilhas. Regras que **quebram o projeto** se ignoradas:
> 1. É **Node.js puro + Express 4 (CommonJS)** — sem TypeScript, sem build, sem framework de front.
> 2. As **views são template strings gigantes** (`dashboard-view.js`, `lp-view.js`, `auth-view.js`,
>    `vision-view.js`): **NUNCA** use crase (`` ` ``) nem `${}` dentro do HTML delas — quebra a
>    string silenciosamente. Concatene com `+` e escape apóstrofos com entidades HTML.
> 3. **Banco Neon em SQL puro** (sem ORM); tabelas criadas sozinhas no boot (`CREATE TABLE IF NOT EXISTS`).
> 4. **Todo texto de UI e comentário em português** (PT-PT, EUR, fuso `Europe/Lisbon`).
> 5. Ao terminar mudanças relevantes, **atualize este arquivo** para mantê-lo preciso.
> 6. Depois de editar módulos, o servidor precisa ser **reiniciado** para recarregar (sem hot-reload).

## 1. Visão geral
Painel de rastreamento de funil e vendas para infoprodutos vendidos com tráfego do TikTok.
Rastreia o lead de ponta a ponta (visita → checkout → compra), dispara eventos server-side
na CAPI (Events API) do TikTok e mostra tudo numa dashboard em `/dashboard`. O checkout é
externo (qualquer gateway), integrado por webhooks universais de conversão. Nome do app: `roi-nados`.

## 2. Stack
- **Runtime:** Node.js >= 18 (JavaScript puro, CommonJS). Sem TypeScript, sem framework de front, sem build.
- **Web:** Express `^4.21.0`.
- **Banco:** Neon Postgres via `@neondatabase/serverless` `^1.1.0` (SQL puro, sem ORM).
- **Cache/dedup:** Upstash Redis `@upstash/redis` `^1.38.0` (opcional; fallback em memória).
- **Geo:** `geoip-lite` `^2.0.3` (fallback; a fonte primária são headers de edge Vercel/Cloudflare).
- **Serviços externos:** TikTok Events API (`business-api.tiktok.com`), Pushcut (webhook de push).
- **Dependência órfã:** `ws` `^8.21.0` está no `package.json` mas **não é usada** por nenhum módulo
  (presença ao vivo usa polling HTTP `/api/pulse`, não WebSocket). Pode ser removida.

## 3. Deploy e ambientes
- **Produção real:** roda no **Railway**, com as credenciais **próprias do usuário** (Neon + Upstash
  configuradas nas *Variables* do Railway). Independente do v0. Start: `node server.js`.
- **Preview do v0:** usa env gerenciada (`.env.development.local` com `DATABASE_URL` do Neon gerenciado).
- **Diagnóstico rápido:** `GET /api/status` (público, sem auth) → `{ok, db, redis, hint}`. Primeira
  parada para depurar "banco não configurado" em produção, sem expor segredos. Não confundir com
  `GET /api/health`, que é **autenticado** e serve outro propósito.

## 4. Arquitetura
Toda a lógica vive em módulos na raiz (sem subpastas de código). As views são strings
HTML/CSS/JS servidas pelo Express.

```
                       ┌─────────────┐
  navegador / t.js ──► │  server.js  │ ◄── webhooks de gateway (/hook/:token, /api/conversion)
                       └──────┬──────┘
        ┌──────────┬─────────┼──────────┬───────────┬──────────┐
        ▼          ▼         ▼          ▼           ▼          ▼
     stats.js  tiktok-    bot-filter  pixel-store  link-store  gateway-store
   (cache      events.js  (cloaking)  (pixels)     (/go/:slug) (webhooks pay)
    quente)    (CAPI)          │          │           │          │
        │          │          ▼          ▼           ▼          ▼
      db.js  ◄──────── config.js ────────────────►  redis.js
   (Neon: contas,   (config editável na dash)      (dedup event_id,
    sessões, leads,  auth.js (e-mail+senha)          presença, log,
    events, links…)  (sessões via cookie)            cache ASN)
```

Responsabilidades por arquivo:
- **server.js** — Express, TODAS as rotas, middleware que transforma page views em leads, webhooks
  de conversão, boot/hidratação dos stores, `/go/:slug` (cloaking). Ordem de boot importa (ver §8).
- **auth.js** — autenticação **multi-usuário e-mail + senha** (substituiu o Basic Auth de senha única).
  Senhas com `scrypt` (nativo), sessões duráveis no Neon (`account_sessions`) + cache em memória (5 min),
  cookie `dash_session` (HttpOnly, SameSite=Lax, Secure, 30 dias). Middlewares `requireAuth`/`optionalAuth`.
  **O PRIMEIRO usuário registrado vira `admin` e herda os dados legados** (`db.claimLegacyData`).
- **auth-view.js** — páginas HTML de `/login` e `/register` (mesma identidade visual dark/azul da dash).
- **stats.js** — cache em memória de leads/eventos/variantes + write-through assíncrono para o Neon.
- **db.js** — camada Neon (SQL puro). Tabelas: `accounts`, `account_sessions`, `leads`, `events`,
  `variants`, `sessions`, `config`, `pixels`, `links`, `pixel_events`, `gateways`. Desativa (modo
  memória/arquivo) se faltar `DATABASE_URL`. `db.init()` cria tudo com `CREATE TABLE IF NOT EXISTS`.
- **redis.js** — Upstash: dedup de `event_id` (SET NX TTL 2h), presença, log e cache de ASN
  (`asn:<ip>`, TTL 24h) usado pelo bot-filter. Fallback: `Map` em memória.
- **config.js** — config editável na dash (Pushcut, shortlinks, notas, token da API pública, domínios,
  cloak). Persistida em memória + `data/config.json` + Neon. Sempre passar pela sanitização existente.
- **tiktok-events.js** — CAPI do TikTok, multi-pixel via `dispatchToAll` / `sendToPixel`.
- **pixel-store.js** — CRUD de pixels do TikTok (cada um com token/código próprio).
- **link-store.js** — links de checkout (`/go/:slug`). Cada link tem: `variantes[]` (A/B com pesos,
  `pickVariant()` faz split determinístico por visitante), `pixelSlug`, `urlWhitePage`,
  `paises[]` (allowlist ISO-3166-1 alpha-2) e `idiomas[]` (allowlist ISO-639-1). Vazio = todos.
- **gateway-store.js** — gateways de pagamento **multi-tenant**: cada gateway cadastrado ganha um
  `webhook_token` único → webhook em `POST /hook/:token`. O token identifica CONTA + PROVIDER,
  dispensando configuração manual de segredo por gateway.
- **bot-filter.js** — cloaking multicamadas (score 0–100), roteia revisores do TikTok Ads para a
  white page. Lookup de ASN com teto de latência (`deadlineMs`, padrão 120ms via `Promise.race`) e
  cache em 2 camadas (memória + Redis) para redirect quase instantâneo.
- **presence.js + pulse-client.js** — visitantes online (heartbeat `/api/pulse`), globo 3D.
- **tracker-view.js** — snippet `/t.js` para páginas externas.
- **lp-view.js / legal-view.js** — landing page em `/` e páginas legais.
- **vision-view.js** — dashboard alternativa "Vision UI" (HTML estático) servida em `/vision`.
- **ua.js** — parse de User-Agent + detecção de bots.
- **pushcut.js** — notificações push.
- **dashboard-view.js** — HTML/CSS/JS da dashboard principal (o maior arquivo; abas Rastreamento,
  Links de Checkout, Gateways, Filtro de Bots, etc.).

## 5. Rotas principais
- `GET /` — landing page. `GET /vision` — dashboard Vision UI.
- `GET /dashboard` — painel (exige sessão). `GET /login`, `GET /register` — auth.
- `POST /login`, `POST /register`, `POST /logout` — auth (form-urlencoded ou JSON).
- `GET /go/:slug` — redirect com cloaking (ver §7). `GET /t.js` — snippet de tracking.
- `POST /api/pulse` — heartbeat de presença.
- `GET /api/status` — diagnóstico público (`{ok, db, redis}`). `GET /api/health` — status autenticado.
- `POST /api/conversion` — webhook universal de conversão (validado por `CONVERSION_WEBHOOK_SECRET`).
- `POST /hook/:token` — webhook por gateway (token identifica conta + provider).
- `POST /api/cloak/link/:slug` — salva a regra de cloak do link (`paises`, `idiomas`, `urlWhitePage`, `pixelSlug`).

## 6. Comandos essenciais
```bash
npm install     # instala dependências
npm start       # produção: node server.js (porta 3000 ou $PORT)
npm run dev     # local: node --env-file-if-exists=.env.development.local server.js
```
- **Build:** não há (script `build` é um `echo`; JS puro, sem transpile).
- **Testes / lint / typecheck:** não configurados no `package.json`.
- **Migração de banco:** automática e idempotente — `db.init()` roda `CREATE TABLE IF NOT EXISTS` no boot.

## 7. Fluxo do `/go/:slug` (cloaking) — ordem dos gates
Só roda com `cloak.enabled` **e** white page configurada no link; senão apenas registra o evento.
1. **rate-limit** (por IP).
2. **gate de país** — allowlist `link.paises`, instantâneo via headers de edge
   (`x-vercel-ip-country`, `cf-ipcountry`, `x-country`), sem DNS. Fora da lista → white page.
3. **gate de idioma** — allowlist `link.idiomas`, instantâneo via header `Accept-Language`
   (idioma primário, ex.: `pt` de `pt-BR`). Fora da lista → white page.
4. **motor de score** (`bot-filter.judge`) — score 0–100; bots/revisores → white page.
5. **escolha da variante** (`pickVariant`, split A/B determinístico) + disparo de `InitiateCheckout`
   no pixel de `link.pixelSlug` (via `sendToPixel`). Só pessoas reais que chegam à offer geram evento.

País e idioma rodam ANTES do score de propósito (são ~0ms). **Não reordenar.**

## 8. Convenções
- **Idioma:** comentários e UI em português (PT-PT, EUR, fuso `Europe/Lisbon`).
- **Módulos:** CommonJS (`require`/`module.exports`); um arquivo por responsabilidade, todos na raiz.
- **Views como string:** nunca crase nem `${}` no HTML das views (`dashboard-view.js`, `lp-view.js`,
  `auth-view.js`, `vision-view.js`). Concatenar com `+`; apóstrofos como entidades HTML.
- **Rastreamento nunca bloqueia navegação:** middleware de tracking usa `try/catch` silencioso e
  responde antes de processar (efeitos colaterais em background).
- **Neon opcional:** todo acesso a banco degrada com elegância se `DATABASE_URL` faltar.
- **Persistência em três camadas:** memória (rápida) → `data/*.json` (cache local, ignorado no git) → Neon (durável).
- **Segurança:** senhas com `scrypt`; comparações timing-safe com `crypto.timingSafeEqual`.

## 9. Variáveis de ambiente
Carregadas pelo `server.js` a partir de `.env.development.local`, `.env.local`, `.env`
(Node puro não lê `.env` sozinho). No Railway, definidas no painel *Variables*.
- `DATABASE_URL` (ou `POSTGRES_URL`) — Neon Postgres. **Obrigatória**; sem ela, persistência e auth desativadas.
- `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` — Redis (dedup/presença/cache ASN). Opcional.
- `CONVERSION_WEBHOOK_SECRET` — valida `/api/conversion`; base do segredo HMAC do cloak.
- `TIKTOK_ACCESS_TOKEN` — token da CAPI TikTok (e `TIKTOK_PIXEL_CODE` legado em pixel-store).
- `PUSHCUT_WEBHOOK_URL` — URL de notificações Pushcut (pode ser definida na dash).
- `PORT` — porta HTTP (padrão 3000).
- (Legado) `DASHBOARD_PASSWORD` — antigo Basic Auth de senha única, **substituído** pela auth por conta.

## 10. Armadilhas
- **Views são strings frágeis:** crase ou `${}` dentro das views quebram o template silenciosamente.
- **Ordem do boot:** `server.js` hidrata `stats` → `config` → `pixelStore` → `linkStore` → `gatewayStore`
  **antes** do `app.listen`. Novos stores duráveis precisam entrar nessa cadeia, senão sobem sem dados.
- **Config compartilhada:** `config.js` guarda vários blocos (pushcut, links, cloak, domínios, api).
  Ao editar, sempre passar pela sanitização existente — escrever direto no objeto pula validação/persistência.
- **Cloak x white page:** o filtro só redireciona se houver white page por link **e** `cloak.enabled`;
  senão apenas registra. Threshold muito agressivo manda usuário real → white page = venda perdida.
- **`deadlineMs` e sinal ASN:** lookup de ASN tem teto de latência; no estouro o `judge` segue SEM
  esse sinal (marca `asn:deadline`) e popula o cache em background. Baixar demais reduz a precisão.
- **Pixel do link vence:** se `link.pixelSlug` aponta um pixel ativo, o `InitiateCheckout` dispara SÓ
  nele, ignorando casamento por rota. Ocorre após os gates (só gente real gera evento).
- **Dedup determinístico:** `event_id` é `Evento.<vid>.<yyyymmddhh>`. Alterar o formato quebra a
  dedup navegador↔servidor no TikTok (eventos duplicados ou perdidos).
- **CIDRs do bot-filter:** só adicionar ranges 100% confirmados; CIDR errado manda gente real pra white page.
- **`data/` não é fonte de verdade:** cache local ignorado no git; o Neon é a fonte durável.
- **Middleware de lead:** conta 1 lead por visitante (cookie `v_id`, 90 dias) e ignora bots via `ua.js`.
- **Primeiro registro = admin:** com o banco vazio, a primeira conta criada em `/register` vira admin
  e herda os dados legados. Para "resetar" o admin é preciso limpar a tabela `accounts` no Neon.
- **Sem hot-reload:** após editar módulos, reiniciar o processo (`node server.js`) para recarregar.
