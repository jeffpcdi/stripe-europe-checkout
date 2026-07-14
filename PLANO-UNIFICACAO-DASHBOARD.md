# Plano — Unificação Visão Geral + Funil + Atividade (com globo central)

> Investigação baseada em leitura do código real. Onde não foi possível determinar algo sem rodar a aplicação, está marcado como **não determinável estaticamente** com o passo de verificação.

---

## Parte A — Respostas da investigação

### 1. Estado atual das três abas

| Aba | Rota | View | Hooks de rede (polling) |
|---|---|---|---|
| Visão Geral | `/` (`app/(dashboard)/page.tsx`) | `overview/overview-view.tsx` | `useStats` → `/api/stats` (12s) · `HeroGlobe`→`useLive` → `/api/live` (5s) · `HealthCard`→`useHealth` → `/api/health` (30s) + `useEmqTrend` → `/api/pixels/emq-trend` (60s) · `GoalCard`→`/api/settings` (sem poll) + `useStats` (dedup) · `AdsOverviewCard`→`useAdsStatus` `/api/ads/status` (sem poll) + `useAdsRoas` `/api/ads/roas` (60s, só se conectado) |
| Funil | `/funnel` | `funnel/funnel-view.tsx` + `leads-table.tsx` + `lead-drawer.tsx` | **Só** `useStats` (12s, dedupado). `useLead` no drawer é condicional (null = inativo) |
| Atividade | `/activity` | `activity/activity-view.tsx` | **Só** `useStats` (12s, dedupado). `apiSend` apenas em ações do usuário (replay CAPI) |

Backend: `/api/stats` = `stats.js getStats()` (estado em memória, cache 2s por conta); `/api/live` = `presence.js` (memória+Redis); `/api/health` = ping db/redis + filas.

**Fato decisivo:** Funil e Atividade não têm nenhuma chamada de rede própria — tudo deriva client-side (`lib/metrics.ts aggregate()`) do mesmo `/api/stats` que a Visão Geral já busca. O SWR deduplica por chave: unificar as três abas **não adiciona nenhuma request**.

### 2. Custo da unificação

Load da página unificada (= load da Visão Geral atual):
`/api/stats` + `/api/live` + `/api/health` + `/api/pixels/emq-trend` + `/api/settings` + `/api/ads/status` (+ `/api/ads/roas` se Ads conectado) = **6–7 requests simultâneas**.

- A unificação **não piora** (adiciona zero chamadas) e **melhora** o total do app: navegar Funil/Atividade deixará de re-montar views.
- Porém 7 simultâneas ≥ limite de 6 do HTTP/1.1 por origem — mesmo risco de Queueing do incidente dos 12,7s (que foi na aba Ads: comentário em `ads-routes.js:1365`).
- **Proposta (combinação b + c, sem endpoint novo):**
  - (b) Carregamento progressivo: `/api/stats` + `/api/live` imediatos (pintam o hero); `health`, `emq-trend`, `settings`, `ads/status` adiados pós-first-paint (mount atrasado ou `useSWR` com `revalidateOnMount` gatilhado por `requestIdleCallback`). Pico de simultâneas cai para 2.
  - (c) `emq-trend` sai do load da página: com a saúde colapsada num único dot, o EMQ só carrega ao abrir o popover de saúde (hook condicional, padrão já usado em `useLead`/`useCloakDecisions`).
  - (a) endpoint agregado fica **descartado** por ora — mais risco (contrato novo) para ganho pequeno depois de b+c.

### 3. O globo

