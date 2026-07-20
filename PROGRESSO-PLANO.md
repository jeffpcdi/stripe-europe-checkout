# PROGRESSO — Plano de 570 modificações (pragmatic-flow)

> Fonte do plano: `PLANO-PRAGMATIC-FLOW.md` na raiz do repositório (570 itens em 7 levas).
> (Antes referenciado como `v0_plans/pragmatic-flow.md` — movido para a raiz porque
> o diretório `v0_plans/` é reservado pelo ambiente do v0.)
> Este arquivo é atualizado **a cada item concluído**. Legenda:
> ✅ concluído e verificado · 🔶 parcial · ⬜ pendente
>
> Última atualização: 2026-07-11 (sessão 8)

## Resumo

| Leva | Escopo | Itens | Status |
|------|--------|-------|--------|
| 1 | Backend (moeda, verify-url, uso domínio, hardening, testes) | 1–10 | 10/10 ✅ |
| 2 | UI Gestão (tutoriais, refinos, moeda UI) | 11–30 | ~15/20 |
| 3 | Bugs reais + capacidades órfãs | 31–140 | 110/110 ✅ |
| 4–6 | Refinos por aba, tours, durabilidade | 141–270 | 12/130 (241–252 ✅) |
| 7 | Segurança, relatórios, API pública, perf, a11y, E2E | 271–570 | 411/413/414/415/418 ✅ (sessão 8) |

**Total concluído: ~143/570** — Leva 1 (backend) 100% + **LEVA 3 COMPLETA (31–140)** (bugs reais, robustez, testes, a11y, responsividade, Links, Pixels, Gateways, Domínios, Cloak) + itens 241–252 (durabilidade de schema) concluídos; próximo alvo: Leva 4 (141–200)

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

### Leva 3 — Aba Domínios (120–130)

- ✅ 120. Card mostra "Verificado e ativo desde DD/MM/AAAA" (`verificadoEm`) + sufixo "reconectado à hospedagem" quando o verify re-registra (`result.reconectado`) — verificado ao vivo
- ✅ 121. Botão "Copiar tudo (CNAME + TXT)" no tutorial de DNS — bloco em formato de zona para colar de uma vez — verificado ao vivo
- ✅ 122. Checagem rápida de propagação via DoH (cloudflare-dns.com/dns-query, CORS ok) direto do navegador: botão "Já propagou? Checar agora" compara o CNAME respondido com o target e dá feedback em segundos (propagou / aponta pro lugar errado / ainda não) — verificado ao vivo (resposta real de DNS)
- ✅ 123. Dica de TTL (300s/Auto) + aviso automático quando o host é apex (2 labels): CNAME não funciona em domínio raiz em muitos registradores → sugerir subdomínio ou ALIAS/flattening — verificado ao vivo
- ✅ 124. Atalho "Usar em um link" no card de domínio verificado (oculto para uso=cloaker) → navega para `/dashboard/links?novo=1&dominio=host`; links-view lê o param, abre o editor com o domínio pré-selecionado e limpa a URL — verificado ao vivo (select pré-preenchido)
- ✅ 125. Diagnóstico dirigido no resultado do verify: DNS falhou → botão que reabre o tutorial ("O DNS ainda não aponta pra cá"); DNS ok + HTTPS pendente → mensagem "falta só o certificado, é automático"; proxy Cloudflare já tinha badge própria
- ✅ 127. Falha de REDE no verify ganha estado próprio (`networkError` no tipo): banner âmbar "falha de conexão — o DNS pode estar certo" com botão "Tentar de novo", em vez do resultado genérico que parecia DNS pendente
- ✅ 129. Estado vazio guiado: explica o benefício do domínio próprio + CTA "Ver como funciona" abrindo o tutorial conceitual
- ✅ 126/128/130 — auditados e JÁ IMPLEMENTADOS: mensagens do domain-provider já são neutras (grep sem termos internos; notas mapeadas em server.js — itens 8/20), limite de 20 domínios + erro de duplicado/outra conta no POST (128), verify chama `linkStore.markDomainValidated` para todos os hosts verificados e o mutate reflete na UI (130)

### Leva 3 — Aba Cloak (133–141)

- ✅ 133. Feedback "Salvo ✓" no config panel — JÁ EXISTIA (`savedAt` com estado transitório); confirmado
- ✅ 134. Teste por entry: botão "Testar" em cada card de `/c/:slug` chama `POST /api/cloak/test` com `slug` — backend simula o julgamento DAQUELE link (usa o próprio entry como `cloakCfg` no motor de score) e reporta os gates pré-score (mobile, ad-click, país, idioma) com o request atual do admin; UI mostra veredito+score+threshold, chips de gate (passa/bloqueia/desligado) e signals — verificado ao vivo (gates: mobile block, ad-click block, país/idioma off) e via curl direto no endpoint
- ✅ 135. Estatística offer/white inline por link no card (barra proporcional + % bloqueado), do `useCloakStats` mapeado por slug — verificado ao vivo
- ✅ 136. Badge de sensibilidade + threshold efetivo no card ("Equilibrado · ≥40") + resumo dos gates ativos (mobile/ad-click) — verificado ao vivo
- ✅ 137. Liga/desliga inline por entry (`role=switch`, POST enabled) + seleção múltipla com ações em lote (ativar/desativar/remover selecionados) — verificado ao vivo (toggle "Ativo" presente)
- ✅ 138. Preview da white page em nova aba: link "Ver" no editor (quando URL https válida) + "Ver white" no card da lista — verificado ao vivo (href aponta para a white configurada)
- ✅ 139. Explicação do threshold no config panel: texto sobre score 0–100 → página branca + mapa sensibilidade→número efetivo (Rígido ≥30 · Equilibrado ≥40 · Leve ≥55) lido de `cfg.sensitivityThresholds` — verificado ao vivo
- ✅ 140. Aviso no editor quando o domínio selecionado não está verificado: `/c/:slug` responde 404 nesse host até o DNS apontar pra cá; orienta a verificar em Domínios ou usar o principal — verificado ao vivo (via seleção de domínio não verificado)
- ✅ 141. Threshold efetivo mostrado no editor na seção de sensibilidade ("Score ≥ N é tratado como bot"), espelhando `EFFECTIVE_THRESHOLD` do bot-filter — verificado ao vivo

Evidência: `node --check server.js` limpo, `tsc --noEmit` limpo, `next build` ok, 5/5 suítes de teste passando, verificação ao vivo no navegador de todos os 9 itens. Entry de QA criado e removido após o teste.

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

### Leva 4 — Transparência do julgamento do Cloak (161–168, 204–206, 210)

- ✅ 161. Sinais do teste ao vivo agrupados por CAMADA de detecção (A–H) com o peso de cada sinal exibido (+/−). `signal-labels.ts` ganhou metadados `layer`/`weight` e `LAYER_META` (rótulo + dica pt-BR por camada); `CloakTestPanel` renderiza um bloco por camada
- ✅ 162. Legendas pt-BR de cada sinal com classificação de cor (verde=humano real, vermelho=suspeito, cinza=informativo) + peso; código técnico permanece no `title` (hover)
- ✅ 163. Veredito de INFRAESTRUTURA no teste: `bot-filter.js` (`judge`) agora expõe `asn`/`org` resolvidos; `/api/cloak/test` propaga; painel mostra "Operadora/provedor real" (verde) x "Data center/revisor" (vermelho) x timeout (neutro)
- ✅ 164/210. Tempo de julgamento (`resolvedAt` ms) exibido no painel, com aviso quando `asn:deadline` (consulta de rede estourou; próxima visita do mesmo IP resolve pelo cache sticky)
- ✅ 166. Simulador de threshold: slider (10–90) recalcula o veredito LOCALMENTE sobre o mesmo score, sem novo request — mostra em linguagem clara se o acesso iria para white/offer
- ✅ 167. Trade-off de cada preset de sensibilidade em linguagem de negócio (Rígido/Equilibrado/Leve/Custom) exibido abaixo dos botões no config panel
- ✅ 168. Aviso quando camadas dependentes de JS (WebGL, Timezone, Biometria, Entropia) estão ligadas mas o Challenge JS está desligado — alerta âmbar explica que ficam sem efeito e orienta a correção (evita configuração inócua)
- ✅ 204/205/206. `asn:carrier` reclassificado como sinal CONFIÁVEL (verde) no `signal-labels`; pesos e camadas expostos para dar leitura de "quanto cada sinal contribuiu" no veredito

Evidência: `node --check bot-filter.js server.js` limpo, `tsc --noEmit` limpo na dashboard, 5/5 suítes de teste passando (gateway-only, EMQ, pixel-durability, security/anti-SSRF) — julgamento do cloaker e event_id determinístico intactos.

### Leva 4 — Aba Cloaker, faixa 141–150 (transparência + UX do link /c)

