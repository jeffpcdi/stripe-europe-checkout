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
É **multi-tenant**: cada conta (`account_id`) tem seus próprios pixels, links, gateways, leads e config.

## 2. Stack
- **Runtime:** Node.js >= 18 (JavaScript puro, CommonJS). Sem TypeScript, sem framework de front, sem build.
- **Web:** Express `^4.21.0`.
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
- **CSS:** dark theme, azul como cor primária. Definido inline nas `<style>` de cada view.
- **Regra de ouro do front:** como o HTML é uma string JS, **nunca** use crase nem `${}` dentro dele;
  para interpolar valores do servidor, concatene com `+` e escape aspas/apóstrofos.
- **Snippets servidos para páginas externas:** `/t.js` (tracker-view.js) e `/px.js` `/px/:token.js`
  (pixel do navegador que casa com a CAPI via `event_id` idêntico), além de `/px.gif` (fallback beacon).

## 5. Rotas (todas as do server.js)
### 5.1 Páginas e assets (GET)
- `GET /` — landing page. `GET /termos`, `GET /privacidade` — legais.
- `GET /dashboard` — painel (exige sessão). `GET /login`, `GET /register` — auth.
- `GET /assets/*` — estáticos. `GET /t.js` — snippet de tracking. `GET /px.js`, `GET /px/:token.js`,
  `GET /px.gif` — pixel do navegador. `GET /l/:slug` — shortlink. `GET /go/:slug` — redirect com cloaking (§9).

### 5.2 API consumida pela dashboard (auth)
- **Auth/conta:** `POST /login`, `POST /register`, `POST /logout`, `GET /api/me`.
- **Métricas:** `GET /api/stats`, `GET /api/live`, `POST /api/reset-stats`, `GET /api/health`.
- **Pixels:** `GET/POST /api/pixels`, `GET/PUT/DELETE /api/pixels/:slug`, `GET /api/pixels/health`,
  `GET /api/pixels/log`, `POST /api/pixels/test`.
- **Links de checkout:** `GET/POST /api/links`, `GET/PUT/DELETE /api/links/:slug`,
  `POST /api/links/validate-domain`.
- **Cloak/filtro de bots:** `GET/POST /api/cloak-config`, `GET /api/cloak/links`,
  `POST /api/cloak/link/:slug`, `POST /api/cloak/test`, `GET /api/cloakcheck`.
- **Gateways:** `GET/POST /api/gateways`, `GET/PUT/DELETE /api/gateways/:id`.
- **Conversões:** `GET /api/conversion/log`, `POST /api/conversion/test`.
- **Domínios:** `GET/POST /api/domains`, `GET/DELETE /api/domains/:host`, `POST /api/domains/verify`.
- **Diversos:** `GET/POST /api/pushcut-config`, `POST /api/pushcut/test`, `GET/POST /api/notes`,
  `PUT /api/notes/:d`, `GET/POST /api/shortlinks`, `DELETE /api/shortlinks/:slug`, `GET/POST /api/public-token`.

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
- **dedup:<event_id>** — dedup navegador↔servidor (SET NX, TTL 2h). Em erro, deixa passar (melhor duplicar que perder).
- **asn:<ip>** — cache do lookup BGP/ASN do bot-filter (TTL 24h), compartilhado entre instâncias.
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

## 9. Fluxo do `/go/:slug` (cloaking) — ordem dos gates
Só roda com `cloak.enabled` **e** white page configurada no link; senão apenas registra o evento.
1. **rate-limit** (por IP).
2. **gate de país** — allowlist `link.paises`, instantâneo via headers de edge
   (`x-vercel-ip-country`, `cf-ipcountry`, `x-country`), sem DNS. Fora da lista → white page.
3. **gate de idioma** — allowlist `link.idiomas`, instantâneo via header `Accept-Language`
   (idioma primário, ex.: `pt` de `pt-BR`). Fora da lista → white page.
4. **motor de score** (`bot-filter.judge`) — score 0–100; bots/revisores → white page.
5. **escolha da variante** (`pickVariant`, split A/B determinístico) + disparo de `InitiateCheckout`
   no pixel de `link.pixelSlug` (via `sendToPixel`). Só pessoas reais que chegam à offer geram evento.

País e idioma rodam ANTES do score (são ~0ms). **Não reordenar.**

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

## 11. Comandos essenciais
```bash
npm install     # instala dependências
npm start       # produção: node server.js (porta 3000 ou $PORT)
npm run dev     # local: node --env-file-if-exists=.env.development.local server.js
```
- **Build:** não há (script `build` é um `echo`; JS puro, sem transpile).
- **Testes / lint / typecheck:** não configurados no `package.json`.
- **Migração de banco:** automática e idempotente — `db.init()` roda `CREATE TABLE/ALTER … IF NOT EXISTS` no boot.

## 12. Variáveis de ambiente
Carregadas pelo `server.js` a partir de `.env.development.local`, `.env.local`, `.env`
(Node puro não lê `.env` sozinho). No Railway, definidas no painel *Variables*.
- `DATABASE_URL` (ou `POSTGRES_URL`) — Neon. **Obrigatória**; sem ela, persistência e auth desativadas.
- `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` (ou aliases `KV_REST_API_URL/TOKEN`) — Redis. Opcional.
- `CONVERSION_WEBHOOK_SECRET` — valida `/api/conversion`; base do segredo HMAC do cloak.
- `TIKTOK_ACCESS_TOKEN` — token da CAPI (e `TIKTOK_PIXEL_CODE` legado em pixel-store).
- `PUSHCUT_WEBHOOK_URL` — URL de notificações Pushcut (pode ser definida na dash).
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
- **Cloak x white page:** o filtro só redireciona se houver white page por link **e** `cloak.enabled`;
  senão apenas registra. Threshold muito agressivo manda usuário real → white page = venda perdida.
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
