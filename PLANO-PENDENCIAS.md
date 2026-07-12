# Plano de Pendências — o que NÃO foi feito

> Gerado por reconciliação item-a-item entre `PLANO-PRAGMATIC-FLOW.md` (570 itens, numerados 1–570 sem saltos) e `PROGRESSO-PLANO.md` (tracker de execução).
> Última reconciliação: 2026-07-11.

## Resumo honesto

- O plano tem **570 itens**. **Não foram todos feitos.**
- O tracker cita ~336 números como concluídos ou auditados, mas isso mistura dois casos: (a) implementados de fato e (b) apenas auditados como já existentes. Além disso, faixas inteiras (Levas 1–6) foram declaradas concluídas **em bloco**, sem linha por item.
- Esta lista contém **236 itens sem confirmação individual de conclusão**, divididos em:
  - **16 itens em faixas declaradas concluídas em bloco (1–270)** → provavelmente feitos, mas **precisam de verificação** (não têm evidência linha-a-linha).
  - **220 itens em 271–570** → **lacunas reais**: território da "Leva 7", que foi trabalhada pinçando itens específicos, deixando a maioria sem implementação.

### Método e limitações
- "Mencionado no tracker" = número aparece após `✅` ou em linha de auditoria. É um proxy imperfeito: pode haver item feito cujo número não foi citado, e item "auditado" que na prática ainda precisa de trabalho.
- Para ter certeza absoluta de qualquer item abaixo, é preciso abrir o código e verificar. Os itens marcados **[VERIFICAR]** têm maior chance de já estarem prontos.

---

## A. Faixas concluídas em bloco — verificar individualmente (16 itens) [VERIFICAR]

Estes caem em Levas 3/4 que o tracker marcou "100% / COMPLETA", mas não têm linha própria confirmando:

- **96.** Toggle ativo/pausado inline no card do pixel (estende 49).
- **97.** Cabeçalho de saúde da aba Pixels (durável vs. memória) consolidando `health()` (estende 51).
- **115.** Provisionamento automático self-service de domínio para qualquer usuário; fallback CNAME manual; `POST /api/domains` sem exigir admin.
- **147.** Moeda configurável por conta (`accounts.currency`, GET/PUT, uso em buildProperties/testPixel/conversion, UI em Config).
- **148.** `verify-url` server-side com anti-SSRF (bloquear IP privado/loopback/metadata, limites, 1 redirect; detectar token/ttq.load/sdkid).
- **149.** Mapa de erros TikTok → pt-BR (`tiktok-errors.js`) reusado em teste de pixel, log e verify-url.
- **151.** Rota de edição/rotação de gateway preservando/regenerando `webhookToken`.
- **152.** Rota de teste por gateway com retorno estruturado da assinatura.
- **153.** Persistir uso do domínio no schema e em `/api/domains*`.
- **154.** Persistir daily/reasons e expor `verdict` em `/api/cloak/test`.
- **155.** Componente `TutorialModal` reutilizável (base dos tutoriais 78/98/107/129/145).
- **156.** Sistema de tour por página nas 5 abas (lib/tour + tour.tsx).
- **157.** Atualizar `lib/types.ts` e `lib/api.ts` para todos os novos endpoints/campos.
- **158.** Padronizar layout/cabeçalho das 5 abas e responsividade de tabelas/listas.
- **159.** Painel "Como funciona a Gestão" (pré-requisitos entre módulos).
- **160.** Ampliar bateria de testes (verify-url+SSRF, idempotência de webhook, etc.).

---

## B. Lacunas reais (271–570) — 220 itens