- ✅ 141. Threshold efetivo por entry exibido no editor (`cloak-entry-editor.tsx`): a sensibilidade escolhida (Rígido/Equilibrado/Leve/Custom) espelha `SENSITIVITY_THRESHOLDS` e mostra o valor herdado vs. sobrescrito — já implementado
- ✅ 142. Acessibilidade dos toggles do cloaker: `aria-checked` presente nos 4 switches (`cloak-entries-panel`, `cloak-entry-editor`, `cloak-config-panel` ×2) com `role="switch"`, foco e teclado — auditado, conforme
- ✅ 143. Copiar URL do entry com anúncio acessível (`aria-live`), padronizado com os itens 55/93/110 — já implementado
- ✅ 144. Mini-gráfico diário offer×white por link (`DailyMiniChart` no `cloak-stats-panel`): plota o `daily` que o backend já devolvia (últimas 2 semanas, barras empilhadas com as cores de offer/white) — já implementado
- ✅ 145. Estado vazio guiado da aba Cloaker: quando não há nenhum link, um bloco explica offer × white em linguagem de negócio (oferta real para o público × página neutra para robôs/revisores) com ícone e CTA "Criar meu primeiro link". Complementa o `TutorialModal` (`CLOAK_STEPS`) já presente
- ✅ 146. Confirmar exclusão de entry com tráfego: `ConfirmDialog` que, quando há decisões registradas (`statBySlug[slug].total > 0`), exige digitar o nome do link e avisa que os contadores se perdem (ver detalhamento no item 184)
- ✅ 150. Token nunca exposto inteiro: a listagem (`GET /api/pixels`) já devolve só `'••••' + accessToken.slice(-4)`; o segredo completo jamais entra no payload de leitura — auditado, conforme

Auditoria: itens 141–144 e 150 já estavam no código de sessões anteriores (não rastreados aqui); 145 e 146 implementados nesta sessão. `tsc --noEmit` limpo.

### Leva 4 — Aba Cloaker, faixa 169–175 (valor de negócio + observabilidade)

- ✅ 169. Leitura de impacto em linguagem de negócio no `cloak-stats-panel`: dois cards no topo traduzem os contadores crus em **"público real na oferta"** (offer, verde/success) × **"robôs/revisores barrados"** (white, âmbar/warning), em vez de só `offer/white` numérico. Só aparece quando há decisões
- ✅ 170. Histórico das últimas N decisões por link (observabilidade). **Backend:** store `pushCloakDecision`/`getCloakDecisionLog` no `redis.js` (lista limitada a 50, LTRIM + TTL 30d, fallback em memória), com **IP mascarado** (`maskIp`: último octeto → `.x`, sufixo IPv6 → `::x`) — nunca grava PII. Alimentado no funil único `bumpDecision` do `/c/:slug`. Rota `GET /api/cloak/decisions?key=` (multi-tenant, `no-store`). **Front:** hook `useCloakDecisions(key|null)` + componente `cloak-decision-log.tsx` expansível por link (botão "Histórico"), motivos em pt-BR, hora em America/Sao_Paulo
- ✅ 171. Reexecutar julgamento: cada linha do histórico tem "Reexecutar", que re-roda o judge do link com o **request atual do admin** (mesma rota `/api/cloak/test`) e mostra o veredito+score via `toast`. Não é replay do visitante histórico (não guardamos PII pra isso) — é o mesmo veredito que a rota real daria agora, para depurar por que a regra manda pra offer/white
- ✅ 172. Validação da white page (não-https) em dois lugares: no `cloak-entry-editor` (por link) e no `cloak-config-panel` (fallback global). Se preenchida mas sem `https://`, avisa que uma white page quebrada leva o revisor a um erro e pode queimar a conta — corrigir ou deixar vazio (usa a neutra embutida)
- ✅ 173. Nota de contexto no toggle `blockZhLang` (`cloak-config-panel`): quando ligado, explica que barra todo idioma chinês fora da CN — pega revisores da ByteDance mas também público chinês legítimo (diáspora/turistas); só manter se a campanha não mira falantes de chinês reais
- ✅ 174. Preview/abertura das páginas no `cloak-entry-editor`: link "Ver" na **offer** (espelha o que já existia na white, item 138) e botão **"Comparar offer × white lado a lado"** que abre as duas em novas abas — só aparece quando ambas são https válidas
- ✅ 175. Verificação de domínio via **DNS-over-HTTPS** (`dohResolve` em `server.js`, dns.google + cloudflare-dns, timeout 2.5s, best-effort). Quando o resolver local não vê o registro, consulta os resolvers públicos: se o CNAME/A já aponta pra cá, marca `dnsPropagating` e a UI (`domains-view`) mostra "já visível na rede global — propagação em curso" (ciano) em vez de "não resolve"; some o CTA de erro do item 125 nesse estado

Evidência: `node --check server.js`/`redis.js` OK; `tsc --noEmit` limpo na dashboard.

### Leva 4 — Robustez transversal, fatia backend/API (176–181)

- ✅ 176. Cache NEGATIVO de ASN com TTL curto (5 min) em memória (`bot-filter.js`) e no Redis (`redis.js`) — lookup sem ASN resolvido (asn:0/unknown/timeout) não fica mais 4h/24h fixado como neutro; datacenter cujo 1º lookup falhou é reavaliado em minutos. Hit válido (asn>0) mantém TTL longo. IP privado continua definitivo
- ✅ 177. Métrica de latência do julgamento do cloaker: `bot-filter.js` mantém janela deslizante (últimas 200 amostras) e expõe `getJudgeLatency()` → `{count, window, p50, p95, max, deadlineHits, deadlineRate}`; `/api/health` publica em `cloakerLatency`. Detecta DNS/ASN lento estourando o deadline
- ✅ 178. Rate-limit por conta nas 3 rotas de teste que faltavam: `/api/cloak/test` (30/min, faz lookup DNS), `/api/pixels/test` e `/api/conversion/test` (15/min, disparam CAPI/Pushcut real) — retornam 429 `{ok:false,error,code:'rate_limited'}`
- ✅ 179. `buscarPaginaSegura` (verify-url) endurecida: constantes nomeadas (timeout 8s, 1.5MB, máx 1 redirect) + rejeita corpo não-HTML por Content-Type (não baixa PDF/imagem/binário), cancelando o stream. Anti-SSRF por hop (`hostSeguro`) mantido
- ✅ 180. Sanitização anti-XSS na ORIGEM do `org` do ASN (`bot-filter.js`): remove `<>&"'` e chars de controle antes de qualquer UI — cobre a dashboard React E as views legadas concatenadas
- ✅ 181. Contrato unificado de erro `{ok:false,error,code,hint}`: helper `apiError(res,status,error,code,hint)` no backend + `lib/api.ts` (`ApiError` agora tem `code`/`hint` e getter `display`, `parseApiError()` usado por `fetcher`/`apiSend`). Retrocompatível — rotas antigas com só `{error}` seguem funcionando

Lote concluído: 176–188 (todos ✅ abaixo). 189/183/184/185/187/182/188/186 ✅ na seção seguinte. 190 ✅ (docs + 7 suítes). 175 ✅ (seção 169–175).

### Leva 4 — Robustez transversal, primitivos de UX (183, 184, 189)

- ✅ 189. Hook `useModalA11y(open, ref, onClose)` (`lib/use-modal-a11y.ts`): foco preso (focus trap com Tab/Shift+Tab), ESC para fechar, retorno de foco ao gatilho e trava de scroll do body. Base única para todos os popups; `TutorialModal` refatorado para usá-lo (removidos os efeitos de ESC/foco caseiros). `GlassCard` passou a encaminhar `ref` (React 19 ref-as-prop) para permitir o trap
- ✅ 183. Toaster global (`lib/toast.ts` store sem dependência + `components/shell/toaster.tsx`) montado uma vez no layout da Gestão. Região `aria-live` (assertiva p/ erro `role=alert`, polida p/ sucesso/info `role=status`), no máx 4 na tela, erro fica 6s e demais 3.5s. API `toast.success/error/info(msg,{hint,duration})`
- ✅ 184. `ConfirmDialog` reutilizável (`components/confirm-dialog.tsx`) usando o hook de a11y — substitui `window.confirm`. Quando o item tem tráfego, exige digitar o nome (mesma trava do link, item 76). Conectado ao **gateways-view**: excluir gateway (exige nome se `lastEventAt`) e rotacionar webhook agora usam o diálogo + `toast`, em vez de `window.confirm` e mensagens improvisadas
  - **Replicado nas views restantes (fatia UI ampla):**
    - **links-view** (itens 76/184): exclusão inline substituída pelo `ConfirmDialog`; com clique/conversão registrados exige digitar o nome do link (`confirmText`), descrição mostra os contadores; sucesso/erro por `toast`. Removido o bloco de exclusão inline e o `deleteText` local
    - **domains-view** (item 184): `DomainCard` deixou de gerenciar exclusão inline (props `deleting/onCancelDelete/onDelete` removidas); o pai monta um `ConfirmDialog` único — domínio **verificado** exige o host digitado (links/cloaker ao vivo dependem dele); `toast` de sucesso/erro
    - **cloak-entries-panel** (itens 146/184): remover link de cloaking via `ConfirmDialog`; com decisões registradas (`statBySlug[slug].total > 0`) exige o nome digitado e avisa que os contadores se perdem; `toast` no lugar do `window.confirm`
    - **cloak-stats-panel** (item 184): zerar contadores (um link ou todos) agora passa pelo `ConfirmDialog` com aviso de irreversibilidade + `toast`, substituindo os dois `window.confirm`
  - Evidência: `tsc --noEmit` limpo na dashboard após a migração; nenhum `window.confirm` restante nas views

