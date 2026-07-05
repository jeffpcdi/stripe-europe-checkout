# CLAUDE.md — ROI-NADOS

## 1. Visão geral
Painel de rastreamento de funil e vendas para infoprodutos vendidos com tráfego do TikTok.
Rastreia o lead de ponta a ponta (visita → checkout → compra), dispara eventos server-side
na CAPI (Events API) do TikTok e mostra tudo numa dashboard em `/dashboard`. O checkout é
externo (qualquer gateway), integrado por um webhook universal de conversão.

## 2. Stack
- **Runtime:** Node.js >= 18 (JavaScript puro, CommonJS). Sem TypeScript, sem framework de front, sem build.
- **Web:** Express `^4.21.0`.
- **Banco:** Neon Postgres via `@neondatabase/serverless` `^1.1.0` (SQL puro, sem ORM).
- **Cache/dedup:** Upstash Redis `@upstash/redis` `^1.38.0` (opcional; fallback em memória).
- **Geo:** `geoip-lite` `^2.0.3` (fallback; a fonte primária são headers de Vercel/Cloudflare).
- **WebSocket:** `ws` `^8.21.0` (a confirmar o uso exato — dependência presente).
- **Serviços externos:** TikTok Events API (`business-api.tiktok.com`), Pushcut (webhook de push).

## 3. Arquitetura
Toda a lógica vive em módulos na raiz (sem subpastas de código). As views são strings
HTML/CSS/JS servidas pelo Express.

```
                       ┌─────────────┐
  navegador / t.js ──► │  server.js  │ ◄── webhook de gateway (/api/conversion)
                       └──────┬──────┘
        ┌──────────────┬──────┼───────────┬──────────────┐
        ▼              ▼      ▼            ▼              ▼
     stats.js    tiktok-events  bot-filter   pixel-store   link-store
   (cache quente)   (CAPI)     (cloaking)    (pixels)      (/go/:slug)
        │              │                        │              │
        ▼              ▼                        ▼              ▼
      db.js  ◄────────────── config.js ──────────────►  redis.js
   (Neon: leads, events,   (config editável na          (dedup event_id,
    variants, sessions,     dash: pushcut, links,         presença, log)
    config, pixels, links,  notas, token API)
    pixel_events)
```

Responsabilidades:
- **server.js** — Express, todas as rotas, middleware que transforma page views em leads, webhook de conversão, auth Basic, boot/hidratação.
- **stats.js** — cache em memória de leads/eventos/variantes + write-through assíncrono para o Neon.
- **db.js** — camada Neon. Tabelas: `leads`, `events`, `variants`, `sessions`, `config`, `pixels`, `links`, `pixel_events`. Desativa se faltar `DATABASE_URL`.
- **redis.js** — Upstash: dedup de `event_id` (SET NX TTL 2h), presença, log, e cache de ASN (`asn:<ip>`, TTL 24h) usado pelo bot-filter. Fallback: Map em memória.
- **config.js** — config editável na dash (Pushcut, shortlinks, notas, token da API pública, domínios, cloak). Persistida em memória + `data/config.json` + Neon.
- **tiktok-events.js** — CAPI TikTok, multi-pixel via `dispatchToAll`.
- **pixel-store.js / link-store.js** — pixels e links de checkout (`/go/:slug` com A/B de variantes). Cada link tem regras de cloaking próprias: `urlWhitePage`, `paises` (allowlist ISO-2 → offer) e `pixelSlug` (pixel que dispara nesse slug).
- **presence.js + pulse-client.js** — visitantes online (heartbeat `/api/pulse`), globo 3D.
- **bot-filter.js** — cloaking multicamadas (score 0–100), roteia revisores do TikTok Ads. Lookup de ASN com teto de latência (`deadlineMs`, padrão 120ms via `Promise.race`) e cache em 2 camadas (memória + Redis) para redirect quase instantâneo.
- **tracker-view.js** — snippet `/t.js` para páginas externas. **lp-view.js / legal-view.js** — LP em `/` e páginas legais. **ua.js** — parse de UA + detecção de bots. **pushcut.js** — notificações push. **dashboard-view.js** — HTML/CSS/JS da dashboard.

## 4. Comandos essenciais
```bash
npm install     # instala dependências
npm start       # inicia o servidor (node server.js), porta 3000 (ou $PORT)
```
- **Build:** não há (JS puro, sem transpile).
- **Testes:** não há suíte configurada no package.json (a confirmar).
- **Lint/Typecheck:** não configurados (a confirmar).
- **Migração de banco:** automática — `db.init()` roda `CREATE TABLE IF NOT EXISTS` no boot (idempotente). Sem ferramenta de migração dedicada.

