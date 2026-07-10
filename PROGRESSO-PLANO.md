# PROGRESSO — Plano de 570 modificações (pragmatic-flow)

> Fonte do plano: `PLANO-PRAGMATIC-FLOW.md` na raiz do repositório (570 itens em 7 levas).
> (Antes referenciado como `v0_plans/pragmatic-flow.md` — movido para a raiz porque
> o diretório `v0_plans/` é reservado pelo ambiente do v0.)
> Este arquivo é atualizado **a cada item concluído**. Legenda:
> ✅ concluído e verificado · 🔶 parcial · ⬜ pendente
>
> Última atualização: 2026-07-10 (sessão 5)

## Resumo

| Leva | Escopo | Itens | Status |
|------|--------|-------|--------|
| 1 | Backend (moeda, verify-url, uso domínio, hardening, testes) | 1–10 | 10/10 ✅ |
| 2 | UI Gestão (tutoriais, refinos, moeda UI) | 11–30 | ~15/20 |
| 3 | Bugs reais + capacidades órfãs | 31–140 | ~87/110 |
| 4–6 | Refinos por aba, tours, durabilidade | 141–270 | 12/130 (241–252 ✅) |
| 7 | Segurança, relatórios, API pública, perf, a11y, E2E | 271–570 | 0/300 |

