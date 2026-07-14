# Handoff de equipe — ROI-NADOS (stripe-europe-checkout)

> **Para quem vai usar outro v0 (sem memória).** A memória do v0 (`v0_memories/`) é
> pessoal de cada conta e **não** é versionada no git — por isso um v0 novo abre
> "sem contexto" mesmo com o mesmo repositório. Este arquivo resolve isso: ele
> vive no repo (`docs/`), então viaja pelo GitHub.
>
> **Como usar no v0 novo:** depois de conectar o v0 ao repo `jeffpcdi/stripe-europe-checkout`,
> mande a IA ler este arquivo: _"leia `docs/HANDOFF-EQUIPE.md` e use como contexto"_.
> Opcionalmente, peça para ela salvar o conteúdo na memória dela
> (`v0_memories/user/`) para não precisar reler toda vez.
>
> ⚠️ O **histórico da conversa** do chat original NÃO é transferível entre contas
> do v0. Para continuar o mesmo chat com histórico, a única forma é os dois
> estarem no **mesmo time/workspace do v0**. Este documento transfere o
> **conhecimento**, não a conversa.

---

## 0. ASSUNTO ABERTO no momento do handoff — conta TikTok "não sincroniza"

**Sintoma relatado:** a conta de anúncio `7557274620176597000` aparece "Conectado"
na dashboard mas com tudo zerado (US$ 0, 0 impressões, 0 campanhas), enquanto no
**site** do Pipeboard a mesma conta mostra dados (100 campanhas, US$ 29, 12.9K impr).

**Causa raiz (NÃO é bug de sincronização, NÃO tem correção por código):**
o Pipeboard limita o **time** a **10 contas de anúncio por mês** (limite
compartilhado por todos, não por pessoa). A conta `7557...` ficou fora desse
limite e está **bloqueada na API** até **2026-08-14**. O **site** do Pipeboard e a
**API** do Pipeboard são canais diferentes: o site mostra os dados, mas a API (o
único canal que nosso app usa) retorna erro de bloqueio. Testado ao vivo: a API
retorna literalmente _"monthly limit of 10 ad accounts ... blocked until the limit
resets on 2026-08-14 ... shared by everyone on your team ... accounts already used
this month keep working"_.

**Saídas reais (ação no Pipeboard, não no código):**
1. Usar uma das contas já ativas neste mês (essas sincronizam normalmente); ou
2. Liberar/trocar uma vaga ou fazer upgrade do plano no Pipeboard; ou
3. Aguardar o reset em 2026-08-14.

**O que JÁ foi corrigido no código (bug real: o app escondia o motivo):**
antes o app engolia o erro e mostrava "0 campanhas" como se a conta estivesse
vazia. Agora ele detecta o bloqueio e mostra um banner explicativo. Detalhes na
seção "Sync bloqueado por limite de contas do Pipeboard" abaixo.

**PENDENTE:** essa correção está na branch de trabalho mas **ainda não foi
mergeada na `main`** — por isso a produção `roi-nados.top` ainda mostra os zeros
sem o aviso. Próximo passo sugerido: publicar (merge para `main`).

---

## 1. O que é o projeto

Rastreador de funil/conversões para tráfego TikTok. Backend Express (raiz) +
dashboard Next.js (pasta `dashboard/`, roda na porta 3001). Express serve a porta
3000 e faz proxy de `/dashboard/*` para o Next.

## 2. Como rodar / acessar (ambiente v0)
- Dev server: `node --env-file-if-exists=.env.development.local dev.js` (sobe Next em 3001 + Express em 3000). Rodar em background.
- App real está na porta **3000** (não usar `$DEV_PORT`/8080, que fica morta).
- O server lê `.env.development.local` **no boot**. Se variáveis novas forem adicionadas depois, é preciso **reiniciar o processo** (matar pids do `dev.js`/`server.js` e subir de novo), senão dá erro "DATABASE_URL não configurada".
- ⚠️ **server.js/ads-*.js/pipeboard-mcp.js NÃO têm hot-reload** — ao editar backend, SEMPRE matar por PID e reiniciar antes de testar via HTTP. Testes via `node -e require(...)` usam código fresco e podem mascarar que o server HTTP está stale.
- ⚠️ reset do sandbox apaga `node_modules` → `npm install`. `pkill -f` mata o próprio shell; matar por PID (`kill -9 <pid>`).
- Se `.env.development.local` sumir: `vercel link --yes --project prj_g1m16frG8I0Ooc7ZkgIdIwdriTvp --scope team_09PRbkxSENZbqohEm5oPiWjv` + `vercel env pull .env.development.local --environment=development --yes`.