## 5. Convenções
- **Idioma:** todo comentário e texto de UI em português (PT-PT, EUR, fuso `Europe/Lisbon`).
- **Módulos:** CommonJS (`require`/`module.exports`); um arquivo por responsabilidade, todos na raiz.
- **Views como string:** `dashboard-view.js`, `lp-view.js`, etc. são template strings gigantes. **Nunca** usar crase (`` ` ``) nem `${}` dentro do HTML dessas views — quebra a string. Concatenar com `+`.
- **Rastreamento nunca bloqueia navegação:** todo o middleware de tracking usa `try/catch` silencioso e responde antes de processar (efeitos colaterais em background).
- **Neon opcional:** todo acesso a banco degrada com elegância se `DATABASE_URL` faltar (modo só-arquivo/memória).
- **Persistência em três camadas:** memória (rápida) → `data/*.json` (cache local) → Neon (durável). `data/` é ignorado no git e recriado sozinho.
- **Segurança:** comparações de senha/segredo com `crypto.timingSafeEqual` (timing-safe).

## 6. Variáveis de ambiente
Carregadas manualmente pelo `server.js` a partir de `.env.development.local`, `.env.local`, `.env` (Node puro não lê `.env` sozinho).
- `DATABASE_URL` (ou `POSTGRES_URL`) — Neon Postgres. Sem ela, persistência desativada.
- `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` — Redis (dedup/presença). Opcional.
- `DASHBOARD_PASSWORD` — protege `/dashboard` e rotas `/api` (Basic Auth). Sem ela, acesso livre.
- `CONVERSION_WEBHOOK_SECRET` — valida o webhook `/api/conversion`; também usado como base do segredo HMAC do cloak.
- `TIKTOK_ACCESS_TOKEN` — token da CAPI TikTok (e `TIKTOK_PIXEL_CODE` legado em pixel-store).
- `PUSHCUT_WEBHOOK_URL` — URL de notificações Pushcut (pode ser definida na dash).
- `PORT` — porta HTTP (padrão 3000).

## 7. Armadilhas
- **Views são strings frágeis:** crase ou `${}` dentro de `dashboard-view.js`/`lp-view.js` quebram silenciosamente o template. Escapar apóstrofos com entidades HTML.
- **Ordem do boot:** `server.js` hidrata `stats` → `config` → `pixelStore` → `linkStore` **antes** do `app.listen`. Novos stores duráveis precisam entrar nessa cadeia, senão sobem sem dados.
- **Config compartilhada:** `config.js` guarda vários blocos (pushcut, links, cloak, domínios, api). Ao editar, sempre passar pela sanitização existente — escrever direto no objeto pula validação e persistência.
- **Cloak x white page:** o filtro só redireciona se houver white page configurada por link **e** `cloak.enabled`; caso contrário apenas registra. Mudar o threshold afeta falso positivo (usuário real → white page = venda perdida).
- **Ordem dos gates no `/go/:slug`:** rate-limit → **gate de país** (allowlist `link.paises`, instantâneo via headers da edge, sem DNS) → motor de score (`judge`) → disparo do pixel. O gate de país roda ANTES do score de propósito (é ~0ms); não reordenar. Só roda com `cloak.enabled`.
- **`deadlineMs` e sinal ASN:** o lookup de ASN tem teto de latência; no estouro o `judge` segue SEM esse sinal (adiciona `asn:deadline`) e o cache popula em background p/ a próxima visita do mesmo IP. Baixar demais o `deadlineMs` reduz a precisão da camada datacenter/ByteDance.
- **Pixel do link vence:** se `link.pixelSlug` aponta um pixel ativo, o `InitiateCheckout` dispara SÓ nele (via `sendToPixel`), ignorando o casamento por rota. O disparo acontece após os gates, então só pessoas reais que vão à offer geram evento.
- **Dedup determinístico:** `event_id` é `Evento.<vid>.<yyyymmddhh>`. Alterar o formato quebra a dedup navegador↔servidor no TikTok (eventos duplicados ou perdidos).
- **CIDRs do bot-filter:** só adicionar ranges 100% confirmados; CIDR errado manda gente real pra white page. A detecção primária é o lookup dinâmico de ASN.
- **`data/` não é fonte de verdade:** é cache local ignorado no git; o Neon é a fonte durável. Não confiar em editar `data/*.json` à mão.
- **Middleware de lead:** só conta 1 lead por visitante (cookie `v_id`, 90 dias) e ignora bots via `ua.js`; bots nunca viram lead nem disparam CAPI.