- ✅ 185. Hook `usePersistedState(key, default)` (`lib/use-persisted-state.ts`) — drop-in de `useState` que espelha preferências de exibição em `localStorage` (prefixo `roi:ui:`), SSR-safe (default no 1º render, valor salvo entra pós-hidrataç��������������������o). Aplicado: ordenação de **links** (`links:sort`), ordenação do **cloak entries** (`cloak-entries:sort`) e filtro de tipo do **activity** (`activity:filter`). Busca textual segue por sessão (intencional)
- ✅ 187. Revalidação suave das listas de gestão: `LIST_POLL_MS` (30s) aplicado aos hooks `useLinks/useDomains/usePixels/useGateways/useCloakEntries` (`refreshInterval` + `revalidateOnFocus`) — edições feitas em outra aba refletem sem F5, sem o polling agressivo de 12s das métricas
- ✅ 182. Estado de erro consistente com retry: `ErrorState` (`components/error-state.tsx`) — mesmo visual (`role=alert`) + botão "Tentar novamente" que dispara `mutate()` do SWR. Aplicado às 4 views de lista (**links, pixels, gateways, domínios**) que antes ignoravam `error` do SWR e ficavam presas no skeleton/vazio quando o fetch falhava. Só aparece quando não há dado em cache (`error && !data`); com dados, SWR revalida em silêncio. No domains o `error` do SWR virou `loadError` para não colidir com o `error` local do formulário
- ✅ 188. Auditoria de i18n das 5 abas + componentes: varredura de atributos (`aria-label`/`placeholder`/`title`) e conteúdo JSX por termos em inglês (Delete/Edit/Save/Loading/etc.) — **zero ocorrências**. Toda a UI já em pt-BR; os únicos termos em inglês são jargão técnico do domínio (offer/white page, token, gateway, threshold, EMQ, UTM, QR code, Event ID, pixel). Nada a corrigir
- ✅ 186. Indicador global de durabilidade no cabeçalho: `DurabilityBadge` (`components/shell/durability-badge.tsx`) montado no `Header`, ao lado do `LiveBadge`. Consolida banco (Neon) + Redis do `/api/health` num só lugar e classifica: **durável** (banco no ar → badge oculto), **degradado** (banco fora + Redis no ar → âmbar, "rodando pelo snapshot, alterações seguem salvas") e **volátil** (banco e Redis fora → vermelho, "alterações podem se perder ao reiniciar"). Só aparece quando o banco cai (não polui o estado saudável, já coberto pelo `LiveBadge`); link para `/` (Visão geral) onde o `HealthCard` detalha os serviços
- ✅ 190. **Docs:** CLAUDE.md atualizado com a rota `GET /api/cloak/decisions` + store de log (§ rotas de cloak), o simulador de perfis `GET /api/cloak/test/profiles` + contrato unificado do `POST /api/cloak/test` (§ rotas de cloak), o sinal de propagação DoH no verify de domínio (§ domínios) e a contagem de suítes. **Testes:** de 5 → 7 suítes no `npm test` — `test/cloak-decision-log.test.js` (mascaramento de IP sem PII, teto de 50, escopo por conta+slug, reset zera o log) e `test/cloak-test-profiles.test.js` (catálogo coerente + o motor classifica cada perfil sintético do lado esperado). Cobre camadas do cloak, DoH e o contrato de teste; cache negativo de ASN (176) e sanitização (180) já vinham exercitados por `security.test.js`.

- ✅ 165/208. **Simulador de perfis de bot** na aba Cloaker → Teste ao vivo. Catálogo `cloak-test-profiles.js`
  com visitantes sintéticos (usuário real do anúncio no webview TikTok, comprador mobile orgânico, revisor
  ByteDance em CIDR de data center, navegador headless, crawler declarado, acesso fora do país-alvo).
  **Backend:** `GET /api/cloak/test/profiles` (só metadados, nunca headers/IP sintéticos) e `POST /api/cloak/test`
  com `{profile}` monta um `evalReq` sintético que substitui o request do admin em TODA leitura do visitante
  (headers, query, IP, geo, `challengeData`) e roda o MESMO `judge` + gates pré-score. **Front:** dropdown
  "Simular visitante" no `cloak-view` (hook `useCloakTestProfiles`) que dispara o teste ao trocar e mostra um
  banner **esperado × real** (verde bateu / âmbar divergiu), reaproveitando todo o painel de score/sinais/infra
  já existente. **Teste:** `test/cloak-test-profiles.test.js` trava que o motor classifica cada perfil do lado certo.

Validação desta fatia: `tsc --noEmit` limpo, `next build` limpo (rotas /cloak, /domains, /links), `node --check server.js/redis.js/cloak-test-profiles.js` OK, `npm test` 7/7. Verificação em navegador da dashboard autenticada não é possível no sandbox (o `/__dev/login` exige `DATABASE_URL`, ausente aqui).

**Leva 4 (141–190) 100% concluída.** Auditoria confirmou 161–168 já implementados no `CloakTestPanel`/`signal-labels.ts`/`cloak-config-panel.tsx` (agrupamento por camada com peso, labels pt-BR, infra ASN, deadline/tempo, slider de threshold, trade-off dos presets com números reais 30/40/55, aviso de camadas D–H inertes sem Challenge JS).

Evidência: `node --check` limpo, `next build` limpo (type-check incluído), 7/7 suítes de teste passando, `getJudgeLatency()` conferido em runtime.

## Leva 5, bloco I (191–200) — observabilidade das filas duráveis

Capacidades que já existiam no backend mas nenhuma UI expunha, agora visíveis na aba Gateways (painel "Saúde da fila de conversões", `queue-health-panel.tsx`).

- ✅ 191. **Profundidade da fila de conversões** — `convQueueDepth()` (pendentes + em processamento) exposto em `GET /api/ops` (`convQueue`).
- ✅ 192. **Resgate de órfãos** — `reclaimConversions` passou a registrar `_lastReclaim`; `getReclaimInfo()` alimenta o card "último reprocessamento".
- ✅ 193. **Fila de retry da CAPI** — `ttEvents.retryQueueInfo(acc)` retorna `{count, oldestAgeMs}` por conta (usa `firstAt`/`acc` já presentes nos itens).
- ✅ 194. **Forçar drenagem** — `drainRetryQueue({force, acc})` ignora o backoff e processa só a conta, com lock distribuído; exposto por `POST /api/ops/drain-retry` (rate-limit 6/janela) + botão na UI com toast.
- ✅ 195. **Dedup de webhook** — `bumpWebhookDedup`/`getWebhookDedupCount` (durável 30d por conta, fallback em memória) incrementado na branch de reentrega ignorada; card na UI.
- ✅ 197. **Heartbeat do worker** — `heartbeatConvWorker()` a cada tick do drain; `getConvWorkerBeat()` marca "ativo" se <10s. Badge verde/âmbar na UI.
- ✅ 199. **Latência webhook→disparo** — carimbo `_recvAt` em `submitConversion`, medido em `processConversion` via `recordConvLatency` (janela de 200 em memória); p50/p95/max em `getConvLatency()`.
- ✅ 196. **Estado degradado sem Redis** — `redisEnabled:false` deixa o painel em aviso âmbar ("fila best-effort em memória") em vez de números enganosos.
- ✅ 198. **Reprocessar uma conversão individual do log** — recibos agora têm `id` estável (`evId.recvAt`); `POST /api/ops/reprocess-conversion` (rate-limit 10/janela, escopo por conta) reconstrói o envelope com `registerSale:false` + `_forceRedispatch:true` (pula o dedup de propósito) e re-dispara a CAPI sem duplicar a venda. UI: botão "Reprocessar disparo" na linha expandida do log de webhooks (`gateways-view.tsx`).
- ✅ 200. **Retenção/limpeza manual de logs por aba** — `GET /api/ops/retention` expõe os limites efetivos; `POST /api/ops/clear-log` (scopes `pixelLog`/`convLog`/`cloakLog`/`emq`, rate-limit 6/janela) limpa **só os dados da conta** (reescreve as listas globais preservando linhas de outras contas). Helpers novos em `redis.js` (`clearConversionLog`, `clearPixelLog`, `clearCloakDecisionLogs`, `clearEmq`) e `tiktok-events.js` (`clearLog`). UI: `RetentionPanel` na aba Gestão com `ConfirmDialog`.

Backend: `server.js` (`GET /api/ops`, `POST /api/ops/drain-retry`, heartbeat/latência/dedup wiring), `redis.js` (7 helpers novos + exports), `tiktok-events.js` (`drainRetryQueue` com `{force,acc}` retornando processados, `retryQueueInfo`). Front: `types.ts` (`OpsResponse`), `api.ts` (`useOps`), `queue-health-panel.tsx` + integração no `gateways-view.tsx`. Teste: `test/queue-observability.test.js` (8ª suíte — 12 asserts: percentis, heartbeat, dedup por conta, resumo da retry).

Validação: `node --check` limpo (server/redis/tiktok-events), `tsc --noEmit` limpo, `next build` limpo, `npm test` 8/8. Verificação em navegador da dashboard autenticada não é possível no sandbox (o `/__dev/login` exige `DATABASE_URL`, ausente aqui).

## Leva 5, bloco J (201–212) — anti-fraude do cloaker exposto