### B1. Overview / Dashboard principal (271–299)
- ~~**271.** Meta de receita mensal por conta com barra de progresso (`revenue_goal`)~~ — ✅ FEITO: `GoalCard` na Overview do painel Novo. Meta vem de `/api/settings` (revenueGoal, configurada em Config); card só aparece com meta > 0. Barra com progressbar acessível e cor por estado (verde ≥100%, ciano no ritmo, âmbar abaixo).
- ~~**272.** Comparativo "período atual vs anterior" no gráfico (linha fantasma)~~ — ✅ FEITO: `RevenueChart` recebe `prevSeries` e desenha curva tracejada cinza (sem fill) atrás da principal, alinhada por posição (dia N vs dia N); legenda "período anterior" no cabeçalho. Some no modo "Tudo" (sem período anterior) e na métrica de barras. Verificado com screenshot.
- **274.** Card "melhor dia da semana" e "melhor hora" das séries. — ⚠️ PARCIAL: "melhor dia da semana" FEITO (card de insight abaixo do gráfico, derivado da série, aparece só com ≥14 dias). "Melhor hora" ainda falta (a série é diária; exigiria granularidade horária do backend).
- **275.** Anotações no gráfico (`chart_annotations`) marcando eventos.
- ~~**276.** Previsão simples de fim de mês (projeção linear) com disclaimer~~ — ✅ FEITO: dentro do `GoalCard` — ritmo médio diário × dias do mês, marcador fantasma na barra até a projeção, texto "Estimativa linear — não é garantia".
- ~~**277.** Alerta com CTA quando aprovação < 40%~~ — ✅ FEITO: banner `role="alert"` na Overview (só com volume ≥10 tentativas, para não gritar com amostra pequena) com CTA "Abrir cloaker".
- ~~**278.** Exportar resumo do período como imagem (canvas)~~ — ✅ FEITO: `ExportSummaryButton` ao lado do PeriodPicker desenha um card 1200×630 (proporção social) em canvas puro — fundo escuro da marca, receita em destaque, KPIs (vendas, leads, conversão, aprovação), sparkline da série e rodapé com data — e baixa como `resumo-<período>-<data>.png`. Sem dependências novas. Clique verificado no browser sem erros de runtime.
- ~~**279.** Drill-down: clicar num KPI abre a aba correspondente filtrada~~ — ✅ FEITO: os 4 KPIs viram links (Receita/Vendas → Atividade filtrada em vendas; Leads/Conversão → Funil), com aria-label "— ver detalhes" e focus ring. Verificado no browser: clique aplica o filtro na chegada.
- ~~**280.** HealthCard com estado agregado (db, redis, filas)~~ — ✅ FEITO (sem rota nova: `/api/health` já traz db/migrations/redis/queues desde o item 263): linha "Estado geral" no topo do card com veredito derivado — Crítico (banco fora ou migrações falhas), Atenção (redis habilitado mas fora, fila de conversões >20 ou retry CAPI >0), Operacional (resto). Integrações opcionais (TikTok/Pushcut) não rebaixam o veredito. `role="status"` + aria-label. Verificado no browser: "Operacional".
- ~~**281.** Tooltip do gráfico com vendas + visitas do dia junto do valor~~ — ✅ FEITO: rodapé do tooltip com "N vendas · M leads" (singular/plural correto) separado por borda, qualquer que seja a métrica ativa.
- **282.** Período customizado (date-range picker) propagado a todas as abas.
- ~~**283.** Persistir período escolhido em localStorage~~ — ✅ FEITO: chave `roi:overview:period`, sobrevive a reload.
- ~~**284.** Deep-link de período via query string~~ — ✅ FEITO: `?p=today|7d|30d|all` (precedência: URL → localStorage → 7d), refletido via `history.replaceState` sem recarregar.
- ~~**285.** Card de "receita líquida estimada" (menos reembolsos/disputas)~~ — ✅ FEITO: `aggregate` acumula `refundRev` (valor devolvido por moeda, em centavos) e a Overview ganhou o MiniStat "Receita líquida" = bruta − devoluções, com subtítulo "− R$ X devolvidos" (ou "sem devoluções no período"). Grid ampliado para 6 colunas no xl. Verificado no browser com dados semeados.
- ~~**286.** Ranking "top campanhas" por UTM no overview~~ — ✅ FEITO: `aggregate` expõe `topCampaigns` (top 5 por `utm.campaign`, ordenado por conversões e leads); componente `TopSources` na Overview mostra posição, nome, leads e conversão com barra proporcional. Some quando não há UTMs no período. Verificado no browser.
- ~~**287.** Ranking "top links" por conversão no overview~~ — ✅ FEITO: mesmo mecanismo com `topLinks` (por `linkSlug`), no card gêmeo "Top links" com atalho "gerenciar links". Tipos `landing`/`linkSlug` adicionados ao `Lead`.
- ~~**288.** Estado vazio guiado (checklist de onboarding com progresso real)~~ — ✅ FEITO: `OnboardingChecklist` no topo da Overview enquanto a conta não fecha o ciclo (visita + venda no histórico TODO, não no período — trocar para "hoje" não ressuscita o card). Progresso 100% derivado de dados reais: link criado (`/api/links`), pixel (`/api/pixels`), gateway (`/api/gateways`), primeira visita (leads) e primeira venda (events). Cada passo pendente é atalho com seta no hover; barra de progresso com aria. Verificado com conta recém-registrada (0 de 5) e conta ativa (oculto).
- ~~**289.** HeroGlobe respeita `prefers-reduced-motion` e pausa sem foco~~ — ✅ FEITO: com reduced-motion o globo abre estático (sem auto-rotação nem zoom de entrada; interação manual livre); `visibilitychange` pausa/retoma o render loop do three.js com a aba oculta (zero GPU em segundo plano).
- ~~**290.** Skeleton do globo com silhueta esférica (evitar salto de layout)~~ — ✅ FEITO: `GlobeSkeleton` — círculo com gradiente radial ciano + halo pulsando no lugar do retângulo plano; a chegada do three.js não muda a forma percebida.
- ~~**292.** MiniStat de reembolsos clicável → Atividade filtrada em refund~~ — ✅ FEITO: chips de Reembolsos e Disputas viram `<Link>` (só quando há ocorrências) para `/activity?f=refund|dispute`; a Atividade lê `?f=` na chegada e sobrepõe o filtro persistido.
- ~~**293.** Contador "próxima atualização em Xs" junto ao badge Ao vivo~~ — ✅ FEITO: o badge do header mostra "atualiza em Xs" no hover (junto da latência), reancorado a cada resposta nova do `/api/stats` (ciclo de 12s do SWR).
- ~~**294.** Modo TV/fullscreen do overview para telão~~ — ✅ FEITO: `TvModeButton` ao lado do PeriodPicker — fullscreen nativo + `data-tv` no `<html>`; CSS global esconde o chrome (sidebar/header/topnav marcados com `data-tv-hide` em wrappers `display:contents`, sem afetar o flex do layout) e solta o max-width do main com padding fluido. Estado segue `fullscreenchange` (Esc sai e restaura tudo, sem dessincronizar). Verificado com screenshot: KPIs, meta, rankings e globo em largura total sem navegação.
- ~~**296.** Card "tempo médio até a compra" (visita → purchase)~~ — ✅ FEITO: card de insight ao lado do "melhor dia" — mediana (não média, robusta a outliers) de `purchasedAt − at` dos leads comprados no período, com contagem da amostra; exige ≥3 vendas para aparecer. `fmtDurationShort` novo em `lib/format.ts` ("14h 16min", "3d 4h"). Verificado no browser.
- ~~**297.** Badge de tendência de EMQ no overview~~ — ✅ FEITO: linha "EMQ dos pixels" no HealthCard (link para a aba Pixels) com média recente entre os pixels com dado, ícone de tendência (↑ verde / ↓ âmbar / – neutro, tolerância de 0,15) e contagem de pixels em alerta. Consome o `/api/pixels/emq-trend` existente (recentAvg/baseAvg/alerts). A linha some quando não há histórico de EMQ — verificado no browser (conta sem eventos CAPI: card renderiza sem a linha, sem erro).
- ~~**298.** Receita por gateway em donut compacto~~ — ✅ FEITO: `aggregate` expõe `revByGateway` (receita/vendas por gateway, só na moeda dominante — misturar moedas somaria valores incomparáveis); componente `GatewayDonut` (Recharts Pie) ao lado da Saúde do sistema, com total no centro e legenda nome + valor + %. Só aparece com 2+ gateways (com um único seria um círculo cheio sem informação). Verificado no browser.
- ~~**299.** Acessibilidade dos KPIs (aria-label com valor + delta + período)~~ — ✅ FEITO: `KpiCard` aceita `ariaLabel` (vira `role="group"` + `aria-label`); a Overview passa leitura completa nos 4 KPIs (ex.: "Receita total: R$ X, alta de Y% vs período anterior"). Verificado no snapshot de acessibilidade do browser.

