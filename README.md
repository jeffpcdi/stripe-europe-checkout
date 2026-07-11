# Painel de Rastreamento

Rastreamento de campanhas para tráfego pago (TikTok Ads): links de checkout com atribuição, filtro de bots/cloaker, TikTok Events API (CAPI), webhooks universais de gateway e dashboard multi-conta.

## Rodar localmente

```bash
npm install
npm run dev        # sobe o server.js (Express) lendo .env.development.local
npm test           # suíte completa (14 arquivos, sem infra externa)
```

O dashboard novo (Next.js) vive em `dashboard/` e é servido pelo build (`npm run build`).

## Variáveis de ambiente

| Variável | Para quê | Obrigatória? |
|---|---|---|
| `DATABASE_URL` | Neon Postgres (persistência durável) | Não (degrada) |
| `UPSTASH_REDIS_REST_URL` / `..._TOKEN` | Redis (contadores, dedupe, rate-limit) | Não (degrada) |
| `SESSION_SECRET` | Assinatura de cookies de sessão | Sim em produção |

## Graceful degradation (item 465)

O sistema NUNCA se recusa a subir por falta de infraestrutura. O que muda:

| Capacidade | Com Neon + Redis | Sem Redis | Sem Neon | Sem ambos |
|---|---|---|---|---|
| Redirects `/go`, `/c` e cloaker | OK | OK | OK | OK |
| Tracking de cliques/leads | OK | OK | OK (memória) | OK (memória) |
| Webhooks de conversão | OK | OK (dedupe em memória) | OK (memória) | OK (memória) |
| TikTok CAPI (fila com retry) | OK | fila em memória (perde no restart) | OK | fila em memória |
| Persistência entre restarts | OK | OK | **NÃO** — dados vivem só no processo | **NÃO** |
| Login e sessões | OK | OK | **NÃO** — auth exige Neon | **NÃO** |
| Rate-limit distribuído | OK | por processo (in-memory) | OK | por processo |
| Contadores de cloak/velocity | OK | por processo | OK | por processo |

Regra geral: **o caminho do dinheiro (redirect → tracking → webhook → notificação) funciona sempre**; o que se perde sem infra é durabilidade (restart zera memória) e login.

## Estrutura

- `server.js` — Express: rotas públicas (`/go`, `/c`, `/hook/:token`, tracker) e API privada (`/api/*`, autenticada)
- `stats.js` — agregação em memória por conta + hidratação do Neon
- `db.js` / `redis.js` — camadas de persistência (ambas opcionais, ver matriz)
- `auth.js` — sessões (cookie httpOnly, TTL 30d deslizante), contas no Neon
- `bot-filter.js` / `ua.js` — cloaker multicamadas e detecção de bots
- `tiktok-events.js` — fila CAPI com retry/backoff
- `dashboard/` — dashboard novo (Next.js + TS); views legadas `*-view.js` em processo de congelamento
- `test/` — suíte sem dependências externas (roda offline)

## Convenções

- Views públicas legadas: HTML por concatenação de strings, **sem template literals** (crase) — regra do projeto.
- Todo dado de dashboard é escopado por `account_id` — nunca query sem filtro de conta.
- `PROGRESSO-PLANO.md` rastreia o plano de execução; `PLANO-PRAGMATIC-FLOW.md` é o backlog numerado.