- **Implementação:** `react-globe.gl` (three.js/WebGL) em `components/geo/globe.tsx`, importado por `overview/hero-globe.tsx` via `next/dynamic` `ssr:false`. Único contexto WebGL da app, com `dispose()`/`forceContextLoss()` no unmount.
- **Fonte de dados:** `useLive` → `/api/live` (5s) → `summary.countries` (país, count). O `purchased` é zerado no HeroGlobe (`purchased: 0`).
- **rAF contínuo?** Sim, o loop é interno do three-globe, **mas** já pausa em `document.hidden` (`pauseAnimation()`, `visibilitychange`) **e** quando sai do viewport (IntersectionObserver, threshold 0.05).
- **Re-render React por frame?** Não. O rAF é interno ao three.js; o React só re-renderiza a cada poll de 5s, e `buildPoints` é memoizado (`useMemo [countries, metric]`).
- **Custo CPU/GPU:** já mitigado com `pixelRatio` cap 1.5. Valor exato é **não determinável estaticamente** — medir com Chrome DevTools → Performance (gravação de 20s na página) e aba Rendering → Frame Rendering Stats; GPU via `about:gpu` + Task Manager do Chrome (coluna GPU). Skill `agent-browser` pode medir Web Vitals no deploy.
- **Ping por lead novo:** o mecanismo já existe (`ringsData` — anéis nos top-5 países). Para pulso por chegada: diff dos `countries` entre polls do `useLive` (count aumentou → novo lead naquele país) e empurrar um ring temporário (estado local com TTL ~3s). Sem stream/SSE novo — o poll de 5s é o "stream".
- **País → coordenada:** já existe — `dashboard/lib/country-coords.ts` (centroides ISO-3166 alpha-2, ~75 países). Países fora do mapa são silenciosamente omitidos (`if (!coords) return []`).

### 4. Período padrão "Hoje"

- **Onde:** `overview-view.tsx` `initialPeriod()` — precedência `?p=` → `localStorage['roi:overview:period']` → **`'7d'`**. O Funil tem o seu próprio `useState<Period>('7d')` hardcoded (linha 28 de `funnel-view.tsx`); a Atividade usa filtro local "Tudo".
- **Payload:** mudar para "Hoje" reduz o payload em **0 bytes**. O `/api/stats` devolve o dataset integral (até 3.000 eventos + 8.000 leads do cache quente) e TODA a filtragem por período é client-side no `aggregate()`. Reduzir payload de verdade exigiria parâmetro `?since=` no backend — fora do escopo deste redesign.
- **Quebras com "Hoje":** `bestWeekday` exige `series.length >= 14` → some (já é condicional, sem crash); `RevenueChart` com 1 ponto único (degrada, não quebra); deltas vs período anterior comparam hoje vs ontem (ok); benchmark 30d do funil continua (agrega 30d client-side independente do período). Atenção: usuários com período salvo no localStorage manterão a escolha antiga — decidir se o novo default limpa a chave ou só muda o fallback.

### 5. Retenção de dados

- **Modelo atual:** híbrido em 3 camadas — memória quente (caps: 3.000 eventos / 8.000 leads), snapshot JSON em disco (debounce 1s, fallback), e **Neon** como fonte durável (`db.insertEvent`/`upsertLead` write-through). Tabela `events(id, type, at, data jsonb, account_id)`.
- **Limpeza JÁ EXISTE:** `checkEventArchive()` em `server.js:1556` roda "pegando carona no tráfego" (máx. 1x/h, sem cron), movendo eventos > `EVENT_RETENTION_DAYS` (default **90 dias**, env-configurável) para `events_archive` em lotes de 2.000. Não apaga: **move** (histórico preservado).
- **Com 1.196 registros**, nada está em risco hoje (bem abaixo do cap de 3.000 e da janela de 90d).
- **Proposta pedida (agregação diária + purga):** criar `events_daily(day, account_id, campaign, country, sales, revenue_cents, failed, visits)` populada no mesmo sweep horário. A "purga do bruto após 90 dias" já é efetivamente o arquivamento existente — recomendo **manter o move para archive** (purga real destruiria o replay CAPI e a auditoria do webhook, `e.raw`).
- **Queries que quebrariam com purga real:** nenhuma query SQL de leitura do dashboard — `getStats()` lê da memória. Quebrariam: restauração do estado após restart (memória hidrata do Neon), permalink `?e=<id>` de eventos antigos, replay de conversão por `orderId` antigo, e o período "all" já é silenciosamente truncado no cap de 3.000 da memória (limitação pré-existente, vale documentar na UI).

### 6. Os dois bugs (investigados)