### B2. Tabela de Leads / Funil (301–330)
- ~~**301.** Funil filtrável por link/campanha (hoje global)~~ — ✅ FEITO: dois selects no topo da aba Funil (link e campanha, opções derivadas dos próprios leads — só o que existe nos dados; escondidos quando não há variedade) + botão "Limpar filtros". Os LEADS são filtrados antes do aggregate, então o funil INTEIRO reage: barras, taxas, gargalo, dinheiro em aberto/receita, medianas de tempo e a tabela de leads (que mantém seus filtros próprios de etapa/gateway/país por cima). Verificado no browser: campanha "black-friday" derrubou visitas de 114→39 e limpar restaurou.
- ~~**302.** Etapa "iniciou pagamento vs aprovado" separada no funil~~ — ✅ FEITO: nova etapa "Tentaram pagar" entre Checkout e Compraram = eventos do gateway no período (vendas + recusas), com contagem de recusadas no rótulo; "Compraram" passa a mostrar "% de aprovação" quando a etapa está visível. Sub do Checkout corrigido ("entraram no checkout" — chegar lá não é iniciar pagamento). Como eventos não carregam link/campanha, a etapa é OCULTADA com filtro ativo (número global num funil recortado seria mentira) e a taxa volta a ser "% do checkout". Pode passar do checkout (retentativas/órfãs) — o sub explica a origem. Verificado no browser: 75 tentativas (13 recusadas), 82,7% aprovação; some ao filtrar.
- **303.** Benchmark interno: conversão atual vs média 30d por etapa.
- ~~**304.** Perfil do lead em drawer (`lead.journey` já existe, nunca renderizado)~~ — ✅ FEITO: clique na linha da tabela abre drawer lateral (dialog com Esc/backdrop/X, foco entra no painel, anim-drawer-in com reduced-motion) com Contato (data-sensitive), Origem (geo/dispositivo/link/campanha), Pagamento (gateway, valores com "—" quando o gateway não reportou — R$ 0,00 sugeriria venda gratuita) e Jornada página a página (timeline com timestamps). Consome useLead condicional (só busca com drawer aberto, poll de 12s). Verificado no browser: abre, seções renderizam, Esc fecha.
- ~~**305.** Coluna "UTM campaign" opcional na tabela~~ — ✅ FEITO: toggle "Campanha" (persiste em localStorage via `usePersistedState`) adiciona a coluna com `utm.campaign` e highlight da busca. Verificado no browser.
- ~~**306.** Filtro por país na tabela de leads~~ — ✅ FEITO: select derivado dos países presentes nos leads (só aparece com 2+), com chip removível e compondo com etapa/gateway/busca. Verificado: US → 7 linhas.
- **307.** Filtro por data (range) na tabela, independente do período global.
- ~~**308.** Ordenação clicável nos cabeçalhos~~ — ✅ FEITO: Etapa/País/Valor/Quando ordenáveis via `SortableTh` (botão real, teclado-acessível, `aria-sort`, seta de direção). Ciclo por clique: desc → asc → ordem natural. Valor usa reportado (dinheiro real) com fallback no esperado; sem valor vai para o fim. Verificado no browser (desc = Comprou 1º, asc = Visita 1º).
- ~~**309.** Coluna de e-mail mascarado com "revelar" no hover~~ — ✅ FEITO: toggle "E-mail" (persiste) mostra coluna com e-mail mascarado ("cl…@gmail.com"); o completo aparece só no hover/focus (tabIndex para teclado) e a célula é `data-sensitive` (respeita o modo privacidade). Verificado no browser.
- ~~**311.** Busca da tabela também por telefone~~ — ✅ FEITO: a busca compara dígitos (mín. 4) contra o telefone normalizado — "55119" acha leads com +55 11 9…. Verificado: 14 linhas.
- ~~**313.** Badge "lead quente" (`checkoutHits > 2`)~~ — ✅ FEITO: badge laranja com chama em leads NÃO comprados com 3+ idas ao checkout (quem comprou não é mais "quente"), tooltip sugere contato. Verificado no browser com seeds de checkoutHits.
- ~~**314.** Ação "reenviar conversão à CAPI" por lead (replay com dedupe)~~ — ✅ FEITO: botão "Reenviar CAPI" na seção Pagamento do drawer do lead (só para stage=purchased — sem compra não há recibo). O `/api/ops/reprocess-conversion` agora aceita `leadId` além de id/orderId (recibo MAIS RECENTE do lead, escopado à conta); o replay reusa o mesmo event_id (dedupe no TikTok) e registerSale=false (não recontabiliza). Estados inline no botão com auto-reset 4s. Verificado no browser nos dois caminhos: lead com recibo → "nenhum pixel ativo" (desfecho honesto da conta dev sem pixel); lead sem recibo → mensagem 404 da API.
- ~~**315.** Densidade compacta obedece `prefs.density`~~ — ✅ VERIFICADO: a regra global `html[data-density='compact'] table td/th` já cobre a tabela de leads (padding 10px → 5.6px, medido no browser). Nada a mudar.
- ~~**316.** Funil com valores monetários por etapa~~ — ✅ FEITO: barra Checkout mostra valor esperado em aberto (leads em checkout com `expectedAmount`; some quando não há dado); barra Compraram mostra a receita real da moeda dominante (`m.rev[mainCur]`). Valores com `data-sensitive` (modo privacidade). Verificado: "R$ 4.578,84 em receita".
- ~~**317.** Tempo médio por etapa entre as barras~~ — ✅ FEITO: MEDIANA (não média — outliers de dias distorceriam) visita → 1º checkout e último checkout → compra, derivada de `checkoutHits`/`purchasedAt`; exige 3+ amostras para exibir. Verificado: "~5h 42min após a visita", "~8h 34min após o checkout".
- ~~**318.** Gargalo (146) vira link com sugestão de ação~~ — ✅ FEITO: faixa âmbar sob o funil com diagnóstico e ação — perda visita→checkout sugere revisar oferta/carregamento; perda no pagamento sugere conferir recusas com link direto para `/dashboard/activity?f=failed` (deep-link do item 292). Verificado no browser. Também corrigido de passagem: badge "quente" estava duplicado na tabela de leads (duas implementações do item 313 coexistiam) — removida a redundante.
- **319.** Cards por gateway com `last_event_status` + link à aba Gateways.
- ~~**320.** Paginação com "ir para página N"~~ — ✅ FEITO: input numérico no lugar do contador estático ("3/12"), com clamp em 1..N e aria-label. Verificado no browser (digitei 3 → "21–27 de 27").
- **321.** Virtualização da tabela acima de 500 leads.
- ~~**322.** Estado vazio do funil diferenciado (sem dados vs conta nova)~~ — ✅ FEITO: conta sem NENHUM lead vê orientação de instalação (pixel + links); conta com leads mas recorte vazio vê "Nenhum lead corresponde" com botão "Limpar filtros". Verificado no browser.
- ~~**323.** `STAGE_LABEL`/cores centralizados em `lib/format.ts`~~ — ✅ FEITO: `STAGE_LABEL` e `STAGE_CLASS` exportados de `lib/format.ts`; `leads-table.tsx` consome de lá (antes duplicava localmente, com risco de divergência).
- **324.** Anonimização automática de leads antigos (LGPD, config por conta).
- **325.** Webhook de saída por lead comprado (integração CRM/planilha).
- ~~**326.** Endpoint `/api/leads/:id` (detalhe com jornada) para o drawer do 304~~ — ✅ FEITO: GET com dashboardAuth, escopo por conta (lead de outra conta = 404, não 403 — não confirmamos existência do id a quem não é dono), projeção explícita de campos (nada de espalhar o objeto interno) incluindo journey e checkoutHits. Cache-Control private/no-cache. Testado: 200 com lead próprio, 404 com id inexistente.
- ~~**327.** Rate-limit e cache do `/api/stats` por conta~~ — ✅ FEITO: (a) rate-limit de 60/min POR CONTA (não por IP — autenticado ≠ ilimitado) reusando o `rateLimited()` existente, respondendo 429 + `Retry-After: 30` no contrato de erro padrão; o poll legítimo (12s = 5/min/aba) fica a uma ordem de grandeza. (b) cache de 3s por conta do `getStats()` (que varre todos os leads/eventos a cada chamada) — colapsa rajadas de várias abas em 1 cômputo sem staleness perceptível (3s << 12s do poll); ETag/304 do Express continua funcionando por cima. Sweep periódico nos dois Maps. Verificado: 65 chamadas → 58× 200 + 7× 429; dashboard segue carregando normal após a janela.
- ~~**328.** Coluna "dispositivo" (mobile/desktop de ua.js)~~ — ✅ FEITO (bloqueio resolvido): o backend já gravava `device/os/browser` no lead (ua.js na entrada) e o `/api/stats` já os projetava; leads antigos do seed sem o campo receberam device coerente (~70% mobile / 25% desktop / 5% tablet via hashtext determinístico). Na tabela do funil: coluna compacta com ícone (Smartphone/Monitor/Tablet), detalhes em title ("desktop · Windows · Chrome") e texto sr-only. Verificado no browser: 9 mobile / 8 desktop / 3 tablet na primeira página.
- ~~**329.** Realce de leads que chegaram após o load~~ — ✅ FEITO: mesmo padrão `seenIds` (ref) do feed de Atividade — snapshot inicial registrado uma vez, leads que chegam depois via polling ganham `anim-cell-flash` (flash âmbar já existente do item 29). Verificado que o load inicial não pisca (0 flashes).
- **330.** Testes do filtro/paginação/CSV e do cálculo de gargalo.