## 3. Login para testar a dashboard (usar SEMPRE em testes)
1. Garantir server de pé: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/login` deve dar 200.
2. `agent-browser open --color-scheme dark "http://localhost:3000/__dev/login"` → cria sessão real na conta admin sem senha e redireciona para `/dashboard`. Só funciona com `NODE_ENV !== 'production'`. Para rota específica: `/__dev/login?next=/rota`.
3. Ajustar viewport ao preview do usuário; então `snapshot`/`screenshot`.
- Login normal (fallback): `/login` (email+senha). Conta admin: `contato.pcdigitalof@gmail.com` (senha não conhecida — pedir se necessário).

## 4. Integrações (status 2026-07)
- **Neon (Postgres)**: conectado. Vars: `DATABASE_URL` / `NEON_DATABASE_URL`. ~31 tabelas (leads, sessions, accounts, ads_*, gateways, pixels...). Conta admin no banco: `acc_282f0c9e4c5d080ea5f2fc88`.
- **Upstash Redis** (AWS sa-east-1): via REST. Vars: `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (cliente `@upstash/redis`, HTTP — não usa TCP 6379).
- **Blob**: token presente mas store é **privado**; o código usa `access:'public'` p/ criativos e CSV. Conflito não resolvido (deixado de lado). Solução futura: recriar store como público.
- **Pipeboard MCP** (TikTok Ads): `PIPEBOARD_API_KEY` (pk_...). Plano Premium = chamadas ilimitadas. Limite real: **10 slots de conta de anúncio/mês por time** (ver seção 0).
- Sem Redis/DB → app roda em "modo memória" (degradação graciosa): perde presença/dedup/log CAPI no restart.

## 5. Arquivos-chave
- `server.js` (Express, rotas, dev login), `db.js` (Neon), `redis.js` (Upstash), `auth.js`, `dashboard-view.js`, `ads-routes.js`, `dev.js`, `scripts/doctor.js` (diagnóstico de env).
- Camada TikTok Ads: `pipeboard-mcp.js` (transporte MCP) → `ads-provider.js` (shape do dashboard, ÚNICA fronteira dashboard↔MCP) → `ads-routes.js` (rotas). Cache no Neon: `ads-cache-store.js` + motor `ads-sync.js`.
- Handoffs: este arquivo, `HANDOFF-NOVO-CHAT.md` (raiz), `docs/HANDOFF-NOVA-IA.md`, `docs/RUNBOOK-INCIDENTES.md`.
- Referência das 74 tools do Pipeboard: `docs/pipeboard-tools.md` (regenerar via `/api/ads/diag`; não editar à mão).

## 6. Fluxo de webhooks de conversão
- Duas rotas de entrada: `/hook/:token` (dedicada por gateway, recomendada) e `/api/conversion` (legada, exige `CONVERSION_WEBHOOK_SECRET` global — não setado, retorna 503).
- Pipeline: `gatewayStore.verifySignature` → `adaptPayload` → `normalizeConversion` (conversion-normalize.js) → `processConversion` (server.js) → match do lead (ttclid → leadId → email → phone → órfã) → `notifyPushcut`.
- Moeda default **EUR** (não BRL). `pickAmountCents` extrai valor (recursivo/BFS). Opção por gateway `config.amountInCents` (toggle "O valor já vem em centavos") evita ×100 indevido (bug do gateway "Cloud").
- **Quarentena**: todo webhook rejeitado grava payload cru na tabela `conversion_quarantine` (retenção 30d). UI: `QuarantinePanel` no "Diagnóstico avançado" da aba Gateways.
- **Dedup durável**: tabela `processed_orders` (PK account_id+gateway+order_id, retenção 90d) evita receita duplicada por retry de gateway após expirar o dedup do Redis (~2h).
- **Isolamento multi-tenant**: match escopado por conta; guard estrito `lead.acc !== n.acc → descarta` (null só casa com null).

## 7. Pixel e rastreamento — 2 scripts distintos (fonte de confusão!)
- **`/t.js` (rastreamento)** = o que faz a visita APARECER NA DASHBOARD (funil/leads/jornada/geo). Client-side: vid em localStorage (`roinados_vid`), POST `/api/track`.
- **`/px/<token>.js` (pixel)** = carrega pixel TikTok + identify external_id + espelha CAPI. NÃO registra visita na dashboard.
- `GET /api/pixels` → `scriptTag` é bloco completo (parte 1 = /t.js rastreamento, parte 2 = pixel nativo TikTok no `<head>`, parte 3 = /px CAPI). Instalar antes do `</head>`.
- **external_id/EMQ**: esquema único `SHA-256(('lead:'+vid).toLowerCase())`. Mesmo hash no browser (crypto.subtle) e no server → liga browser↔CAPI↔conversão. CAPI cobre os 5 eventos (ViewContent, InitiateCheckout, AddToCart, CompletePayment, AddPaymentInfo).
- ⚠️ Quem instalou snippet ANTIGO (sem /t.js) precisa recopiar o bloco.

