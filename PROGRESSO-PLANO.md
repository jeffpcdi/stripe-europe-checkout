# PROGRESSO — Plano de 570 modificações (pragmatic-flow)

> Fonte do plano: `v0_plans/pragmatic-flow.md` (570 itens em 7 levas).
> Este arquivo é atualizado **a cada item concluído**. Legenda:
> ✅ concluído e verificado · 🔶 parcial · ⬜ pendente
>
> Última atualização: 2026-07-10 (sessão 4)

## Resumo

| Leva | Escopo | Itens | Status |
|------|--------|-------|--------|
| 1 | Backend (moeda, verify-url, uso domínio, hardening, testes) | 1–10 | 10/10 ✅ |
| 2 | UI Gestão (tutoriais, refinos, moeda UI) | 11–30 | ~14/20 |
| 3 | Bugs reais + capacidades órfãs | 31–140 | ~27/110 |
| 4–6 | Refinos por aba, tours, durabilidade | 141–270 | 0/130 |
| 7 | Segurança, relatórios, API pública, perf, a11y, E2E | 271–570 | 0/300 |

**Total concluído: ~51/570** — Leva 1 (backend) 100% concluída

## Itens concluídos (com evidência)

### Leva 1 — Backend
- ✅ 1. Moeda por conta (`GET/POST /api/settings`, fallback BRL) — testado via curl
- ✅ 2. `buildProperties` sem fallback fixo EUR
- ✅ 3. `/api/conversion/test` usa moeda da conta
- ✅ 4. `testPixel` com evento escolhível + resposta mapeada
- ✅ 5. `POST /api/pixels/verify-url` (anti-SSRF: ipPrivado/hostSeguro, limite de redirect/tamanho/tempo) + rate-limit dedicado (10/janela, 429 pt-BR)
- ✅ 6. Snippet base do loader `/px.js` + `paymentNote` no `meta` de GET /api/pixels
- ✅ 7. Campo `uso` por domínio (checkout/cloaker/ambos) + fix sanitizador `config.js`
- ✅ 8. Copy sem termos internos + `mode: auto|manual` na resposta de add domínio
- ✅ 9. Hardening (mapa de erros TikTok pt-BR em `tiktok-errors.js` + rate-limit dedicado no verify-url + limites de fetch)
- ✅ 10. Bateria de testes de backend (4/4 passando)

### Leva 2 — UI Gestão
- ✅ 11. Painel "Testar por URL" (input + diagnóstico por pixel: script ok / pixel nativo ok / não encontrado)
- ✅ 12. Aviso "Compra só via gateway" com link para /gateways na aba Pixels
- ✅ 13. Tutorial passo a passo dos Pixels
- ✅ 14. "Testar disparo" com escolha de evento + resposta legível
- ⬜ 15. Refino visual pixels-view
- ✅ 16. Tutorial dos Gateways por provedor
- ✅ 17. Aviso "pagamento só via gateway" fixo no topo da aba Gateways
- ⬜ 18. Refino visual gateways-view
- ✅ 19. Seletor de uso no add de domínio + badge
- ✅ 20. Copy "automático" sem jargão interno (notas + httpDetail neutralizados)
- ✅ 21. Tutorial de DNS aprimorado
- ⬜ 22. Refino visual domains-view
- ✅ 23. Tutorial dos Links
- ⬜ 24. Refino visual links-view
- ✅ 25. Tutorial do Cloaker
- ⬜ 26. Refino visual cloak-view
- ⬜ 27. Tours guiados (tour.ts + data-tour)
- ✅ 28. `TutorialModal` reutilizável + botão "?"
- ✅ 29. Tipos e hooks dos novos endpoints
- ✅ 30. UI de configuração de moeda (`CurrencyCard` em Configurações) — verificado no navegador (select=USD)

### Leva 3 — Bugs reais + capacidades órfãs (31–140)
- ✅ 31. Teste de cloaker unificado (componente único, verdict alinhado)
- ✅ 32. Cores de provedor sincronizadas com catálogo real (kiwify/hotmart/perfectpay/cakto/stripe/vega/adoorei/payt/generic)
- ✅ 33. Edição de gateway (preserva webhookToken/segredo)
- ✅ 34. Teste por gateway específico + nota de assinatura
- ✅ 35. Badge "domínio não verificado" nos links
- ✅ 36. Validação de pesos A/B (indicador de soma + bloqueio + botão "Normalizar para 100%")
- ✅ 37. Alinhar default `AddToCart` (`ev.AddToCart !== false` no pixel-store)
- ✅ 38. Mensagem do teste reflete o evento real testado
- ✅ 39. QR code gerado localmente (lib `qrcode`)
- ✅ 40. Auto-polling de verificação de domínio (45s)
- ✅ 41. `/api/pixels/test` com erro pt-BR amigável sem token ("Configure o Access Token...")
- ✅ 43. Validação de host no POST /api/domains (`normHost` + `DOMAIN_RE`)
- ✅ 44. `touchGateway`/`touch()` com try/catch (falha de métrica não derruba webhook)
- ✅ 46. Rate-limit no `/hook/:token` (120/janela, 429 sem detalhe) — verificado ao vivo (120×404 + 5×429)
- ✅ 79. Tendência de EMQ (card + sparkline + alerta) — verificado no navegador
- ✅ 80. Fila de retry da CAPI visível no painel de saúde
- ✅ 81. Filtro do log (pixel/evento/status)
- ✅ 82. Linha do log expansível (eventId copiável, leadId, emq, resposta)
- ✅ 99. (= 33) Edição de gateway
- ✅ 100. Rotação de segredo/webhook com confirmação
- ✅ 101. (= 34) Teste por card
- ✅ 114. Idempotência de webhook por order_id (dedup + token antigo 404)
- ✅ 116. (= 19) Seletor de uso
- ✅ 117. Validação inline de host
- ✅ 118. (= 40) Auto-refresh
- ✅ 119. Badge proxy Cloudflare
- ✅ 131. (= 31) Teste unificado
- ✅ 132. Legendas pt-BR dos sinais do cloaker (`signal-labels.ts`)

## Fila de execução (próximos)

Ordem recomendada pelo plano (bugs → durabilidade → segurança → valor → refino → DX):

1. 15, 18, 22, 24, 26 — refinos visuais das 5 abas
2. 27 — tours guiados (tour.ts + data-tour)
3. Demais itens da Leva 3 (42, 45, 47–78, 83–98, 102–113, 120–130, 133–140)
4. Leva 4 em diante (141–570)

## Histórico de sessões

- **Sessão 1–2:** Leva 1 parcial + tutoriais + bugs 31/33/34/35/36/38/39/40 + itens 99–101, 114, 116–119, 131–132 (PR #42, mesclado)
- **Sessão 3:** Itens 79–82 (aba Pixels: EMQ, retry, filtro, log expansível) — commit `5d1080e`
- **Sessão 4 (atual):** criação deste tracker + itens 8, 12, 17, 20, 30, 32, 36, 37 (copy neutro, avisos de gateway, moeda UI, cores de provedor, normalizar pesos, default AddToCart) + 5/6/9/11/41 (leva 1 completa) + 43/44/46 (validação host, touch try/catch, rate-limit hook). Type-check limpo, 4/4 testes, card de moeda + rate-limit do hook verificados ao vivo.