### B3. Feed de Atividade (331–350)
- ~~**331.** Busca textual no feed (cliente, e-mail, gateway)~~ — ✅ FEITO: input com ícone, botão limpar e placeholder; busca em cliente/e-mail/gateway/título (efêmera — busca é da sessão, não persiste); estado vazio distingue "sem eventos" de "filtros sem resultado" com botão "Limpar filtros". Verificado: "stripe" filtra 1391 → 134 eventos.
- ~~**332.** Filtro por gateway no feed~~ — ✅ FEITO: select derivado dos gateways realmente presentes nos eventos (só aparece com 2+), compõe com busca/tipo/período.
- ~~**333.** Filtro por período no feed~~ — ✅ FEITO: chips Tudo/Hoje/7 dias/30 dias locais do feed (não mexem no período global da Overview — quem audita o feed recorta sem afetar o resto).
- ~~**334.** Agrupar "N visitas em sequência" em linha expansível~~ — ✅ FEITO: sequências de 4+ leads no MESMO dia viram linha "N visitas em sequência" com faixa de tempo e chevron; expande com borda lateral mostrando cada lead (badges novo/permalink preservados). Vendas/recusas nunca são agrupadas. Grupo quebra na virada de dia (separador continua correto). Separador extraído para `DaySeparator` (reuso com resumo do dia). Verificado no browser: "12 visitas em sequência" expandindo 45 → 57 linhas.
- ~~**335.** Som opcional de "venda" (toggle, off por padrão)~~ — ✅ FEITO: toggle de alto-falante no cabeçalho do feed (persiste, off por padrão); "cha-ching" de dois tons em WebAudio puro (sem asset, sem rede); toca ao ligar como teste. Primeiro load nunca alerta — só vendas que chegam depois. Verificado no browser (aria-pressed + persistência).
- ~~**336.** Notificação nativa do navegador para vendas em segundo plano~~ — ✅ FEITO: toggle de sino que pede permissão ao ligar (só liga se concedida); notifica apenas com `document.hidden` (aba visível já mostra a venda no feed), com `tag` para não empilhar e clique focando a aba. Agrupa múltiplas vendas ("3 novas vendas").
- ~~**337.** Exportar feed filtrado como CSV~~ — ✅ FEITO: botão "CSV" ao lado do contador exporta o recorte ATUAL (todos os filtros aplicados), client-side com BOM UTF-8; e-mail mascarado (o arquivo circula fora do painel). Mesmo padrão do CSV de leads (item 130/310).
- **338.** Virtualização do feed acima de 300 eventos.
- ~~**339.** Auto-scroll "seguir ao vivo" com pausa ao hover~~ — ✅ FEITO (variação melhor): puxar o scroll de quem lê o histórico seria hostil — em vez disso, eventos novos entram no topo e, se o usuário está rolado >400px, um aviso flutuante fixo acumula a contagem ("N novos eventos — ver no topo") e leva ao topo com um clique; voltar ao topo manualmente também zera o aviso. Verificado ao vivo: scroll em 2000px + webhook real → aviso "2 novos eventos", clique → scrollY 0 e aviso some.
- ~~**340.** Linha de resumo por dia no separador ("12 vendas · R$ 340 · 2 recusadas")~~ — ✅ FEITO: separador de dia ganhou resumo do dia INTEIRO filtrado (não só das linhas visíveis): "N vendas · R$ X" + "M recusadas" quando houver. Verificado no browser ("8 vendas · R$ 327,47").
- ~~**341.** Ícone de replay: reprocessar evento failed direto do feed~~ — ✅ FEITO: botão "Reenviar CAPI" no detalhe expandido de eventos de conversão com ref (failed/venda/reembolso/disputa). O feed só conhece o orderId, então `/api/ops/reprocess-conversion` passou a aceitar `orderId` além de `id` (pega o recibo MAIS RECENTE daquele pedido, escopado à conta). Estados no próprio botão: Reenviando… → "N pixel(s) receberam"/"reenviado" ou erro ("nenhum pixel ativo", mensagem da API), com auto-reset em 4s. Limite herdado do endpoint: só os 200 recibos mais recentes. Verificado ponta a ponta no browser (webhook Failed real → clique → "reenviado").
- ~~**342.** Detalhe expandido com raw do webhook (JSON colapsável)~~ — ✅ FEITO: eventos de conversão (venda/recusa/reembolso/disputa/checkout) guardam a conversão NORMALIZADA (whitelist sem flags internas, cap de 2KB — raw gigante estouraria o estado com MAX_EVENTS em memória); no feed, o detalhe expandido ganha "dados do webhook" colapsável com `<pre data-sensitive>` (respeita modo privacidade). Eventos antigos sem raw não mostram o botão. Verificado ponta a ponta com POST real em `/api/conversion`.
- ~~**343.** Permalink de evento (`/activity?e=<id>`)~~ — ✅ FEITO: botão "Copiar link" na expansão do evento; na chegada com `?e=`, garante o evento na página (ajusta o limit da paginação), zera filtros se ele estiver fora deles, rola até a linha (scrollIntoView center) e destaca com outline+flash; limpa o param da URL depois. Verificado no browser: `?e=evt_seed_0_0` → achou, destacou, URL limpa.
- ~~**344.** Marco visual "melhor venda do dia" (destaque dourado)~~ — ✅ FEITO: badge âmbar "top do dia" com troféu na maior venda de cada dia (só com 2+ vendas no dia — com uma única, o marco não informa nada). Verificado com screenshot (R$ 183,09 hoje, R$ 203,62 ontem).
- ~~**345.** Densidade compacta obedece `prefs.density` no feed~~ — ✅ FEITO: classe `.feed-row` nas linhas + regra `html[data-density='compact'] .feed-row { padding-block: .45rem }` (12px → 7.2px, medido no browser).
- ~~**348.** Acessibilidade: `role="feed"` e `aria-busy` na revalidação~~ — ✅ FEITO: container do feed com `role="feed"`, `aria-label` e `aria-busy={isValidating}` (SWR). Verificado no browser.
- **349.** Retenção configurável de eventos (auditar `logEvent`; cap + arquivamento).
- **350.** Testes do agrupamento, filtros e permalink.