## 8. TikTok Ads via Pipeboard — arquitetura (migração Zernio → Pipeboard, concluída até Gate 4)
- `ads-provider.js` é a ÚNICA fronteira dashboard↔MCP (rotas nunca chamam `pipeboard-mcp` direto, exceto `/api/ads/diag`). Estado por conta em `config.pipeboardAds={advertiserId}`.
- **155 advertisers** autorizados no token (não é conta única) → seletor persistido por conta + env default `TIKTOK_ADVERTISER_ID`.
- **Cache no Neon** (performance + resiliência): tabelas `ads_campaigns_cache` (estrutura JSONB), `ads_metrics_cache` (métricas diárias por level/entity/day), `ads_sync_state`. `readTree` reconstrói `AdsTreeResponse`. Leitura morna ~633ms/0 chamadas.
- **Motor `ads-sync.js`**: `syncAdvertiser(acc,adv,{full})`. FULL = backfill 90d (~19 chamadas, 1×/24h ou cache frio); INCREMENTAL = 3d (~9 chamadas). `collectDaily` FATIA em chunks de 30d (TikTok rejeita >30d com erro 40002!). `ensureFresh` = SWR (revalida bg quando stale>3min). Loop a cada 3min só p/ advertisers ativos (vistos nas últimas 6h).
- **insights EXIGE dimensions** (sem → erro 40002); linhas em `out.metrics`, métricas são STRING; `conversion` é singular. SEM coluna de receita no BASIC → ROAS/receita vêm dos gateways, não do pixel. NÃO inventar receita.
- **Escrita (Gate 4)**: setCampaign/AdGroup/AdStatus (bulk), updateCampaign/AdGroup (budget+nome). PUT de orçamento roteado por `classifyEntity` (orçamento vive em campanha/adgroup, nunca em ad). `syncAfterWrite` força sync sem throttle. ⚠️ dryRun default é FALSE nesta conta → escrita VAI AO VIVO. Ativar dryRun antes de testar: `PUT /api/ads/ops/safety-policy {dryRun:true}`.
- **Não suportado pelo Pipeboard (respondem 501)**: duplicar campanha e editar criativo de ad existente. **Gate 5 (criação) não feito**: create/boost/bulk-create; bloqueio conhecido: Pipeboard exige `video_id` (upload prévio), Zernio aceitava URL.
- Status advertiser: STATUS_ENABLE→approved, STATUS_LIMIT→limited, STATUS_PUNISH→banned, STATUS_PENDING_CONFIRM→in_review. **"limitada" no dropdown = health status do TikTok, NÃO o bloqueio de cota do Pipeboard.**

## 9. Sync bloqueado por limite de contas do Pipeboard (correção detalhada)
- **Bug real corrigido**: o app engolia o erro — `syncAdvertiser` capturava, gravava `last_error` e retornava `{ok:false}`; a rota servia `readTree` vazio como árvore válida → "0 campanhas" enganoso, com o motivo preso no `last_error` que a tela nunca lia.
- **Correção (4 arquivos):**
  1. `pipeboard-mcp.js` — `callTool` classifica o erro: regex `monthly limit of N ad accounts|blocked until` → `err.code='ACCOUNT_BLOCKED'` + `err.blockedUntil` (parse da data).
  2. `ads-sync.js` — catch persiste `status='blocked'` (distinto de 'error'); backoff `BLOCKED_BACKOFF_MS=30min` (não re-tenta conta bloqueada a cada tick, exceto `opts.force`); `refreshNow` manual passa `{force:true}`; `dedupSync` repassa opts.
  3. `ads-routes.js` — `GET /api/ads/tree`: após `readTree`, lê `getSyncState`; se status blocked/error, anexa `cached.syncError={code,message,blockedUntil,advertiserId}`.
  4. Front — `types.ts`: `AdsTreeResponse.syncError`; `tiktok-ads-view.tsx`: banner âmbar (GlassCard `border-warning`, ícone `Ban`) após `OpsStatusCards`, explicando limite do time + data de reset + por que está zerado + o que fazer.
- Validado E2E: sync real da conta bloqueada persiste `status='blocked'`, 2ª tentativa pulada por backoff, rota monta `syncError` com `blockedUntil=2026-08-14`, banner renderiza na tela.
- **PENDENTE: merge para `main`** (produção ainda sem o aviso).

## 10. Dashboard (visão geral)
- Estética dark, acento ciano/verde neon. Sidebar: Métricas (Visão Geral, Atividade, Funil), Gestão (Links, Pixels, Gateways, Domínios, Cloaker, TikTok Ads), Sistema (Configurações).
- Overview foi redesenhado: hero em bloco único (KPIs à esq + globo 3D central com leads/países + feed "Chegando agora" à dir), funil compacto | top campanhas, rodapé com barra de status (Operacional · países · EMQ). Largura total.
- **Receita multi-moeda (fix)**: o card "Receita" mostrava só a moeda dominante e escondia vendas em outra moeda (parecia "travado" ao trocar período). Agora `HeroKpi` tem prop `sub` e o overview calcula `otherRev` (moedas ≠ dominante) exibindo sublinha "+ R$ 9,90". NÃO soma moedas diferentes (sem câmbio) — lista cada uma. O filtro de período sempre funcionou; `aggregate/periodStart/within` em `lib/metrics.ts` estão corretos.
- Moeda das vendas vem do webhook do gateway; evento `sale` carimba `at`=hora do webhook. `money()` divide por 100 (centavos).

## 11. Testes
- Suíte: `npm test` (Node test runner). ~21 arquivos de teste. Rodar antes de mudanças no caminho do dinheiro.
- Build do dashboard: `cd dashboard && npx tsc --noEmit -p tsconfig.json` para type-check.