**6a. UTM `__CAMPAIGN_NAME__|__CAMPAIGN_ID__` literal**
- Nosso código injeta apenas `utm_campaign=__CAMPAIGN_ID__` e só quando ausente (`ads-routes.js:62`). O formato com `__CAMPAIGN_NAME__|` + pipe **não existe no nosso código** → foi configurado manualmente no TikTok Ads Manager (campo de URL/UTM do anúncio) ou em ferramenta externa.
- A macro é substituída **pelo TikTok na entrega real do anúncio**. Cliques de preview/teste do Ads Manager, bots e acessos diretos chegam com o literal — e nosso parsing (`server.js:406/1043/1357` lê `q.utm_campaign` cru, `tracker-view.js:55` idem) **não sanitiza** macros não substituídas. Os 2 leads são quase certamente cliques de preview.
- **Correção dupla:** (i) sanitizar padrões `/__[A-Z_]+__/` na ingestão (`/api/track` nos 3 pontos do server.js) gravando `utm.campaign = null` + flag `utmRaw` para auditoria; (ii) defesa no display: `rankBy` em `metrics.ts` ignora nomes que casem com o padrão de macro. Dados históricos: os 2 leads existentes continuam com o literal no Neon — corrigir via normalização na leitura (ii) já resolve a exibição.

**6b. Funil "0 compraram" vs "R$ 9,90 em receita" vs "1 venda" vs "R$ 0,00"**
Duas causas mecânicas independentes, ambas confirmadas no código:
1. **Órfãos (explica "0 compraram" + "R$9,90" no MESMO card):** `aggregate()` (`metrics.ts:82`) filtra `!l.orphan` dos leads — venda cujo webhook não casou com lead rastreado (sem leadId/e-mail/telefone match, ver `matchExternalConversion` em `stats.js:386`) cria lead `orphan:true`, excluído de "Compraram". Mas a **receita** vem de `events type:'sale'`, que **inclui** a venda órfã. Resultado: funil 0 compras, rodapé R$ 9,90. A Atividade mostra "1 venda" porque lê os `events` direto.
2. **Períodos independentes (explica "R$ 0,00" na Visão Geral):** a Overview usa período persistido em `localStorage` (pode estar em "Hoje"), o Funil usa `'7d'` local hardcoded, a Atividade default "Tudo". Se a venda foi antes de hoje: Overview R$0,00, Funil (7d) R$9,90, Atividade (tudo) 1 venda.
- **Verificação em runtime:** abrir Atividade → expandir a venda → o feed deve ter um evento info "[atribuição] conversão órfã: …" explicando por que não casou.
- **Correção:** o funil deve exibir compras órfãs como uma fatia distinta (ex.: "1 compra não rastreada") em vez de omiti-las — número bate com a receita sem poluir a taxa de conversão; e a unificação (Fase 3) elimina a divergência de períodos por construção (um único period state).

---

## Parte B — Fases de execução (ordenadas por impacto ÷ risco; bugs primeiro)

### Fase 1 — Bug UTM (sanitização de macros)
- **Arquivos:** `server.js` (3 pontos de parse de UTM), `tracker-view.js` (1), `dashboard/lib/metrics.ts` (`rankBy` ignora `/__[A-Z_]+__/`).
- **Pronto quando:** Top campanhas não exibe mais o literal (defesa de leitura resolve os 2 leads históricos imediatamente); novo hit com `?utm_campaign=__X__` grava campaign null.
- **Risco de regressão:** baixo — sanitização é aditiva; cuidado apenas para não descartar campaigns legítimas que contenham underscore (regex ancorada em `__...__`).
- **Custo:** baixo.

### Fase 2 — Bug do funil (órfãos visíveis + coerência)
- **Arquivos:** `dashboard/lib/metrics.ts` (expõe `orphanPurchases`/`orphanRevenue` no `PeriodMetrics`), `funnel/funnel-view.tsx` (linha "não rastreadas" na etapa Compraram + nota no rodapé de receita).
- **Pronto quando:** com uma venda órfã no período, o funil mostra "0 rastreadas + 1 não rastreada" e o rodapé de R$ bate com a Atividade no mesmo recorte.
- **Risco:** baixo-médio — `PeriodMetrics` é consumido pela Overview/TvMode/Export; adicionar campos é retrocompatível, não alterar os existentes.
- **Custo:** baixo.