### B4. Ao Vivo / Presence (351–360)
- **351.** Trilha de navegação do visitante ao vivo (sequência de páginas).
- **352.** Alerta "visitante no checkout há mais de 3min".
- **353.** Mini-mapa inline na aba Ao Vivo (projeção 2D leve).
- **354.** Origem por visitante (UTM/referer) na linha.
- **355.** Sparkline "online nas últimas 24h" no card Online agora.
- **356.** Contador de "checkouts abandonados hoje" com link ao funil.
- **357.** Filtro por país na lista de visitantes.
- **358.** `ConnectionDot` reusado em TODAS as abas com polling.
- **360.** TTL/prune do presence configurável e exposto no painel técnico.

### B5. Geo / Globo (361–380)
- **361.** Pontos com tamanho por métrica e cor por conversão.
- **362.** Clicar num país no globo filtra o ranking (bidirecional).
- **363.** Coluna de conversão (% visita→venda por país) na tabela.
- **364.** Comparativo geo entre períodos (país que mais cresceu/caiu).
- **365.** Export CSV do ranking de países.
- **366.** Ranking secundário por cidade quando país focado.
- **368.** `newIds/seenIds` do live com limpeza (mesmo vazamento do 346).
- **370.** Fallback 2D do globo para GPU fraca/WebGL indisponível.
- **371.** Tour das abas Geo e Ao Vivo.
- **372.** "Horário local do visitante" na linha.
- **373.** Badge de visitante recorrente no live.
- **374.** Métrica "tempo médio de sessão" no resumo.
- **376.** `checkout.externalEst` explicado em tooltip.
- **377.** Acessibilidade do globo (alternativa textual com `aria-describedby`).
- ~~**378.** Polling do live com backoff quando aba oculta (5s → 30s)~~ — ✅ FEITO (superado): o SWR já suspende TODO o polling com a aba oculta (`refreshWhenHidden: false` por padrão) e revalida na volta (`revalidateOnFocus`) — zero requests em segundo plano, melhor que o backoff pedido. Documentado em `lib/api.ts` para ningu��m regredir com `refreshWhenHidden: true`.
- ~~**379.** `/api/live` com `Cache-Control: no-store` e payload enxuto~~ — ✅ FEITO: header `no-store` adicionado à rota (payload já era enxuto: visitors + summary + checkoutEst). Verificado via curl.
- **380.** Testes do dedupe do live, prune do presence e agregação por cidade.