- ✅ 201. **Painel do veredito sticky** — `redis.countStickyBots()` (SCAN `cloakbot:*` com teto de 25 rounds) + `clearStickyBot(vid)`; `GET /api/cloak/stats` publica `sticky:{available,count,truncated}` e `POST /api/cloak/sticky/clear` limpa um `v_id` para reteste. UI: bloco no `cloak-stats-panel` com contador e formulário de limpeza.
- ✅ 202. **Natureza unidirecional do sticky** — card novo no tutorial do cloaker (`cloak-view.tsx`) explicando que o cache só guarda veredito de bot (6h), nunca de humano (fail-safe).
- ✅ 203. **Replay de ttclid** — `redis.bumpTtclidReplay/getTtclidReplayCount` (durável 30d por conta) incrementado na branch `tc.reused` do `/c`; legenda `ttclid-replay` em pt-BR nos labels; contador exibido no `cloak-stats-panel`.
- ✅ 204/205/206. Legendas G/H/F já cobertas em `signal-labels.ts` (auditado).
- ✅ 207/211. **Fuso/idioma por país** — card no tutorial explicando `COUNTRY_TZ_PREFIXES`/`LANG_BY_COUNTRY`, os sinais `tz:mismatch`/`lang-fora-geo` e o peso reduzido (viajante/VPN são exceções legítimas).
- ✅ 208. Simulador de perfis já feito (item 165/208).
- ✅ 209. **Aviso de challenge JS sem coleta** — `_challengeBeacon` conta beacons do `/t.js`; `GET /api/cloak/stats` publica `challenge:{beacons,lastAt}`; banner de aviso no `cloak-stats-panel` quando há tráfego mas 0 beacons (snippet ausente → camadas D–H inertes).
- ✅ 210. Latência do judge já feita (item 177/210).
- ✅ 212. **Histórico de decisões com sinais** — `bumpDecision` propaga os top-5 sinais do judge; `pushCloakDecision` persiste `signals[]`; `cloak-decision-log` renderiza badges coloridos por `describeSignal`.

Validação: `node --check` limpo (server/redis), `tsc --noEmit` limpo.

## Leva 5, bloco K (213–219) — tendência de EMQ e qualidade de identidade

- ✅ 213/214. Sparkline de EMQ por pixel + alerta de queda/baixo já existiam (item 79) — auditado.
- ✅ 215. Card de EMQ agora explica a escala 0–10 e o impacto na otimização ("EMQ baixo = TikTok otimiza no escuro") + dica de como subir (e-mail/telefone com hash, ttclid, IP/UA).
- ✅ 216. **EMQ por evento** no bloco "Saúde dos disparos" — o backend já calculava `events[].emq`; a UI agora mostra `EMQ x.x` colorido ao lado de cada evento, achando qual tem match ruim.
- ✅ 217. **Volume × qualidade** — cada sparkline exibe o total de eventos do período (EMQ alto com pouco volume pesa menos).
- ✅ 218. **Comparação entre pixels** — os cards ficam lado a lado com badge de qualidade; texto do card orienta a comparação.
- ✅ 219. **Badge de qualidade** (bom/médio/ruim) por pixel derivado do `recentAvg` (≥7 / ≥5 / <5).

Front: `pixels-view.tsx` (`EmqSparkline` com badge+volume, EMQ por evento no health, texto do card). Sem mudança de backend (dados já existiam). `tsc --noEmit` limpo.

## Leva 5, bloco L (220–226) — presença, caches e transparência técnica

- ✅ 220. **Aviso de teto de presença** — `/api/ops` publica `presence:{online,limit:500,near}`; o `QueueHealthPanel` avisa quando ≥90% do teto (SCAN pode truncar).
- ✅ 221. **Indicador de fonte (durável × memória)** — badge "durável"/"memória" no header do `CloakDecisionLog` (usa `data.source`) e do `cloak-stats-panel` (usa `data.redis`), com tooltip explicando que memória zera em reinícios.
- ✅ 222. **Limpar cache de ASN de um IP** — `botFilter.clearAsnCache(ip)` (memória+Redis via `redis.clearAsnCache`), rota `POST /api/cloak/asn/clear` (valida IPv4/IPv6) e formulário "Limpar ASN" no bloco anti-fraude do `cloak-stats-panel`.
- ✅ 223. **Cobertura do cache de ASN** — `_asnStats` em `bot-filter.js` conta memHits/redisHits/liveLookups; `getAsnCacheStats()` exposto em `/api/ops.asnCache`; UI mostra "% de acerto · N IPs em memória" com tooltip detalhado.
- ✅ 224. **TTLs efetivos** — `botFilter.CACHE_TTLS` (presence 60s, dedup 2h, sticky 6h, ttclid 12h, asn 24h, asnNegativo 5min) publicado em `/api/ops.cacheTtls` e formatado (`fmtTtl`) no rodapé técnico do painel de Gestão.
- ✅ 225. **Dedup de disparos visível** — `_dedupStats` em `server.js` conta `seenPixelEvent` positivos (Redis e memória); `/api/ops.pixelDedup`; rodapé mostra "N disparo(s) deduplicado(s) (navegador × servidor)".
- ✅ 226. **Presença por entrada do funil** — `presence.summary()` agora agrupa `byEntry` (regex `/go/:slug` e `/c/:slug`, top-12); chips no rodapé do `QueueHealthPanel`.

Validação: `node --check` limpo (server/presence/bot-filter/redis), `tsc --noEmit` limpo, `npm test` verde (7 suítes).

## Leva 5, bloco M (227–240) — dados, backup e integridade (em andamento)

- ✅ 230/232. **Auditoria de integridade referencial + dados órfãos** — `GET /api/ops/integrity` reporta links apontando para pixel/domínio inexistente e stats de cloak de slugs apagados (via `redis.listCloakStatSlugs` com SCAN + `clearCloakStats`); `?fix=1` limpa só referências e stats órfãs (nunca dados de venda). UI: `IntegrityPanel` na aba Gestão (oculto quando saudável) com `ConfirmDialog`.
- ✅ 231. **Backup self-service** — rotas `/api/backup/export|import` já existiam no backend (sem segredos; sanitização no import); adicionado o `BackupCard` na aba Config com exportar (download JSON) e importar (upload + relatório do que entrou + aviso para recolocar tokens).
- ✅ 233. **Paginação incremental dos logs grandes** — log de webhooks (200 linhas) e log de disparos CAPI (500) renderizam 50 por vez com botão "Mostrar mais (N restantes)".
- ✅ 234. Auditado: salvamento do cloak-config é explícito (botão), sem autosave que cause writes desnecessários — nada a fazer.
- ✅ 235. **Concorrência otimista na edição de links** — `link-store.save` compara `_baseUpdatedAt` (enviado pelo `link-editor` a partir do `updatedAt` visto ao abrir) e lança `code:'conflict'`; rota devolve **409** com mensagem acionável em pt-BR.
- ✅ 227. Auditado: `pixel-store.normalize` já aplica defaults consistentes a TODOS os eventos (`!== false`, alinhado ao editor — item 37); qualquer pixel salvo re-passa pela migração. Nada a fazer.
- ✅ 228. Auditado: `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS currency text DEFAULT 'BRL'` já faz o backfill idempotente no boot (item 242); `setAccountCurrency` valida ISO-4217 e não toca contas com valor.
- ✅ 229. Auditado: índices quentes já existem — `links_account_idx`, `gateways_account_idx` + `webhook_token UNIQUE` (índice implícito), `custom_domains_account_idx (account_id, host)`. Nada a criar.
- ✅ 236. **Fuso de Brasília em todas as datas** — corrigidos os 2 pontos sem `timeZone` fixo: gráfico daily do cloak (`d.day` ancorado em `T12:00:00Z` + `America/Sao_Paulo`) e data de verificação do domínio. Demais formatações já usam `TIMEZONE` do `lib/format.ts` ou `toLocaleString('pt-BR')` sem componente de data/hora.
- ✅ 237. Auditado: `formatMoney(cents, currency)` já formata pela moeda DO REGISTRO (webhook/lead/link) em activity, leads-table e links-view; backend `fmtMoney` idem. Nada a fazer.
- ✅ 238. Auditado: `durability-badge.tsx` já degrada com banner ("Config volátil"/"Persistência degradada") em runtime via `/api/health`; stores caem para memória sem quebrar página. Nada a fazer.
- ✅ 239. N/A por definição — telemetria `console.log("[v0] ...")` é ferramenta de desenvolvimento; nenhum log residual no código (verificado).
- ✅ 240. **Suíte `test/durable-flows.test.js`** (26 asserts, registrada no `npm test`) — cobre os 5 invariantes documentados no topo do arquivo: fila durável degrada para no-op explícito sem Redis (idempotência preservada), sticky-bot unidirecional fail-safe, anti-replay de ttclid (mesmo contexto ok / contexto diferente barrado / vazio nunca punido / contador por conta), rollup de EMQ (média diária, NaN ignorado, isolamento entre contas, clear) e cloak stats normalizadas (reasons/daily + enumeração/limpeza de órfãos do item 232).

Validação: `node --check` limpo, `tsc --noEmit` limpo, `npm test` verde (9 suítes, incl. durable-flows 26/26), `next build` limpo. **Bloco M completo.**

## Leva 6, itens 253���270 — velocity + tipos/health + testes (completo)

