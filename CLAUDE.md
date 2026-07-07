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

## 0. Índice
1. Visão geral · 2. Stack · 3. Deploy e ambientes · 4. Arquitetura (4.1 Backend, 4.2 Frontend) ·
5. Rotas · 6. Esquema do banco · 7. Redis · 8. Score do bot-filter · 9. Fluxo do `/go/:slug` ·
10. CAPI do TikTok · 11. Comandos · 12. Variáveis de ambiente · 13. Convenções · 14. Armadilhas ·
15. Estrutura de arquivos · 16. Ciclo de vida do lead · 17. Formato dos eventos de tracking ·
18. Ciclo de vida do domínio personalizado.

## 1. Visão geral
Painel de rastreamento de funil e vendas para infoprodutos vendidos com tráfego do TikTok.
Rastreia o lead de ponta a ponta (visita → checkout → compra), dispara eventos server-side
na CAPI (Events API) do TikTok e mostra tudo numa dashboard em `/dashboard`. O checkout é
externo (qualquer gateway), integrado por webhooks universais de conversão. Nome do app: `roi-nados`.
É **multi-tenant**: cada conta (`account_id`) tem seus próprios pixels, links, gateways, leads e config.

## 2. Stack
- **Runtime:** Node.js >= 18 (JavaScript puro, CommonJS). Sem TypeScript, sem framework de front, sem build.
- **Web:** Express `^4.21.0` + `compression` (gzip em todas as respostas > 1 KB — essencial:
  o HTML da dashboard tem ~340 KB e cai para ~55 KB comprimido).
- **Banco:** Neon Postgres via `@neondatabase/serverless` `^1.1.0` (SQL puro por template tag, sem ORM).
- **Cache/dedup:** Upstash Redis `@upstash/redis` `^1.38.0` via HTTP REST (opcional; fallback em memória).
- **Geo:** `geoip-lite` `^2.0.3` (fallback; a fonte primária são headers de edge Vercel/Cloudflare).
- **Serviços externos:** TikTok Events API (`business-api.tiktok.com/open_api/v1.3`), Pushcut (push).
- **Dependência órfã:** `ws` `^8.21.0` está no `package.json` mas **não é usada** por nenhum módulo
  (presença ao vivo usa polling HTTP `/api/pulse`, não WebSocket). Pode ser removida.

## 3. Deploy e ambientes
- **Produção real:** roda no **Railway**, com credenciais **próprias do usuário** (Neon + Upstash
  nas *Variables* do Railway). Independente do v0. Start: `node server.js`.
- **Preview do v0:** usa env gerenciada (`.env.development.local` com `DATABASE_URL` do Neon gerenciado).
- **Diagnóstico rápido:** `GET /api/status` (público, sem auth) → `{ok, db, redis, hint}`. Primeira
  parada para depurar "banco não configurado" em produção, sem expor segredos. Não confundir com
  `GET /api/health`, que é **autenticado** e traz status detalhado.

## 4. Arquitetura
Toda a lógica vive em módulos na raiz (sem subpastas de código). As views são strings
HTML/CSS/JS servidas pelo Express. Tamanho aproximado (linhas): `dashboard-view.js` ~5200 (maior),
`server.js` ~2200, `db.js` ~670, `bot-filter.js` ~600, `stats.js` ~560, `lp-view.js`/`vision-view.js` ~450.

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
    sessões, leads,  auth.js (e-mail+senha)          presença, logs,
    events, links…)  (sessões via cookie)            filas, cache ASN)
