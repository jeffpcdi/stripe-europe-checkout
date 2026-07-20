# PLANO-VERIFICACAO-ADS — Verificação total + automação + refinamento do TikTok Ads

> Estado em 2026-07-18 (branch `claude/eager-bohr-63bmet`, PR #109). Três partes:
> **A)** o que JÁ foi verificado no sandbox (com evidência), **B)** checklist de
> verificação em PRODUÇÃO (o que só dá para provar com Pipeboard/Neon reais) e
> **C)** roadmap de automação + refinamento. Marcar cada item ao concluir.

---

## 🆕 RUNBOOK DE PRODUÇÃO — pós-PR #113 (redesenho + edição + Smart+)

> Tudo abaixo foi **mesclado no `main`** (PR #113) e passa em suíte/tsc/build/boot
> no sandbox (re-confirmado em 2026-07-18: 32 blocos de teste OK, `next build` OK,
> `/healthz` 200, rotas de escrita 401 sem sessão, deep-links `?tab=` 200,
> `/catalog`→`?tab=catalog` 307). MAS **nenhuma escrita foi exercitada contra o
> TikTok real.** Execute este runbook em produção NA ORDEM.
>
> **Passo 0 (obrigatório):** Automações → Modo avançado → Limites de segurança →
> **Modo teste (dry-run) LIGADO**. A 1ª passada inteira NÃO publica nada; confira
> cada ação na auditoria (Operações) antes de repetir de verdade com Modo teste OFF.

Pré-requisitos: deploy do `main`; `PIPEBOARD_API_KEY`, `DATABASE_URL`,
`BLOB_READ_WRITE_TOKEN` no Railway; ≥1 advertiser conectado (`GET /api/ads/diag`).

- [ ] **1. Conexão/UI** — `/dashboard/ads/tiktok` abre na aba **Hoje**; pontinho
      de conexão verde na barra; as 4 abas trocam e o `?tab=` muda na URL; voltar/
      avançar do navegador respeita a aba; deep-links legados (`?tab=overview|ai|
      smartplus`) caem na aba certa; botão "?" abre o tour (5 passos).
- [ ] **2. Hoje** — inbox "Precisa de você" lista propostas (se houver); KPIs,
      ROAS real e briefing carregam; OperationsCenter (metas/anomalias/timeline/
      relatórios) renderiza; atalhos de criação abrem os diálogos.
- [ ] **3. Editar anúncio sem recriar** — lápis num anúncio → alterar texto/CTA/
      link → Salvar. Modo teste: toast "Modo teste" + auditoria `entity_update`
      com `applied.creative`. Depois REAL: no Ads Manager, texto/CTA/link mudaram
      SEM recriar o anúncio (mesmo ad_id).
- [ ] **4. ABO/CBO + lance** — criar campanha com **CBO** + **custo-alvo** (teste →
      real com orçamento mínimo): no Ads Manager, orçamento no nível CAMPANHA (CBO)
      e lance custom (conversion_bid_price/bid_price) aplicados.
- [ ] **5. Filtro Validadas** — aba Campanhas → chip "Validadas" mostra só
      `reviewStatus=approved`; selo verde "Validada" nas aprovadas.
- [ ] **6. Smart+** — segmento "Smart+" lista campanhas; pausar/ativar reflete no
      Ads Manager; **criar Smart+** (teste → real, nasce PAUSADA; se falhar num
      passo, resposta traz `step`+`createdIds` e a campanha parcial fica pausada);
      **recorrer** de um anúncio reprovado (se existir). ⚠️ "permission required"
      = conta não liberada p/ Smart+ (não é bug).
- [ ] **7. Pilotos + autonomia (+ Smart+)** — ligar "Protetor de orçamento"
      (normal); no Modo avançado, confirmar regras tagueadas `pilot`; alternar
      autonomia (Só avisar / Propor / Agir sozinho) e ver o `mode` das regras
      mudar; "Testar agora" gera log; regra em Propor + Modo teste OFF → proposta
      aparece no inbox do Hoje; aprovar com Modo teste ON responde aviso de
      simulação; **ativar 3 pilotos não passa de 10 regras** (consumo de presets).
      **Cobertura Smart+ (C1):** com uma campanha Smart+ gastando sem retorno, a
      regra de pausa deve **pausar a campanha Smart+** (log/auditoria mostra
      "campanha Smart+ pausada"); regras de **orçamento/escala** em Smart+ são
      **puladas** com o motivo "Smart+ não permite ajuste de orçamento via API".
      ⚠️ requer que o TikTok reporte métricas de Smart+ no nível de campanha.
- [ ] **8. Vigilância + auto-recurso Smart+ (C3)** — "avisar reprovação" ligado +
      um anúncio Smart+ reprovado real → aguardar a varredura (≤30min) → push/log
      "Smart+ … REPROVADO"; cooldown 6h. **Auto-recurso:** ligar "Recorrer sozinho
      1×"; com Modo teste ON, a auditoria mostra `smart_plus_appeal.simulated` (não
      envia); com Modo teste OFF, o robô envia o recurso 1× e **não repete por 7
      dias** (cooldown por anúncio); **Pausar tudo** bloqueia o auto-recurso.
