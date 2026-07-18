# PLANO-VERIFICACAO-ADS — Verificação total + automação + refinamento do TikTok Ads

> Estado em 2026-07-18 (branch `claude/eager-bohr-63bmet`, PR #109). Três partes:
> **A)** o que JÁ foi verificado no sandbox (com evidência), **B)** checklist de
> verificação em PRODUÇÃO (o que só dá para provar com Pipeboard/Neon reais) e
> **C)** roadmap de automação + refinamento. Marcar cada item ao concluir.

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

**C1. Automação sobre Smart+** *(maior lacuna atual)* — o motor de regras/
dayparting varre só campanhas regulares (espelho `ads-cache`). Incluir Smart+:
sync do `get_tiktok_smart_plus_campaigns` no espelho + `setSmartPlusCampaignStatus`
como ação de pause/dayparting. Sem isso, regras não protegem gasto Smart+.

**C2. Resumo semanal via Pushcut** — carona no briefing diário (`ads-ai`):
domingo à noite, agregado da semana (gasto, ROAS, top 3 campanhas, propostas
pendentes). Barato: leituras 100% do espelho.

**C3. Auto-appeal opcional de Smart+ reprovado** — regra opt-in: reprovou →
recorre sozinho 1× (cooldown 7d por anúncio) + notificação. A tool já existe
(`appeal_tiktok_smart_plus_ad`); é ligar ao sweep de alertas.

**C4. Variações A/B na criação Smart+** — mesmo padrão do criar clássico
(vídeos extras → N campanhas com sufixo A/B/C).

**C5. Refinos de UI** — (a) contagem de reprovados como badge na sub-aba
Smart+; (b) linha de auditoria do catálogo com link direto pro produto
reprovado no Catalog Manager; (c) `?tab=` refletido na URL ao trocar de
sub-aba (hoje só é lido no mount).

**Limite conhecido (não é pendência):** appeal de CONTA suspensa não tem API —
segue semi-automático (ticket + texto pronto + formulário oficial).