```

### 4.1 Backend — responsabilidades por arquivo
- **server.js** — Express, TODAS as rotas (ver §5), middleware que transforma page views em leads,
  webhooks de conversão, boot/hidratação dos stores, `/go/:slug` (cloaking). Ordem de boot importa (§10).
  Helper `publicAccountId()` decide de qual conta é o tráfego público (domínio mapeado → senão o 1º admin).
- **auth.js** — autenticação **multi-usuário e-mail + senha** (substituiu o Basic Auth de senha única).
  Senhas com `scrypt` (nativo, salt+hash), comparação `timingSafeEqual`. Sessões duráveis no Neon
  (`account_sessions`) + cache em memória (5 min); cookie `dash_session` (HttpOnly, SameSite=Lax,
  Secure, 30 dias). Middlewares `requireAuth` (bloqueia) e `optionalAuth` (anexa `req.account` se houver).
  **O PRIMEIRO usuário registrado vira `role='admin'` e herda os dados legados** (`db.claimLegacyData`).
- **auth-view.js** — páginas HTML de `/login` e `/register` (identidade visual dark/azul da dash).
- **stats.js** — cache em memória de leads/eventos/variantes (API síncrona rápida) + write-through
  assíncrono para o Neon. É a fonte que a dashboard lê para métricas. Hidratado no boot via `db.loadState`.
- **db.js** — camada Neon (SQL puro, multi-tenant). Ver esquema completo em §6. Desativa (modo
  memória/arquivo) se faltar `DATABASE_URL`. `db.init()`/`initWithRetry()` criam tudo com
  `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ADD COLUMN IF NOT EXISTS` (idempotente).
- **redis.js** — Upstash via HTTP REST. Chaves e TTLs em §7. Aceita aliases `KV_REST_API_URL/TOKEN`.
  Fallback: `Map`/array em memória (o log de conversão sempre tem ring em memória).
- **config.js** — config editável na dash (Pushcut, shortlinks, notas, token da API pública, domínios,
  cloak). Persistida em memória + `data/config.json` + Neon (por conta). Sempre passar pela sanitização.
- **tiktok-events.js** — CAPI do TikTok v1.3. Hash SHA-256 de PII, telefone normalizado E.164,
  `external_id` = hash de `lead:<v_id>`. Multi-pixel via `dispatchToAll`/`sendToPixel`. Calcula **EMQ**
  (proxy do Event Match Quality, 0–10) por `matchScore()`. Retry imediato + fila durável no Redis.
- **pixel-store.js** — CRUD de pixels do TikTok (cada um com `pixel_code` + `access_token` próprios).
- **link-store.js** — links de checkout (`/go/:slug`). Cada link: `variantes[]` (A/B com pesos;
  `pickVariant()` faz split determinístico por visitante), `pixelSlug`, `urlWhitePage`,
  `paises[]` (ISO-3166-1 alpha-2) e `idiomas[]` (ISO-639-1). Listas vazias = "todos permitidos".
- **gateway-store.js** — gateways de pagamento **multi-tenant**: cada gateway ganha um `webhook_token`
  único → webhook em `POST /hook/:token`. O token identifica CONTA + PROVIDER, dispensando segredo manual.
- **bot-filter.js** — cloaking multicamadas (score 0–100). Modelo de score em §8. Lookup de ASN (Cymru
  via DNS) com teto de latência (`deadlineMs`, padrão 120ms via `Promise.race`) e cache 2 camadas
  (memória + Redis `asn:<ip>`) para redirect quase instantâneo.
- **presence.js + pulse-client.js** — visitantes online (heartbeat `/api/pulse`), globo 3D no painel.
- **tracker-view.js** — snippet `/t.js` injetado em páginas externas (envia pageview/eventos).
- **ua.js** — parse de User-Agent + detecção de bots (usado no middleware de lead).
- **pushcut.js** — notificações push (venda, etc.) via webhook Pushcut.
- **domain-provider.js** — automação de Custom Domains na hospedagem (hoje Railway GraphQL). Interface
  única (`enabled`/`register`/`status`/`remove`) que isola o provedor — trocar p/ outro (ex.: Cloudflare
  for SaaS) é mexer só aqui. Lê `RAILWAY_API_TOKEN` + IDs de `process.env` e **nunca** vaza o token
  (erros da API viram mensagens genéricas: `auth`/`duplicado`/`limite`/`offline`/`falha na hospedagem`).
  Detecta sozinho o tipo de token (Bearer p/ account/workspace × `Project-Access-Token` p/ project token)
  via `selfTest()` no boot + fallback na 1ª chamada; `register()` **adota** domínio já existente
  (`findByDomain`) quando a criação dá `duplicado`. Degrada gracioso: sem token/IDs, `enabled=false` e o
  app segue em modo manual sem quebrar nada. Detalhes de operação em §5.2.2 e ciclo completo em §18.
- **lp-view.js / legal-view.js** — landing page em `/` e páginas legais (`/termos`, `/privacidade`).
- **vision-view.js** — dashboard alternativa "Vision UI" (HTML estático) em rota interna.

### 4.2 Frontend — como a UI é entregue
- **Não há framework de front nem build.** Cada "view" é uma função que devolve uma string HTML
  completa (com `<style>` e `<script>` inline) servida diretamente pelo Express.
- **dashboard-view.js** (o maior arquivo, ~5200 linhas) — painel principal SPA-like. Navegação por
  abas via atributo `data-view`: **`overview`** (visão geral/métricas), **`tracking`** (rastreamento,
  links de checkout, gateways, filtro de bots), **`live`** (visitantes ao vivo + globo 3D) e
  **`config`** (configurações). Todo o estado é buscado por `fetch()` nos endpoints `/api/*` (§5.2);
  não há store client-side — a página relê os endpoints e re-renderiza os blocos.
- **CSS:** tema **"Glitch TikTok"** (derivado da logo): fundo preto neutro `#08080a` (nunca azul),
  ciano neon `#25f4ee` = interação/links/abas, rosa `#fe2c55` = "ao vivo"/atenção, verde `#22c55e`
  = **só dinheiro**, dourado `#fbbf24` = avisos/checkout, texto `#f4f4f5`/`#a1a1aa`. O degradê
  ciano→rosa (`--brand-grad`) é reservado a: logo, card-herói de Receita e anel do globo.
  Tokens em `:root` no topo do dashboard-view.js — **usar sempre os tokens, nunca cor hardcoded**.
  Escalas fixas: gaps 6/8/12/16px, raios 10px (interno) e 14px (cards), fontes mínimo 11px.
  Popups de confirmação: usar `uiConfirm({title,msg,okLabel,danger},cb)` — nunca `confirm()` nativo.
  Header compacto (~64px): logo 46px + nav inline + status. KPIs em grelha fixa 4→2→1.
- **Regra de ouro do front:** como o HTML é uma string JS, **nunca** use crase nem `${}` dentro dele;
  para interpolar valores do servidor, concatene com `+` e escape aspas/apóstrofos.
- **Snippets servidos para páginas externas:** `/t.js` (tracker-view.js) e `/px.js` `/px/:token.js`
  (pixel do navegador que casa com a CAPI via `event_id` idêntico), além de `/px.gif` (fallback beacon).

## 5. Rotas (todas as do server.js)
### 5.1 Páginas e assets (GET)
- `GET /` — landing page. `GET /termos`, `GET /privacidade` — legais.
- `GET /dashboard` — painel (exige sessão). `GET /login`, `GET /register` — auth.
- `GET /assets/*` — estáticos (cache 7d). Inclui `countries.geojson` (bordas dos países) e
  `earth-blue-marble.jpg` (textura do globo) — servidos localmente para não depender de
  GitHub/unpkg. A lib `globe.gl` (three.js ~1MB) é **lazy-loaded** pela dashboard via
  `ensureGlobeLib()` só quando um globo vai renderizar (não está mais no `<head>`).
- `GET /t.js` — snippet de tracking. `GET /px.js`, `GET /px/:token.js`,
  `GET /px.gif` — pixel do navegador. `GET /l/:slug` — shortlink. `GET /go/:slug` — redirect com cloaking (§9).
- `GET /c/:slug` — link de cloaking dedicado (offer/white próprios por link, §9). Slug **aleatório**
  (não deriva do nome). Cada link tem: `nome` (rótulo), `dominio` (opcional; a URL vira
  `https://<dominio>/c/<slug>` — precisa apontar DNS para o app), `mobileOnly` e `requireAdClick`.
  Gates aplicados na ordem: bot-UA → **mobileOnly** (desktop→white, default ON) → **requireAdClick**
  (sem prova de clique no anúncio TikTok → white; prova = webview in-app OU `ttclid` OU referrer do
  TikTok; fecha o buraco de "copiar/colar o link no navegador") → país (preset: `all`/`br`/`latam`/`eu`/
  `custom`, `[]`=todos) → idioma → motor de score. Ambos os gates têm default LIGADO inclusive para
  links antigos (retroativo via `boolOr(...,true)` na sanitização do config).
- `GET /_safe` — **página neutra embutida** (fail-safe do cloaker). Destino final de bots/revisores
  quando o link não tem white page própria nem white global configurada. HTML institucional inofensivo,
  `noindex`, sem redirect nem oferta. **Bots nunca chegam à offer.**
- `GET /__dev/login` — **acesso rápido só em desenvolvimento** (ver §11.1). Loga automaticamente e
  redireciona para `/dashboard`, sem tela de login. **404 em produção** (`NODE_ENV=production`).

### 5.2 API consumida pela dashboard (auth)
- **Auth/conta:** `POST /login`, `POST /register`, `POST /logout`, `GET /api/me`.
- **Métricas:** `GET /api/stats`, `GET /api/live`, `POST /api/reset-stats`, `GET /api/health`.
- **Pixels:** `GET/POST /api/pixels`, `GET/PUT/DELETE /api/pixels/:slug`, `GET /api/pixels/health`,
  `GET /api/pixels/log`, `POST /api/pixels/test`.
- **Links de checkout:** `GET/POST /api/links`, `GET/PUT/DELETE /api/links/:slug`,
  `POST /api/links/validate-domain`.
- **Cloak/filtro de bots:** `GET/POST /api/cloak-config` (inclui `defaultWhitePage`, a white global
  de fallback da conta), `GET /api/cloak/links`, `GET/POST/DELETE /api/cloak/entries[/:slug]` (links `/c/`),
  `POST /api/cloak/link/:slug`, `POST /api/cloak/test`, `GET /api/cloakcheck`.
  **Métricas de decisão:** `GET /api/cloak/stats` (offer vs white + taxa de bloqueio + breakdown por
  motivo, por link e agregado) e `POST /api/cloak/stats/reset` (zera um link via `{key}` ou todos).
- **Gateways:** `GET/POST /api/gateways`, `GET/PUT/DELETE /api/gateways/:id`.
- **Conversões:** `GET /api/conversion/log`, `POST /api/conversion/test`.
- **Domínios:** `GET/POST /api/domains`, `GET/DELETE /api/domains/:host`, `POST /api/domains/verify`.
  **Mecanismo de verificação (2 passos, mas só o 2º decide):** (1) DNS — `resolveCname`/`resolve4`
  comparados com o `appHost` da requisição; detecta proxy Cloudflare por faixa de IP (`isCloudflareIp`)
  → `cloudflareProxy=true` (nuvem laranja mascara o CNAME real). (2) HTTP — `GET https://host/__domain-check`
  precisa responder 200 com `{app:'roi-nados-tracker'}` (assinatura `APP_CHECK_ID`). **`ok = httpOk`**:
  DNS apontado NÃO basta — sem o domínio roteado na hospedagem (Custom Domain + SSL), `/go` daria 404.
  `dnsPronto=true` = DNS ok mas app ainda não atende. Sem cache: cada verify re-checa do zero. O front
  (dashboard-view.js) tem polling de 30s (só com pendentes + aba visível).
  **Registro automático na hospedagem:** `POST /api/domains` chama `domain-provider.js` (Railway GraphQL
  `customDomainCreate`) quando `RAILWAY_API_TOKEN` está setado; devolve `dnsRecords` (CNAME + eventual TXT
  de verificação) que o popup exibe. `DELETE` remove também na Railway (`customDomainDelete` via
  `providerId` salvo no config). **Nenhum erro bloqueia o cadastro:** `limite`/`auth`/`offline` caem em
  modo manual (com aviso) e a verificação re-tenta o registro sozinha quando há capacidade
  (auto-recuperação em `POST /api/domains/verify`); `duplicado` faz `domain-provider.findByDomain()`
  **adotar** o domínio já existente no Railway (pega `providerId` + DNS reais em vez de falhar).
  O `domain-provider.js` aceita account/workspace token (header `Authorization: Bearer`) OU project token
  (header `Project-Access-Token`), detectando o header certo no boot (`selfTest`).
- **Diversos:** `GET/POST /api/pushcut-config`, `POST /api/pushcut/test`, `GET/POST /api/notes`,
  `PUT /api/notes/:d`, `GET/POST /api/shortlinks`, `DELETE /api/shortlinks/:slug`, `GET/POST /api/public-token`.

### 5.2.1 Guard de domínio personalizado (isolamento host principal × campanha)
- Um request é "personalizado" quando `config.accountForDomain(host)` acha uma conta dona do Host
  (o host principal / domínio do Railway não está na lista de ninguém → não é personalizado).
  `PRIMARY_HOST`/`RAILWAY_PUBLIC_DOMAIN` (env) são salvaguardas: nunca tratados como personalizados
  (evita lockout do painel se o apex for adicionado por engano a uma conta).
- Em domínio personalizado, um middleware (logo após o CORS `/api`, antes do rastreio de funil) serve
  **só o funil público** e responde **404 puro** em qualquer outra rota — o app do SaaS (LP `/`,
  `/dashboard`, `/login`, `/register`, `/privacidade`, `/termos` e TODAS as APIs de gestão) fica
  acessível **só no host principal**. É **allowlist** (não denylist): rota nova nasce bloqueada no
  domínio do lojista. Allowlist: exatos `/_safe`, `/__domain-check`, `/t.js`, `/px.js`, `/px.gif`,
  `/api/track`, `/api/px/event`, `/api/cloakcheck`, `/api/conversion`; regex `/px/:token.js`;
  prefixos `/go/`, `/c/`, `/l/`, `/hook/`, `/assets/`. Ao liberar uma rota pública nova no funil,
  adicione-a a `CUSTOM_ALLOW_EXACT`/`CUSTOM_ALLOW_PREFIX` em `server.js`.

### 5.2.2 Domínios personalizados — operação e diagnóstico (aprendido em produção)
- **Cada domínio precisa ser registrado individualmente no Railway.** Apontar o CNAME do domínio do
  lojista para `roi-nados.top` **não funciona**: o Railway roteia por Host header e só conhece os
  domínios cadastrados nele. Host desconhecido → a borda do Railway responde **404
  `{"status":"error","code":"NOT_FOUND","message":"Application not found",...}`**. Esse JSON com
  `request_id` é a assinatura de "domínio não registrado no Railway" (≠ 404 do nosso app).
- **Sinal de diagnóstico rápido:** `GET https://<host>/__domain-check` → `200 {app:"roi-nados-tracker"}`
  = domínio roteado e nosso app responde (verifica na hora). `404 Application not found` = domínio não
  está no Railway (ficou em modo manual / precisa (re)registrar).
- **Cloudflare deve ficar CINZA (Somente DNS), não laranja.** Com proxy laranja (IPs `104.21.x`/
  `172.67.x`) a Cloudflare intercepta e o SSL/roteamento do Railway pode não emitir. O tutorial no popup
  já avisa isso.
- **Teto de Custom Domains do plano Railway é real.** O código não bloqueia o cadastro (cai em manual +
  auto-recuperação), mas p/ o domínio ser roteado/ganhar SSL precisa de slot livre — libere domínios não
  usados em *Settings → Networking* ou faça upgrade. Após liberar, a verificação reconecta sozinha.
- **Sem hot reload:** mudanças de env (ex.: `RAILWAY_API_TOKEN`) ou de código só valem após **redeploy**.
  Confirme no log de boot: `[domain-provider] Railway conectado — <tipo> token válido`.
- **Fatos do schema GraphQL do Railway** (confirmados por introspection, backboard.railway.com/graphql/v2):
  `customDomainCreate(input:{domain!, projectId!, environmentId!, serviceId!})`; `customDomainDelete(id!)`;
  `customDomain(id!, projectId!)` — **ambos obrigatórios**; `domains(projectId!, environmentId!, serviceId!)`
  → `AllDomains{ customDomains[{id,domain,status{dnsRecords,verified,verificationToken,certificateStatus}}], serviceDomains }`.
  Sonda de auth no boot: `project(id)` (Bearer) e `projectToken` (Project-Access-Token).
- **Sandbox v0 ≠ runtime Railway:** as vars `RAILWAY_*` não existem no sandbox do v0, então `enabled=false`
  e os logs mostram "modo manual" aqui — isso não reflete produção. Teste auth de token só roda no Railway.

### 5.3 Ingestão pública / webhooks (sem sessão)
- `GET /api/status` — diagnóstico público (`{ok, db, redis}`).
- `POST /api/pulse`, `POST /api/pulse/leave` — heartbeat de presença.
- `POST /api/track`, `POST /api/px/event` — ingestão de eventos do navegador (via `/t.js` e `/px.js`).
- `POST /api/conversion` — webhook universal de conversão (validado por `CONVERSION_WEBHOOK_SECRET`).
- `POST /hook/:token` — webhook por gateway (o token identifica conta + provider).
- `GET /api/v1/summary` — API pública read-only (autenticada pelo token público configurável).
- `GET /__domain-check` — verificação de domínio.

## 6. Esquema do banco (Neon, multi-tenant)
Todas as tabelas de dados têm `account_id text`. Tabelas keyed-by-name usam PK namespaced
`${accountId}:${nome}`. Dados legados (`account_id IS NULL`) são atribuídos ao 1º admin via `claimLegacyData()`.
- **accounts** — `id, email (unique), password_hash, name, role ('user'|'admin'), created_at`.
- **account_sessions** — `token (pk), account_id, created_at, expires_at` (+ índice por expiração).
- **gateways** — `id, account_id, provider, name, webhook_token (unique), secret, config jsonb,
  last_event_at, last_event_status, created_at`.
- **leads** — `id, account_id, data jsonb, stage, status, gateway, country, country_name, orphan, timestamps`.
- **events** — `id, account_id, type, at, data jsonb`.
- **variants** — `name (pk namespaced), account_id, data jsonb, updated_at` (contadores A/B).
- **sessions** — `visitor_id (pk), account_id, page, referrer, country, city, ua, ip, variant,
  first_seen, last_seen, pageviews` (sessões ao vivo).
- **config** — `key (pk = account_id, ou 'main' legado), data jsonb, updated_at`.
- **pixels** — `slug (pk namespaced), account_id, data jsonb, updated_at`.
- **links** — `slug (pk namespaced), account_id, data jsonb, updated_at`.
- **pixel_events** — `id, account_id, pixel, event, event_id, lead_id, status, response jsonb, at` (log CAPI).

Funções db.js notáveis: `createAccount`, `getAccountByEmail/ById`, `countAccounts`, `getFirstAccountId`,
`claimLegacyData`, sessões (`create/get/delete/pruneAuthSession`), gateways (`upsert/delete/load/getByToken/touch`),
`upsertLead`, `insertEvent`, `upsertVariant`, `loadState` (hidrata cache no boot), `saveConfig`/`loadConfig`
(retorna `{ok,data}`: `ok=false` = ERRO de leitura, não sobrescrever!), `reset`.

## 7. Redis (Upstash) — chaves, TTLs e usos
- **presence:<id>** — presença ao vivo (TTL 60s, renovado por heartbeat ~12s). `listPresence` faz SCAN+MGET.
- **pixelLog** (lista, cap 500) + **pixelLogByTime** (zset) — log de disparos CAPI (TTL 14 dias).
- **conversionWebhookLog** (lista, cap 200) — cada webhook `/api/conversion` recebido (+ ring em memória sempre).
- **capiRetryQueue** — fila durável de eventos CAPI que falharam após os retries imediatos (cap 300, TTL 2d).
- **convQ** + **convQ:proc** — fila DURÁVEL de conversões do webhook (cap 5000). O webhook grava aqui ANTES do 200; um worker (2s) consome via `LMOVE` para `convQ:proc`, processa e dá ack (`LREM`). `reclaimConversions` (60s, idade>120s) requeue itens presos por crash. Idempotente via dedup.
- **dedup:<event_id>** — dedup navegador↔servidor (SET NX, TTL 2h). Em erro, deixa passar (melhor duplicar que perder).
- **asn:<ip>** — cache do lookup BGP/ASN do bot-filter (TTL 24h), compartilhado entre instâncias.
- **cloakbot:<v_id>** — veredito STICKY do cloaker (só bot, TTL 6h). `/go` curto-circuita à white sem re-rodar o judge; setado no veredito bot e no beacon `/api/cloakcheck` com WebGL de software. Nunca cacheia 'real' (fail-safe).
- **lock:<nome>** — lock distribuído (SET NX EX). Usos: `capiRetryDrain` (só 1 instância drena a fila de retry) e `convWorker` (só 1 instância drena convQ por ciclo). Sem Redis = processo único = já exclusivo.
- **emq:<acc>:<pixel>** — rollup de EMQ por pixel/dia (`d:<data>:sum`/`:cnt`, retenção ~40d). Alimenta `GET /api/pixels/emq-trend` (série + alerta de queda) e o painel de tendência na aba Pixels.
Sem Upstash tudo degrada para memória (perde persistência entre restarts, mas funciona).

## 8. Modelo de score do bot-filter (cloaking)
Cada visita retorna `{ verdict:'real'|'bot', score:0-100, signals[] }`. **`score >= threshold` ⇒ bot ⇒ white page.**
- **Threshold:** padrão 40; presets de sensibilidade `strict:30 / balanced:40 / loose:55` (têm prioridade
  sobre threshold manual). Clamp final 10–90. `deadlineMs` clamp 40–500 (padrão 120).
- **Sinais (exemplos e pesos):** `ua:ausente` +55, `ua:headless` (SwiftShader/llvmpipe) +50,
  `ch-ua:brand-mismatch` +30, `ch-ua:safari-chrome-mix` +25, além de ASN de datacenter/ad-review,
  timezone×geo, comportamento (zero interação). Lista `DATACENTER_ASNS` cobre ByteDance (AS138699/396986/
  136907), hyperscalers, ad-verification (DoubleVerify, HUMAN, IAS) e proxies residenciais.
- **ASN:** detecção primária é o lookup dinâmico (`lookupASN` via DNS Cymru); os CIDRs fixos são só
  fast-path 100% confirmado. No estouro do `deadlineMs`, o `judge` segue SEM o sinal ASN (marca
  `asn:deadline`) e popula o cache em background — nunca atrasa o redirect.

## 9. Fluxo do `/go/:slug` e `/c/:slug` (cloaking) — ordem dos gates
Roda com `cloak.enabled` (interruptor da conta no `/go`, do link no `/c`). **FAIL-SAFE:** não depende
mais de white page por link — o destino seguro sempre existe, na ordem: **white do link → `defaultWhitePage`
global da conta → `/_safe` embutida.** Assim **nenhum bot chega à offer**, mesmo em link sem white.
1. **UA de bot** (`uaTools.isBot`) → página segura.
2. **rate-limit** (por IP) → página segura.
3. **gate de país** — allowlist `link.paises`, instantâneo via headers de edge
   (`x-vercel-ip-country`, `cf-ipcountry`, `x-country`), sem DNS. Fora da lista → página segura.
4. **gate de idioma** — allowlist `link.idiomas`, instantâneo via header `Accept-Language`
   (idioma primário, ex.: `pt` de `pt-BR`). Fora da lista → página segura.
5. **motor de score** (`bot-filter.judge`) — score 0–100; bots/revisores → página segura (SEMPRE, sem exceção).
6. **escolha da variante** (`pickVariant`, split A/B determinístico) + disparo de `InitiateCheckout`
   no pixel de `link.pixelSlug` (via `sendToPixel`). Só pessoas reais que chegam à offer geram evento.

País e idioma rodam ANTES do score (são ~0ms). **Não reordenar.**
**Métricas:** cada decisão chama `redis.bumpCloakDecision(acc, key, 'offer'|'white', motivo)` — `key` é
o `slug` no `/go` e `'cloak:'+slug` no `/c`. Alimenta `GET /api/cloak/stats` e o painel white/offer.
Motivos: `bot-ua`, `rate-limit`, `pais`, `idioma`, `score`. Contadores em `cloakstats:<acc>:<key>` (Redis,
90d, fallback em memória).

## 10. CAPI do TikTok (tiktok-events.js)
- **Endpoint:** `POST https://business-api.tiktok.com/open_api/v1.3/event/track/`, header `Access-Token`.
- **PII:** SHA-256 (trim+lowercase) em email/telefone/external_id. Telefone normalizado para E.164
  antes do hash; fora de 7–15 dígitos é descartado (não envia lixo).
- **external_id:** `hash('lead:' + v_id)` — amarra todo o funil à mesma pessoa no gerenciador do TikTok.
- **EMQ:** `matchScore(user)` devolve 0–10 (proxy do Event Match Quality) + `emqFields` (sinais enviados:
  email, phone, ttclid, external_id…). Guardado no log de disparos para o painel.
- **Dedup:** `event_id` determinístico `Evento.<vid>.<yyyymmddhh>`. **Alterar o formato quebra a dedup**
  navegador↔servidor (duplica ou perde eventos). Retry imediato + fila durável (`capiRetryQueue`).
- **Multi-pixel:** `dispatchToAll` dispara em todos os pixels ativos; `sendToPixel` mira um específico
  (usado pelo `/go` quando o link tem `pixelSlug`).
- **Trava gateway-only (eventos de dinheiro):** `MONEY_EVENTS` = `CompletePayment`, `AddPaymentInfo`,
  `Refund`, `Dispute`. `dispatchToAll` BLOQUEIA esses eventos se o payload não tiver `p._trusted = true`.
  Só o webhook do gateway (`/hook/:token`) e `/api/conversion` marcam `_trusted`. Isso impede venda
  "fantasma" disparada por beacon client-side. Bloqueio é logado com `status:'bloqueado'` e retorna
  `{ blocked:'gateway-only' }`. Client-side fica restrito a `ViewContent`/`InitiateCheckout`/`AddToCart`.

## 11. Comandos essenciais
```bash
npm install     # instala dependências
npm start       # produção: node server.js (porta 3000 ou $PORT)
npm run dev     # local: node --env-file-if-exists=.env.development.local server.js
npm test        # roda os testes de regressão (test/*.test.js), sem rede/DB reais
```
- **Build:** não há (script `build` é um `echo`; JS puro, sem transpile).
- **Testes:** `npm test` — asserts em Node puro, sem framework. `test/retry-queue.test.js` (re-resolução
  da fila CAPI por token) e `test/gateway-only.test.js` (trava de eventos monetários). Stubam
  `pixel-store`/`redis` no require-cache e `global.fetch`. Ao mexer no motor CAPI, rode-os.
- **Migração de banco:** automática e idempotente — `db.init()` roda `CREATE TABLE/ALTER … IF NOT EXISTS` no boot.

### 11.1 Acesso rápido à dashboard em desenvolvimento (para IAs/testes)
Para testar a dashboard **sem cair na tela de login** (registrar conta + injetar cookie a cada vez),
basta abrir uma única rota:
```
GET http://localhost:3000/__dev/login   →  302 /dashboard  (já autenticado)
```
- **Como funciona:** cria uma sessão real para a **primeira conta existente** (`db.getFirstAccountId()`,
  então você vê os dados reais); se o banco estiver vazio, cria uma conta admin de desenvolvimento
  (`dev@local.test` / senha `devdevdev`) e entra nela. Usa a mesma maquinaria de sessão/cookie da auth normal.
- **Uso típico com agent-browser:** `agent-browser open "http://localhost:3000/__dev/login"` — depois é só
  navegar; o cookie `dash_session` fica setado. Não precisa mais de `curl /register` nem `cookies set`.
- **Segurança:** a rota **só existe quando `NODE_ENV !== 'production'`**. Em qualquer deploy Vercel
  (preview e produção usam `NODE_ENV=production`) ela **não é registrada** e responde 404 — portanto
  **nunca** vira um bypass de auth em produção. Definida em `server.js` logo antes de `POST /register`.
- Requer `DATABASE_URL` configurada (sem banco não há contas nem sessões); responde 503 caso falte.

## 12. Variáveis de ambiente
Carregadas pelo `server.js` a partir de `.env.development.local`, `.env.local`, `.env`
(Node puro não lê `.env` sozinho). No Railway, definidas no painel *Variables*.
- `DATABASE_URL` (ou `POSTGRES_URL`) — Neon. **Obrigatória**; sem ela, persistência e auth desativadas.
- `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` (ou aliases `KV_REST_API_URL/TOKEN`) — Redis. Opcional.
- `CONVERSION_WEBHOOK_SECRET` — valida `/api/conversion`; base do segredo HMAC do cloak.
- `TIKTOK_ACCESS_TOKEN` — token da CAPI (e `TIKTOK_PIXEL_CODE` legado em pixel-store).
- `PUSHCUT_WEBHOOK_URL` — URL de notificações Pushcut (pode ser definida na dash).
- `RAILWAY_API_TOKEN` — token da Railway p/ registro automático de Custom Domains via `domain-provider.js`.
  **Aceita qualquer tipo:** account/workspace token (header `Authorization: Bearer`) OU project token
  (header `Project-Access-Token`). O módulo detecta o header certo sozinho (tenta Bearer, cai p/
  Project-Access-Token) e loga no boot qual autenticou. Fallback de nome: usa `RAILWAY_TOKEN` se
  `RAILWAY_API_TOKEN` não existir. **Opcional:** sem token válido, domínios ficam em modo manual (fluxo
  antigo). O token é lido SÓ dentro de `domain-provider.js` e nunca aparece em log, resposta de API, view
  ou mensagem de erro. Usa também `RAILWAY_PROJECT_ID`/`RAILWAY_ENVIRONMENT_ID`/`RAILWAY_SERVICE_ID`
  (injetados automaticamente pelo Railway em runtime). **Obs.:** se um project token for recusado para
  `customDomainCreate`, troque por um account/workspace token (Account Settings → Tokens).
- `PRIMARY_HOST` — (opcional) host do painel/SaaS (ex.: `roi-nados.top`). Salvaguarda do guard de
  domínio personalizado (§5.2.1): esse host — junto de `RAILWAY_PUBLIC_DOMAIN` — nunca é tratado como
  domínio de lojista, evitando lockout do painel. Sem ele, o guard ainda funciona (o host principal
  simplesmente não consta em `accountForDomain`), mas defini-lo é a rede de segurança recomendada.
- `PORT` — porta HTTP (padrão 3000).
- (Legado) `DASHBOARD_PASSWORD` — antigo Basic Auth de senha única, **substituído** pela auth por conta.

## 13. Convenções
- **Idioma:** comentários e UI em português (PT-PT, EUR, fuso `Europe/Lisbon`).
- **Módulos:** CommonJS (`require`/`module.exports`); um arquivo por responsabilidade, todos na raiz.
- **Views como string:** nunca crase nem `${}` no HTML das views. Concatenar com `+`; apóstrofos como entidades.
- **Rastreamento nunca bloqueia navegação:** middleware de tracking usa `try/catch` silencioso e
  responde antes de processar (efeitos colaterais em background).
- **Neon/Redis opcionais:** todo acesso degrada com elegância se a env faltar.
- **Persistência em três camadas:** memória (rápida) → `data/*.json` (cache local, ignorado no git) → Neon (durável).
- **Segurança:** senhas com `scrypt`; comparações timing-safe com `crypto.timingSafeEqual`.
- **Multi-tenant:** toda query/escrita de dados passa `accountId`; nunca vazar dados entre contas.

## 14. Armadilhas
- **Views são strings frágeis:** crase ou `${}` dentro das views quebram o template silenciosamente.
- **Ordem do boot:** `server.js` hidrata `stats` → `config` → `pixelStore` → `linkStore` → `gatewayStore`
  **antes** do `app.listen`. Novos stores duráveis precisam entrar nessa cadeia, senão sobem sem dados.
- **Config compartilhada:** `config.js` guarda vários blocos (pushcut, links, cloak, domínios, api).
  Ao editar, sempre passar pela sanitização — escrever direto no objeto pula validação/persistência.
- **`loadConfig` retorna `{ok,data}`:** `ok=false` = ERRO de leitura (NÃO sobrescreva a config!);
  `ok=true, data=null` = confirmado que não há config salva. Tratar os dois casos distintamente.
- **Cloak x white page (FAIL-SAFE):** o destino seguro SEMPRE existe (white do link → `defaultWhitePage`
  global → `/_safe`). O filtro depende só de `cloak.enabled`; bot detectado nunca vai à offer.
  Threshold muito agressivo manda usuário real → página segura = venda perdida (ajuste com cuidado
  olhando a taxa de bloqueio em `/api/cloak/stats`).
- **Eventos de dinheiro são gateway-only:** nunca dispare `CompletePayment`/`AddPaymentInfo` (nem
  `Refund`/`Dispute`) sem `p._trusted=true`. Só webhook do gateway e `/api/conversion` são confiáveis;
  o motor bloqueia o resto (ver §10). Adicionar um novo caminho de venda exige marcar `_trusted`.
- **`deadlineMs` e sinal ASN:** lookup de ASN tem teto de latência; no estouro o `judge` segue SEM
  esse sinal (marca `asn:deadline`) e popula o cache em background. Baixar demais reduz a precisão.
- **Pixel do link vence:** se `link.pixelSlug` aponta um pixel ativo, o `InitiateCheckout` dispara SÓ
  nele. Ocorre após os gates (só gente real gera evento).
- **Dedup determinístico:** `event_id` é `Evento.<vid>.<yyyymmddhh>`. Alterar o formato quebra a
  dedup navegador↔servidor no TikTok.
- **CIDRs do bot-filter:** só adicionar ranges 100% confirmados; CIDR errado manda gente real pra white page.
- **`data/` não é fonte de verdade:** cache local ignorado no git; o Neon é a fonte durável.
- **Middleware de lead:** conta 1 lead por visitante (cookie `v_id`, 90 dias) e ignora bots via `ua.js`.
- **Primeiro registro = admin:** com o banco vazio, a primeira conta criada em `/register` vira admin
  e herda os dados legados. Para "resetar" o admin é preciso limpar a tabela `accounts` no Neon.
- **Sem hot-reload:** após editar módulos, reiniciar o processo (`node server.js`) para recarregar.

## 15. Estrutura de arquivos
```
/ (raiz)
├── server.js              # Express + todas as rotas (ponto de entrada)
├── auth.js / auth-view.js # autenticação e páginas /login /register
├── db.js / redis.js       # persistência (Neon) e cache (Upstash)
├── config.js              # config editável na dash (multi-bloco)
├── stats.js               # cache quente de métricas + write-through
├── bot-filter.js / ua.js  # cloaking (score) e parse de User-Agent
├── tiktok-events.js       # CAPI do TikTok (server-side)
├── pixel-store.js / link-store.js / gateway-store.js  # CRUD dos recursos
├── conversion-normalize.js # normalização de payloads de gateway (puro, testável)
├── domain-provider.js     # Custom Domains na hospedagem via API (Railway; token só aqui)
├── presence.js / pulse-client.js   # visitantes ao vivo
├── pushcut.js             # notificações push
├── *-view.js              # views (HTML como string): dashboard, lp, legal, tracker, vision, auth
├── assets/                # estáticos servidos em /assets/*
├── pixels/                # assets do pixel do navegador
├── data/                  # cache local em JSON (IGNORADO no git; não é fonte de verdade)
├── package.json / railway.json  # deps e config de deploy Railway
└── CLAUDE.md / README.md  # este mapa e o readme
```
Não há subpastas de código-fonte: todo módulo `.js` vive na raiz, um arquivo por responsabilidade.

## 16. Ciclo de vida do lead
Um lead avança por **stages** (etapa no funil) e carrega um **status** (resultado do disparo CAPI):
- **stage:** `visit` (pageview registrada) → `checkout` (chegou/entrou no checkout, `InitiateCheckout`)
  → `purchased` (compra confirmada via webhook, `CompletePayment`).
- **status (do disparo/conversão):** `pending` (em processamento) · `converted` (evento aceito pelo
  TikTok) · `dedup` (ignorado por dedup — `event_id` repetido) · `erro` (falha no envio à CAPI).
- Identidade: cookie `v_id` (visitante, 90 dias). O middleware conta 1 lead por visitante e ignora bots (`ua.js`).
- `orphan`: lead de conversão sem visita prévia casada (chegou webhook mas não há sessão/visita ligada).

## 17. Formato dos eventos de tracking
- **Tipos de evento CAPI usados:** `ViewContent` (pageview/visita), `InitiateCheckout` (entrada no
  checkout, disparado no `/go/:slug` após os gates) e `CompletePayment` (compra, via webhook de gateway).
- **Ingestão navegador → servidor:** `/t.js` (tracker) chama `POST /api/track`; o pixel do navegador
  (`/px.js`) chama `POST /api/px/event`. Ambos casam com o disparo server-side pelo mesmo `event_id`.
- **event_id determinístico:** `Evento.<v_id>.<yyyymmddhh>` — garante dedup navegador↔servidor no TikTok.
  **Nunca** alterar esse formato sem migrar a lógica de dedup em ambos os lados.
- **Conversão (compra):** chega por `POST /hook/:token` (por gateway) ou `POST /api/conversion`
  (webhook universal, validado por `CONVERSION_WEBHOOK_SECRET`), marca o lead como `purchased` e
  dispara `CompletePayment` na CAPI com o valor/moeda recebidos.

## 18. Ciclo de vida do domínio personalizado (ponta a ponta)
Amarra §4.1 (`domain-provider.js`), §5.2 (rotas), §5.2.1 (guard) e §5.2.2 (operação). Termos:
**host principal** = onde roda o painel (`roi-nados.top`/domínio do Railway); **domínio personalizado**
= domínio do lojista usado só no funil (checkout/cloaker/pixel).

**1. Cadastro** — lojista adiciona o domínio na aba *Domínios* → `POST /api/domains`:
- Se a automação está ligada (`domain-provider.enabled`), chama `register(host)`:
  - **sucesso** → guarda `providerId` no config da conta e devolve `dnsRecords` (CNAME + eventual TXT).
  - **`duplicado`** → `findByDomain()` adota o domínio já criado no Railway (pega `providerId` + DNS reais).
  - **`limite`/`auth`/`offline`** → NÃO bloqueia: salva o domínio em **modo manual** (sem `providerId`) e
    devolve `providerNote` (aviso amigável). O CNAME de fallback aponta p/ o host principal.
- O popup "Conectar domínio" mostra o passo a passo com os valores reais (ou o fallback manual).

**2. DNS** — lojista cria o CNAME (e TXT, se houver) no painel do domínio dele. **Cloudflare: nuvem
CINZA (Somente DNS)** — laranja quebra o SSL/roteamento do Railway (§5.2.2).

**3. Verificação** — `POST /api/domains/verify` (botão manual ou polling de 30s no front):
- **Auto-recuperação:** se o domínio está em manual (sem `providerId`) e a automação está ligada, tenta
  `register()` de novo — cobre o caso de um slot do Railway ter vagado (upgrade/remoção). Se reconectar,
  grava o `providerId`, devolve `reconectado:true`+`dnsRecords` e o popup re-renderiza com o alvo real.
- **Decisão real (`ok = httpOk`):** só passa quando `GET https://host/__domain-check` responde 200 com a
  assinatura do app. DNS apontado sozinho não basta (sem roteamento na hospedagem, `/go` daria 404 do
  Railway). `dnsPronto=true` = DNS ok mas app ainda não atende (aguardando SSL/roteamento).

**4. Uso (guard)** — com o domínio ativo, o middleware de §5.2.1 garante que ele sirva **só o funil**
(`/go`, `/c`, `/l`, `/hook`, `/t.js`, `/px*`, `/_safe`, `/__domain-check`, `/assets`); qualquer outra
rota (painel, login, APIs de gestão) responde **404 puro**. O painel existe só no host principal.

**5. Remoção** — `DELETE /api/domains/:host` remove do config e, se havia `providerId`, chama
`remove()` (`customDomainDelete`) p/ liberar o slot no Railway e não acumular contra o teto do plano.

**Armadilhas específicas:** (a) apontar CNAME p/ `roi-nados.top` nunca roteia — cada domínio precisa
existir no Railway; (b) sem **redeploy**, mudança de `RAILWAY_API_TOKEN`/código não vale (sem hot
reload); (c) o sandbox do v0 não tem as vars `RAILWAY_*`, então lá é sempre modo manual — teste real
só no Railway (§5.2.2).