- [ ] **9. Catálogo** — configurar Business Center → criar catálogo (tipo/país/
      moeda) → +1 produto válido → **Publicar no TikTok** → conferir
      `tiktok_catalog_id` + auditoria (aprovados/pendentes) no Catalog Manager;
      "Atualizar status" reconsulta. **SEM Vercel Blob:** o feed é servido pelo
      próprio app em `https://<PRIMARY_HOST>/feed/<token>.csv` (gerado do Neon).
      Pré-requisito: **`PRIMARY_HOST` (ou `RAILWAY_PUBLIC_DOMAIN`) setado** — senão
      publicar responde 503 "Host público não configurado". Confirme abrindo a URL
      do feed no navegador (deve baixar o CSV). Para uploads de vídeo/imagem
      duráveis, anexe um **Volume no Railway** (senão vão para disco efêmero).
- [ ] **9d. Publish direto pode dar 502 — CSV é o fallback garantido.** A chamada
      real ao TikTok (`create_tiktok_catalog`/`upload_tiktok_catalog_products`)
      depende de **BC autorizado + permissão de catálogo + timeout do proxy**. Se
      der 502, a razão real fica no **feed de Operações** (`[catálogo] Falha ao
      publicar…`). O caminho garantido é **"Baixar CSV pronto para o TikTok"** (só
      produtos válidos, formato oficial) → Catalog Manager → importar por arquivo →
      criar campanha **Product Sales (conversão)**. O painel "Subir no TikTok Ads
      (manual)" traz o passo a passo + o download em destaque; na falha do publish
      automático, o bloco de fallback aparece sozinho.
- [ ] **9b. Campanha de catálogo (DPA) — NOVO** — com o catálogo sincronizado,
      botão **"Criar campanha deste catálogo"** → nome/orçamento/país/ABO-CBO →
      Modo teste: toast "Modo teste" + auditoria `catalog_campaign.simulated`
      (nada criado). REAL: nasce **PAUSADA**; conferir no Ads Manager campanha
      `PRODUCT_SALES` com fonte = catálogo (todos os produtos). ⚠️ se a API
      recusar um campo de catálogo, a resposta traz `step`/motivo e o parcial
      fica pausado (nada órfão ativo).
- [ ] **9c. Direcionamento na criação — NOVO** — no criador de campanha, passo
      Público: **gênero** (Todos/Homens/Mulheres), **posicionamento** (Automático
      × escolher TikTok/Pangle) e **interesses** (busca → chips). Criar (Modo
      teste ok) e conferir no Ads Manager que o grupo saiu com gênero/interesses/
      posicionamento aplicados (antes só saía no automático).
- [ ] **10. Guardrails** — **Pausar tudo** (kill switch) ON → qualquer escrita
      responde 423; cap de ações/hora barra o motor após N ações reais; reverter
      uma ação real do motor pela auditoria (Operações).

**Limites conhecidos (não são bugs):** Smart+ é **pausado** por regra/dayparting,
mas **não escalado** (o Pipeboard não expõe tool de orçamento de Smart+); a pausa
por métrica depende de o TikTok reportar métricas de Smart+ no nível de campanha
(se não vierem, o nó fica sem métrica e a regra não dispara — inócuo); recurso de
CONTA suspensa não tem API (semiautomático: ticket + formulário); pagamento/
faturamento só no TikTok.

---

## A. Verificado no sandbox (evidência colhida em 18/07/2026)

- [x] Suíte completa: 16 suítes verdes (`npm test`), incluindo as novas
      `ads-budget-plan`, `ads-review-filter`, `ads-smart-plus`,
      `ads-automation-cpc`, `ads-catalog-tiktok`.
- [x] Boot do Express sem crash; degrada com elegância sem Neon/Redis
      (`/api/status` responde `{ok:false, db:false, hint:…}`).
- [x] Rotas novas registradas e AUTENTICADAS (401 sem sessão):
      `/api/ads/smart-plus[/ads|/:id/status|/ads/:id/appeal]`,
      `/api/ads/catalogs/business-center`, `/api/ads/catalogs/:id/sync-tiktok|/audit`.
- [x] Fail-safes públicos: `/_safe` 200 · `/go/:slug` inexistente → 404 amigável ·
      `/healthz` ok.
- [x] `next build` verde; `/dashboard/catalog` → **307** para
      `/dashboard/ads/tiktok?tab=catalog` (provado com `next start` real).
