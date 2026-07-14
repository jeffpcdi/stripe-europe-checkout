# Plano v3 — Substituir Zernio por Pipeboard (TikTok Ads)

## 0. Viabilidade (confirmada nos docs oficiais)
- Transporte: **Streamable HTTP MCP** em `https://tiktok-ads.mcp.pipeboard.co/`.
- Auth server-to-server documentada: headers `Authorization: Bearer pk_...` +
  `X-Pipeboard-Token: pk_...` (recomendado pelos docs; query `?token=` existe como fallback).
- **19 tools oficiais** (pipeboard.co/guides/tiktok-ads-mcp#tools) cobrem contas,
  campanhas, ad groups, ads, mídia, insights e targeting — leitura e escrita.
- Implementação direta na dashboard é viável sem Claude/ChatGPT.

## 1. Inventário dos 19 tools
| Categoria | Tool | Uso no painel |
|---|---|---|
| Contas | `list_tiktok_advertisers` | listar advertisers (cap 3 do plano do usuário) |
| Contas | `get_tiktok_advertiser_info` | moeda/saldo/timezone p/ card de status |
| Campanhas | `get_tiktok_campaigns` | árvore — buscar SEM filtro de status (filtrar local) |
| Campanhas | `create_tiktok_campaign` | criação (objetivo + orçamento) |
| Campanhas | `update_tiktok_campaign` | nome/orçamento |
| Campanhas | `update_tiktok_campaign_status` | ENABLE / DISABLE / DELETE |
| Ad Groups | `get_tiktok_adgroups` | árvore (targeting, bid, budget) |
| Ad Groups | `create_tiktok_adgroup` | criação |
| Ad Groups | `update_tiktok_adgroup` | targeting/budget/bid/schedule |
| Ad Groups | `update_tiktok_adgroup_status` | ENABLE / DISABLE / DELETE |
| Ads | `get_tiktok_ads` | árvore (criativo + status) |
| Ads | `create_tiktok_ad` | vídeo/imagem/carrossel |
| Ads | `update_tiktok_ad` | copy, CTA, criativo |
| Ads | `update_tiktok_ad_status` | ENABLE / DISABLE / DELETE |
| Mídia | `upload_tiktok_image` | jpg/png/webp |
| Mídia | `upload_tiktok_video` | mp4/mov, 5–60s |
| Analytics | `get_tiktok_insights` | métricas por nível + date range + breakdown |
| Targeting | `get_tiktok_targeting_regions` | location IDs (TikTok exige ID) |
| Targeting | `get_tiktok_interest_categories` | interesses |

Objetivos suportados na criação (8): TRAFFIC, CONVERSIONS, APP_INSTALL, REACH,
VIDEO_VIEWS, LEAD_GENERATION, CATALOG_SALES, COMMUNITY_INTERACTION.

**Sem tool para:** Business Center, gestão de catálogos, Spark Ads/identity,
duplicação nativa, bulk nativo. → capability flags (seção 5).

## 2. Disposição completa das 57 rotas de `ads-routes.js`
Legenda: **[P]** reimplementa via Pipeboard · **[L]** local/estado (inalterado na
lógica; só troca `zernio.getState/setState` → provider) · **[R]** removida ·
**[D]** desativada com 501 + capability flag.

### Núcleo TikTok — [P] (16 rotas)
| Rota | Implementação |
|---|---|
| `GET /ads/status` | chave presente + `list_tiktok_advertisers` + `get_tiktok_advertiser_info`; retorna `capabilities` |
| `GET /ads/accounts` | `list_tiktok_advertisers` |
| `GET /ads/tree` | composição: campaigns + adgroups + ads (paginados até o fim) + `get_tiktok_insights` por nível; filtro de status LOCAL após reconciliação; cache 15s; `fresh=1` mantido |
| `POST /ads/tree/refresh` | cacheBust local (inalterado) |
| `GET /ads/campaigns/:id/analytics` | `get_tiktok_insights` (nível campaign, timeIncrement) |
| `GET /ads/roas` | `get_tiktok_insights` (spend/conversões) + cálculo local atual |
| `GET /ads/attribution` | `get_tiktok_insights` com breakdowns; dimensões sem equivalente → 501 parcial |
| `POST /ads/create` | orquestração `createFullAd` (seção 4) |
| `PUT /ads/:adId` | `update_tiktok_ad` |
| `DELETE /ads/:adId` | `update_tiktok_ad_status` = DELETE |
| `POST /ads/campaigns/bulk-status` | loop `update_tiktok_campaign_status` c/ relatório por item |
| `POST /ads/campaigns/:id/duplicate` | composto get→create (criado DISABLED) |
| `POST /ads/duplicate` | idem, multi-nível |
| `POST /ads/bulk` + `GET /ads/bulk/:jobId` + `POST .../retry` | job store local mantido; executor troca REST→tools |

### Upload/criativos — [P] (3 rotas)
| Rota | Implementação |
|---|---|
| `POST /ads/upload` | binário → Vercel Blob (`put`, private) → `upload_tiktok_video`/`upload_tiktok_image` → creativeId |
| `GET /ads/library` | biblioteca local (state) + creativeIds mapeados |
| `DELETE /ads/library` | remove do state + delete no Blob |

### Estado local — [L] (17 rotas, lógica intacta)
`/ads/ops/jobs`, `/ads/ops/safety-policy` (GET/PUT), `/ads/accounts/select`,
`/ads/alerts` (GET/PUT/check), `/ads/rules` (GET/PUT/run), `/ads/templates`
(GET/POST/DELETE), `/ads/tickets` (GET/PATCH/regenerate), `/ads/health`.
Obs.: `alerts/check`, `rules/run` e `health` fazem leituras TikTok por dentro —
essas leituras internas trocam para o provider.

### Removidas — [R] (6 rotas)
`GET/POST /ads/connect`, `POST /ads/connected`, `POST /ads/disconnect`,
`GET /ads/deeplink/create-account`, `GET /ads/business-centers/select` (o select
BC sai junto com BC). Conexão passa a viver no site do Pipeboard.

### Desativadas — [D] (15 rotas)
- `GET /ads/business-centers` (+select) — sem tool.
- `POST /ads/boost` (Spark) e `PATCH /ads/identity` — sem tool.
- Catálogos (11 rotas: spec, CRUD, products, import, export.csv, publish) — sem
  tool. Criação com objetivo CATALOG_SALES permanece permitida quando o payload
  não exigir catalog_id.
Resposta padrão: `501 { unavailable: true, reason: "não suportado via Pipeboard" }`.

## 3. Arquitetura (3 camadas)
1. **`pipeboard-mcp.js`** (novo, ~150 linhas, zero dependências novas):
   - `initialize` → guarda `Mcp-Session-Id` → `notifications/initialized`.
   - `callTool(name, args)` → `tools/call`; aceita resposta JSON **ou** SSE;
     extrai `content[0].text` com `JSON.parse` defensivo; `isError` → exceção tipada.
   - `listTools()` → boot/diag; valida auth e captura os JSON Schemas reais.
   - Timeout 60s; 1 retry com re-handshake se sessão expirar; limite caseiro de
     4 chamadas simultâneas para não estourar rate limit.
2. **`ads-provider.js`** (novo) — única interface que as rotas conhecem:
   - Migra do `zernio-ads.js`: state store (getState/setState — 47 usos),
     cache (get/set/bust — 34 usos), `ensureProfile` vira no-op/compat.
   - Métodos: `status`, `listAdvertisers`, `selectAdvertiser`, `getTree`,
     `getInsights`, `createFullAd`, `updateCampaign/AdGroup/Ad`,
     `setStatus(level,id,action)`, `bulkStatus`, `duplicate`, `uploadCreative`,
     `targetingRegions`, `interestCategories`, `capabilities`.
   - Normalizadores: shape Pipeboard → shape atual do dashboard (types.ts
     inalterado onde possível: `AdsTree`, `pagination`, `status` reconciliado).
3. **`ads-routes.js`** — troca das 25 chamadas `zernio.api` por métodos do
   provider; contratos de resposta preservados rota a rota.

## 4. Orquestração `createFullAd` (a rota mais complexa)
1. Validar payload local (objetivo ∈ 8 suportados; datas; orçamento mínimo).
2. `create_tiktok_campaign` (status inicial DISABLED — segurança).
3. Resolver locations: `get_tiktok_targeting_regions` (cachear 24h).
4. `create_tiktok_adgroup` (targeting + bid + schedule).
5. Criativo: URL do Blob → `upload_tiktok_video` (validar duração 5–60s ANTES,
   via metadata do upload) ou `upload_tiktok_image`.
6. `create_tiktok_ad`.
7. Se o usuário pediu ativo: `update_*_status` = ENABLE em cadeia.
8. Falha em qualquer etapa → rollback best-effort (DISABLE nas anteriores) +
   erro com etapa exata (`{ step: "adgroup", detail }`) para a UI mostrar onde parou.

## 5. Capability flags
`GET /ads/status` retorna:
```json
{ "connected": true, "capabilities": { "businessCenters": false, "catalogs": false,
  "sparkAds": false, "identity": false, "targetingBrowser": true } }
```
Frontend esconde/desabilita cards e menus com base nisso (nunca hardcode).

## 6. Taxonomia de erros (provider → HTTP)
| Situação | Detecção | Resposta |
|---|---|---|
| Chave ausente/inválida | 401/403 no handshake | `401 { connect: "pipeboard" }` + card instrução |
| Conexão TikTok caiu no Pipeboard | tool retorna erro de auth TikTok | `409 { reconnect: true, url: "pipeboard.co" }` |
| Tool inexistente (plano/versão) | `tools/list` sem o nome | `501 unavailable` + flag off |
| Rate limit | erro 429/mensagem | `429` + `Retry-After`; retry 1× com backoff 2s |
| Sessão MCP expirada | 404/erro de sessão | re-handshake transparente (1×) |
| Validação (orçamento, duração vídeo) | pré-validação local | `400` com mensagem PT-BR clara |
| Erro TikTok genérico | `isError` no content | `502 { source: "tiktok", detail }` |

## 7. Frontend — impacto arquivo a arquivo
| Arquivo | Mudança |
|---|---|
| `lib/api.ts` | shapes mantidos; `useAdsStatus` ganha `capabilities` |
| `lib/types.ts` | + `capabilities` no status; resto intacto |
| `connect-card.tsx` | **reescrito**: sem OAuth; estados: sem chave → instruções + link pipeboard.co; chave ok → "Conectado via Pipeboard" + advertiser + moeda |
| `context-bar.tsx` | remove menção a business center; seletor de advertiser mantém (cap 3) |
| `tiktok-ads-view.tsx` | esconde seções via capabilities; remove refs OAuth |
| `catalog-dialog.tsx`, `spark-ad-dialog.tsx`, `identity-dialog.tsx` | não renderizam (flag off); código mantido p/ futuro |
| `create-ad-panel.tsx` | upload via Blob (2 etapas com progresso); validação 5–60s no cliente |
| `bulk-upload-dialog.tsx` | idem upload |
| demais (campaign-tree, drawer, roas-card, alerts, automation, ops, health, duplicate, creative-library) | sem mudança de contrato; testes visuais |

## 8. Env e segurança
- Adicionar: `PIPEBOARD_API_KEY` (obrigatória). `PIPEBOARD_TIKTOK_MCP_URL`
  opcional (default constante).
- Remover ao final: `ZERNIO_API_KEY` e quaisquer refs.
- Recomendação: token permission-scoped (Pro+) só com tools TikTok.
- Chave nunca no cliente; todas as chamadas MCP são server-side.

## 9. Ordem de execução — gates com critério de aceite
1. **Cliente MCP + diag** — `pipeboard-mcp.js` + rota temporária `GET /ads/diag`
   (roda `tools/list`, lista tools + advertisers). *Aceite: deploy retorna as 19
   tools e ≥1 advertiser.* ← valida auth e schemas REAIS antes de tudo.
2. **Provider leitura** — status/accounts/tree/insights. *Aceite: árvore no
   painel bate com o TikTok Ads Manager (contagem e status das campanhas).*
3. **Rotas de leitura trocadas** — roas, analytics, attribution, health.
   *Aceite: nenhuma regressão visual; números plausíveis.*
4. **Escrita** — status/update/bulk/duplicate. *Aceite: pausar + reativar uma
   campanha de teste reflete no Ads Manager.*
5. **Criação + upload Blob** — createFullAd. *Aceite: campanha de teste criada
   DISABLED de ponta a ponta com vídeo.*
6. **Flags + UI** — esconder BC/catálogo/spark/identity; connect-card novo;
   remoção das 6 rotas OAuth.
7. **Extinção da Zernio** — deletar `zernio-ads.js`, refs em `ads-bulk.js` e
   config; `grep -ri zernio` = 0; remover env; remover `/ads/diag`.

## 10. Riscos e mitigação
- **Schemas exatos dos args não publicados** → gate 1 captura os JSON Schemas
  reais via `tools/list`; provider é escrito contra eles, nada às cegas.
- **Custo de chamadas na árvore** (3 gets + insights, paginados) → cache 15s,
  `fresh=1` só no polling, insights agregados por nível (1 chamada/nível),
  limite de 4 chamadas simultâneas.
- **Limites do plano Pipeboard** (execuções de tools/semana) → o diag loga
  contagem de chamadas por request da árvore; se o polling ameaçar o limite,
  subir TTL do cache para 60s.
- **Teste real só em produção** (chave vive no ambiente publicado) → gates 1–2
  são deploys pequenos e reversíveis; commits atômicos por gate permitem
  `git revert` imediato.
- **Vídeos fora de 5–60s** → validação no cliente + servidor antes do upload ao
  TikTok, com mensagem clara.

## 11. Fora de escopo (explícito)
- Multi-tenant (cada cliente conectando a própria conta) — modelo Pipeboard é
  conta única; se necessário no futuro, reavaliar Unified/Nango atrás do provider.
- Migração de dados históricos de métricas — a árvore sempre reflete o TikTok.