### B6. Shell / Navegação / Command palette (381–410)
- **381.** Command palette com ações ("zerar estatísticas", "copiar link X", etc.).
- **382.** Command palette com busca federada de leads/links/gateways (`/api/search`).
- **383.** Atalhos de teclado globais (`g+letra`) com folha de atalhos em `?`.
- **384.** Histórico de páginas recentes no palette.
- **385.** Breadcrumb clicável no header.
- **386.** Notificações in-app (sino no header com dropdown).
- **387.** Barra de busca global no header (atalho `/`).
- **388.** Tema claro opcional (`[data-theme=light]` + toggle).
- **389.** Acento de cor configurável por conta.
- ~~**390.** `LiveClock` com segundos opcionais~~ — ✅ FEITO: clique no relógio do header alterna segundos on/off (aria-pressed + title), persistido em `prefs.clockSeconds`. Padrão sem segundos (menos ruído). Verificado no browser.
- **391.** Sidebar colapsável com persistência.
- **392.** Mobile: bottom-nav com badge + swipe entre abas.
- **393.** PWA: manifest + service worker instalável.
- **394.** Título da aba dinâmico com contagem de vendas não vistas.
- **395.** Favicon dinâmico com dot de saúde.
- **396.** Toast global unificado (`use-toast` padrão).
- ~~**397.** Error boundary por rota com tela de erro na identidade~~ — ✅ FEITO: `app/(dashboard)/error.tsx` — erro de render cai num card glass com `role="alert"`, digest de referência e botão "Tentar de novo" (`reset()`); o shell (sidebar/header) continua vivo. Erro vai ao coletor do item 561 via console.
- ~~**398.** Página 404 do dashboard na identidade~~ — ✅ FEITO: `app/not-found.tsx` (server component, dark + glass, CTA para a visão geral). Verificado no browser em rota inexistente.
- **399.** `RefreshButton` com feedback de erro real.
- **401.** Prefetch das rotas do grupo ativo no hover.
- **402.** `UserMenu` com "copiar token da API" + link aos tutoriais.
- **403.** Tour global "conheça o dashboard" para primeiro login.
- **404.** Indicador de versão clicável → changelog interno.
- ~~**405.** Sincronizar logout entre abas (storage event)~~ — ✅ FEITO: "Sair" grava `roi:logout` no localStorage; as demais abas do painel escutam `storage` e redirecionam ao login imediatamente (a sessão já morreu no servidor). Fallback: sem storage, o guard de 401 pega no próximo poll.
- **406.** Guard de sessão expirada com modal (em vez de redirect seco).
- **407.** Reduzir polling quando `document.hidden` em todos os hooks.
- **408.** Auditoria de z-index com escala única de camadas.
- ~~**409.** Skip-link "pular para conteúdo"~~ — ✅ JÁ EXISTIA (item 102): `<a href="#conteudo" class="skip-link">` no layout do grupo (dashboard), aparece no primeiro Tab.
- **410.** Testes de navegação (palette, atalhos, deep-links, error boundary).