- [x] Guardrails cobertos por teste: kill switch e dry-run em TODAS as escritas
      novas (Smart+ status/appeal/criação, sync de catálogo); pisos de volume
      no `cpc_max`; teto obrigatório no `roas_scale`.

## B. Checklist de verificação em PRODUÇÃO (Railway + Pipeboard + Neon reais)

Pré-requisito: deploy do branch, `PIPEBOARD_API_KEY` válida, `DATABASE_URL`,
`BLOB_READ_WRITE_TOKEN`. Fazer NA ORDEM — cada passo cobre o seguinte.
**Dica:** ligar *modo simulação* (Operações → dry-run) antes dos testes de
escrita; a 1ª rodada inteira pode ser validada sem tocar o TikTok.

1. **Conexão** — `/api/ads/diag`: 74+ tools e ≥1 advertiser. `GET /api/ads/status`
   → `connected:true`.
2. **Leitura** — aba Campanhas carrega a árvore; filtro **Validadas** mostra só
   `reviewStatus=approved`; selo verde "Validada" visível nas aprovadas.
3. **ABO/CBO/lance (dry-run primeiro)** — criar campanha com CBO + custo-alvo:
   conferir na auditoria o payload simulado (`budget_optimize_on:true`, orçamento
   na campanha, `conversion_bid_price`). Depois repetir REAL com orçamento mínimo
   e conferir no Ads Manager: orçamento no nível campanha (CBO) e lance custom.
4. **Smart+ leitura** — aba Smart+ lista campanhas existentes (se houver);
   pausar/ativar uma e conferir reflexo no Ads Manager.
5. **Smart+ criação (dry-run → real)** — criar com objetivo Tráfego e orçamento
   pequeno. Real: nasce PAUSADA; se falhar num passo, a resposta traz
   `step` + `createdIds` e a campanha parcial fica pausada. ⚠️ Elegibilidade
   Smart+ varia por conta ("permission required" = conta não allow-listada;
   não é bug).
6. **Appeal de anúncio Smart+** — só com um anúncio reprovado real: recorrer
   pela aba e conferir o status de recurso no Ads Manager.
7. **Catálogo ponta a ponta** — configurar Business Center ID → criar catálogo
   (tipo/país/moeda) → adicionar 1 produto válido → **Publicar no TikTok** →
   conferir `tiktok_catalog_id` no Catalog Manager + auditoria
   (aprovados/pendentes) atualizando via "Atualizar status".
8. **Automação `cpc_max`** — ativar o preset "CPC alto" em modo proposta com
   teto artificialmente baixo (ex.: 0.01) numa conta com tráfego; esperar o
   sweep (≤30min): deve gerar PROPOSTA (não ação) com detail "CPC X > teto".
   Depois restaurar o teto real.
9. **Alerta de criativo reprovado** — com `rejectedAds` ligado e uma campanha
   reprovada na conta: esperar sweep → Pushcut "teve anúncio REPROVADO".
   Cooldown de 6h: não repete no próximo sweep.
10. **Rollback e guardrails** — reverter uma ação real do motor pela auditoria;
    ligar kill switch e confirmar 423 em qualquer escrita (inclusive Smart+).

## C. Roadmap — automação + refinamento (próximas levas, em ordem)

**C1. Automação sobre Smart+** — ✅ **ENTREGUE.** O `ads-sync` mescla as
campanhas Smart+ no espelho (`campaignKind:'smart_plus'`) e o motor pausa Smart+
que estoura CPA/gasto/ROAS (regras + dayparting) via `setSmartPlusCampaignStatus`;
orçamento/escala é pulado com motivo (o Pipeboard não tem tool de orçamento de
Smart+). Cobertura: `test/ads-smart-plus-automation.test.js`.

**C2. Resumo semanal via Pushcut** — carona no briefing diário (`ads-ai`):
domingo à noite, agregado da semana (gasto, ROAS, top 3 campanhas, propostas
pendentes). Barato: leituras 100% do espelho. *(Fora do escopo atual a pedido.)*

**C3. Auto-appeal opcional de Smart+ reprovado** — ✅ **ENTREGUE.** Opção opt-in
`autoAppealSmartPlus` nos alertas: reprovou → recorre sozinho 1× (cooldown 7d por
anúncio) + notificação, respeitando kill switch e Modo teste. Cobertura no mesmo
suíte de C1.

**C4. Variações A/B na criação Smart+** — mesmo padrão do criar clássico
(vídeos extras → N campanhas com sufixo A/B/C).

**C5. Refinos de UI** — (a) contagem de reprovados como badge na sub-aba
Smart+; (b) linha de auditoria do catálogo com link direto pro produto
reprovado no Catalog Manager; (c) `?tab=` refletido na URL ao trocar de
sub-aba (hoje só é lido no mount).

**Limite conhecido (não é pendência):** appeal de CONTA suspensa não tem API —
segue semi-automático (ticket + texto pronto + formulário oficial).