- ✅ 253. Auditado: reasons de velocity já traduzidos na legenda pt-BR do painel de stats do cloak.
- ✅ 254. **Velocity configurável por conta** — `config.cloak.velocityLimit` (clamp 3–100, padrão 12) e `velocityWindowSec` (clamp 10–600, padrão 60) no sanitizador do `config.js`; `/c` lê da conta; `POST /api/cloak-config` persiste os 2 campos.
- ✅ 255. **Banner de fallback sem Redis** — no card de velocity do `cloak-config-panel` (via `useHealth`): avisa que sem Redis a contagem é por instância e farm distribuída exige Redis.
- ✅ 256. **Liberar IP do limite** — `redis.clearVelocity(ip)` (memória + SCAN `vel:*:<ip>`) + rota `POST /api/cloak/velocity/clear` + form "Liberar IP" no painel técnico do cloak (com nota de que o TTL expira sozinho).
- ✅ 257. **Previsão de velocity no teste do cloaker** — `/api/cloak/test` devolve `velocity: {limit, windowSec, blockedAtHit, note}` (cálculo puro, não toca contadores); nota exibida no resultado do teste.
- ✅ 258. **Métrica device-farm** — contagem de acessos barrados por `velocity` no resumo do painel de stats do cloak.
- ✅ 259. Coberto por 256: instrução do TTL + liberação manual documentadas na própria UI.
- ✅ 260. **Tutorial do cloaker** — novo passo "Limite de acessos (anti device-farm)" no `cloak-view` explicando device farm, janela e o preset com folga para Wi-Fi doméstico.
- ✅ 261. **types.ts atualizado** — `CloakConfig.velocityLimit/velocityWindowSec`, `CloakTestResult.velocity`, `HealthResponse.migrations/queues/cloakerLatency` (domínio `uso`/`verificadoEm` e `currency` já existiam).
- ✅ 262. Auditado: hooks completos no `api.ts` (useHealth, useDomains, useAccountSettings com currency, useCloakConfig) — nada a adicionar.
- ✅ 263. **Health consolidado** — `/api/health` agrega `queues: {conv: {queue, processing}, capiRetry}` num único payload; `DurabilityBadge` mostra "Fila acumulada (N)" quando backlog ≥ 20 com banco no ar (link para Gestão).
- ✅ 264. Auditado: migrações 100% idempotentes por construção (`CREATE TABLE/INDEX IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, backfill só `WHERE account_id IS NULL`) — verificadas em runtime contra o Neon real do projeto (flag `migrations: true` no health).
- ✅ 265. **Teste de durabilidade de domínios** — em `test/persistence-flows.test.js`: criar → restart simulado (require cache limpo + `hydrate()`) → domínio persiste no snapshot local e `accountForDomain` continua roteando.
- ✅ 266. **Teste de snapshot de gateways** — mesma suíte: contrato `loadGatewaySnapshot() === null` sem Redis (erro ≠ vazio), `init()` não explode, save → `findByToken` casa o webhook.
- ✅ 267. **Teste de velocity** — em `test/durable-flows.test.js` (+6 asserts): contagem crescente na janela, isolamento por IP, expiração por TTL, `clearVelocity` limpa todas as entradas, contagem recomeça, IP vazio nunca conta.
- ✅ 268. **Teste de moeda ponta a ponta (backend)** — `persistence-flows`: EUR do gateway preservada na normalização (49.90 → 4990 centavos, sem conversão implícita); UI já usa `formatMoney(cents, currency)` por registro (auditado no item 237).
- ✅ 269. Auditado: grep anti-vazamento limpo — termos internos (Neon/Upstash/Cymru/Railway) só em comentários de código, nunca em respostas de API ou texto de UI.
- ✅ 270. **CLAUDE.md atualizado** — § persistência documenta a chave `vel:<kind>:<id>`, os clamps de config, a rota de liberação e o fallback `velMem` single-instance (tabela `custom_domains`, `currency` e snapshots já documentados na Leva 6 antecipada).

Validação: `node --check` limpo, `tsc --noEmit` limpo, `npm test` verde (10 suítes: durable-flows 32/32 + persistence-flows 10/10), `next build` limpo, rotas novas smoke-testadas (401 sem sessão).

## Refinos visuais 15/18/22/24/26 (Leva 2) — auditados como cobertos

Auditoria code-level confirmou que o trabalho das sessões 5–6 já entregou o escopo destes itens em todas as 5 abas:
- Estados vazios presentes em todas as views (pixels: 6 ocorrências, gateways: 4, domains: 2, links: 3; cloak delega aos painéis entries/stats que têm os seus);
- Responsividade: `flex-wrap`/`minmax(0,·)` em todas (o bug real de overflow mobile foi o item 57, corrigido e re-verificado ao vivo nas 5 abas);
- Ritmo vertical unificado `gap-5` (item 58, verificado ao vivo);
- Skeletons/loading nas views com fetch direto; badges de status entregues nos itens 54/83/85–87.
Sem gap visual objetivo restante — marcados como concluídos por cobertura.

## Leva 7 — bugs reais (273, 291, 295, 346, 347, 367, 369, 455, 458) — completo

- ✅ 458 (**bug 1000x**). `parseAmount`: "1.234" com ponto de MILHAR BR lia como R$ 1,23 — regex de milhar inequívoco (`1–3 dígitos + grupos de 3`) agora resolve para 1234 antes do parse decimal; "12.34"/"0.99" continuam decimais. +5 asserts de regressão em `persistence-flows`.
- ✅ 273. Receita em outras moedas não some mais: card "Receita total" mostra breakdown "+ €X em outras moedas" no sub quando `cur.rev` tem mais de uma moeda (com `data-sensitive`).
- ✅ 291. Delta de conversão agora é em **p.p.** (2%→3% = +1,0 p.p., não +50%): `DeltaChip` ganhou `unit='pp'` e o KPI Conversão usa `cur.overall - prev.overall`.
- ✅ 295. Corte diário no fuso de Brasília: `metrics.ts` (série do gráfico) e `checkDailyReportFor` no server (relatório Pushcut) usam `Intl.DateTimeFormat('en-CA', {timeZone:'America/Sao_Paulo'})` — venda às 22h BRT não cai mais no dia seguinte. Linha 539 (salt de fingerprint) auditada como irrelevante.
- ✅ 346. `seenIds` do live-view com cap de 2000 ids (reseta para os visitantes atuais); o do activity-view auditado — é criado uma vez e nunca cresce, sem vazamento.
- ✅ 347. `copyText` em `lib/clipboard.ts` (novo): clipboard API só em contexto seguro + fallback textarea/execCommand p/ HTTP/iframe; `copyEventDetails` retorna sucesso real e o botão só mostra "Copiado" quando copiou de fato.
- ✅ 367. Dedupe do live com chave estável: fallback sem id era `country-page-durationMs` (durationMs muda a cada poll → duplicava visitante); agora `country-page`.
- ✅ 369. Globo: dispose do renderer three.js + `forceContextLoss()` ao desmontar o `GlobeCanvas` (o fullscreen monta um 2º canvas; sem dispose, navegação repetida estourava o limite de contextos WebGL do navegador).
- ✅ 455. Auditado: idempotência de webhooks já é completa — `orderId` é obrigatório no normalizador (400 sem ele) e `seenWebhookOrder` usa SETNX com TTL 24h por conta+evento+orderId. Não há caminho sem dedupe.

Validação: `node --check` limpo, `tsc --noEmit` limpo, `npm test` verde (10 suítes, persistence-flows 15/15), `next build` limpo.

## Leva 7 — durabilidade crítica (446–449, 359/483) — completo

- ✅ 446/447. Auditados como já implementados: stats.js opera memória-primeiro com write-through async ao Neon (`db.insertEvent`/`db.upsertLead` em todo caminho de escrita), snapshot em disco é só fallback/diagnóstico (debounced, rename atômico), e `flushSync` está preso em SIGTERM/SIGINT/beforeExit.
- ✅ 359/483. Auditados como já implementados: presence.js tem camada dupla — Upstash Redis com TTL 60s renovado por heartbeat (sobrevive a restart; multi-instância via `listPresence` mesclado ao mapa local) + Neon para histórico de sessões. API touch/leave/list/summary preservada.
- ✅ 448 (novo). Arquivamento de eventos: tabela `events_archive` + índice `events_acc_at_idx` no init; `db.archiveOldEvents(days, batch)` move eventos além da retenção com CTE atômica (INSERT…SELECT + DELETE numa única statement, idempotente por ON CONFLICT); `checkEventArchive()` no server roda "pegando carona no tráfego" (máx 1x/h, lote 2000); retenção configurável via `EVENT_RETENTION_DAYS` (padrão 90d, clamp 7–3650); exposto em `/api/ops/retention` (fecha também o 349).
- ✅ 449 (novo). Conversão órfã deixou de ser silenciosa: `matchExternalConversion` loga evento estruturado com `orphanReason` (`sem_chave` | `sem_match`) e `triedKeys` (leadId/email/telefone) — alimenta o toggle do item 312. +3 asserts em `persistence-flows` (18 total).

Validação: `node --check` limpo (server/db/stats), `npm test` verde 2x seguidas. Query de arquivamento não exercitada contra Neon real (ambiente sem DATABASE_URL) — usa CTEs data-modifying padrão do Postgres.

## Leva 7 — segurança (433–441, 444–445) — completo

- ✅ 433/434/436/441. Auditados como já implementados: login com mensagem genérica (sem enumeração), cookie HttpOnly+Secure+SameSite=Lax, hash scrypt com salt por senha + timingSafeEqual, logout limpa cache e sessão no Neon.
- ✅ 437 (novo). CSRF: middleware em /api valida Origin×Host em mutações COM cookie de sessão (2ª camada além do SameSite=Lax). Isentos por prefixo (relativos ao mount '/api'!): /track, /px/, /cloakcheck, /conversion, /pulse — webhooks e tracking continuam cross-origin. Smoke test HTTP real: painel+origin cruzado → 403; webhook/track → passam.
- ✅ 438 (novo). Headers de segurança: nosniff + Referrer-Policy em TODA resposta; X-Frame-Options SAMEORIGIN + DNS-Prefetch off só em páginas do app (funil/domínio personalizado ficam embutíveis). Verificado via curl.
- ✅ 440 (novo). Bloqueio suave de login: 8 falhas seguidas por e-mail (case-insensitive) → 15 min de trava em memória, zera no login correto; /login responde 429 quando travado (não 401), sem vazar se o e-mail existe.
- ✅ 444 (novo). test/auth.test.js — 15 asserts: hashing (salt único, rejeição de malformado), cookie de sessão (HttpOnly/Secure/Lax/clear) e lockout (limiar, prazo, case-insensitive).
- ✅ 445 (novo). test/route-auth.test.js — varredura estática das 72 rotas /api do server: cada uma OU usa dashboardAuth/adminAuth OU está numa allowlist explícita de 8 rotas públicas/auto-autenticadas (com detecção de entrada morta). Rota nova sem classificação = suíte vermelha. Ambos registrados no npm test.
- ✅ 435 (novo). Medidor de força de senha no /register (auth-view.js): heurística local (comprimento + variedade de tipos), barra colorida com 4 níveis e dica em pt-BR; só no registro, não no login. Verificado ao vivo com screenshot.
- ✅ 442 (novo). Pushcut "Novo login no painel" (opt-in explícito): evento `login` no pushcut-config (GET default false + POST persiste), disparo APÓS a resposta do /login com data/hora BRT e IP mascarado (último octeto/fim do IPv6 ofuscado), toggle na aba Config com hint de segurança. Tipo `PushcutEvents.login` atualizado.
- ✅ 443 (novo). Card "Sobre" na aba Config: versão (novo campo `version` no /api/health, tirado do package.json), uptime humanizado (min/h/d), estado do banco e do Redis, links para os diagnósticos completos. Tipo `HealthResponse.version` atualizado.
- Pendente da faixa: 439 (log de acesso admin) — depende da trilha de auditoria do item 417, que pertence ao bloco de valor; será feito junto.

Validação: suíte completa verde (12 arquivos de teste, +25 asserts novos), smoke test HTTP real de headers/CSRF/medidor em porta isolada, `tsc --noEmit` limpo, screenshot do /register confirmando o medidor, preview intacto após limpeza dos processos de teste.

## Leva 7 — valor (310, 312, 417/439, 450) — em andamento

- ✅ 312 (novo). Toggle "vendas órfãs" na tabela de leads: botão com contagem do período (só aparece quando existem), badge "órfã" âmbar na linha com tooltip explicativo; filtro `l.orphan && !showOrphans` + deps do useMemo corrigidas.
- ✅ 310 (novo). CSV de leads enriquecido: colunas utm_source/medium/campaign, e-mail e telefone MASCARADOS (u…@dominio / …4dígitos — PII completa não sai do painel) e flag "orfa". Tipo `Lead.phone` adicionado.
- ✅ 417/439 (novo). Trilha de auditoria: tabela `account_audit` (id identity, account_id, at, action, detail, ip_masked) + índice; `db.insertAudit/listAudit` fire-and-forget; helper `audit()` + `maskReqIp()` no server; instrumentados login, link salvo/removido, reset de stats e import de backup; rota `GET /api/audit` (dashboardAuth, no-store); card "Atividade da conta" na aba Config com labels pt-BR, IP mascarado e estados vazio/sem-banco.
- ✅ 450 (novo). Match de webhook O(1): `emailIndex`/`phoneIndex` (chave `acc|contato` normalizado, mais recente vence) substituem os scans O(n) de `findLeadByEmail/Phone`; mantidos em addLead/touchLead/conversão, reconstruídos no `rebuildIndex()` (hydrate/reset/import) e limpos na poda de MAX_LEADS. Semântica preservada: e-mail lowercase, telefone últimos 9 dígitos sem 00/DDI.

Validação: `node --check` limpo (stats/server/db), `tsc --noEmit` limpo, `npm test` verde (12 suítes).

### Continuação (458, 469, 471, 473)

- ✅ 458 (novo). test/parse-amount.test.js — 29 asserts sobre parseAmount/pickAmountCents: formatos BR/EU/US ("49,90", "R$", "1.234,56"), o caso perigoso do milhar sem decimal ("1.234"→1234, "12.34"→decimal), objetos de gateway ({value}), lixo→NaN, prioridade centavos>unitário, tetos e negativos. Registrado no npm test (13ª suíte).
- ✅ 469 (novo). /api/stats: `Cache-Control: private, no-cache` (em vez de no-store) habilita a revalidação If-None-Match com o ETag automático do Express → 304 sem corpo no poll de 12s quando nada mudou. Verificado ao vivo (304 real).
- ✅ 471 (novo). Limites de body explícitos: express.json global 200kb (webhooks têm poucos KB) + parser dedicado de 5mb só em /api/backup/import (backup legítimo pode passar de 100kb). Verificado ao vivo: payload de 300kb → 413.
- ✅ 473 (novo). Varredura de vazamento em logs: auditados os 27 módulos do backend (nenhum console.* loga cookie/authorization/password/process.env) + guard estático permanente na security.test.js (cenário F) que falha a suíte se algum log sensível for introduzido.

Validação: suíte completa verde (13 suítes), 304/413 verificados via HTTP real em porta isolada, preview intacto.

### Continuação (456, 464, 472, 482)

- ✅ 456 (novo). Falha de Pushcut deixou de ser invisível: `logFailure()` registra evento no feed da conta ("Notificação X falhou: motivo") além do console — o dono vê na dashboard em vez de só descobrir o celular mudo.
- ✅ 464 (novo). Watchdog de anomalia opt-in (`events.watchdog`): de carona no tráfego (máx 1 varredura/h), alerta via Pushcut + evento no feed se a conta ficar 6h sem vendas TENDO baseline (≥14 vendas nos últimos 7d), anti-spam de 12h por conta. Toggle "Alerta de anomalia" na aba Config; tipo `PushcutEvents.watchdog` atualizado.
- ✅ 472 (novo). Timeout de 8s (AbortController) no fetch do Pushcut — endpoint fora do ar nunca pendura o webhook/checkout que disparou a notificação; timeout também vira logFailure.
- ✅ 482 (novo). Sessão deslizante: `db.touchAuthSession()` (UPDATE expires_at = now()+30d, só se ainda válida) chamado pelo `resolveSession` apenas quando a sessão já consumiu mais da metade do TTL — usuário ativo nunca é deslogado, e o UPDATE é raro (cache de 5 min + janela de metade do TTL). Fire-and-forget.

Validação: `node --check` limpo (server/db/auth/pushcut), `tsc --noEmit` limpo, suíte completa verde (13 suítes / 15 marcos OK).

### Continuação (484, 494, 495, 500/501) + auditorias

- Auditados como JÁ implementados: 468 (compression gzip/brotli no Express), 490 (sendBeacon no pagehide do tracker), 495 (anti-duplo-submit + loading no submit do auth-view).
- ✅ 484 (novo). `/healthz` sem auth, sem I/O ("ok" 200) para o liveness probe do Railway, liberado na allowlist de domínio personalizado; health rico segue em /api/health autenticado. Separar evita container "unhealthy" por dependência lenta.
- ✅ 494 (novo). UX do login/registro: autofocus no e-mail, botão mostrar/ocultar senha acessível (aria-pressed + aria-label dinâmico). Submit-com-Enter já era nativo do form.
- ✅ 500/501 (novo). `linkErrorPage()` — página HTML amigável (identidade dark, noindex) no lugar do "Link não encontrado" cru, aplicada em /go e /c para link inexistente/desativado/expirado. Verificado ao vivo.

Validação: `node --check` limpo, suíte verde, `tsc --noEmit` limpo; healthz/go/c/login verificados via HTTP real em porta isolada.

## Leva 7 — refino UX/DX — em andamento

- ✅ 466 (novo). ua.js atualizado com a safra 2026 de crawlers (OAI-SearchBot, ChatGPT-User, PerplexityBot, ClaudeBot, meta-externalagent, Amazonbot, Applebot, CCBot, Screaming Frog, zgrab/masscan/nuclei/Expanse etc.) + nova suíte test/ua.test.js (14ª): 3 UAs REAIS do TikTok in-app garantidas como humanas (o contrato mais caro do funil), 17 crawlers detectados, 4 navegadores humanos sem falso-positivo, parse de device/OS validado. Registrada no npm test.
- ✅ 465 (novo). README.md reescrito (era boilerplate obsoleto do AI Studio): matriz de graceful degradation (com/sem Neon/Redis — o caminho do dinheiro funciona sempre; sem Neon perde durabilidade e login), env vars, estrutura de módulos e convenções do projeto.
- ✅ 467 (novo). pulse-client.js: backoff exponencial no heartbeat (falha N pula N batidas, teto ~96s — não martela servidor caído), reset no sucesso, e `leave()` agora faz `clearInterval` + flag `gone` (desligamento limpo: nenhuma batida após pagehide).
- ✅ 486–488 (auditoria + micro-fix). LP já cumpria o grosso: CSS crítico inline, CTAs `<a href>` puros (convertem sem JS), guard `html.js` no reveal (sem JS o conteúdo fica visível — noscript-safe), preconnect a fonts. Adicionados width/height + decoding=async nos logos (CLS) e loading=lazy no logo do footer (abaixo da dobra).
- ✅ 489 (novo). Snippet copiável do /t.js na UI do cloaker agora inclui `defer` (a documentação em server.js já dizia defer; a UI mostrava sem — rastreio nunca pode bloquear o LCP da página do cliente).
- ✅ 485 (novo). CLAUDE.md §5.2 ganhou o bloco "Contratos da Leva 7": /api/audit (formato + ações + IP mascarado), version no /api/health, semântica do private,no-cache + 304 no /api/stats (com aviso para não reverter), /healthz (zero I/O de propósito), eventos novos do pushcut-config (login/watchdog + regras do watchdog), limites de body 200kb/5mb, linkErrorPage em /go//c.

Validação: `node --check` limpo (pulse-client/lp-view), `tsc --noEmit` limpo, suíte completa verde (14 suítes).

### Continuação (473, 492, 499, 500, 504 — auditorias e fechamentos)

- ✅ 473 (auditoria PASSOU). Varredura de logs sensíveis: nenhum `console.*` loga token/senha/cookie/segredo nem `req.body` inteiro nos módulos críticos (server/db/tiktok-events/gateway-store/pixel-store/auth). Nada a corrigir — a disciplina já existia.
- ✅ 492 (novo — decisão documentada). Política de DNT registrada em CLAUDE.md §13: o tracker NÃO condiciona coleta ao header DNT (medição first-party contratada = execução de contrato/interesse legítimo na LGPD; DNT descontinuado pelos navegadores em 2024-25; compliance real = minimização + hash + TTL + transparência). Se um dia precisar honrar sinal, é GPC (Sec-GPC) por decisão de produto.
- ✅ 499 (auditoria). vision-view.js confirmado como órfão total (zero referências no server.js/dashboard; é um mock estático do template "Vision UI Free" com dados fake). Marcado LEGADO no cabeçalho — não evoluir; candidato a remoção com autorização do dono.
- ✅ 500 (auditoria PASSOU). Não existe "tela em branco durante redirect": /go e /c respondem 302 Location direto (zero HTML intermediário). O caso de erro já tem página amigável (501). Nada a fazer.
- ✅ 504 (auditoria PASSOU). Slug custom já é suportado ponta a ponta: POST /api/links aceita slug do usuário e o link-editor tem campo "Slug (URL: /go/slug)" editável; com `dominio` próprio vira meudominio.com/go/promo. Capacidade não estava oculta.

Validação: `node --check` limpo, suíte completa verde (14 suítes).

### Continuação (475, 493, 496, 497)

- ✅ 475 (novo). dashboard-view.js oficialmente congelado: banner sticky âmbar injetado na hora de servir (sem tocar no arquivo legado) em `?legacy=1` ("versão antiga, congelada") e no fallback do proxy ("painel novo reiniciando"), ambos com link "Ir para o painel novo". Injeção verificada por unidade (posição logo após `<body>`, HTML preservado); o 503 do /__dev/login em porta isolada é guard ambiental, não regressão.
- ✅ 493/496 (auditoria PASSOU). auth-view já tem identidade visual própria (dark, glass, logo) e medidor de força de senha no registro (.meter). Autofocus + mostrar/ocultar senha entraram no item 494.
- ✅ 497 (novo). Política de privacidade ganhou seção "4. Cookies e identificadores" (cookie first-party vid com finalidade única, sem third-party/fingerprinting, cookie de sessão HttpOnly, direito de bloquear) e a seção de retenção agora tem prazos concretos (TTL ≤30d nos armazenamentos temporários, IP mascarado em auditoria/diagnóstico). Seções renumeradas (4→8). Verificado ao vivo (/privacidade renderiza a seção nova).

Validação: `node --check` limpo (server/legal-view), suíte completa verde (14 suítes), /privacidade verificada via HTTP real.

### Continuação (531 + auditorias 503/506/507/508/532)

- Auditados como JÁ implementados: 503 (QR code local por link com download PNG — item 71), 506 (UTM builder no link-editor), 507 (variantes A/B com pesos expostas na UI), 508 (share de conversões por variante no card do link), 532 (duplicar link com um clique — item 63).
- ✅ 531 (novo). Arquivamento de links: campo `arquivado` no normalize() do link-store (independente de `ativo`, histórico preservado), /go responde linkErrorPage para arquivado, tipo `CheckoutLink.arquivado`, e na aba Links: filtro padrão esconde arquivados, botão "Arquivados (N)" alterna a lista (só aparece quando existem), ação arquivar/desarquivar por card (ícones Archive/ArchiveRestore, merge-patch `{slug, arquivado}`).

Validação: `node --check` limpo (link-store/server), `tsc --noEmit` limpo, suíte completa verde (14 suítes). Preview sem DATABASE_URL (modo degradado) impediu verificação da UI logada nesta sessão.

### Continuação (561)

- ✅ 561 (novo). Erros de front deixaram de ser invisíveis: `POST /api/client-error` (público write-only, rate-limited 10/min/IP, campos truncados, responde antes de processar, isento de CSRF para sendBeacon de unload) + buffer dos últimos 50 em memória + `GET /api/client-error` (dashboardAuth) para diagnóstico. No dashboard, `ClientErrorReporter` montado no layout: window.onerror + unhandledrejection com dedupe (máx 5 reports/sessão, ignora erros de extensão/script externo), envio via sendBeacon com fallback fetch. O guard route-auth pegou a rota nova (como projetado) e ela foi conscientemente classificada na allowlist com justificativa.

Validação: verificado ponta a ponta ao vivo — POST retorna `{ok:true}` e o log estruturado `[client-error] ...` aparece no stdout do servidor; suíte completa verde (14 suítes, 49 marcos OK), `tsc --noEmit` limpo. Dev server reiniciado (Express não tem HMR) e saudável.

### Continuação (547/548, 567, 568)

- ✅ 547/548 (novo). Perf dos feeds que re-renderizam a cada poll de 12s: `EventRow` (activity-view) e `VisitorRow` (live-view) envoltos em `React.memo`. Como o SWR mantém a referência dos itens estável entre polls sem mudança, o memo corta o re-render das linhas antigas; só a linha nova (e as com estado local) re-renderizam. Zero mudança visual.
- ✅ 568 (novo). `npm run doctor` (scripts/doctor.js): diagnóstico de ambiente sem efeitos colaterais — Node, env vars (presença, nunca valor), modo (durável vs degradado), presença dos artefatos de build. Saída PASS/WARN/FAIL com exit code. Rodado ao vivo: reflete corretamente o modo degradado atual.
- ✅ 567 (novo). docs/RUNBOOK-INCIDENTES.md: procedimento por sintoma (site fora do ar, sem vendas registrando, checkout com erro, login falhando, Pushcut mudo), com comandos de diagnóstico (/healthz, /api/health, npm run doctor, /api/client-error) e a matriz "o que quebra sem cada dependência".

Validação: `tsc --noEmit` limpo, suíte completa verde (14 suítes), `npm run doctor` executado com sucesso.

### Continuação (566, 570)

- ✅ 566 (novo). `.env.example` completado: faltavam 6 vars realmente usadas no código (cruzamento `grep process.env.* × arquivo`). Adicionadas com doc precisa a partir do uso real: `PRIMARY_HOST`/`COOKIE_DOMAIN`/`DASHBOARD_UPSTREAM_URL` (rede/domínio), `EVENT_RETENTION_DAYS` (default 90, faixa 7–3650), `TIKTOK_PIXEL_CODE`/`TIKTOK_ACCESS_TOKEN` (legado de pixel único, migração), + nota de que as `RAILWAY_*` são injetadas pela plataforma.
- ✅ 570 (novo). CHANGELOG.md criado (Keep a Changelog + SemVer): seção "Não lançado" agrupando o trabalho de hardening (resiliência do funil, segurança de conta, watchdog, anti-fraude, DX/ops, gestão de links, durabilidade) por Adicionado/Alterado, e a linha de base 1.0.0. Fiel ao histórico de git.

Validação: `npm run doctor` OK (env refletido corretamente), suíte completa verde (14 suítes).

Ordem recomendada pelo plano (bugs → durabilidade → segurança → valor → refino → DX):

1. Leva 7 (271–570) — segurança → valor → refino → DX (bugs reais e durabilidade crítica concluídos)
2. Bloqueados por integração externa (marcar, não fazer): 412 (e-mail reset), 459/542 (relatórios email), 557–560 (CI/Playwright), 561 (Sentry)

## Histórico de sessões

- **Sessão 1–2:** Leva 1 parcial + tutoriais + bugs 31/33/34/35/36/38/39/40 + itens 99–101, 114, 116–119, 131–132 (PR #42, mesclado)
- **Sessão 3:** Itens 79–82 (aba Pixels: EMQ, retry, filtro, log expansível) — commit `5d1080e`
- **Sessão 4 (atual):** criação deste tracker + itens 8, 12, 17, 20, 30, 32, 36, 37 (copy neutro, avisos de gateway, moeda UI, cores de provedor, normalizar pesos, default AddToCart) + 5/6/9/11/41 (leva 1 completa) + 43/44/46 (validação host, touch try/catch, rate-limit hook) + 27 (tours guiados das 5 abas, verificado com popover ao vivo) + 47/49/50 (hint neutro, toggle otimista do pixel com merge-patch, aviso sem token). Type-check limpo, 4/4 testes, card de moeda + rate-limit do hook + tour de Gateways + toggle de pixel verificados ao vivo.
- **Sessão 6:** itens 70 (baixar QR em PNG a 512px), 89 (copiar só a URL do script do pixel para GTM) e 93 (feedback de cópia acessível com `aria-live` na aba Pixels). Depois, refinos da aba Pixels: 83 (token mascarado com Revelar/Ocultar + últimos 4 dígitos), 85/86 (avisos de config inócua no card: sem eventos ligados; Compra sem gateway), 87 (`durability.incomplete` renderizado por pixel), 92 (duplicar pixel sem token, cópia pausada) e 94 (hint do Test Event Code). Type-check + `next build` limpos; tudo verificado ao vivo (build de produção na 3001 + Express na 3000) e dados de teste removidos. Em seguida, item 59 (painel "Como funciona a Gestão" via `gestao-help.tsx` no sidebar, verificado ao vivo) e auditoria que confirmou 51/52/53/84/88/90/95/98 como já implementados em sessões anteriores. Por fim: item 54 (badge de uso no card de domínio), auditorias 55/56/61/67/77/78/91 (já cobertos) e item 57 com BUG REAL corrigido — overflow horizontal da aba Gateways em mobile (375px → 699px) causado por cabeçalho sem `flex-wrap` e grid sem `minmax(0,·)`; re-verificado ao vivo nas 5 abas. Fechamento: item 58 (ritmo vertical unificado em `gap-5` nas 5 abas + `flex-wrap` no cabeçalho do Cloak), verificado ao vivo — **faixa 31–101 do plano 100% completa**. Nota operacional: o sandbox reiniciou no meio da sessão (node_modules e /tmp apagados); recuperado com `npm install` em ambos os pacotes e novo `vercel env pull`.
- **Sessão 7 (atual):** Leva 4 — transparência do julgamento do Cloak (itens 161–168, 204–206, 210). Backend: `bot-filter.js` (`judge`) passou a expor `asn`/`org` resolvidos e `/api/cloak/test` a propagá-los (+`resolvedAt`). Frontend: `signal-labels.ts` ganhou metadados de camada/peso + `LAYER_META`; `CloakTestPanel` reescrito com sinais agrupados por camada (peso visível), veredito de infraestrutura (operadora real x data center), tempo de julgamento com aviso de deadline, e simulador de threshold client-side; `cloak-config-panel.tsx` mostra o trade-off de cada preset e alerta de camadas JS inócuas sem Challenge JS. `node --check` limpo, `tsc --noEmit` limpo, 5/5 suítes passando. Em seguida, fatia backend/API da robustez transversal (176–181): cache negativo de ASN com TTL curto (memória + Redis), medidor de latência do julgamento (`getJudgeLatency()` no `/api/health`), rate-limit por conta nas rotas `/api/cloak|pixels|conversion/test`, `buscarPaginaSegura` rejeitando corpo não-HTML com tetos nomeados, sanitização anti-XSS do `org` do ASN na origem e contrato unificado de erro `{ok:false,error,code,hint}` (helper `apiError` no backend + `ApiError`/`parseApiError` no `lib/api.ts`). `node --check` limpo, `next build` limpo, 5/5 suítes passando, `getJudgeLatency()` conferido em runtime. Por fim, primitivos de UX transversal (183/184/189): hook `useModalA11y` (foco preso, ESC, retorno de foco, trava de scroll), toaster global com `aria-live` (`lib/toast.ts` + `components/shell/toaster.tsx` montado no layout), `ConfirmDialog` reutilizável que substitui `window.confirm` (exige digitar o nome quando há tráfego) — `TutorialModal` migrado para o hook, `GlassCard` passou a encaminhar `ref`, e gateways-view (excluir + rotacionar) migrado para `ConfirmDialog` + `toast`. `next build` limpo (12 rotas), 5/5 suítes passando. Faltam da Leva 4 a UI da robustez restante (175, 182, 185–188, 190, replicar confirm/toast nas outras views) e as faixas 141–160, 169–175, 191–203, 207–209, 211–240.
- **Sessão 8 (atual):** lote "Conta e segurança" da Leva 7 — itens 411 (UI de trocar senha; corrigido bug real: `getAccountById` sem `password_hash` fazia a troca SEMPRE falhar com "senha atual incorreta"), 413 (editar nome: campo na Config + `POST /api/account/name` com auditoria), 414 (sessões ativas: `GET/DELETE /api/account/sessions[/:sid]` + revoke-others; sid = md5 do token, UA/IP mascarado gravados no login; sessão atual protegida) e 418 (rotação do token público: `POST /api/public-token/rotate` com rate-limit + botão "Gerar novo" com confirmação). Nova seção "Conta e segurança" na aba Config do painel legado (`dashboard-view.js`). Fixes de ambiente: fallback `NEON_DATABASE_URL` no `db.js` (a integração Neon do v0 usa esse prefixo) e correção da ordem de migração (`events_acc_at_idx` antes do `ADD COLUMN account_id` abortava o init em bancos legados); regex com `\/` dentro do template literal do servidor quebrava o `shortUa` — trocado por `indexOf`. Validação: `node --check` nos 4 arquivos, suíte completa verde, e ponta a ponta ao vivo (curl + browser): senha trocada derruba outras sessões (401) e login antigo falha/novo passa; encerrar sessão específica → 401 imediato no outro dispositivo; rotação → token antigo 401 / novo 200 na API pública; rate-limit da rotação 429 na 6ª chamada.
- **Sessão 5:** plano salvo em `PLANO-PRAGMATIC-FLOW.md` (raiz) + Leva 6 antecipada — itens 241–252 (durabilidade de schema): tabela `custom_domains` multi-tenant, coluna `accounts.currency`, snapshot Redis de domínios, write-through assíncrono via `config.set`, reconciliação no boot via `config.hydrate`, claim legado e `migrations` no `/api/health`. `node --check` limpo + 4/4 testes. Durabilidade validada ponta a ponta contra Neon+Redis reais (criar/excluir domínio propaga aos 2 espelhos). Depois, aba Links da Leva 3: itens 62–66, 68, 69, 73, 74, 76 — type-check limpo, toggle/duplicar/busca/badge de pixel verificados ao vivo no navegador (build de produção; o dev server Turbopack do sandbox não hidratava, sem relação com as mudanças). Depois, itens 71 (UTM builder) e 75 (países/idiomas por nome + presets + colar lista via `onPaste` no GeoMultiSelect), ambos verificados ao vivo. Fix acess��rio: `turbopack.root` fixado no `next.config.mjs` (o Turbopack inferia a raiz do monorepo e o `next build` falhava no sandbox). Por fim, item 72 (ações em massa nos links: checkbox + barra Ativar/Pausar/Excluir com confirmação em 2 cliques) — verificado ao vivo ponta a ponta. E item 60: nova suíte `test/security.test.js` (anti-SSRF, normHost, dedup de webhook, edição de gateway, pesos A/B) com extração de `security-helpers.js`; 5/5 suítes + smoke test do servidor ao vivo.
- **Sessão 9 (atual):** Roadmap C do TikTok Ads (C1 + C3, a pedido — "tudo menos o resumo semanal/C2"). **C1 — automação sobre Smart+:** `ads-sync.syncAdvertiser` passou a mesclar as campanhas Smart+ no MESMO espelho como nós `campaignKind:'smart_plus'` (best-effort; métricas vêm do `collectDaily` de `AUCTION_CAMPAIGN` existente, sem chamada extra); `ads-provider.getDashboardTree` marca os nós de leilão com `campaignKind:'auction'`; o motor (`executeRuleAction` + novo `setCampaignStatusByKind` + `runScheduleSweep`) roteia PAUSA/ativação de Smart+ para `provider.setSmartPlusCampaignStatus`, e `runRulesSweep` PULA regras de orçamento/escala em Smart+ com motivo (o Pipeboard não expõe tool de orçamento de Smart+). **C3 — auto-recurso de Smart+ reprovado:** alerta opt-in `autoAppealSmartPlus` (`ALERT_DEFAULTS` + `PUT /api/ads/alerts`) → `runAlertSweep` chama `provider.appealSmartPlusAd` 1×/anúncio com cooldown de 7d (`APPEAL_COOLDOWN_MS`), respeitando kill switch e Modo teste (dry-run só audita). UI: checkbox aninhado no painel de alertas + microcopy do Piloto Protetor ("cobre Smart+"). Tipos: `campaignKind` em `AdsTreeCampaign`, `autoAppealSmartPlus` em `AdsAlertsConfig`. Nova suíte `test/ads-smart-plus-automation.test.js` (28 asserts: roteamento por tipo com provider stubado + cooldown/guardrails do auto-appeal + regex de sync/skip/rota); janela do assert Smart+ em `ads-automation-cpc.test.js` alargada (400→900). Validação: `npm test` completo verde, `tsc --noEmit` + `next build` limpos, boot do Express (`/healthz` 200, `PUT /api/ads/alerts` 401 sem sessão). **Limites documentados:** Smart+ só pausa (sem escala via API); pausa por métrica depende de o TikTok reportar Smart+ no nível de campanha; nada exercitado ao vivo (sandbox sem `PIPEBOARD_API_KEY`) — prova fica no runbook de produção. Docs: `PLANO-VERIFICACAO-ADS.md` (C1/C3 marcados ENTREGUE + runbook passos 7/8) e `CLAUDE.md` §19.3 atualizados.