### B7. Config / Segurança / Conta (411–432)
- ~~**411.** Trocar senha na Config~~ — ��� FEITO (backend + UI): formulário na seção "Conta e segurança" da Config; validação de confirmação no cliente; backend verifica a atual, rate-limit 5/min, auditoria, derruba outras sessões. De quebra corrigiu bug: `getAccountById` não trazia `password_hash` e a troca SEMPRE respondia "senha atual incorreta".
- **412.** Recuperação de senha por e-mail (token de reset + provedor de e-mail).
- ~~**413.** Editar nome da conta~~ — ✅ FEITO: campo na Config (pré-preenchido via `/api/me`) + `POST /api/account/name` (trim, máx. 80, auditoria `nome_alterado`, limpa cache de sessões).
- ~~**414.** Sessões ativas~~ — ✅ FEITO: `GET /api/account/sessions` lista dispositivos (UA resumido + IP mascarado + data, gravados no login/registro), sessão atual marcada; `DELETE /api/account/sessions/:sid` encerra uma (sid = md5 do token, nunca expõe o token; a atual não pode ser encerrada por aí); `POST .../revoke-others` encerra todas as outras. Tudo auditado. Verificado no browser: sessão encerrada perde acesso na hora (401).
- ~~**415.** "Encerrar todas as outras sessões"~~ — ✅ FEITO: a troca de senha derruba todas as outras sessões automaticamente (`db.deleteOtherAuthSessions`); agora também tem botão dedicado na Config (item 414).
- ~~**416.** Rate-limit no login~~ — ✅ JÁ EXISTIA (item 440): bloqueio por e-mail após 8 falhas, 15 min, resposta 429.
- ~~**418.** Rotação do token da API pública~~ — ✅ FEITO: `POST /api/public-token/rotate` (rate-limit 5/min, auditoria) + botão "Gerar novo" com confirmação avisando que integrações antigas param. Verificado: token antigo → 401 na API pública, novo → 200.
- ~~**419.** Escopos do token público~~ — ✅ FEITO: `POST /api/public-token/scope` (`stats` | `stats+leads`) + seletor na Config dos dois painéis; escopo atual exposto em `/api/settings` (`apiScope`).
- ~~**420.** 2FA TOTP opcional~~ — ✅ FEITO: otplib v13 + qrcode. Ativação em 2 passos (QR/secret → confirmar código; nada persiste até confirmar), login em 2 etapas (ticket opaco de 5 min em memória, sem sessão até o código), desativação exige código válido, freio de força bruta (5 erros → 5 min). Coluna `accounts.totp_secret`. UI nos dois painéis + campo de código no /login. Ciclo completo verificado no browser.
- ~~**422.** Seletor de fuso da conta~~ — ✅ FEITO: select na Config (persistido via `/api/settings`, validado com `Intl` no servidor).
- ~~**423.** UI da meta de receita~~ — ✅ FEITO: campo em reais na Config (salvo em centavos).
- ~~**424.** UI do webhook de saída~~ — ✅ FEITO: campo de URL + botão "Testar disparo" (`POST /api/settings/webhook-test` envia venda fictícia, timeout 8s, rate-limit, devolve o HTTP do destino).
- ~~**425.** UI de retenção LGPD~~ — ✅ FEITO: select de retenção (desligado/30/90/180/365/730 dias) na Config.
- ~~**426.** Exportar todos os dados~~ — ✅ FEITO: `GET /api/account/export` (JSON com perfil, settings, links, pixels, leads, eventos e auditoria — sem chaves secretas) + botão "Baixar meus dados" nos dois painéis.
- ~~**427.** Excluir conta~~ — ✅ FEITO: `POST /api/account/delete` (senha + frase exata "EXCLUIR MINHA CONTA", cascata no banco, sessões derrubadas) + modal de confirmação forte nos dois painéis. Verificado: login pós-exclusão falha.
- ~~**428.** Pré-visualização da zona de perigo~~ — ✅ FEITO: `GET /api/account/data-counts` (contagens de leads/eventos/links/pixels/gateways/domínios) exibido no card de zerar e no modal de exclusão.
- ~~**429.** Template de mensagem do Pushcut~~ — ✅ FEITO: campo de template com variáveis (`{{valor}}`, `{{pais}}`, `{{produto}}`, `{{gateway}}`, `{{cliente}}`, `{{pedido}}`) na Config.
- ~~**430.** Resumo diário com horário configurável~~ — ✅ FEITO: seletor de hora local (0–23h) na Config, persistido em `dailyReportHour`.
- **431.** Convites multi-usuário (papel viewer/editor).
- **432.** Página de permissões por papel.

