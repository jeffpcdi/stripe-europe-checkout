# AGENTS.md — ROI-NADOS

> **Instruções para IAs (LEIA PRIMEIRO):** Este arquivo é o mapa mental completo do projeto.
> Leia-o inteiro antes de mexer em qualquer coisa. É a fonte de verdade sobre stack,
> arquitetura, convenções e armadilhas. Regras que **quebram o projeto** se ignoradas:
> 1. O backend é **Node.js puro + Express 4 (CommonJS)** — sem TypeScript, sem build.
>    **EXCEÇÃO:** a dashboard nova é um app **Next.js 16 + React + TypeScript** que vive em
>    `dashboard/` e é servida por proxy reverso em `/dashboard` (ver §19 — leia antes de mexer na UI).
> 2. As **views legadas são template strings gigantes** (`dashboard-view.js`, `lp-view.js`,
>    `auth-view.js`, `vision-view.js`): **NUNCA** use crase (`` ` ``) nem `${}` dentro do HTML delas —
>    quebra a string silenciosamente. Concatene com `+` e escape apóstrofos com entidades HTML.
>    (Essa regra NÃO se aplica ao código em `dashboard/`, que é TSX normal.)
> 3. **Banco Neon em SQL puro** (sem ORM); tabelas criadas sozinhas no boot (`CREATE TABLE IF NOT EXISTS`).
> 4. **Todo texto de UI e comentário em português do Brasil (pt-BR)**; **multi-moeda com padrão
>    BRL** (R$) e fuso de **Brasília** (`America/Sao_Paulo`).
> 5. Ao terminar mudanças relevantes, **atualize este arquivo** para mantê-lo preciso.
> 6. Depois de editar módulos do Express, o servidor precisa ser **reiniciado** (sem hot-reload).
>    O app Next em `dashboard/` tem HMR normal em dev (`next dev`).

## 0. Índice
1. Visão geral · 2. Stack · 3. Deploy e ambientes · 4. Arquitetura (4.1 Backend, 4.2 Frontend) ·
5. Rotas · 6. Esquema do banco · 7. Redis · 8. Score do bot-filter · 9. Fluxo do `/go/:slug` ·
10. CAPI do TikTok · 11. Comandos · 12. Variáveis de ambiente · 13. Convenções · 14. Armadilhas ·
15. Estrutura de arquivos · 16. Ciclo de vida do lead · 17. Formato dos eventos de tracking ·
18. Ciclo de vida do domínio personalizado · **19. Nova dashboard Next.js (`dashboard/`)** —
arquitetura, arquivos, identidade visual e plano de refinamento · **20. Central mágica e automações avançadas**.

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
- **IA:** `@anthropic-ai/sdk` direto; não há Vercel AI Gateway, `ai`, `@ai-sdk/*` nem `@vercel/oidc`.
- **URLs baixadas pelo TikTok:** `ads-storage.publicOrigin()` aceita apenas hostname/IP público.
  `localhost`, redes privadas e `*.internal` retornam vazio; a publicação falha antes de qualquer
  upload com `PUBLIC_ORIGIN_REQUIRED`. Em produção, configure `PRIMARY_HOST`.
- **Serviços externos:** TikTok Events API (`business-api.tiktok.com/open_api/v1.3`), Pipeboard, Anthropic e Pushcut.
- **Transporte Pipeboard:** o timeout de 60s cobre headers **e o corpo/SSE inteiro**; nunca limpe o
  `AbortController` antes de `res.text()`, ou um stream incompleto congela o worker durável.
- **Presença ao vivo:** usa polling HTTP `/api/pulse`; não há dependência de WebSocket no runtime.

## 3. Deploy e ambientes
- **Produção real:** roda no **Railway**, com credenciais **próprias do usuário** (Neon + Upstash
  nas *Variables* do Railway). Independente do v0. Start: `NODE_ENV=production node start.js`;
  `start.js` também força `NODE_ENV` antes de carregar o Express para manter `/__dev/login` ausente.
- **Desenvolvimento local:** `.env.development.local` recebe as variáveis do Railway/gerenciador seguro. O repositório não está conectado à Vercel.
- **Diagnóstico rápido:** `GET /api/status` (público, sem auth) → `{ok, db, redis, hint}`. Primeira
  parada para depurar "banco não configurado" em produção, sem expor segredos. Não confundir com
  `GET /api/health`, que é **autenticado** e traz status detalhado — incluindo `migrations` e, desde
  o item 177, `cloakerLatency` (`{count,window,p50,p95,max,deadlineHits,deadlineRate}` de `getJudgeLatency()`
  do bot-filter): `deadlineRate` alto = lookup de ASN estourando o teto (DNS lento).

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
  Falha do Neon nunca muda para banco de demonstração: `mock-db.js` foi removido,
  `initWithRetry()` retorna falha após esgotar as tentativas e `isReady()` não simula sucesso.
  Sem URL, auth fica desativada; caches locais dos stores continuam disponíveis. O ping usa
  `{ok, latencyMs?, reason?}` tanto na saúde quanto no diagnóstico de login. Uma sessão só é
  aceita após sua gravação durável. A deduplicação de venda mantém a chave
  `account_id + gateway + order_id`; erro do Neon (ou ausência dele em produção) retorna
  `ORDER_PERSISTENCE_UNAVAILABLE` antes dos efeitos da conversão. O worker mantém o item em
  `convQ:proc` para reclaim; o caminho inline tenta novamente após 30s (somente em memória
  enquanto não conseguir enfileirar no Redis, sem garantia de sobreviver a restart).
- **redis.js** — Upstash via HTTP REST. Chaves e TTLs em §7. Aceita aliases `KV_REST_API_URL/TOKEN`.
  Fallback: `Map`/array em memória (o log de conversão sempre tem ring em memória).
- **config.js** — config editável na dash (Pushcut, shortlinks, notas, token da API pública, domínios,
  cloak). Persistida em memória + `data/config.json` + Neon (por conta). Sempre passar pela sanitização.
- **tiktok-events.js** — CAPI do TikTok v1.3. Hash SHA-256 de PII, telefone normalizado E.164,
  `external_id` = hash de `lead:<v_id>`. Multi-pixel via `dispatchToAll`/`sendToPixel`. Calcula **EMQ**
  (proxy do Event Match Quality, 0–10) por `matchScore()`. Retry imediato + fila durável no Redis.
  O funil mantém `CompletePayment` internamente por retrocompatibilidade, mas a fronteira CAPI converte
  para o Standard Event atual `Purchase`; `Purchase.<order_id normalizado>` é compartilhado com o
  navegador para deduplicação. `tiktok-event-contract.js` concentra esse contrato.
- **pixel-store.js** — CRUD de pixels do TikTok (cada um com `pixel_code` + `access_token` próprios).
  A remoção só altera o cache depois de Neon e Redis configurados confirmarem o delete; uma leitura Neon
  vazia é autoritativa e nunca reidrata snapshot Redis obsoleto.
- **link-store.js** — links de checkout (`/go/:slug`). Cada link: `variantes[]` (A/B com pesos;
  `pickVariant()` faz split determinístico por visitante), `pixelSlug`, `urlWhitePage`,
  `paises[]` (ISO-3166-1 alpha-2) e `idiomas[]` (ISO-639-1). Listas vazias = "todos permitidos".
- **gateway-store.js** — gateways de pagamento **multi-tenant**: cada gateway ganha um `webhook_token`
  único → webhook em `POST /hook/:token`. O token identifica CONTA + PROVIDER, dispensando segredo manual.
  A dashboard mantém o fluxo manual: o usuário cadastra o gateway, copia a URL exclusiva exibida no
  card e a cola no painel do provedor; a UI nunca simula conexão automática/OAuth inexistente.
- **ads-catalog-store.js + `catalog/`** — catálogo TikTok multi-tenant, feed, sincronização e criação
  durável de campanhas. `catalog-batch-domain.js` valida/normaliza lotes sem efeitos e rejeita toda URL
  de anúncio; `catalog-batch-executor.js` cria catálogos/produtos com concorrência limitada e
  idempotência; `catalog-sync-worker.js` e `catalog-campaign-worker.js` deixam jobs em
  `waiting_connector_confirmation` e os retomam automaticamente. Depois do upload, o sync só conclui
  quando o overview remoto mostra produtos; até lá fica em `waiting_tiktok_processing`, preserva a resposta
  do upload e o diagnóstico de feeds, e reconsulta com backoff persistido (máximo 8 tentativas). Zero feeds
  é diagnóstico apenas, pois upload direto por arquivo pode não criar feed recorrente. No limite, o run
  falha como `CATALOG_UPLOAD_NOT_VISIBLE`, limpa a falsa marca `synced_at` e pode ser retomado;
  a campanha pausada só é liberada após auditoria dos produtos
  e confirmação semântica de Product Link pelo conector. A igualdade exata entre snapshot local e
  overview continua sendo a única condição que avança `synced_at`. Se o `feed_log_id` atual terminar
  em `SUCCESS` sem erros, mas o overview estabilizar com outra quantidade inteiramente aprovada
  (mínimo 4), o worker encerra o polling como `remoteReadyWithDifference`, preserva o item local
  excedente sem marcá-lo como sincronizado e usa a contagem remota como verdade operacional.
  Campanhas com escopo `ALL` podem então usar somente os produtos que o próprio TikTok confirmou;
  não reconstroem a seleção com IDs locais. Sucesso da campanha exige leitura dos três níveis
  (campanha → conjunto → anúncio), todos pausados, com o catálogo correto, `PRODUCT_LINK` e sem URL manual.
  O launcher do catálogo prioriza uma única ação de alto contraste e recolhe produtos/sincronização
  quando o catálogo já está saudável. A criação em massa aceita de 1 a 50 campanhas independentemente
  da quantidade de vídeos: um vídeo pode ser reutilizado no lote e vários são distribuídos em rodízio;
  cada item continua sendo um run durável com idempotência própria. O lançador aceita até 50 criativos
  MP4/MOV por seleção/lote, mostra progresso e falha individual, permite reenviar/remover e preserva
  a ordem. Por padrão cria uma campanha por criativo (5 vídeos → 5 campanhas); quantidade maior
  reutiliza os vídeos em rodízio e a prévia mostra a distribuição. Quantidade menor que o número de
  criativos é bloqueada para não omitir vídeos silenciosamente. `campaign-batch` aceita `videoUrls`
  sem exigir `videoUrl`, valida todas as URLs antes do primeiro run e mantém o contrato antigo de
  vídeo único. Uploads de um modal fechado não alteram o próximo lote; o idempotency key permanece
  estável em erro/timeout até o usuário alterar o plano.
  No fluxo rápido, essa pausa é uma barreira interna: somente depois desse readback o worker habilita
  anúncio → conjunto → campanha (pai por último) e exige novo readback `ENABLE` nos três níveis antes de
  marcar `ready_active`. Falha ou confirmação parcial pausa novamente toda a hierarquia; updates de status
  são idempotentes e `activation_attempts` aplica backoff durável sem recriar nenhuma entidade.
  Como o readback do TikTok pode atrasar depois da escrita, os três IDs entram em
  `waiting_tiktok_confirmation`: `verify_attempts`/`next_retry_at` aplicam backoff durável sem recriar
  campanha, conjunto, anúncio ou vídeo. Vídeo/capa usam `asset_attempts` separado: o `videoId` é
  persistido assim que o upload responde, falhas de transporte mantêm a etapa correta e o mesmo asset
  é retomado com backoff antes de qualquer campanha existir. Só depois de seis tentativas do respectivo
  estágio o run vira parcial e pede `Retomar`; tentativas de asset nunca consomem as de readback.
  Antes da primeira escrita, o Pixel precisa ter qualquer atividade real em 7 dias e um enum real de
  Compra (`SHOPPING`/`ON_WEB_ORDER`) no histórico de até 30 dias. Ausência ou indisponibilidade transitória
  não falha o formulário: o run fica em `waiting_pixel_purchase`, é reconsultado pelo worker e avança
  automaticamente. Nunca é enviado evento de Compra sintético para liberar campanha. O schema vivo do
  Pipeboard exige `schedule_start_time` no conjunto e ainda não expõe `schedule_type`; a agenda usa o
  `timezone` efetivo da conta (não `display_timezone`, que pode divergir por horário de verão).
- **ads-provider.js + ads-routes.js** — toda criação automática regular, Smart+ e de catálogo só usa
  identidade `BC_AUTH_TT` com `identity_bc_id` e dark post habilitado; nunca escolhe
  `CUSTOMIZED_USER`/`TT_USER`/`AUTH_CODE` automaticamente. Duplicação pré-valida esse fallback antes
  de criar a campanha. Catálogo tenta primeiro identidades BC com perfil nomeado e, no modo automático,
  percorre as demais identidades autorizadas do mesmo BC quando uma perde acesso. Uma identidade escolhida
  explicitamente é reconsultada antes do upload e nunca cai silenciosamente em outro perfil; o endpoint
  `GET /api/ads/catalogs/:catalogId/identities` devolve somente `BC_AUTH_TT` utilizáveis do BC vinculado.
  Product Sales aceita Máxima entrega ou Cost Cap; `CONVERT + OCPM` usa obrigatoriamente
  `conversion_bid_price`. Entrega acelerada só é válida em `ABO + Cost Cap`; CBO e Máxima entrega ficam
  em `STANDARD`. O schema vivo habilita cada opção separadamente e o readback confirma lance e pacing.
  O conjunto envia e confirma `PLACEMENT_TYPE_NORMAL`, `PLACEMENT_TIKTOK` e as localizações; o mapper
  aceita `location_ids` na raiz do readback real. `dark_post_status` pode não voltar na leitura, mas,
  quando voltar, precisa ser `ON`. A árvore e o editor carregam `catalogId`/`websiteType`; se for `PRODUCT_LINK`,
  não exibem nem aceitam `landing_page_url` (inclusive por API), pois o destino é o `Link` de cada produto.
  O produto é exclusivamente de **conversão**: criação comum, Smart+ e Spark usam TikTok placement,
  evento `ON_WEB_ORDER` e campanhas pausadas; objetivos de tráfego/alcance/leads/engajamento são
  rejeitados também no backend. O Pixel não é informado em cada formulário: `ads_pixel_bindings`
  mantém um vínculo por `account_id + advertiser_id`; `GET /api/ads/pixels` cruza o `pixel_code`
  alfanumérico salvo em Conversões com o `pixel_id` numérico lido do TikTok e
  `PUT /api/ads/pixels/default` resolve apenas contas ambíguas. Campanhas comuns, Smart+, Spark,
  wizard e lote de catálogos recebem esse Pixel no servidor e sempre usam Compra.
  “Vídeos em massa” também é exclusivamente conversão: o formulário não oferece objetivo, Pixel
  nem evento; bloqueia uploads enquanto o vínculo central não estiver pronto, exige destino HTTPS
  e usa orçamento mínimo real. `POST /api/ads/bulk` rejeita objetivos incompatíveis, resolve novamente
  o Pixel por `account_id + advertiser_id`, força `ON_WEB_ORDER`, usa o advertiser autorizado e mantém
  a chave idempotente estável em timeout/retry; a fila cria cada estrutura pausada.
  Listagens percorrem **todas as páginas** do conector, inclusive contas com mais de 1.000 anúncios.
  A árvore Smart+ usa as APIs Smart+ nos três níveis e a classificação falha fechada: uma falha de
  leitura nunca rebaixa silenciosamente Smart+ para campanha comum. Orçamento CBO pertence somente à
  campanha; ABO pertence ao conjunto — leitura, automação e edição seguem o mesmo dono para não somar
  nem alterar orçamento duas vezes. O total de investimento da conta vem de `/api/ads/kpis`, inclui
  todos os status e usa a data civil/fuso da conta de anúncios; a árvore mostra separadamente o subtotal
  do filtro atual. Assim Visão geral e Campanhas usam o mesmo escopo, moeda e janela de calendário.
  `POST /api/ads/duplicate/preflight` lê e valida toda a hierarquia antes da primeira escrita, e a
  idempotency key do front permanece estável em timeout/retry. Duplicação comum recria campanha,
  conjuntos e anúncios sempre pausados, preservando Pixel, targeting, identidade, tracking e criativos;
  aceita apenas conversão/Product Sales, normaliza o evento legado para `ON_WEB_ORDER` e nunca degrada
  objetivo/evento para Traffic/Click. ABO mantém orçamento no conjunto e CBO somente na campanha.
  Na versão atual do conector, Smart+ só pode ser duplicada fielmente quando a origem é CBO com
  `BUDGET_MODE_TOTAL`: Smart+ ABO e `BUDGET_MODE_DYNAMIC_DAILY` falham no preflight antes de qualquer
  criação (`SMART_PLUS_ABO_DUPLICATION_UNSUPPORTED`/`SMART_PLUS_BUDGET_MODE_UNSUPPORTED`), pois tentar
  convertê-las silenciosamente mudaria a estrutura ou o período do orçamento.
  Em Product Sales, o preflight exige que o schema Pipeboard declare `product_specific_type`; se não
  declarar, falha antes da primeira escrita (`PRODUCT_SALES_DUPLICATION_CONNECTOR_UNSUPPORTED`) em vez
  de criar uma hierarquia parcial. O escopo reconstruído é `ALL`, `PRODUCT_SET` ou
  `CUSTOMIZED_PRODUCTS` conforme os IDs salvos.
- **Integridade do espelho Ads:** `getInsights()` percorre todas as páginas e rejeita resposta
  inválida, página repetida, término prematuro e teto de paginação. `ads-sync.js` exige todos os
  níveis e períodos antes de substituir o snapshot; falha mantém as datas do último sucesso e
  registra `error`. Campanhas, métricas e limpeza são gravadas numa transação HTTP do Neon,
  serializada por conta/advertiser com advisory lock. Vazio confirmado remove métricas antigas;
  sincronização incremental só substitui os dias consultados e preserva o restante do histórico.
  Regressões isoladas: `db-failure-integrity`, `conversion-database-retry`, `ads-sync-integrity`
  e `ads-insights-pagination` (incluídas em `npm test`, sem serviços externos).
- **ads-bulk.js** — fila durável de mutações em massa/duplicações. Produção preserva a chave histórica
  `adsBulkQ`; desenvolvimento e teste usam namespace próprio (ou `ADS_BULK_QUEUE_NAMESPACE`) para um
  worker local nunca consumir jobs de produção. A leitura de job reconcilia sempre o snapshot em memória
  com o Neon, evitando polling eternamente em `queued` quando outro processo concluiu/falhou o trabalho.
- **ads-ops-store.js + ads-automation.js + ads-automation-window.js** — `ads_ad_rejections` é a caixa durável de reprovações,
  agrupada por conjunto/campanha Smart+ para não repetir um alerta por anúncio. Cada sincronização abre,
  atualiza ou resolve incidentes sem apagar histórico. `GET /api/ads/rejections` lista o inbox e
  `POST /api/ads/rejections/:rejectionId/appeal` reserva atomicamente uma tentativa, gera justificativa
  factual com os dados disponíveis e registra resposta/erro. Recurso automático só envia para Smart+
  quando a conta está em autonomia global, a chave de apelação está ligada e o kill switch/dry-run
  permitem. A autonomia falha fechada quando a política está desativada, o advertiser está bloqueado
  ou o teto anti-loop é menor que uma ação/hora; recursos reais também entram nesse teto durável.
  A tela de Segurança permite corrigir os três bloqueios sem editar configuração bruta. Há cooldown
  de 7 dias após sucesso e backoff de 1 hora após falha. Campanha comum fica com
  instrução manual explícita enquanto o conector não expõe API programática de recurso para esse tipo.
  O loop de `ads-sync.js` une contas abertas recentemente aos perfis duráveis com regra, alerta ou
  agendamento ativo em `config.pipeboardAds.automationProfiles`; por isso automações continuam inscritas
  24/7 depois de 6 horas sem abrir a dashboard e após reinício. Briefings de IA continuam limitados às
  contas vistas recentemente e não são ativados por essa inscrição operacional. O status operacional
  não é inferido da configuração: `ads-sync.getRuntimeStatus()` expõe o heartbeat do processo atual,
  cada promise de regra/alerta/agendamento registra dispatch, conclusão e resultado em
  `runTrackedSweep()`. Regras, alertas e agenda compartilham **um único lease durante o ciclo inteiro**
  por `account_id + advertiser_id`; renovação/liberação comparam o token atomicamente, falham fechadas
  quando um Redis configurado fica indisponível e marcadores Redis com TTL impedem também a repetição
  sequencial do mesmo ciclo em outra instância. A ordem é determinística (alertas → regras → agenda),
  a posse é confirmada antes de cada escrita externa. Perda de lease antes de qualquer mutação libera o
  cooldown sem criar falha; se um lote de orçamento já mudou parcialmente, preserva o cooldown, audita o
  aplicado e grava em dead-letter **somente** os targets restantes. Falha ao persistir cooldown/autoria
  no Neon aborta antes da mutação em vez de seguir apenas com memória. Depois de uma escrita, o motor
  aguarda o sync forçado do espelho antes da etapa seguinte. Cada regra de performance consulta sua própria janela inclusiva
  (`1d` = somente hoje; `7d` = hoje + seis dias), com métricas e atribuição cortadas no fuso retornado
  pelo advertiser TikTok e persistido em `ads_sync_state.advertiser_timezone`; backtest e execução real
  usam o mesmo planejador. Se várias regras baterem na mesma campanha, só uma decisão segue, pela
  precedência conservadora `pause > budget_down > budget_up > activate`, e as suprimidas ficam explícitas.
  Agendamentos também são consolidados por campanha: qualquer janela fechada bloqueia reativação, e uma
  pausa de performance limpa a autoria antiga do dayparting. A atribuição, o copiloto e os briefings usam
  o mesmo dia civil do advertiser, inclusive em viradas de horário de verão. Aprovações CBO revalidam o
  orçamento no nível campanha; o retry de dead-letter relê a campanha atual, preserva `campaignKind`
  (Smart+ nunca cai no endpoint comum), descarta targets já aplicados e bloqueia orçamento divergente.
  Ações parciais entram no cap durável de ações/hora.
  `deriveEngineStatus()` cruza isso com o sync do advertiser selecionado, frescor
  de 15 min, Neon/Pipeboard, kill switch, dry-run e circuit breaker. `/api/ads/rules` e
  `/api/ads/mcp/status` usam o mesmo builder. Após restart, fica `starting` até o novo processo concluir
  o primeiro ciclo — nunca restaura um heartbeat antigo como se o worker estivesse vivo.
- **bot-filter.js** — cloaking multicamadas (score 0–100). Modelo de score em §8. Lookup de ASN (Cymru
  via DNS) com teto de latência (`deadlineMs`, padrão 120ms via `Promise.race`) e cache 2 camadas
  (memória + Redis `asn:<ip>`) para redirect quase instant��neo.
- **presence.js + pulse-client.js** — visitantes online (heartbeat `/api/pulse`), globo 3D no painel.
- **tracker-view.js** — snippet `/t.js` injetado em páginas externas (envia pageview/eventos).
- **ua.js** — parse de User-Agent + detecção de bots (usado no middleware de lead).
- **pushcut.js** — notificações push (venda, etc.) via webhook Pushcut.
- **cloudflare-domain-provider.js** — provedor principal de domínios via Cloudflare for SaaS / Custom
  Hostnames. Lê `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`, `CLOUDFLARE_FALLBACK_ORIGIN` (origem
  Railway pública — registrada na ZONA via API, nunca mostrada ao lojista) e `CLOUDFLARE_CNAME_TARGET`
  (Managed CNAME target — o alvo que o LOJISTA aponta; sem ele o provider opera em modo degradado).
  Preflight rígido no boot: token autentica na zona + origem é hostname público (rejeita
  `*.railway.internal`/IPs privados) + origem responde `/__domain-check`; qualquer falha desabilita o
  provider com causa exata (`auth`/`origem privada`/`origem offline`) e o server cai para o legado via
  `activeDomainProvider()` (seleção dinâmica, nunca congelada no boot). Estados explícitos por domínio:
  `pending_dns → pending_ssl → active | error` (+ `sslStatus`/`lastCheckedAt`/`lastError` persistidos;
  `active` nunca regride por leitura transitória). Diagnóstico consolidado em
  `GET /api/custom-domains/:host/diagnostics` (preflight + Cloudflare + DNS + TLS via SNI + marcador).
  Bateria E2E real: `npm run check:domains` (scripts/check-domains.mjs). Nunca expõe token; erros viram
  `auth`/`duplicado`/`limite`/`offline`/`falha`. Domínios antigos são adotados idempotentemente quando o
  verify detecta `provider` diferente.
- **domain-provider.js** — fallback legado Railway GraphQL quando as variáveis `CLOUDFLARE_*` não estão
  completas. Mantém a mesma interface (`enabled`/`register`/`status`/`remove`) e suporta account token ou
  project token. Detalhes de operação em §5.2.2 e ciclo completo em §18.
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
  A dashboard usa as pilhas locais `system-ui` e `ui-monospace`; não importe fontes por
  `next/font/google`, pois o download no build torna o deploy dependente do CDN externo.
- **Regra de ouro do front:** como o HTML é uma string JS, **nunca** use crase nem `${}` dentro dele;
  para interpolar valores do servidor, concatene com `+` e escape aspas/apóstrofos.
- **Snippets servidos para páginas externas:** `/px/:token.js` é a instalação recomendada e
  autossuficiente: carrega o Pixel nativo e inicializa `/t.js` (tracker-view.js) para jornada, SPA e
  identidade. `/px.js` permanece legado e `/px.gif` é o fallback sem JS. Compra confirmada pode ser
  espelhada no Pixel do navegador por `data-roinados-purchase` ou
  `RoiNadosPixel.purchase(token,{order_id,value,currency})`; o navegador nunca cria receita nem CAPI.

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
- **Contrato de erro (item 181):** rotas novas/migradas respondem `{ok:false, error, code?, hint?}`
  via helper `apiError(res,status,error,code,hint)`. `error`=o quê, `code`=estável p/ lógica,
  `hint`=orientação pt-BR. No front, `lib/api.ts` (`ApiError` com `code`/`hint` + getter `display`,
  `parseApiError`) monta a mensagem. **Retrocompatível:** rotas com só `{error}` seguem funcionando.
- **Rate-limit dos testes (item 178):** `/api/cloak/test` (30/min — faz lookup DNS),
  `/api/pixels/test` e `/api/conversion/test` (15/min — disparam CAPI/Pushcut real) usam `rateLimited`
  por conta e retornam 429 `{ok:false,error,code:'rate_limited'}`.
- **Auth/conta:** `POST /login`, `POST /register`, `POST /logout`, `GET /api/me`.
- **Métricas:** `GET /api/stats`, `GET /api/live`, `POST /api/reset-stats`, `GET /api/health`.
  `GET /api/ads/kpis` e `GET /api/ads/roas` retornam `scope='advertiser_all_campaigns'`, moeda,
  `timeZone` e `lastSyncedAt`; ambos agregam todos os status no mesmo intervalo civil da conta de
  anúncios. Filtros da árvore (`active`/`review`/`paused`) são mutuamente exclusivos e nunca alteram
  o total oficial exibido. `POST /api/ads/duplicate/preflight` é somente leitura e devolve avisos/erros
  estruturais antes de enfileirar a duplicação real.
- **Observabilidade das filas (Leva 5, bloco I):** `GET /api/ops` — profundidade da fila de
  conversões (`convQueue`), último resgate de órfãos (`reclaim`), latência webhook→disparo
  p50/p95/max (`convLatency`, janela de 200 em memória), heartbeat do drain worker (`worker`,
  ativo se tick <10s), resumo da fila de retry da CAPI por conta (`capiRetry`) e contador de
  reentregas de webhook ignoradas (`webhookDedup`, durável 30d por conta). `POST /api/ops/drain-retry`
  força a drenagem da fila de retry AGORA (ignora backoff, escopado à conta, rate-limit 6/janela).
  A UI vive no painel "Saúde da fila de conversões" da aba Gateways (`queue-health-panel.tsx`).
- **Pixels:** `GET/POST /api/pixels`, `GET/PUT/DELETE /api/pixels/:slug`, `GET /api/pixels/health`,
  `GET /api/pixels/log`, `POST /api/pixels/test`.
  `DELETE` retorna 404 para slug ausente, 409 enquanto um Link ainda usa o Pixel, remove os
  `ads_pixel_bindings` da mesma conta e só responde sucesso após confirmação durável.
- **Links de checkout:** `GET/POST /api/links`, `GET/PUT/DELETE /api/links/:slug`,
  `POST /api/links/validate-domain`.
- **Cloak/filtro de bots:** `GET/POST /api/cloak-config` (inclui `defaultWhitePage`, a white global
  de fallback da conta), `GET /api/cloak/links`, `GET/POST/DELETE /api/cloak/entries[/:slug]` (links `/c/`),
  `POST /api/cloak/link/:slug`, `POST /api/cloak/test`, `GET /api/cloakcheck`.
  **Métricas de decisão:** `GET /api/cloak/stats` (offer vs white + taxa de bloqueio + breakdown por
  motivo, por link e agregado) e `POST /api/cloak/stats/reset` (zera um link via `{key}` ou todos).
  **Histórico de decisões (item 170):** `GET /api/cloak/decisions?key=` devolve as últimas ~50 decisões
  do link (mesma convenção de `key`: `slug` no `/go`, `'cloak:'+slug` no `/c`), com **IP mascarado** (sem
  PII). Store `pushCloakDecision`/`getCloakDecisionLog` no `redis.js` (lista LTRIM 50 + TTL 30d, fallback
  em memória), alimentado pelo funil `bumpDecision` do `/c`. `stats/reset` também limpa esse log. O front
  reexecuta o julgamento (item 171) reusando `POST /api/cloak/test` — não há replay do visitante histórico.
  **Simulador de perfis (item 165/208):** `GET /api/cloak/test/profiles` lista o catálogo (`cloak-test-profiles.js`)
  só com metadados (`id`/`label`/`expected`/`hint` — nunca os headers/IPs sintéticos). `POST /api/cloak/test`
  com `{profile}` monta um `evalReq` sintético (headers, query, IP, geo, `challengeData`) e roda o MESMO
  `botFilter.judge` + os gates pré-score, substituindo o request do admin em TODA leitura derivada do
  visitante (mantém `req.account`/`req.body`). Sem `profile` = julga o acesso real do admin (deve dar `real`).
  O eco `profile` na resposta permite à UI confrontar veredito real × esperado. Cobertura em
  `test/cloak-test-profiles.test.js` (o motor precisa classificar cada perfil do lado certo).
- **Gateways:** `GET/POST /api/gateways`, `GET/PUT/DELETE /api/gateways/:id`.
- **Catálogos TikTok:** `GET/POST /api/ads/catalogs`, `GET/PUT/DELETE /api/ads/catalogs/:catalogId`,
  produtos (`POST .../products`, `DELETE .../products/:productId`), CSV (`POST .../import`,
  `GET .../export.csv`), lote (`POST /api/ads/catalogs/batch/preview` e `POST /api/ads/catalogs/batch`),
  feed (`POST .../publish`), vínculo/auditoria, sync runs e campaign runs.
  **Todas** exigem `adAccountId` explícito
  (query string; o backend também aceita `advertiserId`) e validado pelo Pipeboard. O escopo é
  `account_id + advertiser_id`; nunca autorize uma operação só porque o `catalogId` ou `runId` existe.
  A sincronização é durável (`catalog/catalog-sync-worker.js`) e verifica o catálogo remoto em
  todo envio: se o ID salvo não existir mais no BC atual, recria apenas o vínculo remoto e preserva
  catálogo/produtos/feed locais. Cada run usa um snapshot CSV imutável (`ads_catalog_feed_snapshots`)
  identificado por hash na URL `?v=`; a limpeza nunca remove revisões referenciadas por runs duráveis.
  `synced_at` exige o `feed_log_id` do upload atual em `SUCCESS` com
  `error_count=0` **e** overview com exatamente a quantidade enviada; produtos antigos no catálogo nunca
  confirmam o snapshot local como sincronizado. Quando o mesmo recibo termina sem erros e o overview
  retorna uma quantidade diferente, mas inteiramente aprovada e suficiente para Catalog Ads, o run
  termina com a divergência registrada sem avançar `synced_at`: a UI mostra primeiro a contagem real
  do TikTok, informa quantos itens existem apenas localmente e libera somente campanhas `ALL`, que usam
  o catálogo remoto. Uma leitura isolada do overview atualiza apenas `audit`. Produtos são revalidados contra a spec atual em toda leitura crítica e
  no feed público: `brand` é o 9º campo obrigatório (nunca inferido) e o enum correto é
  `available for order` (não `available`). Assim, registros antigos com `valid=true` não furam a regra.
  A campanha Catalog Ads Product Link exige orçamento mínimo 50, Pixel ID numérico, atividade real do
  Pixel nos últimos 7 dias + evento de Compra real visto em até 30 dias (`SHOPPING` nesta conta;
  `ON_WEB_ORDER` somente quando aparecer nas estatísticas), e pelo menos **4 produtos aprovados no
  overview agregado**. Esse overview
  não comprova sozinho estoque/disponibilidade por SKU, portanto a UI não deve alegar essa verificação.
  Product Link **não exige URL no anúncio nem Catalog Video Template ID**: o destino é o `link`
  individual de cada produto. O fluxo principal é `SINGLE_VIDEO` com
  `vertical_video_strategy=SINGLE_VIDEO`: o usuário envia um MP4/MOV, o áudio vem do próprio arquivo,
  e a dashboard extrai a capa retornada pelo TikTok e a envia automaticamente. Não existe campo de
  música, capa, Pixel, evento ou URL manual no wizard. `get_tiktok_video_info` só libera o asset com
  o `videoId` exato e `displayable=true`; uma capa de outro vídeo ou status textual não antecipa a
  criação. O TikTok pode devolver a capa observada como `http://*.tiktokcdn.com`: somente nesse host
  comprovado o provider eleva para HTTPS preservando a query assinada. A capa automática rejeita
  qualquer outro domínio, IP literal, credencial, porta, hostname ambíguo ou host sintético; a capa
  HTTPS manual do Smart+ mantém validação e mensagem próprias.
  O lote aceita TSV ou CSV (vírgula/ponto e vírgula), normaliza orçamento pt-BR como `1.000,00` e recebe
  exclusivamente o `link` HTTPS de cada produto; URL manual no anúncio é bloqueada em duas barreiras
  (preview + executor). O parser de `/api/ads/catalogs/batch` é montado antes do JSON global e aceita
  até 25 MB (o restante da API continua em 200 KB). A confirmação Product Link só vale quando o JSON Schema do Pipeboard
  declara explicitamente todos os valores enviados nos três níveis (incluindo `PRODUCT_SALES`,
  `product_source=CATALOG`, `shopping_ads_type=VIDEO`, `promotion_type=WEBSITE`,
  `shopping_ads_retargeting_type=OFF`, `catalog_authorized_bc_id`, `CONVERT`, pausa,
  `ad_format=SINGLE_VIDEO`, `vertical_video_strategy=SINGLE_VIDEO`, `video_id`, `image_ids`,
  `product_specific_type`, CTA, identidade
  `BC_AUTH_TT`, `identity_authorized_bc_id` e dark post);
  `store_authorized_bc_id` é de TikTok Shop e não deve ser usado para o catálogo. O preflight também
  exige as três tools de readback, respeita `inputSchema.required` e valida o evento escolhido antes da
  primeira escrita. A leitura final confirma formato/estratégia/vídeo/capa, escopo de produtos,
  Pixel/evento, identidade/BC, texto/CTA, Product Link, ausência de URL manual e pausa nos três níveis.
  Quando o conector ainda não confirma catálogo ou Product Link, sync/campanhas ficam
  em `waiting_connector_confirmation` e são retomados automaticamente; depois a campanha segue para
  `waiting_catalog_review` e só é promovida após auditoria aprovar o catálogo. Assim o lote pode ser
  preparado agora, mas nenhum fallback com URL global é criado nem anúncio é enviado antes da confirmação
  explícita do schema Pipeboard.
  **Estado observado do Pipeboard neste token (verificação real em 2026-08-03):** o schema vivo
  declara `vertical_video_strategy=SINGLE_VIDEO` no contrato textual do campo, aceita a configuração
  regional obrigatória `catalog_conf={region_code,currency}` para `catalog_type=ECOM` e expõe os
  readbacks dos três níveis. A capability só aceita o token exato `SINGLE_VIDEO` (texto genérico de
  pass-through falha fechado) e revalida a cada 60s. Catálogo temporário ECOM/BR/BRL foi criado e
  removido pela mesma API para confirmar o contrato; nunca degradar para Smart+, carousel, vídeo comum
  com URL global ou etapa manual.
  **QA real da retomada em 2026-08-03:** o run `catcamp_ba1a82377663404fa4ab4ddf39368ce0`
  reutilizou o vídeo `v10033g50000d9odsb7og65r705oicd0` e concluiu a hierarquia pausada
  `1872529264778369 → 1872529069625394 → 1872529066711297`. O readback confirmou
  `PRODUCT_SALES`, catálogo `7668025884561000213`, `CATALOG+VIDEO`, Pixel/evento
  `7565659074893791250/SHOPPING`, `SINGLE_VIDEO`, escopo `ALL`, `landing_page_url=null`
  e `DISABLE` nos três níveis.
  A criação também consulta todos os nomes do advertiser antes de escrever:
  `catalog/catalog-campaign-safety.js` incrementa o sufixo numérico
  (`ecom — VSA 01` → primeiro número livre) e, se outra instância ocupar o nome
  entre preflight e create, repete somente a campanha com o próximo nome. O nome
  efetivo entra em `created_ids.campaignName` antes da escrita e aparece no cartão
  do run. O mesmo módulo classifica a causa semântica dos erros de criação — nunca
  decide só pelo código genérico 40002 — e preserva o request_id. Rate limit,
  agenda inválida e indisponibilidade explicitamente anterior à escrita usam
  `creation_attempts` com backoff durável; timeout/rede ambíguos nunca repetem um
  create cegamente. Matriz de manutenção: `docs/TIKTOK-CATALOG-CAMPAIGN-ERRORS.md`.
  Duplicação também normaliza orçamentos legados abaixo de 50 e repete automaticamente o erro
  transitório TikTok 40002 “Could not acquire IP”; outros 40002 continuam falhando sem retry cego.
  **UI Next do lote de catálogos:** a prévia pode validar os dados locais, mas o botão de criação
  fica bloqueado quando campanhas foram pedidas sem sincronização ou quando a sincronização ainda
  não tem BC/origem/permissões. O resumo terminal informa também campanhas preparadas, aguardando
  Product Link/análise, ignoradas e com falha. Quando `catalogSingleVideoCampaign=false`, o hook de
  capabilities reconsulta em baixa frequência (60s) para remover o banner sem exigir reload; os
  cards de run exibem nome, escopo, orçamento, avisos e a verificação final completa. Polling de campanha
  usa 4s em execução, 15s aguardando análise/readback, 60s aguardando o conector e para em estado terminal.
  O Business Center é descoberto pelas identidades `BC_AUTH_TT`: uma única opção é persistida
  automaticamente, múltiplas viram uma escolha na própria tela e o ID manual fica só na recuperação
  avançada. Salvar/corrigir o BC no cartão de conexão revalida também o estado pai.
  O parser do lote exige a coluna `marca`/`brand` e envia `brand` por produto; valor ausente bloqueia
  a prévia com as linhas exatas, pois a marca real é obrigatória no TikTok e nunca deve ser inferida.
  Ao preparar campanhas, a rota injeta o Pixel central vinculado à conta de anúncio e consulta
  `get_tiktok_pixel_event_stats` por sete dias para escolher Compra; planilha, wizard e lote rápido
  não pedem Pixel/evento repetidamente.
  No wizard dedicado há uma única ação “Criar campanhas”; o fluxo principal pede somente quantidade,
  orçamento e criativos, começa em uma campanha por criativo e aceita até 50. “Entrega e perfil” concentra Máxima
  entrega/Cost Cap, CPA alvo, entrega acelerada (quando elegível) e o perfil mostrado no anúncio;
  o resumo fechado expõe a configuração atual sem poluir o formulário. Reabrir o modal sempre restaura
  os padrões automáticos, e o rodapé fixo mantém a única ação de criação visível. A identidade automática
  continua sendo o padrão. Todos os produtos aprovados, nomes ordenados, Pixel,
  Compra, capa e Product Link são resolvidos automaticamente; o áudio vem do vídeo.
  O orçamento é sempre exibido na moeda da conta de anúncio (não na moeda do feed);
  comparações de IDs normalizam string/número para não cair na moeda de uma campanha antiga.
  A tabela técnica de produtos locais fica recolhida por padrão e explicita separadamente o total
  salvo na dashboard e o total confirmado no TikTok. Avisos do run ficam visíveis e falhas não retomáveis oferecem apenas a limpeza da
  estrutura parcial. A contagem principal e a prontidão vêm do overview remoto; itens salvos só na
  dashboard aparecem como uma diferença não destrutiva e nunca entram em uma campanha `ALL`.
  Duplicar um produto gera novo `sku_id` **e** novo `item_group_id`, evitando que a cópia herde o
  agrupador do original. Sem `catalogSingleVideoCampaign`, nada é enviado ao TikTok.
  O endpoint de lote (`POST /api/ads/catalogs/:catalogId/campaign-batch`, máximo 50) atende essa única
  ação do cartão “Campanhas deste catálogo”, gera nomes ordenados e cria runs duráveis idempotentes.
  O modal só abre com `catalogSingleVideoCampaign=true`; não existe formulário concorrente na tela.
  Nomes diferentes que geram a mesma key normalizada bloqueiam a prévia com nomes e linhas, em vez
  de fundir produtos silenciosamente. A idempotency key do wizard é preservada entre timeout/retry e
  só muda após sucesso ou alteração material do formulário. Runs
  `waiting_tiktok_processing/processing_tiktok` (e o legado `completed/processing_tiktok`)
  continuam em polling lento (15s) até `reviewed_tiktok` ou outro estado terminal acionável.
- **Convers����������es:** `GET /api/conversion/log`, `POST /api/conversion/test`.
- **Domínios:** `GET/POST /api/domains`, `GET/DELETE /api/domains/:host`, `POST /api/domains/verify`.
  **Mecanismo de verificaç��o (2 passos, mas s�� o 2º decide):** (1) DNS — `resolveCname`/`resolve4`
  comparados com os **alvos aceitos**: o `appHost` da requisição E o alvo de CNAME gerado pela hospedagem
  para o domínio (`entry.dns.cname.target` — é o valor que o Tutorial DNS mostra; aceitar só o `appHost`
  travava quem seguia o tutorial). A comparação de A/AAAA usa os IPs de TODOS os alvos (round-robin de IPs
  quebrava a comparação 1:1). Antes da checagem local, se o domínio tem `providerId`, o verify consulta
  `domainProvider.status()` — se a hospedagem já validou o DNS (`providerVerified=true`), `dnsOk=true`
  mesmo que os resolvers locais não reflitam (cobre apex com CNAME flattening da Cloudflare) e os
  `dns` do config são sincronizados com o que a hospedagem exige hoje. Detecta proxy Cloudflare por faixa
  de IP (`isCloudflareIp`, só quando os alvos NÃO estão atrás da Cloudflare)
  → `cloudflareProxy=true` (nuvem laranja mascara o CNAME real). (2) HTTP — `GET https://host/__domain-check`
  precisa responder 200 com `{app:'roi-nados-tracker'}` (assinatura `APP_CHECK_ID`). **`ok = httpOk`**:
  DNS apontado NÃO basta — sem o domínio roteado na hospedagem (Custom Domain + SSL), `/go` daria 404.
  `dnsPronto=true` = DNS ok mas app ainda não atende. Sem cache: cada verify re-checa do zero. O front
  (dashboard-view.js) tem polling de 30s (só com pendentes + aba visível).
  **Sinal de propagação via DoH (item 175):** quando o resolver LOCAL (`dnsp`) não vê registro nenhum,
  o verify consulta `dohResolve()` (DNS-over-HTTPS: dns.google + cloudflare-dns, timeout 2.5s, best-effort).
  Se o CNAME/A já aparece nos resolvers públicos apontando pra cá, devolve `dnsPropagating=true` (a
  dashboard mostra "já visível na rede global — propagação em curso" em vez de "não resolve" e some o CTA
  de erro). É só um sinal antecipado — nunca fonte de verdade; `ok` continua sendo `httpOk`.
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
- **Contratos da Leva 7 (itens 417/439/442/443/464/469/471/484/485):**
  - `GET /api/audit?limit=` → `{ok, enabled, log:[{id,at,action,detail,ip}]}` — trilha de auditoria da
    conta (tabela `account_audit` no Neon). `enabled=false` = sem banco (UI mostra aviso, não erro).
    Ações gravadas: `login`, `link_salvo`, `link_removido`, `reset_stats`, `backup_importado`. IP sempre
    mascarado (`maskReqIp`: último octeto IPv4 / cauda IPv6 ofuscados). Gravação via `audit(req,accId,
    action,detail)` — fire-and-forget, nunca quebra a ação auditada.
  - `GET /api/health` ganhou `version` (do package.json) — consumido pelo card "Sobre" da aba Config.
  - `GET /api/stats` responde `Cache-Control: private, no-cache` (não mais `no-store`): o poll de 12s
    revalida com `If-None-Match` e ganha 304 sem corpo quando nada mudou. NÃO trocar de volta para
    no-store sem entender que isso desliga o 304.
  - `GET /healthz` (SEM auth, na allowlist de domínio) → `ok` texto puro — liveness probe do Railway.
    Zero I/O de propósito: não medir Neon/Redis aqui (para isso existe `/api/health`).
  - `POST /api/pushcut-config` aceita `events.{sale,failed,refund,dispute,checkout,daily,login,watchdog}`.
    `login` (item 442) = aviso de novo login; `watchdog` (item 464) = alerta se 6h sem vendas com
    baseline ≥14 vendas/7d (carona no tráfego, máx 1 varredura/h, anti-spam 12h/conta). Ambos opt-in
    explícito (`=== true` na sanitização).
  - Limites de body (item 471): `express.json` global **200kb**; `/api/backup/import` tem parser
    dedicado de **5mb** montado ANTES do global. Payload maior → 413.
  - `/go/:slug` e `/c/:slug` inexistentes/desativados respondem `linkErrorPage()` (HTML amigável,
    noindex, 404) — nunca mais "Link não encontrado" em texto cru (itens 500/501).

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
- **accounts** — `id, email (unique), password_hash, name, role ('user'|'admin'), currency (default 'BRL'), created_at`.
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
- **ads_catalogs** — `id, account_id, advertiser_id, name, currency, feed_blob_url,
  feed_published_at, product_count, link_status, tiktok_catalog_id, bc_id, audit, batch_key, timestamps`;
  `advertiser_id` é anulável apenas para migração.
  Catálogos legados (`advertiser_id IS NULL`) são atribuídos atomicamente ao primeiro advertiser
  selecionado que abrir a área, preservando IDs, produtos e URL de feed sem duplicação. Novos
  catálogos sempre persistem o advertiser. **ads_catalog_products** continua ligada por
  `account_id + catalog_id`; toda leitura/escrita de produto primeiro valida o catálogo pai no
  mesmo advertiser. **ads_catalog_sync_runs** também persiste `advertiser_id`; publicações e jobs
  de campanha só são listados/retomados depois da validação do catálogo/run no mesmo advertiser.
  `batch_key` é única por conta+advertiser quando presente, para uma repetição idempotente do lote.
- **ads_ad_rejections** — incidentes duráveis de reprovação por
  `account_id + advertiser_id + campaign_kind + adgroup_id`, com IDs/nomes de anúncios e materiais,
  status bruto, motivo, estado/tentativas/texto/anexos do recurso e timestamps. Índice parcial garante
  apenas um incidente `open` por grupo; quando a reprovação some do espelho, o incidente é resolvido.
- **pixel_events** — `id, account_id, pixel, event, event_id, lead_id, status, response jsonb, at` (log CAPI).
- **custom_domains** — `host (pk — unicidade global entre contas), account_id, uso
  ('checkout'|'cloaker'|'ambos'), verificado, verificado_em, provider_id, provider_note, dns jsonb,
  criado_em, updated_at` (itens 241–252). O cache quente continua sendo `config.customDomains`
  (jsonb por conta); `config.set` faz write-through ASSÍNCRONO (setImmediate) para esta tabela +
  snapshot Redis `domains:all`, e `config.hydrate()` reconcilia no boot (Neon → fallback Redis,
  SÓ em memória via `config.seed` — leitura nunca semeia escrita).

Funções db.js notáveis: `createAccount`, `getAccountByEmail/ById`, `countAccounts`, `getFirstAccountId`,
`claimLegacyData`, sessões (`create/get/delete/pruneAuthSession`), gateways (`upsert/delete/load/getByToken/touch`),
`upsertLead`, `insertEvent`, `upsertVariant`, `loadState` (hidrata cache no boot), `saveConfig`/`loadConfig`
(retorna `{ok,data}`: `ok=false` = ERRO de leitura, não sobrescrever!), `reset`,
`upsert/delete/loadCustomDomains`, `setAccountCurrency`/`loadAccountCurrencies`,
`migrationStatus()` (flags `customDomains`/`accountCurrency` expostas no `/api/health` como `migrations`).

## 7. Redis (Upstash) — chaves, TTLs e usos
- **presence:<id>** — presença ao vivo (TTL 60s, renovado por heartbeat ~12s). `listPresence` faz SCAN+MGET.
- **pixelLog** (lista, cap 500) + **pixelLogByTime** (zset) — log de disparos CAPI (TTL 14 dias).
- **conversionWebhookLog** (lista, cap 200) — cada webhook `/api/conversion` recebido (+ ring em memória sempre).
- **capiRetryQueue** — fila durável de eventos CAPI que falharam após os retries imediatos (cap 300, TTL 2d).
- **convQ** + **convQ:proc** — fila DURÁVEL de conversões do webhook (cap 5000). O webhook grava aqui ANTES do 200; um worker (2s) consome via `LMOVE` para `convQ:proc`, processa e dá ack (`LREM`). `reclaimConversions` (60s, idade>120s) requeue itens presos por crash. Idempotente via dedup. O worker bate `heartbeatConvWorker()` a cada tick e `processConversion` registra `recordConvLatency` (webhook→disparo) — ambos expostos em `GET /api/ops`.
- **dedup:<event_id>** — dedup navegador↔servidor (SET NX, TTL 2h). Em erro, deixa passar (melhor duplicar que perder).
- **asn:<ip>** — cache do lookup BGP/ASN do bot-filter, compartilhado entre instâncias. **TTL DUPLO
  (item 176):** hit resolvido (asn>0) fica 24h; resultado NEGATIVO (asn:0/unknown/timeout) fica só
  5min (`ASN_NEG_TTL`) para não congelar um datacenter como neutro após um lookup que falhou. Mesma
  regra no cache em memória do `bot-filter.js` (`ASN_TTL_MS` × `ASN_NEG_TTL_MS`).
- **domains:all** — hash `${accountId}:${host}` → JSON do domínio (item 245): espelho durável dos
  domínios personalizados (mesmo padrão de `pixels:all`/`gateways:all`); fallback de hidratação
  quando o Neon falha no boot.
- **cloakbot:<v_id>** — veredito STICKY do cloaker (só bot, TTL 6h). `/go` curto-circuita à white sem re-rodar o judge; setado no veredito bot e no beacon `/api/cloakcheck` com WebGL de software. Nunca cacheia 'real' (fail-safe).
- **lock:<nome>** — lock distribuído (SET NX EX). Usos: `capiRetryDrain` (só 1 instância drena a fila de retry) e `convWorker` (só 1 instância drena convQ por ciclo). Sem Redis = processo único = já exclusivo.
- **emq:<acc>:<pixel>** — rollup de EMQ por pixel/dia (`d:<data>:sum`/`:cnt`, retenção ~40d). Alimenta `GET /api/pixels/emq-trend` (série + alerta de queda) e o painel de tendência na aba Pixels.
- **vel:<kind>:<id>** — camada de VELOCITY (anti device-farm, itens 253–260): contador `INCR` com TTL
  = janela. `kind` ex.: `c:<slug>:ip`; `id` = IP. Limiar/janela configuráveis por conta em
  `config.cloak.velocityLimit` (clamp 3–100, padrão 12) / `velocityWindowSec` (clamp 10–600, padrão
  60) — usados no `/c`; excedente vai à white com reason `velocity`. `clearVelocity(ip)` (rota
  `POST /api/cloak/velocity/clear`) libera um IP legítimo de TODAS as entradas antes do TTL. Fallback
  memória: `velMem` (single-instance — banner na UI avisa que farm distribuída exige Redis).
Sem Upstash tudo degrada para memória (perde persistência entre restarts, mas funciona).

## 8. Modelo de score do bot-filter (cloaking)
Cada visita retorna `{ verdict:'real'|'bot', score:0-100, signals[], threshold, resolvedAt, asn, org }`.
**`score >= threshold` ⇒ bot ⇒ white page.** Os campos `asn`/`org` (infra resolvida) e `resolvedAt`
(ms do julgamento) são consumidos SÓ pela transparência do `/api/cloak/test`/painel — não alteram a
decisão nem o redirect. `asn=0`/`org=''` = desconhecido/privado; `asn:deadline` ⇒ `org='timeout'`.
- **Threshold:** padrão 40; presets de sensibilidade `strict:30 / balanced:40 / loose:55` (têm prioridade
  sobre threshold manual). Clamp final 10–90. `deadlineMs` clamp 40��500 (padrão 120).
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
- **Dedup:** navegação usa IDs únicos compartilhados entre `/t.js` e `/px/:token.js`; compra usa
  `Purchase.<order_id normalizado>` no Browser Pixel e na Events API. **Alterar qualquer formato quebra
  a dedup** navegador↔servidor (duplica ou perde eventos). Retry imediato + fila durável (`capiRetryQueue`).
- **Multi-pixel:** `dispatchToAll` dispara em todos os pixels ativos; `sendToPixel` mira um específico
  (usado pelo `/go` quando o link tem `pixelSlug`).
- **Trava gateway-only (eventos de dinheiro):** `MONEY_EVENTS` = `CompletePayment`/`Purchase`, `AddPaymentInfo`,
  `Refund`, `Dispute`. `dispatchToAll` BLOQUEIA esses eventos se o payload não tiver `p._trusted = true`.
  Só o webhook do gateway (`/hook/:token`) e `/api/conversion` marcam `_trusted`. Isso impede venda
  "fantasma" disparada por beacon client-side. Bloqueio é logado com `status:'bloqueado'` e retorna
  `{ blocked:'gateway-only' }`. Client-side envia `ViewContent`/`InitiateCheckout`/`AddToCart` pelos dois
  canais; `Purchase` client-side vai apenas ao Pixel nativo e depende do webhook para a cópia CAPI confiável.

## 11. Comandos essenciais
```bash
npm install     # instala dependências do Express (raiz)
npm start       # produção: node start.js → sobe Next (porta 3001) + Express ($PORT) juntos (§19)
npm run dev     # local: node --env-file-if-exists=.env.development.local server.js (só o Express)
npm run build   # cd dashboard && npm install && npm run build (build do Next; o Express não tem build)
npm test        # roda os testes de regressão (test/*.test.js), sem rede/DB reais

# Dashboard Next.js em dev (segundo terminal, além do Express):
cd dashboard && npm run dev -- -p 3001   # HMR; acesse via http://localhost:3000/dashboard (proxy)
```
- **Build:** só o app `dashboard/` tem build (Next). O Express continua JS puro sem transpile.
- **Testes:** `npm test` — asserts em Node puro, sem framework (8 suítes). `test/retry-queue.test.js`
  (re-resolução da fila CAPI por token), `test/gateway-only.test.js` (trava de eventos monetários),
  `test/attribution.test.js`, `test/pixel-durability.test.js`, `test/security.test.js`,
  `test/cloak-decision-log.test.js` (item 170: mascaramento de IP sem PII, teto de 50, escopo por
  conta+slug, reset zera o log), `test/cloak-test-profiles.test.js` (item 165/208: catálogo coerente +
  o motor classifica cada perfil sintético do lado esperado) e `test/queue-observability.test.js`
  (Leva 5 bloco I: percentis de latência webhook→disparo, heartbeat do worker, dedup de webhook
  escopado por conta, resumo da fila de retry). Stubam `pixel-store`/`redis` no require-cache e
  `global.fetch`; rodam no fallback de memória do redis. Ao mexer no motor CAPI, no motor de
  julgamento do cloaker, no store de decisões ou nos contadores de fila, rode-os.
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
- `ADS_AUTOMATION_LEASE_TTL_SEC` — TTL do lease distribuído das automações (padrão 900s; limite 60–3600).
  Normalmente não precisa ser alterado; o worker renova durante execuções longas.
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
- **Idioma:** comentários e UI em português do Brasil (pt-BR); multi-moeda com padrão BRL (R$);
  fuso de Brasília (`America/Sao_Paulo`).
- **Módulos:** CommonJS (`require`/`module.exports`); um arquivo por responsabilidade, todos na raiz.
- **Views como string:** nunca crase nem `${}` no HTML das views. Concatenar com `+`; apóstrofos como entidades.
- **Rastreamento nunca bloqueia navegação:** middleware de tracking usa `try/catch` silencioso e
  responde antes de processar (efeitos colaterais em background).
- **Neon/Redis opcionais:** todo acesso degrada com elegância se a env faltar.
- **Persistência em três camadas:** memória (rápida) → `data/*.json` (cache local, ignorado no git) → Neon (durável).
- **Segurança:** senhas com `scrypt`; comparações timing-safe com `crypto.timingSafeEqual`.
- **Multi-tenant:** toda query/escrita de dados passa `accountId`; nunca vazar dados entre contas.
- **Política de Do Not Track (item 492, DECIDIDA):** o tracker NÃO condiciona a coleta ao header
  `DNT`. Razões: (a) o produto É medição de conversão first-party contratada pelo dono do funil
  (execução de contrato/interesse legítimo na LGPD), não ad-tech third-party; (b) o DNT foi
  descontinuado como padrão (removido do Firefox/Chrome em 2024-25) e nunca teve valor jurídico no
  Brasil; (c) a base de compliance do projeto é minimização (IP mascarado nos logs, e-mail/telefone
  hasheados SHA-256 antes da CAPI, retenção com TTL) + transparência nos Termos/Privacidade — não um
  header que os próprios navegadores abandonaram. Se um dia for preciso honrar sinal do navegador,
  o correto é o GPC (`Sec-GPC`), como decisão de produto — não colar um `if` no tracker.

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
- **Eventos de dinheiro são gateway-only:** nunca dispare `CompletePayment`/`Purchase`/`AddPaymentInfo` (nem
  `Refund`/`Dispute`) sem `p._trusted=true`. Só webhook do gateway e `/api/conversion` são confiáveis;
  o motor bloqueia o resto (ver §10). Adicionar um novo caminho de venda exige marcar `_trusted`.
- **`deadlineMs` e sinal ASN:** lookup de ASN tem teto de latência; no estouro o `judge` segue SEM
  esse sinal (marca `asn:deadline`) e popula o cache em background. Baixar demais reduz a precisão.
- **Pixel do link vence:** se `link.pixelSlug` aponta um pixel ativo, o `InitiateCheckout` dispara SÓ
  nele. Ocorre após os gates (só gente real gera evento).
- **Dedup determinístico:** navegação e compra têm contratos diferentes (§10/§17); alterar o formato
  só em um lado quebra a dedup navegador↔servidor no TikTok.
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
├── tiktok-events.js / tiktok-event-contract.js # CAPI e contrato Purchase/event_id
├── pixel-store.js / link-store.js / gateway-store.js  # CRUD dos recursos
├── conversion-normalize.js # normalização de payloads de gateway (puro, testável)
├── domain-provider.js     # Custom Domains na hospedagem via API (Railway; token só aqui)
├── presence.js / pulse-client.js   # visitantes ao vivo
├���─ pushcut.js             # notificações push
├── *-view.js              # views legadas (HTML como string): dashboard, lp, legal, tracker, vision, auth
├── start.js               # start de produção: sobe Next (3001) + Express ($PORT) no mesmo serviço (§19)
├── dashboard/             # NOVA dashboard Next.js 16 + TypeScript + Tailwind v4 (§19)
│   ├── app/               #   rotas App Router sob basePath /dashboard
│   ├── components/        #   componentes por página (shell/, overview/, live/, geo/, funnel/, �����)
│   ├── lib/               #   api.ts (SWR), types.ts, navigation.ts, format.ts, metrics.ts
│   ├── proxy.ts           #   guard de sessão (cookie dash_session do Express)
│   └── next.config.mjs    #   basePath /dashboard + rewrites /api → Express
├── docs/                  # documentação: HANDOFF-NOVA-IA.md e PLANO-REFINAMENTO-VISUAL.md
├── assets/                # estáticos servidos em /assets/*
├── pixels/                # assets do pixel do navegador
├── data/                  # cache local em JSON (IGNORADO no git; não é fonte de verdade)
���── package.json / railway.json  # deps e config de deploy Railway
└── AGENTS.md / README.md  # este mapa e o readme
```
Nos módulos do Express não há subpastas: todo `.js` vive na raiz, um arquivo por responsabilidade.
A única subárvore de código é `dashboard/` (app Next independente, com `package.json` próprio).

## 16. Ciclo de vida do lead
Um lead avança por **stages** (etapa no funil) e carrega um **status** (resultado do disparo CAPI):
- **stage:** `visit` (pageview registrada) → `checkout` (chegou/entrou no checkout, `InitiateCheckout`)
  → `purchased` (compra confirmada via webhook; interna `CompletePayment`, externa `Purchase`).
- **status (do disparo/conversão):** `pending` (em processamento) · `converted` (evento aceito pelo
  TikTok) · `dedup` (ignorado por dedup — `event_id` repetido) · `erro` (falha no envio à CAPI).
- Identidade: cookie `v_id` (visitante, 90 dias). O middleware conta 1 lead por visitante e ignora bots (`ua.js`).
- `orphan`: lead de conversão sem visita prévia casada (chegou webhook mas não há sessão/visita ligada).

## 17. Formato dos eventos de tracking
- **Tipos de evento CAPI usados:** `ViewContent` (pageview/visita), `InitiateCheckout` (entrada no
  checkout, disparado no `/go/:slug` após os gates) e `Purchase` (compra, via webhook de gateway;
  `CompletePayment` existe apenas como nome interno/legado).
- **Ingestão navegador → servidor:** `/t.js` (tracker) chama `POST /api/track`; o pixel do navegador
  (`/px.js`) chama `POST /api/px/event`. Ambos casam com o disparo server-side pelo mesmo `event_id`.
- **event_id:** navegação recebe ID único compartilhado pelos dois scripts; compra usa
  `Purchase.<order_id normalizado>`. **Nunca** alterar esses formatos sem migrar navegador e servidor juntos.
- **Conversão (compra):** chega por `POST /hook/:token` (por gateway) ou `POST /api/conversion`
  (webhook universal, validado por `CONVERSION_WEBHOOK_SECRET`), marca o lead como `purchased` e
  normaliza internamente como `CompletePayment` e dispara `Purchase` na CAPI com valor/moeda. Webhooks
  de saque/payout com formato financeiro confirmado respondem 200 como `ignorado` e não poluem a
  quarentena nem o status do gateway.

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
  - **Auto-recuperação:** se o dom��nio está em manual (sem `providerId`) e a automação está ligada, tenta
  `register()` de novo — cobre o caso de um slot do Railway ter vagado (upgrade/remoção). Se reconectar,
  grava o `providerId`, devolve `reconectado:true`+`dnsRecords` e o popup re-renderiza com o alvo real.
  - **Status do provedor:** com `providerId`, consulta `domainProvider.status()` antes da checagem local;
  `verified` do Railway ⇒ `dnsOk=true` + `providerVerified:true` na resposta (e `certificateStatus`), e o
  `entry.dns` do config é sincronizado. O CNAME do lojista pode apontar tanto pro `appHost` quanto pro
  alvo gerado pela hospedagem (`entry.dns.cname.target`) — ambos contam como DNS ok.
  `GET /api/domains` também expõe `autoProvision` (=`domain-provider.enabled`); quando `false`, a aba
  Domínios mostra um aviso de que o registro automático está desligado (configurar `RAILWAY_*` uma vez).
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

## 19. Nova dashboard Next.js (`dashboard/`) — reestruturação do front

> **Resumo em uma frase:** a dashboard legada (`dashboard-view.js`, string HTML de ~5200 linhas)
> foi **reescrita como app Next.js 16 + React 19 + TypeScript + Tailwind v4** em `dashboard/`,
> servida por **proxy reverso** no mesmo domínio em `/dashboard`. O Express continua dono de
> **todas** as APIs, da auth e do funil público — o Next é só a camada de apresentação.
> Documento de handoff completo (para IAs sem contexto): `docs/HANDOFF-NOVA-IA.md`.

### 19.1 Arquitetura (um domínio, dois processos)
- **Produção (`npm start` → `start.js`):** sobe o Next (`next start -p 3001`, interno) e o Express
  (`$PORT`, público) no mesmo serviço Railway. O Express faz proxy reverso de `/dashboard/*` para
  `localhost:3001` (`proxyToNextDashboard` em `server.js`, com `pageAuth` antes). Se o Next morrer,
  o serviço encerra (exit propagado).
- **Mesmo domínio = zero CORS:** cookie de sessão (`dash_session`), `/api/*` e assets funcionam
  sem configuração extra, porque o navegador nunca sai do host do Express.
- **basePath `/dashboard`** no `next.config.mjs`; `allowedDevOrigins` liberam o acesso via proxy
  em dev (sem isso a hidratação falha silenciosamente e a página fica presa nos skeletons).
- **Rewrites do Next (só relevantes em dev):** `/api/*`, `/assets/*` e `/logout` → Express
  (`EXPRESS_API_URL`, padrão `http://localhost:3000`).
- **Auth em duas camadas:** `dashboard/proxy.ts` (proxy do Next) só checa a **presença** do cookie
  `dash_session` e redireciona ao `/login` do Express se faltar; a validação real é do Express em
  cada chamada de API (401 → `lib/api.ts` redireciona ao login).
- **Rollback:** a dashboard legada continua acessível em `/dashboard?legacy=1` (o proxy detecta
  `legacy=1` e serve o `DASHBOARD_HTML` antigo). Não apagar `dashboard-view.js`.

### 19.2 Stack e dados
- Next.js 16.2.11 (App Router, `experimental.viewTransition`), React 19, TypeScript, Tailwind v4
  (`@import 'tailwindcss'` + tokens em `@theme`/`:root` no `globals.css`), lucide-react (ícones),
  Recharts (gráficos), `globe.gl` (globo 3D), SWR (dados).
  O override `sharp=0.35.3` corrige a versão opcional vulnerável herdada do Next; validar com
  `npm --prefix dashboard audit --omit=dev` e `npm run build` ao atualizar o framework.
- **Todos os dados vêm dos endpoints `/api/*` do Express** (§5.2) via hooks SWR em `lib/api.ts`
  (`useStats`, `useLive`, `useLinks`, `usePixels`, `useGateways`, `useCloakConfig`, etc.), com
  `credentials:'include'` e polling. **Não criar API routes no Next** — API nova nasce no Express.
- `lib/types.ts` espelha os shapes JSON do Express; `lib/metrics.ts` deriva KPIs/funil/série do
  `/api/stats`; `lib/format.ts` formata moeda/número/data em pt-BR (moeda multi com padrão BRL);
`lib/navigation.ts` é a fonte
  única do menu (seções Métricas/Gestão/Sistema) usada por sidebar, mobile-nav e subnav.

### 19.3 Páginas (App Router, grupo `(dashboard)`)
`/` Visão Geral (KPIs + gráfico de receita + saúde) · `/live` Ao Vivo (feed tempo real + presença) ·
`/geo` Geografia (globo 3D) · `/funnel` Funil (etapas + tabela de leads) · `/activity` Atividade
(log de conversões/pixels/cloaker) · `/links` Links de Checkout · `/cloak` Filtro de Bots ·
`/domains` Domínios · `/pixels` Pixel TikTok (saúde + EMQ) · `/gateways` Gateways · `/config`
Configurações. Cada página é um `page.tsx` fino que renderiza a view de `components/<área>/`.
`/ads/tiktok` tem somente três áreas de trabalho: **Campanhas, Catálogo e Automações**. Há um único
launcher “Criar campanha” (Conversão ABO/CBO, Smart+, vídeos em massa e Spark). A área Campanhas
mostra apenas contexto, quatro KPIs acionáveis, busca/status e lista; exemplos fictícios de copiloto,
Mapa Mental, resumo duplicado e simulador de orçamento foram removidos. Gasto, ROAS e conversões usam
colunas fixas e cada linha mantém status e ações visíveis; detalhes só aparecem ao expandir. Os antigos
painéis Today/Smart+ e cards de copiloto/proposta/insights/MCP foram removidos por duplicarem controles.
Pixel e evento não aparecem nos formulários: o banner `PixelBindingCard` só é exibido enquanto o
vínculo central do advertiser estiver pendente. Em Catálogo, conexão verificada, feed e históricos
técnicos ficam recolhidos; a lista prioriza nome, quantidade e estado acionável. Em Automações,
`RejectionInbox` mostra no máximo cinco grupos reprovados antes de “Ver mais”, permite recurso manual
Smart+ com `ConfirmDialog` e liga/desliga o recurso automático no mesmo controle de autonomia; o badge
da aba soma incidentes abertos sem multiplicar notificações por anúncio. A faixa compacta da aba usa o
estado real do motor (`idle|starting|running|paused|degraded|blocked`) e explica somente a condição
acionável — motor parado, sync atrasado, conta sem acesso, modo teste ou pausa de segurança. Ela não
mostra revisão/ID no fluxo normal, atualiza a cada 60s e nunca transforma falha de fetch em estado vazio.
“Agir sozinho” só pode ser ativado com a proteção ligada, o advertiser desbloqueado e ao menos uma
ação/hora no anti-loop; o aviso abre diretamente os controles necessários.

### 19.4 Identidade visual ("Glitch TikTok", capturada 1:1 do legado)
- **Tokens no `dashboard/app/globals.css`** (fonte de verdade do tema — nunca cor hardcoded):
  fundo preto neutro `#08080a` (nunca azul), ciano neon `#25f4ee` (interação/links/ativo), rosa
  `#fe2c55` (ao vivo/atenção/perigo), verde `#22c55e` (**só dinheiro/sucesso**), dourado `#fbbf24`
  (avisos/checkout), texto `#f4f4f5`/`#a1a1aa`. Degradê ciano→rosa (`--brand-grad`) é **reservado**
  a: logo, card-herói de Receita e anel do globo.
- **Linguagem visual:** glassmorphism escuro (cards translúcidos com `backdrop-blur` e borda 8–12%
  branco), orbes de aurora derivando ao fundo, grelha de pontos sutil, hairlines com gradiente,
  labels mono uppercase 11px, números tabulares, KPIs em grelha 4→2→1.
- **Layout:** sidebar fixa à esquerda (logo neon + seções MÉTRICAS/GESTÃO/SISTEMA + indicador
  ativo ciano-rosa) — substituiu as pills do topo; header com título da página, data e badge
  "Ao vivo"; conteúdo em `main` com container central. Mobile: `mobile-nav.tsx` (menu deslizante).
- **Globo 3D** (`components/geo/globe.tsx`): textura blue-marble local (`/assets/`), polígonos de
  países (`countries.geojson`), pontos de tráfego, controles de zoom e modal fullscreen. O movimento é
  deliberadamente discreto (máx. 3 anéis, 3 arcos e 2 rótulos), respeita `prefers-reduced-motion` e
  não usa estrelas decorativas; a entrada curta só roda uma vez por sessão.
- **Notificações:** `NotificationBell` mostra no máximo 8 itens, diferencia prioridade crítica sem
  multiplicar alertas e sincroniza o visto entre os sinos de desktop/mobile. Eventos de automação TikTok
  devem apontar para `/dashboard/ads/tiktok?tab=automation` (o cliente ainda aceita o alias legado `view`).
- **Plano de refinamento pendente:** `docs/PLANO-REFINAMENTO-VISUAL.md` — 206 alterações numeradas
em 28 blocos (A–AB) com ordem de execução em 12 fases. **Executar na ordem** (coerência primeiro).
- **Plano ativo (570 modificações):** `PLANO-PRAGMATIC-FLOW.md` (raiz; antes `v0_plans/pragmatic-flow.md`,
movido porque `v0_plans/` é diretório reservado do ambiente v0) — 7 levas cobrindo backend, as
5 sub-abas da Gestão, shell, lado público e camadas transversais. **Progresso rastreado item a item
em `PROGRESSO-PLANO.md` (raiz)** — atualizar esse arquivo a CADA item concluído, com evidência.
**Leva 1 (backend, itens 1–10) 100% concluída. Itens 241–252 (durabilidade de schema) 100%
concluídos (antecipados):** tabela `custom_domains`, coluna `accounts.currency`, snapshot Redis
`domains:all`, write-through assíncrono via `config.set` e reconciliação no boot (§8/§10).
Aba Domínios (itens 120–130): card "Verificado e ativo desde DD/MM" + "reconectado", copiar bloco
DNS completo (CNAME+TXT), dica de TTL, aviso automático de apex (CNAME em raiz), checagem
instantânea de propagação via DoH da Cloudflare direto do navegador, falha de rede vira estado
próprio com retry (`networkError`), diagnóstico dirigido (DNS pendente reabre tutorial; DNS ok +
HTTPS pendente explica certificado automático), atalho "Usar em um link" (→ editor com domínio
pré-selecionado via `?novo=1&dominio=`) e estado vazio guiado. **Aba Cloak (itens 133–141,
LEVA 3 COMPLETA):** teste por entry (`POST /api/cloak/test` com `slug` → simula o julgamento do
`/c/:slug` e reporta gates pré-score mobile/ad-click/país/idioma), stats offer/white inline por
link, badge de sensibilidade+threshold no card, liga/desliga inline + ações em lote, preview da
white page em nova aba, explicação do threshold (mapa sensibilidade→número) e aviso de domínio não
verificado no editor. Entregues (faixa 31–140 COMPLETA): moeda por conta+UI, uso por
domínio, idempotência de webhook, edição/teste/rotação de gateways, EMQ trend + filtro/expansão do
log de pixels, QR local, validação+normalização de pesos A/B, legendas pt-BR do cloaker, tutoriais,
tours guiados das 5 abas (tour.ts + data-tour; decisão de produto: SEM auto-start na primeira
visita — só abrem pelo botão "?" flutuante), copy neutra sem jargão interno, verify-url
anti-SSRF + rate-limit, rate-limit no /hook, snippet base do loader; aba Links (itens 62–66, 68,
69, 71–76): toggle/duplicar/busca+ordenação nos cards, receita+taxa de conversão, barra de
performance por variante, badge do pixel (com alerta de pixel inexistente/pausado), validação de
URL https:// no editor, aviso de troca de domínio, exclusão protegida por nome quando há tráfego,
UTM builder no editor, países/idiomas por nome (GeoMultiSelect + presets de mercado + colar lista)
e ações em massa (checkbox por card + barra Ativar/Pausar/Excluir com confirmação em 2 cliques);
item 60: 5ª suíte `test/security.test.js` (anti-SSRF, normHost, dedup de webhook, edição de
gateway, pesos A/B) com helpers extraídos do server.js para `security-helpers.js`; aba Pixels
(itens 83–87, 89, 92–94): QR "Baixar PNG", copiar tag ou só a URL do script (GTM), cópia com
`aria-live`, token mascarado com Revelar/Ocultar + últimos 4 dígitos, avisos de config inócua
(sem eventos ligados; Compra sem gateway), `durability.incomplete` por pixel, duplicar pixel
(sem token, pausado) e hint do Test Event Code; item 59: painel "Como funciona a Gestão"
(`components/shell/gestao-help.tsx`, "?" no label da seção no sidebar → TutorialModal com o fluxo
Link → Pixel → Gateway → Domínio → Cloaker); item 54: badge de uso no card de domínio; item 57:
overflow horizontal da aba Gateways em mobile corrigido (grid precisa de `minmax(0,·)` +
`flex-wrap` no cabeçalho — armadilha de `min-width:auto` em grid items); item 58: ritmo vertical
unificado (`gap-5` na raiz das 5 abas). Próxima fila: Leva 4 (141–200) — refinos por aba/microcopy.
Fila e histórico no `PROGRESSO-PLANO.md`. **Dica operacional:** se `/__dev/login` responder 503,
o Express na 3000 subiu antes do env ser espelhado — mate o processo e suba com
`node --env-file-if-exists=.env.development.local server.js`. No sandbox, use
recupere `.env.development.local` no Railway/gerenciador seguro e use
`node --env-file-if-exists=.env.development.local server.js`; o **dev server do Next (Turbopack) pode não hidratar no sandbox** — valide a
dashboard com `next build` + `next start -p 3001`.

### 19.4.1 Primitivos de UX compartilhados (itens 182/183/184/185/187/189 — REUTILIZE, não reinvente)
Ao adicionar feedback, confirmações, modais ou estados de erro numa view, use SEMPRE estes — não
improvise `window.confirm`, `savedAt`/`copied` locais, trap de foco caseiro ou branch de erro solto:
- **`lib/toast.ts` + `components/shell/toaster.tsx`** — toaster global montado 1× no layout. Chame
  `toast.success/error/info(msg, { hint?, duration? })`. `aria-live` (erro=`alert`/assertivo,
  demais=`status`/polido), erro fica 6s. NÃO monte outro `<Toaster>`.
- **`components/confirm-dialog.tsx`** — toda ação destrutiva. Props `open/title/description/
  confirmLabel/confirmText?/busy/onConfirm/onClose`. Passe `confirmText={nome}` quando o item tem
  tráfego → exige digitar o nome (mesma trava do link, item 76). Padrão de uso: estado
  `confirm:{title,description,confirmLabel,confirmText?,run}` + `confirmBusy` (ver gateways-view).
- **`lib/use-modal-a11y.ts`** — `useModalA11y(open, ref, onClose)` dá foco preso, ESC, retorno de
  foco e trava de scroll a QUALQUER popup. O container precisa de `tabIndex={-1}` e `role`
  (`dialog`/`alertdialog`). `GlassCard` encaminha `ref` (ref-as-prop React 19), então serve de
  container. Já usado por `TutorialModal` e `ConfirmDialog`.
- **`lib/use-persisted-state.ts`** — `usePersistedState(key, default)` (item 185): drop-in de
  `useState` que espelha PREFERÊNCIAS DE EXIBIÇÃO (filtro, ordenação, aba) em `localStorage`
  (prefixo `roi:ui:`). SSR-safe. NUNCA para dados de negócio — só UI. Busca textual fica em
  `useState` normal (por sessão).
- **`LIST_POLL_MS` (30s) em `lib/api.ts`** (item 187) — hooks de LISTA de gestão
  (`useLinks/useDomains/usePixels/useGateways/useCloakEntries`) usam esse intervalo + `revalidateOnFocus`.
  NÃO use o `POLL_MS` (12s) das métricas para listas.
- **`components/error-state.tsx`** — `ErrorState` (item 182): falha de fetch de uma aba. Props
  `title?/description?/onRetry?/retrying?`. Padrão: `if (error && !data) return <ErrorState
  title="…" onRetry={() => mutate()} />` ANTES do branch de skeleton — só quando não há cache (com
  dados, deixe o SWR revalidar em silêncio). Já em links/pixels/gateways/domínios. Se a view já tem
  um `error` local (ex.: domains), renomeie o do SWR para `loadError` no destructure.
- **`components/shell/durability-badge.tsx`** — `DurabilityBadge` (item 186), montado no `Header`.
  Lê `/api/health` (`useHealth`) e classifica: banco no ar → OCULTO (não polui; `LiveBadge` cobre a
  saúde geral); banco fora + Redis no ar → âmbar "Persistência degradada"; banco e Redis fora →
  vermelho "Config volátil". É o lugar canônico do estado de durabilidade — NÃO recrie esse alerta
  em views individuais.
Pendente (próxima fatia): migrar links/domínios/cloak entries para `ConfirmDialog`+`toast`.

### 19.5 Armadilhas específicas da dashboard nova
- Acesse SEMPRE via `http://localhost:3000/dashboard` (proxy do Express), não `:3001` direto —
  senão cookie/API quebram. Em dev, use `GET /__dev/login` primeiro (§11.1).
- `globe.gl` importa `three` (~1MB): manter lazy (`next/dynamic`, sem SSR).
- O Express NÃO comprime respostas de `/dashboard` (o Next já comprime) — ver filtro em `server.js`.
- Texto de UI em **pt-BR**; **multi-moeda com padrão BRL** (R$) e seletor de exibição
  (BRL/USD/EUR, formatação client-side); fuso de **Brasília** (`America/Sao_Paulo`).
- Depois de mudar código do Next em produção: `npm run build` + redeploy (o Railway roda o build).
- `next.config.mjs` fixa `turbopack.root` no diretório `dashboard/` — sem isso o Turbopack pode
  inferir a raiz do monorepo (onde vive o Express) e o build falha por não resolver o pacote `next`.

## 20. Central mágica e automações avançadas (2026-09-04)

- **Autocura e agenda condicional:** `ads-automation.js` aceita `self_heal` e `scheduled_scale`.
  Autocura trabalha somente entre campanhas ativas de mesma moeda/tipo, reduz a doadora antes de
  aumentar a vencedora, mantém o total, respeita teto/cap/lease/circuit breaker/cooldown e tenta
  rollback. O preset `preset_friday_scale` representa sexta às 18h com ROAS >= 2. Regras ficam
  inscritas no worker 24/7 já existente de `ads-sync.js`.
- **Lucro real:** `profit-engine.js` calcula em centavos receita menos estornos/disputas, taxa do
  gateway, impostos, custo de produto e gasto TikTok da mesma janela/moeda. Valores exatos do webhook
  vencem os percentuais configurados; `quality`/`coverage` deixam a estimativa explícita. Rotas:
  `GET /api/ads/profitability` e `GET|PUT /api/ads/profitability/config`.
- **Anomalias a cada 4h:** `ads-ai.js` persiste snapshots cumulativos no briefing `anomaly_4h`, calcula
  deltas determinísticos e usa Anthropic apenas para redigir a frase. Rotas:
  `GET /api/ads/anomalies` e `POST /api/ads/anomalies/run`.
- **Anti-bot automático:** `bot-risk-store.js` usa HMAC do IP, contagem por anúncio, TTL e Redis com
  fallback local. `/c/:slug` bloqueia recorrências de score alto e pode emitir o custom event
  diagnóstico `BotTrafficBlocked`; nunca cria compra/conversão falsa. Rotas de operação:
  `GET /api/cloak/blocks` e `DELETE /api/cloak/blocks/:ipHash`.
- **Catálogo mágico:** `ads-catalog-inspect.js` raspa JSON-LD e coleções Shopify com DNS anti-SSRF,
  redirects revalidados, limite de corpo e timeout. `POST /api/ads/catalogs/magic-import` cria produtos
  e tenta iniciar o sync; `GET /feed/:token.xml` expõe XML complementar, mas o upload TikTok continua
  usando o CSV canônico. Produtos têm `sort_order` e `PUT /api/ads/catalogs/:id/products/reorder`.
- **Drive/Dropbox:** `cloud-video-sync.js` usa OAuth, cifra tokens AES-256-GCM no Neon, observa pastas,
  limita downloads e envia somente assets de vídeo ao TikTok (rascunho reutilizável, nunca ativa
  campanha). Exige `INTEGRATION_TOKEN_KEY`, origem HTTPS pública e credenciais do provedor; rotas em
  `/api/ads/cloud-video/*` e callback `/api/integrations/videos/:provider/callback`.
- **Relatório diário:** o worker do `server.js` verifica a cada 5 minutos e envia às 08h no fuso da
  conta por Pushcut, Web Push e/ou template aprovado do WhatsApp Cloud API. Inclui gasto, vendas,
  ROAS e lucro; só marca entrega após confirmação de algum canal.
- **Fila e testes A/B:** `ads-bulk.js` pausa toda a fila por 5 minutos ao reconhecer rate limit,
  persiste o prazo e reencaminha o item. `ab-predictor.js` usa posterior Beta-Binomial aproximada;
  `link-store.js` encerra somente com volume, confiança e vantagem mínimos, zerando o peso da perdedora.
- **Dashboard Next:** Cmd+K executa somente comandos em whitelist; tabela tem orçamento inline,
  slider, preview de vídeo em hover e filtros naturais; drawer mostra timeline; criação usa Zen Mode;
  catálogo aceita drag-and-drop; `MagicOpsPanel` é uma central Lego persistida. Som/vibração respeitam
  `roi_action_feedback`. As configurações mostram relatório e bloqueio automático.
- **Teste transversal:** `test/magic-features.test.js` cobre lucro, A/B, autocura sem aumento do total,
  anomalia, XML, bloqueio sem IP bruto e cifragem OAuth. Ele roda no `pretest` antes da suíte completa.