**Total concluído: ~124/570** — Leva 1 (backend) 100% + **faixa 31–113 COMPLETA** (bugs reais, robustez, testes, a11y, responsividade, Links, Pixels, Gateways) + itens 241–252 (durabilidade de schema) concluídos

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
- ✅ 27. Tours guiados das 5 abas (5 tours em `tour.ts` + 16 âncoras `data-tour`) — verificado no navegador (popover 1/3 na aba Gateways)
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
- ✅ 42. Mapa de erros TikTok → pt-BR (`tiktok-errors.js`, usado no caminho compartilhado de disparo/teste em `tiktok-events.js`)
- ✅ 43. Validação de host no POST /api/domains (`normHost` + `DOMAIN_RE`)
- ✅ 45. (= 114) Idempotência de webhook por order_id (`seenWebhookOrder`, Redis SET NX + fallback memória, TTL 24h)
- ✅ 44. `touchGateway`/`touch()` com try/catch (falha de métrica não derruba webhook)
- ✅ 46. Rate-limit no `/hook/:token` (120/janela, 429 sem detalhe) — verificado ao vivo (120×404 + 5×429)
- ✅ 47. Hint público de `/api/status` sem citar plataforma de hospedagem
- ✅ 48. Snapshot durável de gateways no Redis (espelho em save/remove/rotate/touch + hidratação com fallback quando Neon falha) — 4/4 testes após a mudança
- ✅ 49. Toggle ativo/pausado inline no card do pixel (otimista) + merge-patch no POST /api/pixels — verificado ao vivo (toggle + reload preserva token)
- ✅ 50. Aviso no editor de pixel quando falta Access Token (CAPI não dispara)
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
- ✅ 62. Toggle ativo/pausado inline no card do link (otimista com rollback; merge-patch `{slug, ativo}` no POST /api/links) — verificado ao vivo (Pausar → `ativo:false` na API)
- ✅ 63. Duplicar link (slug `-copia` com desambiguação, cópia nasce pausada, contadores zerados pelo normalize) — verificado ao vivo
- ✅ 64. Busca por nome/slug/domínio + ordenação (recentes/nome/cliques/conversões), só aparece com 2+ links — verificado ao vivo (filtro "outro" → 1 card)
- ✅ 65. Receita por moeda + taxa de conversão no card do link (soma `variantes[].revenue`, `formatMoney`)
- ✅ 66. Barra de performance por variante (trilho = peso configurado; preenchimento = participação real nas conversões)
- ✅ 68. Badge do pixel associado no card com alerta quando o pixel não existe mais ou está pausado — verificado ao vivo ("pixel-fantasma (não existe)")
- ✅ 69. Botão "abrir /go em nova aba" no card (com aviso de que conta como clique)
- ✅ 73. Validação de URL https:// no editor (mesmo critério do `validUrl` do backend), erro inline por campo + botão salvar bloqueado
- ✅ 74. Aviso antes de salvar quando o domínio do link mudou (a troca zera `dominioValidado` no backend)
- ✅ 76. Exclusão de link com tráfego exige digitar o nome do link (botão desabilitado até coincidir)
- ✅ 71. UTM builder colapsável no editor de link (utm_source/medium/campaign/content/term → URL `/go/slug` montada ao vivo com botão copiar) — verificado ao vivo (source=tiktok + campaign=promo-julho → querystring correta)
- ✅ 75. Países/idiomas por nome no editor (reuso do `GeoMultiSelect` + `geo-options` do cloaker) com presets de mercado (Lusófonos/LATAM/Europa; Ibéricos/Europa), botão limpar e suporte a colar lista (`onPaste` novo no GeoMultiSelect, beneficia também o cloaker) — verificado ao vivo (preset Lusófonos → Brasil/Portugal/Angola/…)
- ✅ 72. Ações em massa na lista de links: checkbox por card (só com 2+ links), barra de ações com Ativar/Pausar/Excluir + limpar seleção; exclusão em 2 cliques (armar → "Confirmar exclusão de N"); requisições em série reusando o merge-patch do item 62 — verificado ao vivo (pausar 2 → `ativo:false` em ambos; excluir 2 → lista vazia)
- ✅ 60. Bateria de testes ampliada (`test/security.test.js`, 5ª suíte no `npm test`): anti-SSRF do verify-url (ipPrivado + hostSeguro com lookup injetado, incl. rebinding parcial), validação de host (normHost), idempotência de webhook por conta+evento+order_id (fallback memória), edição de gateway preservando webhookToken/segredo + rotação, e pesos A/B (clamp, descarte de http://, contadores preservados na edição). Extração acessória: `ipPrivado`/`hostSeguro`/`normHost`/`DOMAIN_RE` movidos do `server.js` para `security-helpers.js` (comportamento idêntico, confirmado por smoke test ao vivo). 5/5 suítes passando.
- ✅ 70. Botão "Baixar PNG" no popover do QR (regenera com `qrcode` a 512px, sem serviço externo; download via `<a download>`) — verificado ao vivo (botão presente e habilitado com o QR gerado)
- ✅ 89. Aba Pixels: além de "Copiar tag" (`<script>` completo), botão "Só URL" que copia apenas `scriptUrl` para colar em GTM/Tag Manager (chaves de `copied` distintas `:tag`/`:url`) — verificado ao vivo (ambos os botões presentes)
- ✅ 93. Feedback de cópia acessível na aba Pixels: região `role=status` `aria-live=polite` (sr-only) anuncia "X copiado…" além do destaque visual do botão — verificado ao vivo (região presente no DOM)
- ✅ 83. Campo do Access Token mascarado (`type=password`) com botão Revelar/Ocultar (`aria-pressed`) + hint "Token atual termina em ••XXXX" quando já há token salvo — verificado ao vivo
- ✅ 85. Aviso no card quando o pixel está ativo mas nenhum evento ligado (config inócua que nunca dispara) — verificado ao vivo
- ✅ 86. Aviso no card quando Compra/Pagamento está ligado mas `trustedGateways === 0` (eventos de dinheiro só saem do webhook do gateway), com link para /gateways — condição validada ao vivo (com 2 gateways conectados o aviso corretamente não aparece)
- ✅ 87. `durability.incomplete` renderizado pixel a pixel no banner de diagnóstico ("X está com configuração incompleta: falta …") — antes só warnings agregados apareciam
- ✅ 92. Duplicar pixel: clona nome/código/eventos SEM o Access Token (cada conta de anúncio tem o seu); cópia nasce pausada com slug `-copia` (sufixo incremental) — verificado ao vivo (`1-copia` criado com `active:false`, `hasToken:false`)
- ✅ 94. Hint explicando o Test Event Code no editor (aba Eventos de teste do TikTok Events Manager, com link para a doc oficial e aviso de remover ao ir ao ar)
- ✅ 59. Painel "Como funciona a Gestão": botão "?" ao lado do label da seção Gestão no sidebar abre TutorialModal com 6 passos (fluxo Link → Pixel → Gateway → Domínio → Cloaker + pré-requisitos, ex.: Compra exige gateway) — novo `components/shell/gestao-help.tsx`, verificado ao vivo
- ✅ 51/52/53/84/88/90/95/98 — auditados e JÁ IMPLEMENTADOS em sessões anteriores (comentários "Item NN" no código): cabeçalho de saúde consolidado da aba Pixels (51), motivo do último webhook no card do gateway (52), estados vazios guiados com CTA de tutorial (53, Links/Pixels/Gateways/Cloak), dropdown de evento no teste (84), saúde/EMQ por pixel com filtro (88 via 79/81), testar por URL (90), default AddToCart alinhado editor=store (95 via 37), tutorial passo a passo do Pixel (98, `PIXEL_STEPS`)
- ✅ 54. Badge de uso no card de domínio ("só checkout"/"só cloaker"/"checkout + cloaker"; ciano quando restrito, neutro quando ambos) — verificado ao vivo
- ✅ 55/61/67/77/78/91 — auditados e JÁ COBERTOS: feedback de cópia com aria-live (55 = 93), badge "domínio não verificado" no card do link (61, `links-view.tsx:502`), indicador "soma N%" + botão normalizar + save bloqueado com pesos inválidos (67 via 36), estado vazio guiado do Links com CTA de tutorial (77), tutorial `LINK_STEPS` (78), tutorial do gateway explica a URL de webhook como integração + regra gateway-only sempre visível (91 via 11/17)
- ✅ 56. Auditoria a11y dos toggles: todos os `role="switch"` (cloaker mestre, camadas, entry) têm `aria-checked` + label; toggle de link usa `aria-pressed`; foco visível global via `:focus-visible` no globals.css — nada a corrigir
- ✅ 57. Responsividade auditada nas 5 abas a 375px: Links/Pixels/Domínios/Cloak ok; BUG REAL corrigido na aba Gateways (overflow de 699px): cabeçalho sem `flex-wrap` + grid `1.3fr_1fr` sem `minmax(0,·)` deixavam o log de webhooks alargar a página — corrigido com `flex-wrap` + `minmax(0,1.3fr)_minmax(0,1fr)` + `min-w-0` nos cards, re-verificado ao vivo (scrollWidth = 375)
- ✅ 58. Padronização visual das 5 abas da Gestão: ritmo vertical unificado em `gap-5` na raiz (Links era gap-4, Cloak gap-6, Domains gap-4; Pixels/Gateways já eram gap-5) + `flex-wrap` no cabeçalho do Cloak (padrão das demais abas no mobile); todas já compartilhavam GlassCard `p-5`, descrição + TutorialButton no topo e tokens de tema — verificado ao vivo nas 5 abas (`gap-5 ok`)

### Leva 3 — Aba Gateways (102–113)

- ✅ 102. Marca visual por provedor no card: `ProviderIcon` — marks oficiais de Stripe e Hotmart (via theSVG.org, inline em `currentColor` para herdar a cor da marca) + monograma com cor do catálogo para os gateways BR de nicho sem SVG público (kiwify, cakto, vega, adoorei, payt, perfectpay); ícone genérico Webhook removido — verificado ao vivo (monograma "P" renderizado)
- ✅ 103. Segredo do gateway mascarado (`type=password`) com Revelar/Ocultar (`aria-pressed`) + hint "já tem um segredo salvo, deixe em branco para manter" quando `hasSecret` — verificado ao vivo
- ✅ 104/105. Log de webhooks com linha expansível (`aria-expanded`): clique revela Pedido (orderId), Valor+moeda, E-mail, Evento e status do lead (casou com clique rastreado / órfã ou fora da janela) — verificado ao vivo (52 linhas expansíveis, detalhe renderizado)
- ✅ 106. Aviso cruzado no estado vazio de Gateways: "sem gateway, os eventos de dinheiro do pixel (Compra e Pagamento) nunca disparam" (par do item 86 na aba Pixels)
- ✅ 107/108/111/112/113 — auditados e JÁ IMPLEMENTADOS: tutorial por provedor via `prov.docs` no card e editor (107), estado vazio guiado com CTA (108), badge de saúde do último evento com motivo (111, `lastEventStatus`), `touchGateway` com catch logado (112, via 44), snapshot Redis de gateways (113, via 48)
- ✅ 109. Nome único por conta — backend já validava (case-insensitive, ignora o próprio registro na edição) e o editor exibe o erro via `setError`
- ✅ 110. Cópia do webhook com anúncio `aria-live` (região `role=status` sr-only, padrão do item 93) — verificado ao vivo

### Leva 6 — Durabilidade de schema e persistência (241–252) — ANTECIPADA

- ✅ 241. Tabela `custom_domains` no Neon (host PK, account_id, uso, verificado, verificado_em, provider_id, provider_note, dns jsonb, timestamps) criada no `init()` do `db.js`
- ✅ 242. `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS currency text DEFAULT 'BRL'` + write-through no POST /api/settings (`db.setAccountCurrency`) + hidratação no boot (`config.hydrate` → `loadAccountCurrencies`, config tem precedência)
- ✅ 243. Coluna `uso` (checkout/cloaker/ambos) no schema + índice `custom_domains_account_idx (account_id, host)`
- ✅ 244. Índice único de host: `host` é PRIMARY KEY — impede duplicidade entre contas
- ✅ 245. Snapshot durável de domínios no Redis (`saveDomainSnapshot`/`deleteDomainSnapshot`/`loadDomainSnapshot`, hash `domains:all`, padrão dos pixels) + fallback na reconciliação do boot quando o Neon falha
- ✅ 246. Snapshot durável de gateways — JÁ EXISTIA (implementado no item 48, `gateways:all`); confirmado em `gateway-store.js`
- ✅ 247. `claimLegacyData()` agora atribui `custom_domains` com `account_id IS NULL` ao primeiro admin
- ✅ 248. Migração idempotente no `init()` (CREATE TABLE/ADD COLUMN IF NOT EXISTS) — default BRL não afeta contas EUR (config editável tem precedência)
- ✅ 249. `initWithRetry` cobre as novas migrações (fazem parte do `init()`) + `/api/health` reporta `migrations: { customDomains, accountCurrency }`
- ✅ 250. `/api/domains` devolve `uso` e `verificadoEm` — entradas preservadas pelo sanitizador e reconciliadas do novo schema no boot
- ✅ 251. Índices de gateway confirmados: `webhook_token UNIQUE` (caminho quente do `/hook/:token`) + `gateways_account_idx` já existiam
- ✅ 252. Write-through ASSÍNCRONO dos domínios (padrão stats.js): `config.set` espelha em `setImmediate` no Neon + Redis sem bloquear o request; leitura nunca semeia escrita (`config.seed` só em memória)

Evidência: `node --check` limpo nos 4 módulos + 4/4 suítes de teste passando após as mudanças.

## Fila de execução (próximos)

Ordem recomendada pelo plano (bugs → durabilidade → segurança → valor → refino → DX):

1. Demais itens da Leva 3 (120–130, 133–140)
2. 15, 18, 22, 24, 26 — refinos visuais das 5 abas
3. Leva 4 em diante (141–240, 253–570) — 241–252 já concluídos (antecipados)

## Histórico de sessões

- **Sessão 1–2:** Leva 1 parcial + tutoriais + bugs 31/33/34/35/36/38/39/40 + itens 99–101, 114, 116–119, 131–132 (PR #42, mesclado)
- **Sessão 3:** Itens 79–82 (aba Pixels: EMQ, retry, filtro, log expansível) — commit `5d1080e`
- **Sessão 4 (atual):** criação deste tracker + itens 8, 12, 17, 20, 30, 32, 36, 37 (copy neutro, avisos de gateway, moeda UI, cores de provedor, normalizar pesos, default AddToCart) + 5/6/9/11/41 (leva 1 completa) + 43/44/46 (validação host, touch try/catch, rate-limit hook) + 27 (tours guiados das 5 abas, verificado com popover ao vivo) + 47/49/50 (hint neutro, toggle otimista do pixel com merge-patch, aviso sem token). Type-check limpo, 4/4 testes, card de moeda + rate-limit do hook + tour de Gateways + toggle de pixel verificados ao vivo.
- **Sessão 6:** itens 70 (baixar QR em PNG a 512px), 89 (copiar só a URL do script do pixel para GTM) e 93 (feedback de cópia acessível com `aria-live` na aba Pixels). Depois, refinos da aba Pixels: 83 (token mascarado com Revelar/Ocultar + últimos 4 dígitos), 85/86 (avisos de config inócua no card: sem eventos ligados; Compra sem gateway), 87 (`durability.incomplete` renderizado por pixel), 92 (duplicar pixel sem token, cópia pausada) e 94 (hint do Test Event Code). Type-check + `next build` limpos; tudo verificado ao vivo (build de produção na 3001 + Express na 3000) e dados de teste removidos. Em seguida, item 59 (painel "Como funciona a Gestão" via `gestao-help.tsx` no sidebar, verificado ao vivo) e auditoria que confirmou 51/52/53/84/88/90/95/98 como já implementados em sessões anteriores. Por fim: item 54 (badge de uso no card de domínio), auditorias 55/56/61/67/77/78/91 (já cobertos) e item 57 com BUG REAL corrigido — overflow horizontal da aba Gateways em mobile (375px → 699px) causado por cabeçalho sem `flex-wrap` e grid sem `minmax(0,·)`; re-verificado ao vivo nas 5 abas. Fechamento: item 58 (ritmo vertical unificado em `gap-5` nas 5 abas + `flex-wrap` no cabeçalho do Cloak), verificado ao vivo — **faixa 31–101 do plano 100% completa**. Nota operacional: o sandbox reiniciou no meio da sessão (node_modules e /tmp apagados); recuperado com `npm install` em ambos os pacotes e novo `vercel env pull`.
- **Sessão 5 (atual):** plano salvo em `PLANO-PRAGMATIC-FLOW.md` (raiz) + Leva 6 antecipada — itens 241–252 (durabilidade de schema): tabela `custom_domains` multi-tenant, coluna `accounts.currency`, snapshot Redis de domínios, write-through assíncrono via `config.set`, reconciliação no boot via `config.hydrate`, claim legado e `migrations` no `/api/health`. `node --check` limpo + 4/4 testes. Durabilidade validada ponta a ponta contra Neon+Redis reais (criar/excluir domínio propaga aos 2 espelhos). Depois, aba Links da Leva 3: itens 62–66, 68, 69, 73, 74, 76 — type-check limpo, toggle/duplicar/busca/badge de pixel verificados ao vivo no navegador (build de produção; o dev server Turbopack do sandbox não hidratava, sem relação com as mudanças). Depois, itens 71 (UTM builder) e 75 (países/idiomas por nome + presets + colar lista via `onPaste` no GeoMultiSelect), ambos verificados ao vivo. Fix acessório: `turbopack.root` fixado no `next.config.mjs` (o Turbopack inferia a raiz do monorepo e o `next build` falhava no sandbox). Por fim, item 72 (ações em massa nos links: checkbox + barra Ativar/Pausar/Excluir com confirmação em 2 cliques) — verificado ao vivo ponta a ponta. E item 60: nova suíte `test/security.test.js` (anti-SSRF, normHost, dedup de webhook, edição de gateway, pesos A/B) com extração de `security-helpers.js`; 5/5 suítes + smoke test do servidor ao vivo.