### Fase 3 — Unificação das abas + novo layout hero
- **Arquivos:** `overview/overview-view.tsx` (reescrita do layout: header com kicker/saúde-dot/período; hero grid 3 colunas KPI|globo|feed; abaixo funil|top campanhas; rodapé países+EMQ), novos `overview/live-feed.tsx` (últimos 5 leads do `data.leads` — zero request nova) e `overview/funnel-compact.tsx` (extraído da lógica de `funnel-view.tsx`, sem tabela), `health-card.tsx` → `health-dot.tsx` (dot único + popover; `useEmqTrend` passa a condicional ao popover aberto), `shell/sidebar.tsx`+`navigation.ts` (remove entradas Funil/Atividade ou redireciona), `app/(dashboard)/funnel|activity/page.tsx` (redirect para `/?sec=...` OU manter como páginas de detalhe — decisão abaixo).
- **Cortes:** KPIs 8→4 (ficam Receita, Gasto — precisa do `useAdsRoas`, ROAS, Leads); removem-se Vendas aprovadas, Aprovação, Receita líquida, Ticket médio, Conversão; Países ativos + EMQ para o rodapé.
- **Decisão pendente:** a tabela completa de leads (funil) e o feed completo com replay CAPI (atividade) são ferramentas de trabalho — o link "ver todos" do feed hero deve levar a onde? Recomendo manter `/activity` e `/funnel` como páginas de detalhe acessíveis por link, fora da navegação principal.
- **Pronto quando:** página única com globo central; um único `PeriodPicker` governa KPIs+funil+top campanhas; contagem de requests no load ≤ atual (verificar na aba Network); nenhuma view importa componente deletado (`pnpm exec next build` limpo).
- **Risco:** médio-alto — maior superfície; mitigado por reusar `aggregate()` e componentes existentes sem tocar no backend.
- **Custo:** alto.

### Fase 4 — Período padrão "Hoje" + carregamento progressivo
- **Arquivos:** `overview-view.tsx` (fallback `'7d'`→`'today'` no `initialPeriod`; decidir tratamento do localStorage legado), diferimento dos hooks secundários (`settings`, `ads/status`) pós-idle.
- **Pronto quando:** primeira visita abre em "Hoje"; `?p=7d` e localStorage continuam funcionando; waterfall do load mostra ≤2 requests simultâneas no first paint e zero Queueing >100ms.
- **Risco:** baixo — payload não muda (filtragem é client-side); apenas UX de default.
- **Custo:** baixo.

### Fase 5 — Globo: ping por lead novo
- **Arquivos:** `geo/globe.tsx` (aceitar `pulses` externos no `ringsData`), `overview/hero-globe.tsx` (diff de `countries` entre polls → pulsos com TTL; overlay de contagem de leads + nº países na base do globo).
- **Pronto quando:** simular visita (abrir link rastreado) → em ≤5s um anel pulsa no país correspondente; `document.hidden` continua pausando o rAF.
- **Risco:** baixo — aditivo sobre mecanismo existente.
- **Custo:** médio.

### Fase 6 — Agregação diária + documentação de retenção
- **Arquivos:** `db.js` (tabela `events_daily` + upsert no sweep), `server.js` (`checkEventArchive` também agrega), sem mudança de leitura por ora (base para relatórios longos futuros).
- **Pronto quando:** sweep popula `events_daily` idempotentemente (rodar 2x não duplica); `events_archive` continua recebendo o bruto >90d; contagem `events` ≤ janela.
- **Risco:** baixo — escrita nova, nenhuma leitura muda; a "purga" permanece como move para archive (não destrutiva).
- **Custo:** médio.

### Fora do escopo declarado
- Endpoint `/api/stats?since=` (redução real de payload) — só se o dataset crescer.
- SSE/WebSocket para o feed ao vivo — o poll de 5s já sustenta o ping do globo.