### B8. API pública / Ops / Infra (451–481)
- **451.** `getStats` com cache TTL por conta + invalidação por evento; medir tempo.
- **452.** API pública v1: `/api/v1/summary` com período e formato (json/csv).
- **453.** Nova `/api/v1/events` (paginada, read-only) para BI externo.
- **454.** OpenAPI/Swagger mínimo (`/api/docs`).
- **457.** `conversion-normalize.js`: mapeamento por provedor documentado + testes.
- **459.** Relatório diário automático por e-mail.
- **460.** Cron interno resiliente (guard de instância única via Redis lock).
- **461.** `/api/backup/export` e `/api/backup/import` (admin-only).
- **462.** Logs estruturados JSON (account_id/rota/latência).
- **463.** Métricas Prometheus-style em `/api/metrics`.
- **470.** Paginação real de `/api/stats` (separar summary de leads/events).
- **474.** `server.js`: extrair rotas em módulos (routes/*.js) sem mudar comportamento.
- **476.** Feature flag por conta (`accounts.flags`).
- **477.** Seed de demonstração (`npm run seed:demo`).
- **478.** Ambiente de teste (`NODE_ENV=test` com Neon/Redis in-memory).
- **479.** Suíte de integração dos webhooks (payload por gateway → lead/evento/CAPI/Pushcut).
- **480.** Teste de carga leve (autocannon) com baseline.
- **481.** Validação de payload com schema (zod) nas rotas de mutação.

### B9. Páginas públicas / Tracker / Links (487–538)
- **487.** LP: preconnect aos domínios de checkout/analytics.
- **491.** Tracker: retry local (localStorage queue) para eventos offline.
- **498.** Página de status pública opcional (`/status`).
- **505.** Detecção de link quebrado (HEAD periódico) com alerta.
- **509.** Agendamento de link (ativar/desativar por data).
- **510.** Link com limite de cliques + contagem regressiva na LP.
- **511.** Aviso de manutenção programável (banner via flag).
- **513.** Teste de compatibilidade in-app TikTok (UA real, cookies bloqueados).
- **514.** Lighthouse budget nas páginas públicas (LCP < 2s) no CI.
- **515.** Lint custom: NENHUMA view legada usa template strings.
- **516.** Relatórios semanais comparativos (`/reports`).
- **517.** Insights automáticos regrados (sem IA) no topo do overview.
- **518.** Metas por métrica com confete discreto (reduced-motion).
- **519.** Comparador de campanhas UTM lado a lado (pivot).
- **520.** Calculadora de ROI (custo de mídia → ROI real).
- **521.** Custo por campanha persistido (`campaign_costs`) alimentando o 520.
- **522.** Modo comparação de gateways (aprovação/latência/custo + recomendação).
- **523.** Heatmap hora × dia da semana de vendas.
- **524.** Alertas configuráveis por regra ("se vendas < N até 12h, avise").
- **525.** Biblioteca de templates de LP (2–3 variações).
- **526.** Editor de texto da LP por link (headline, bullets, CTA em JSON).
- **527.** Prova social configurável na LP.
- **528.** Cronômetro de escassez opcional na LP.
- **529.** Arquitetura multi-plataforma de pixel (`capi-provider`; Meta/Kwai depois).
- **530.** Multi-pixel por link (2 pixels TikTok simultâneos).
- **533.** Notas por entidade (link/gateway/pixel).
- **534.** Tags coloridas por link + filtro por tag.
- **535.** Busca global federada (`/api/search`) cobrindo tudo.
- **536.** Recycle bin (soft delete + restauração em 7 dias).
- **537.** Undo via toast "Desfazer" (10s) usando soft delete.
- **538.** Snapshot diário das configs em Redis ("restaurar como ontem").

### B10. Compartilhamento / Ajuda / Qualidade de front / CI (540–569)
- **540.** Widget embeddable read-only (iframe com token do 419).
- **541.** Modo espectador com senha simples (token de convite).
- **542.** Exportação agendada (CSV semanal por e-mail).
- **543.** Importação de leads históricos por CSV (com dry-run).
- **544.** Central de ajuda `/help` (tutoriais agregados e buscáveis).
- **545.** Changelog automático visível alimentado por `CHANGELOG.md`.
- **546.** Bundle analysis do Next (code splitting do three.js).
- **549.** Imagens: `next/image` com tamanhos corretos (auditar usos).
- **550.** Fontes: `next/font` com subset latin e `display: swap`.
- **551.** CSS: purgar classes órfãs e consolidar keyframes duplicados.
- **552.** Lint proibindo template strings em `*-view.js` + eslint no backend.
- **553.** TypeScript strict no dashboard (`noUncheckedIndexedAccess`).
- **554.** `lib/types.ts` verificado contra respostas reais do Express (teste de contrato).
- **555.** Storybook leve OU `/dev/ui` com componentes base.
- **556.** Testes de componente (Vitest + Testing Library) dos 10 críticos.
- **557.** Testes E2E (Playwright) dos 5 fluxos principais.
- **558.** CI GitHub Actions (lint + typecheck + testes + build nos PRs).
- **559.** Pre-commit hooks (husky + lint-staged).
- **560.** Renovate/dependabot (update semanal).
- **562.** Web Vitals do dashboard reportados ao backend (LCP/INP/CLS reais).
- **563.** Orçamento de performance interno (TTI < 3s em 3G rápido) no CI.
- **564.** Varredura axe automatizada nas 12 rotas (zero violações críticas).
- **565.** Contraste AA verificado nos tokens.
- **569.** Versionamento semântico + tag de release ao deploy.

---

## Priorização sugerida (quando retomar)

1. **Segurança primeiro (411, 416, 414, 415, 418):** trocar senha, rate-limit de login, gestão de sessões, rotação de token. São lacunas de segurança reais, não features.
2. **LGPD / portabilidade (324/425, 426, 427):** obrigações legais.
3. **Valor de negócio direto (271/423, 520/521, 516/517, 524):** metas, ROI, relatórios e alertas por regra — o que o dono usa para ganhar dinheiro.
4. **Robustez de front (396, 397, 398, 405, 406):** toast/error boundary/404/logout entre abas — evitam "tela quebrada".
5. **DX/CI (558, 557, 556, 478):** CI, E2E e ambiente de teste — sustentam todo o resto.
6. **Resto:** refinamentos de UX por aba, conforme demanda.

> Nota: vários itens dependem de integrações externas que exigem decisão/credencial do dono (provedor de e-mail para 412/459/542; possível 2FA no 420). Esses ficam bloqueados até a integração ser conectada.
