# V16.14 — convergência de produção e deploy Railway

- Consolida no GitHub/Railway a fonte de verdade construída nas V16.10–V16.13, sem introduzir nova regra financeira, automação ou mudança visual.
- O release parte exclusivamente de `roi-nados-v16.13.zip`; o `main` anterior (V16.9) não é usado como base para reconstruir código.
- `railway.json` troca o healthcheck legado `/login` pelo liveness dedicado `/healthz` e reduz a janela para 30s; builder/runtime/replicas/domínios permanecem fora do escopo.
- V16.12 entra em produção com analytics durável da Home e presença escopada por `accountId + visitorId`; migrations permanecem idempotentes e executadas pelo `db.init()`.
- V16.13 entra em produção com elegibilidade do scheduler baseada em contas reais, isolamento de testes e telemetria do tick; resíduos órfãos permanecem auditáveis, sem cleanup destrutivo automático.
- Gate local da release reexecuta as suites focadas de Home, tracking/conversão, Ads sync/automação/account scope/IA e leases Redis antes do push.
- O deploy passa a ser validado por build, healthcheck, logs de boot, disponibilidade da dashboard e comportamento real do scheduler antes de a versão ser considerada concluída.
- `/api/ads/roas`, `/api/ads/profitability`, cobertura 90×365 dias e demais cálculos financeiros ficam explicitamente reservados para a próxima leva.

# V16.13 — higiene operacional do scheduler TikTok Ads

- Scheduler de background passa a aceitar somente `account_id` existente em `accounts`; `config`/`ads_sync_state` órfãos não criam tenancy implícita.
- `listActiveAdvertisers()` faz `INNER JOIN accounts`; resíduos recentes continuam auditáveis, mas geram zero chamadas Pipeboard.
- Automações 24/7 filtram configs por conjunto de contas reais sem semear/migrar perfis durante a descoberta.
- Tick ganhou boundary por advertiser e telemetria de duração, elegibilidade, órfãos, freshness, bloqueios, unauthorized e falhas.
- Mantido processamento sequencial; nenhuma concorrência nova contra o rate limit do Pipeboard.
- `config.js` passa a respeitar `DATA_DIR`; helper de testes neutraliza Neon/Redis/Pipeboard/Stripe/IA externos salvo opt-in explícito.
- Testes Ads de maior risco passam a carregar o isolamento antes dos módulos da aplicação.
- Adicionado `scripts/audit-ads-sync-orphans.js`, estritamente read-only, para inventariar configs/sync/automation state sem conta correspondente.
- Nenhum cleanup automático, nenhuma alteração de Railway e nenhuma mudança em ROAS/profitability/UI.

## V16.12 — Backend da Home: analytics durável e presença multi-tenant

- Visão Geral deixa de usar o cache quente global de `stats.js` como fonte matemática dos KPIs: novo `GET /api/overview/analytics` resolve período + timezone no backend e agrega diretamente no Neon por conta, consultando `events` + `events_archive` e `leads` sem herdar os caps de 8.000/3.000 nem o `leads.slice(0, 3000)`.
- `/api/stats` permanece compatível para tracking, Funil, Atividade e listas recentes; a Home espera o agregado durável e só recorre ao snapshot antigo quando o Neon está indisponível, sinalizando a falha pelo estado de atualização existente.
- Agregado durável cobre faturamento multimoeda, vendas/falhas/aprovação, visitas, checkout, início de pagamento, compras, série diária no timezone da conta, países e ranking UTM; período `Tudo` mantém a semântica de 365 dias.
- `/api/overview/health` passa a usar fatos de cobertura e frescor calculados no Neon (janela operacional de 365d), com cache curto de 15s; snapshot quente fica apenas como fallback.
- Boot do banco faz backfill idempotente de `account_id` legado em `leads`, `events` e `events_archive` para que o arquivo frio não fique fora dos agregados históricos.
- Presença ao vivo passa a identificar sessão por `accountId + visitorId` em memória, Upstash e Neon; heartbeat/leave/listagem são escopados por conta e o Upstash usa namespace `presence:<accountId>:<visitorId>` com `SCAN` restrito ao tenant.
- Schema `sessions` migra de PK global `visitor_id` para `PRIMARY KEY (account_id, visitor_id)` após backfill seguro de sessões legadas; `upsertSession` usa o mesmo conflito composto. Chaves Upstash antigas expiram naturalmente pelo TTL de 60s.
- Nenhuma variável, serviço, réplica ou deploy do Railway foi alterado; o serviço Redis TCP do Railway também não foi tocado porque a presença ativa da aplicação usa Upstash REST.
- Adicionado `overview-window.js` para janelas civis backend e `overview-backend-v16-12.test.js` cobrindo timezone, >8.000 leads, fonte durável, health completo, isolamento de presença, leave por tenant, namespace Upstash e contrato de PK composta.
- `package.json` inclui o teste V16.12 no `pretest`; TikTok Ads, ROAS, profitability, janela de sync e scheduler permanecem fora desta versão.

## V16.11 — Visão Geral: leitura executiva e confiança operacional

- KPIs principais preservam a composição sem cards, mas recuperam microcontexto útil: vendas e comparação de faturamento, margem do lucro, vendas atribuídas, base da conversão e CPA do ROAS.
- `Lucro` deixa de usar o fallback simplificado `faturamento - mídia` quando a composição completa de custos não está disponível; nesses casos mostra `—` em vez de sugerir precisão inexistente.
- Presença ao vivo foi retirada de dentro da barreira WebGL: contagem/status e atualização continuam acessíveis mesmo se o canvas do globo falhar. O refresh do observatório agora revalida também a presença ao vivo.
- Atividade recente passa a ordenar/exibir o timestamp real da etapa (checkout, pagamento ou compra) e usa o timezone configurado da conta, em vez de fixar São Paulo no tooltip.
- Ranking de campanhas preserva ausência de gasto como `—`, mostra ROAS real `0,00x` quando aplicável e direciona `Ver tudo` para TikTok Ads ou Atividade conforme a fonte atualmente exibida.
- Card `Dados` ganhou estado operacional compacto, primeira pendência acionável e recuperação local quando a saúde do pipeline não carrega, sem reintroduzir uma faixa grande de alertas.
- Nenhum endpoint, regra de atribuição, cálculo backend, TikTok Ads, tracking ou fluxo fora da Visão Geral foi alterado.
- Adicionado `dashboard-overview-refinement-v16-11.test.js` cobrindo os novos contratos visuais/operacionais.

## V16.10 — TikTok Ads: fechamento operacional de Campanhas

- Histórico da Central passa a ser filtrado por advertiser/campanha no backend antes do `LIMIT`, evitando o falso estado “sem alterações” quando os eventos da campanha ficaram fora dos últimos eventos globais da conta.
- `GET /api/ads/ops/audit` ganhou apenas filtros opcionais `advertiserId`/`campaignId`; nenhum endpoint novo foi criado e o store continua usando a auditoria existente.
- Métricas ausentes de anúncios na Estrutura preservam `—` em vez de serem convertidas visualmente em gasto/impressões `0`.
- Ações em massa de Pausar/Ativar agora enviam somente campanhas elegíveis para a transição, mostram a quantidade efetiva no próprio botão e evitam requisições redundantes para campanhas que já estão no estado desejado.
- Confirmação de ativação em massa explicita quantas campanhas pausadas serão enviadas, quais selecionadas ficarão de fora e resume os orçamentos que podem começar a gastar.
- Orçamento em massa ganhou revisão antes de salvar com totais antes → depois para orçamento diário/total, aviso quando o potencial de gasto aumenta e validação visual do mínimo TikTok no modo de valor fixo.
- Seletor do ajuste de orçamento foi achatado para tabs textuais, mantendo a identidade silenciosa da dashboard e sem criar automação financeira nova.
- Criação de campanhas, Smart+, Spark, Catálogo, Automações, Redis/Neon, filas, idempotência, retries e demais áreas fechadas permanecem fora do escopo desta leva.
- Adicionado `dashboard-tiktok-final-v16-10.test.js` cobrindo histórico filtrado, falso zero e previsibilidade das ações financeiras em massa.

## V16.9 — TikTok Ads: consistência final de navegação e estado

- Trabalho local do Catálogo passa a agregar uploads do detalhe, Product Link e Batch, sem criar store global ou persistência nova.
- Remoção remota de criativo deixa de ser tratada como upload; copies agora distinguem envio ativo de itens pendentes/com falha aguardando nova tentativa.
- Product Link e criação Conversão bloqueiam X/backdrop/Escape/Cancelar enquanto há upload local, alinhando o comportamento ao Smart+ e preservando jobs duráveis já enfileirados.
- Back/Forward passa a preservar a pilha real do navegador com índices de histórico e `history.go()`, sem sobrescrever a entrada visitada com `replaceState()` durante um guard.
- O atalho `Alertas desligados` agora abre diretamente `Alertas de performance`, expandindo, rolando e focando a configuração responsável em Automações.
- `Resultado após custos` envia o timezone conhecido do advertiser e a resposta diferencia `advertiser`, `advertiser_context` e `account_fallback`; fallback real deixa de ser rotulado como fuso TikTok.
- Overview, `/api/ads/roas`, `profit-engine.js`, `config.js`, provider, automação, stores, Redis/Neon e workers permanecem inalterados; o único backend tocado continua sendo `GET /api/ads/profitability` em `ads-routes.js`.
- Testes V16.7/V16.8 foram atualizados apenas para acompanhar os nomes/guards mais seguros, e foi adicionado `dashboard-tiktok-final-v16-9.test.js`.

## V16.8 — TikTok Ads: fechamento técnico final

- Corrige os dois erros TypeScript restantes no caminho ativo: `RejectionInbox` passa a usar `AdsAdRejection` e a criação Product Link volta a inferir `Promise<void>` sem retornos de `toast.error()`.
- Tour cross-tab e Back/Forward passam a usar o mesmo guard de navegação das tabs, sempre com estado atual, sem contornar uploads locais do Catálogo.
- Saídas internas do detalhe do Catálogo agora protegem trabalho local: Voltar confirma descarte/cancelamento, clone fica indisponível com envios pendentes e exclusão não concorre com upload ativo.
- Ações globais de criação do Catálogo também confirmam antes de desmontar um detalhe com upload/erro pendente; copies diferenciam envio ativo de itens falhos aguardando retry.
- `Resultado após custos` dentro do TikTok Ads passa a consultar lucratividade com `calendar=advertiser`, alinhando receita first-party ao mesmo calendário civil do gasto TikTok, sem alterar o Overview ou `/api/ads/roas`.
- A resposta de lucratividade expõe o timezone efetivo e a UI mostra discretamente o fuso da conta TikTok usado no período.
- Dirty state da política de Segurança normaliza `blockedAdvertiserIds` como conjunto ordenado, eliminando alterações falsas causadas apenas pela ordem dos IDs.
- Backend alterado somente em `GET /api/ads/profitability` dentro de `ads-routes.js`; provider, automação, stores, workers, Redis/Neon, Catálogo backend e lógica multimoeda da V16.7 permanecem intactos.

## V16.7 — TikTok Ads: correções finais de consistência

- Corrige o import ausente de `useEffect` em Pilotos e amplia a validação com uma tentativa de typecheck TypeScript real, além do `transpileModule`.
- Troca de conta de anúncios passa a confirmar drafts/uploads locais antes de persistir `/api/ads/accounts/select`; cancelar não altera mais a conta selecionada no servidor.
- Períodos Hoje/7d/30d passam a usar o fuso civil da conta de anúncios TikTok, mantendo lista, decisões e Central no mesmo intervalo.
- Aprovações financeiras de Automações passam a formatar orçamento com a moeda real do advertiser, sem `BRL` hardcoded.
- Custos fixos de lucratividade ganham `fixedCostCurrency`; percentuais continuam universais, mas valores fixos não são reinterpretados em outra moeda e nenhuma conversão cambial automática é feita.
- Configs legados de custos adotam a moeda padrão da conta (fallback BRL); divergência de moeda mantém o resultado disponível como `mixed` e explica quais custos fixos foram omitidos.
- RuleForm protege `Escape` quando há mudanças, exclusão de regra limpa dirty residual e pilotos/custos/origens de nuvem passam a calcular dirty por diferença real com o baseline.
- OAuth de Google Drive/Dropbox confirma antes de abandonar drafts locais; voltar ao valor salvo deixa de exibir falso estado de alteração pendente.
- Importação em lote de Catálogo inicia na moeda do advertiser e oferece o mesmo conjunto de moedas do domínio; Product Link deixa de afirmar Pixel confirmado antes do preflight.
- Upload local de criativos do Catálogo passa a bloquear navegação/troca de conta/desconexão sem confirmação; remoção de criativo ganha `ConfirmDialog` quiet.
- Targets residuais de Colar/Limpar e paginação foram normalizados sem reabrir os layouts refinados.
- Testes estáticos de account-scope e campanha de Catálogo deixaram de depender de whitespace/copy antiga; nenhum endpoint novo foi criado e o único backend alterado ficou restrito à configuração/cálculo de lucratividade multimoeda.

## V16.6 — TikTok Ads: fechamento de UX

- Segurança passou a proteger alterações não salvas mesmo depois de alternar entre Tarefas e Segurança; o draft é preservado até salvar ou descartar explicitamente.
- Saúde das contas agora agrega tickets com texto de recurso não salvo e impede fechamento silencioso por X, backdrop, Escape ou botão Fechar.
- Regras avançadas em modo `execute` não podem mais ser ativadas diretamente pelo switch: limites são verificados e a ativação exige confirmação quiet.
- Drafts de Automações passaram a sobreviver à troca Campanhas/Catálogo/Automações sem manter polling escondido ativo.
- Alertas, perfis dos pilotos e RuleForm preservam edições ao recolher/reabrir; Mais ferramentas mantém custos e origens Google Drive/Dropbox depois da primeira abertura.
- Trocar de conta de anúncios com drafts pendentes agora exige confirmação explícita; a confirmação de desconexão informa quando rascunhos locais também serão descartados.
- Controles avançados restantes foram alinhados à tipografia e aos targets atuais, removendo microtipografia funcional de 10–11px e botões reduzidos.
- Estado inicial do TikTok/Pipeboard deixou a linguagem promocional e passou a `Verificar integração`, sem sugerir OAuth direto nem prometer métricas “em tempo real”.
- Backend, endpoints, worker, Redis/Neon, inferência de autonomia, Catálogo e demais áreas V16–V16.5 permanecem inalterados.

## V16.5 — TikTok Ads: Catálogo

- Lista principal deixou o card wall de KPIs e passou a usar contexto operacional, com criação global deduplicada no topo da tab.
- Business Center ganhou linguagem correta e criação pelo link passou a explicar os quatro registros técnicos necessários ao Catalog Ads sem inventar dados comerciais.
- Detalhe do catálogo agora expõe `Próximo passo` e prontidão na primeira camada; diagnóstico técnico permanece recolhido.
- Auto-sync existente ficou explícito nas ações de produto; copies de salvar/remover foram alinhadas ao comportamento real e “Corrigir com IA” virou correção automática determinística.
- ProductEditor ganhou dirty state, `Salvar produto` desabilitado sem mudanças e confirmação quiet antes de descartar alterações.
- Conexão, criativos, status TikTok, sincronização e histórico foram achatados para leitura editorial, preservando todos os estados e retries existentes.
- Criação rápida Product Link passou a reutilizar a linguagem da V16.2, com biblioteca/mercado refinados, preflight antes da fila, Pixel herdado, gasto diário potencial e autoativação explícita.
- Criação real com autoativação exige confirmação financeira quiet; `autoActivate: true` e toda a state machine do CatalogCampaignWizard foram preservados.
- Importação em lote continua preparando campanhas pausadas e agora antecipa a dependência entre Product Link e sincronização com o TikTok.
- Backend, endpoints, workers, Redis/Neon, idempotência, Product Link, Pixel/Compra, auto-sync e regras de ativação foram preservados.

## V16.4 — TikTok Ads: Automações

- Topo da automação convertido de KPI cards para leitura operacional com estado, regras, alertas e próxima avaliação em linguagem humana.
- Ação de avaliação agora muda conforme o modo real e exige confirmação antes de uma execução automática capaz de pausar campanhas ou alterar orçamentos.
- Modos Só avisar / Pedir aprovação / Aplicar sozinho ficaram autoexplicativos; pilotos foram achatados e perfis usam preview antes de `Aplicar ajustes`.
- Aprovações passaram a mostrar `beforeState`/`afterState` quando disponíveis e ações com potencial de iniciar/aumentar gasto ganharam confirmação quiet.
- Reprovações Smart+, alertas, histórico e regras avançadas foram simplificados; exclusão de regra agora exige confirmação.
- `NeedsYouInbox` ganhou `appearance="automation"` sem alterar a variante `embedded` usada em Campanhas.
- Ferramentas da conta deixaram o card wall: custos mostram escopo da conta ROI-NADOS, origens Google Drive/Dropbox podem ser salvas sem sincronizar e bloqueios de tráfego exigem confirmação para remoção.
- Reordenação de ferramentas continua preservada em `roi_ads_widget_order`, mas alças só aparecem no modo Organizar.
- Backend, endpoints, Redis, Neon, worker, regras, propostas, circuit breaker e Catálogo foram preservados.

## V16.3 — TikTok Ads: Públicos, duplicação, overlays e tour

- Públicos convertidos para leitura operacional, sem KPI card wall ou soma enganosa de alcance; Pixel central aparece como pré-requisito antes dos presets de remarketing.
- Presets de Compradores, Checkout e Visitantes preservam eventos/retenções existentes; Lookalike ganhou país explícito, semelhança autoexplicativa e resolução do `location_id` real do TikTok.
- Duplicação deixou de oferecer cross-account incompatível, passou a exibir conta atual readonly e transformou o preflight em etapa de revisão antes de iniciar a fila.
- Nomes, quantidade, warnings e impacto das cópias ficaram previsíveis; dry-run e progresso da duplicação agora mostram simulação, rate limit, retomada e retry com linguagem humana.
- Operações/Segurança ganharam tabs textuais, estado efetivo da política, limites com copy precisa, rascunho explícito, `Salvar política` e confirmação antes de descartar mudanças.
- Saúde das contas foi simplificada para status editoriais; tickets explicam que o envio do recurso é manual e o texto deixou de salvar silenciosamente no blur.
- Regenerar/dispensar ticket agora protege alterações locais; tickets encerrados ficam em disclosure secundário.
- Tour TikTok Ads atualizado para Campanhas / Catálogo / Automações, com aparência quiet e navegação cross-tab sem executar ações.
- Backend preservado salvo correção pontual do Lookalike: códigos ISO como `BR` não são mais enviados diretamente como `location_id`; a região é resolvida pelo mecanismo já existente do TikTok.

## V16.2 — TikTok Ads: criação de campanhas

- Launcher de criação consolidado em **Conversão (CBO)**, Smart+ e Spark Ads com linguagem visual comum, controles legíveis e revisão quiet, sem alterar contratos distintos de cada formato.
- Conversão/CBO foi reorganizada em Criativos → Destino e mercado → Investimento → Personalização → Revisão; upload e biblioteca ficaram igualmente descobríveis e todos os vídeos permitem editar o nome da campanha.
- Múltiplos vídeos continuam criando uma campanha pausada por criativo via fila durável; a revisão agora destaca quantidade de campanhas e gasto diário total potencial antes do envio.
- Pixel central virou pré-requisito explícito antes da configuração de Conversão e Smart+, com acesso direto ao vínculo existente e sem adicionar seletor manual dentro dos formulários.
- Smart+ preserva orçamento total + data de término e diferencia a média diária estimada de um orçamento diário configurado; Spark preserva seleção manual de identidade/post e os modos diário/total.
- `SavedVideos` e `MarketSelector` ganharam variante visual `creation`, preservando o default compartilhado pelo Catálogo; estilos da V16.2 ficam escopados a `.tiktok-create-flow`.
- Acompanhamento do lote passa a exibir fila pausada por rate limit, horário de retomada, tentativas/retry por item, estados humanos e aviso de que fechar a janela não cancela a fila.
- Dry run usa linguagem de simulação e não afirma criação real; erros de preflight/criação permanecem visíveis na revisão além do toast.
- Backend, APIs, Redis, Neon, Pipeboard, idempotência, retries, kill switch, dry run, criação pausada e regras de orçamento/targeting foram preservados.

## V16.1 — TikTok Ads: campanha aberta, Estrutura + Central

- Expansão inline convertida em **Estrutura rápida**, removendo a grade completa de métricas e separando operação estrutural da análise aprofundada na Central da campanha.
- Central da campanha refinada para tabs textuais Resultado / Estrutura / Histórico, KPIs editoriais, gráfico sem gradient decorativo e métricas secundárias com origem TikTok vs. ROI-NADOS explícita.
- Conjuntos e anúncios ganharam hierarquia mais plana, previews touch-friendly, ações persistentes, reprovação contextual e orientação clara para destinos Product Link.
- CBO continua editável na campanha e ABO passa a ser editável também dentro da Central no nível de cada conjunto, reutilizando o endpoint existente e sem alterar backend.
- Editor de anúncio foi simplificado: inputs sem neon/glow, layout responsivo, validação junto ao campo, explicação sobre nova revisão e botão Salvar desabilitado enquanto nada mudou.
- Ativação pelo drawer agora usa `ConfirmDialog appearance="quiet"` antes de qualquer ação com potencial de gasto; pausa permanece imediata.
- Corrigidos falso zero de gasto durante loading e ROAS real de `0,00×` quando há gasto e receita real zero; aumento de gasto deixa de ser tratado visualmente como erro.
- Histórico passou a usar timeline contínua com rótulos humanos; APIs, Railway, Redis, atribuição, filas, retries, Smart+, Spark, criação de campanhas e demais regras de negócio permanecem inalterados.

## V16 — TikTok Ads: operação diária de campanhas

- Topo de TikTok Ads convertido de hero/KPI cards em contexto operacional com conta, período, frescor da sincronização e quatro métricas editoriais.
- Alertas críticos, vínculo de Pixel e navegação Campanhas/Catálogo/Automações foram simplificados sem alterar regras ou integrações.
- Prioridades foram reorganizadas em atenção e oportunidades; aprovações ganharam modo embedded sem afetar a apresentação padrão em Automações.
- Lista de campanhas ganhou busca natural descoberta, filtros mais claros, orçamento inline legível, ações rápidas simplificadas e precheck de compatibilidade para orçamento em lote.
- Mobile deixou de depender da tabela horizontal de 1160px e passou a usar leitura operacional própria, sem duplicar controles interativos.
- Confirmações de ativação, exclusão e desconexão passaram a usar a aparência quiet; APIs, atribuição, CBO/ABO, guardrails, Redis e Railway permanecem inalterados.

## V15.3 — Cloaker: histórico operacional, destino seguro efetivo e tour cross-tab

- Histórico de decisões convertido para lista operacional contínua, com destino principal/seguro, motivo, score, IP anonimizado e sinais em progressive disclosure.
- Retenção passa a refletir corretamente Redis (até 50 decisões, 30 dias) ou memória da instância (até 50, perdida em reinícios).
- A ação de reexecução foi esclarecida como teste com o acesso atual, sem sugerir replay do visitante histórico.
- Menu dos links agora abre o destino seguro efetivo seguindo link → padrão global → `/_safe`, e fecha após cada ação.
- Tour do Cloaker passa automaticamente por Resultados → Regras → Validação → Links, com aparência quiet e acionador manual acessível.
- Backend, APIs, motor de decisão, Redis, tracking e configuração Railway permanecem inalterados.

## V10 — Pixel & Conversões: topo e navegação interna

- Refinado exclusivamente o topo de Rastreamento > Pixel / Conversões, sem alterar os cards internos de Pixel, Checkout ou Entregas.
- Removidos os quatro cards de resumo; Pixels ativos, Checkouts, Última venda e Saúde agora formam uma faixa editorial integrada.
- Ações globais duplicadas foram removidas do topo; Novo Pixel e Cadastrar checkout continuam disponíveis dentro das respectivas abas, enquanto Atualizar permanece como ação global discreta.
- Alerta de falha convertido em faixa operacional compacta, sem GlassCard pesado ou pulso contínuo.
- Navegação Pixels / Checkouts / Entregas convertida de três mini-cards em tabs textuais com contadores inline e indicador cyan mínimo.
- Preservadas integralmente APIs, dados, cálculos, testes, modais, lógica de abas, backend, tracking e configuração Railway.

## V9.1 — LinkEditor: Teste A/B preditivo

- Refinada exclusivamente a seção Teste A/B preditivo dentro do LinkEditor.
- Removidos mini-card, ícone decorativo, checkboxes crus e caixas coloridas de avaliação.
- Reutilizado o Switch acessível existente do design system, sem criar novo componente ou dependência.
- Simplificada a descrição do recurso e mantido o requisito mínimo de duas variantes com feedback discreto.
- Auto-stop apresentado como configuração secundária, exibindo o limiar real de confiança já salvo no experimento.
- Resultado do experimento reduzido a estado contextual simples, preservando winnerId, status e avaliação original.
- Payload, thresholds, lógica estatística, salvamento, APIs, backend e Railway permanecem inalterados.

## V7 — Links: cabeçalho, métricas e toolbar

- Refinado somente o topo de Rastreamento > Links.
- Removidos os quatro cards de KPI do resumo; métricas agora ficam em faixa editorial integrada.
- Adicionado cabeçalho simples com título Links e ação Novo link.
- Busca, ordenação e arquivados consolidados em uma toolbar leve, sem GlassCard.
- Removidos uppercase/tracking excessivos e microtipografia do resumo.
- Preservadas integralmente lista de links, editor, modais, APIs, lógica e rotas.


## V6.1 — Consolidação da Visão Geral

- Loading do observatório atualizado para refletir KPIs com label + valor e somente dois blocos inferiores.
- Área inferior do hero consolidada em duas colunas sem cards, usando a estrutura editorial já vigente.
- Header do bloco Países simplificado, sem ícone/tooltip redundante.
- Altura mínima residual dos blocos inferiores removida para acompanhar o conteúdo real.
- Nenhuma lógica de dados, API, tracking, integração ou configuração Railway foi alterada.

## V4 — Campanhas analíticas na Visão Geral (2026-09-15)

- Converte Campanhas em uma tabela analítica compacta, sem ranking, badges ou mini-KPIs.
- Cria colunas únicas para Campanha, Gasto, Vendas, CPA e ROAS, com números tabulares alinhados para comparação vertical.
- Substitui o segmented control TikTok Ads/UTMs por tabs textuais discretas e acessíveis.
- Move status para uma indicação inline mínima e remove tooltips redundantes e animações decorativas.
- Mantém o fallback UTM na mesma linguagem visual e reorganiza o mobile em até duas linhas por campanha.
- Preserva integrações, cálculos, dados, backend, Railway e todas as demais áreas da Visão Geral.

## V3 — Funil + Atividade editorial (2026-09-15)

- Segunda seção da Visão Geral refinada sem alterar hero, navbar ou seções seguintes.
- Funil convertido de lista técnica com mini-elementos para fluxo horizontal editorial com quatro etapas e taxas de passagem.
- Removidos números decorativos, ícones, barras, badges e destaque artificial da etapa final.
- Atividade recente convertida em lista limpa: local, estágio, valor quando aplicável e tempo.
- Removidos badges, ícones de estágio, cápsulas e microtipografia abaixo de 11px nesta seção.
- Funil + Atividade permanecem em uma única superfície funcional, com sombra reduzida e divisor simples.
- Responsividade revisada: desktop lado a lado; tablet estreito empilha os dois blocos preservando o funil horizontal; mobile usa funil vertical sem cards.
- Dados, cálculos, APIs, tracking, backend, Railway e demais áreas permanecem inalterados.

# UI V2 — Visão Geral viva, sem cards (2026-09-15)

- Primeira dobra da Visão Geral simplificada para uma composição contínua: Faturamento, Lucro, Investimento, Conversão e ROAS agora aparecem sem cards, sem ícones, sem subtítulos e sem textos auxiliares permanentes.
- Globo central ganhou indicador mínimo de presença ao vivo e passou a usar somente beacons/pulsos na visualização embutida; labels flutuantes ficam reservados ao modo imersivo.
- Aumento real de presença por país dispara pulso cyan curto no globo; o texto técnico foi corrigido de “lead” para “atividade”, sem inferir dados que a API não fornece.
- Controles do globo ficaram visualmente silenciosos e ganham contraste apenas em hover/foco.
- Superfície externa do observatório deixou de ler como um grande card: sem borda/sombra, com ambiente espacial mais discreto.
- Nenhuma rota, API, cálculo, tracking, banco, integração ou configuração do Railway foi alterada.

# UI V1 — Identidade e menubar (2026-09-15)

- Nova aplicação de marca derivada do símbolo atual: wordmark otimizado e app mark dedicado.
- Favicon, ícones PWA, Apple Touch Icon e badge atualizados para o novo símbolo.
- Menubar compactada de 96px para 80px, com controles mais leves, active state mais discreto e menor dependência de glow/gradientes.
- Em telas menores, o wordmark dá lugar ao app mark para preservar espaço sem perder reconhecimento.
- Ícone legado do avatar da navbar substituído pela nova identidade para eliminar a mistura com a linguagem visual anterior.
- Nenhuma rota, API, integração, backend ou configuração do Railway foi alterada.

# Changelog

Todas as mudanças relevantes deste projeto. O formato segue, de forma leve,
[Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/); versionamento
[SemVer](https://semver.org/lang/pt-BR/).

## [Não lançado]

### Adicionado

- **Resiliência do funil (caminho do dinheiro):** trava anti-duplo-disparo de
  webhook por `order_id`, timeout de 8s no fetch do Pushcut e limites de corpo
  (200kb global, 5mb no import de backup) — o checkout do cliente nunca fica
  refém de uma dependência lenta.
- **Segurança de conta:** bloqueio suave de e-mail após várias tentativas de
  login, aviso opt-in de novo login por Pushcut, trilha de auditoria por conta
  (`/api/audit`) com IP mascarado, e sessão deslizante de 30 dias.
- **Watchdog de anomalia (opt-in):** alerta quando uma conta com histórico de
  vendas fica 6h sem conversões, por carona no tráfego (sem cron dedicado).
- **Anti-fraude do cloaker:** camada de velocidade contra granjas de device,
  assinaturas de bots atualizadas para a safra 2026 (crawlers de IA e scanners
  de rede) e nova suíte de testes de user-agent.
- **Operação/DX:** `/healthz` para liveness probe, `npm run doctor` (diagnóstico
  de ambiente sem efeitos colaterais), captura de erros de front no backend
  (`/api/client-error`), runbook de incidentes e `.env.example` completo.
- **Gestão de links:** arquivamento (histórico preservado, fora da lista e do
  `/go`), e páginas de erro amigáveis para links inexistentes/desativados.
- **Durabilidade:** snapshots no Redis e migrações idempotentes no Neon para
  domínios, gateways, pixels e moeda por conta, com reconciliação no boot.

### Alterado

- `/api/stats` passou a usar `private, no-cache` com ETag/304, e os feeds "Ao
  Vivo" e "Atividade" agora memoizam as linhas — menos trabalho a cada poll.
- Política de privacidade com seção de cookies e prazos de retenção concretos.
- README reescrito com a matriz de degradação; `CLAUDE.md` com os contratos de
  API da fase de hardening.

## [1.0.0]

- Primeira versão: rastreamento first-party TikTok (pixel + CAPI), cloaker com
  score de bot, gestão de links/pixels/gateways/domínios, dashboard Next.js e
  webhooks de conversão por gateway.

## V2.1 — acabamento corretivo do hero da Visão Geral

- Remove o pulso decorativo infinito do indicador de status ao vivo; movimento fica reservado a nova atividade real.
- Remove entrada escalonada e deslocamento de hover dos KPIs, mantendo os valores estáveis e não interativos.
- Elimina o gradiente/text-fill legado de Faturamento e fixa o valor em cor sólida.
- Consolida as regras diretamente nos estilos existentes da primeira dobra, sem criar uma nova camada de redesign.
- Preserva layout, globo, dados, tracking, rotas, backend e configuração de Railway.

## UI V2.2 — consolidação final da primeira seção da Visão Geral

- Remove a aparência de grande card do observatório e integra o hero ao fundo da página.
- Mantém KPIs sem cards e sem subtítulos, com o globo como foco principal.
- Remove a duplicação do bloco "Ao vivo" inferior; o status permanece junto ao globo.
- Simplifica Top países e Compras para listas editoriais sem superfícies, sombras ou bordas fechadas.
- Simplifica o foco de país e o tooltip do globo embutido.
- Encurta o pulso de nova atividade real e impede repetição perceptível do ring.
- Preserva backend, APIs, tracking, Railway, navbar e demais seções.

## V5 — Países da Visão Geral
- Simplifica o bloco Países sem alterar dados, filtros ou integração com o globo.
- Remove badge isolado de compras e microanimações/hover com transform.
- Torna visitas e compras autoexplicativas em cada linha.
- Mantém barra proporcional em 2px, com tratamento discreto.
- Simplifica estado de foco para um único accent cyan lateral.
- Tooltip passa a explicar somente a ação de focar/desfocar o globo.
- Mantém acessibilidade com aria-label completo e aria-pressed.

## V6 — Visão Geral / Dados

- Simplifica o bloco Dados da Visão Geral sem alterar lógica ou fontes de dados.
- Substitui o gauge circular por leitura tipográfica do score (`x,x / 10`).
- Integra estado, tendência e alertas em uma linha textual discreta.
- Remove ícone e tooltip redundante do título do bloco.
- Aumenta a legibilidade das métricas `Compras rastreadas` e `Origem identificada`.
- Remove microtipografia de 9–10 px e mantém números tabulares.
- Preserva link para `/conversions?tab=pixels`, `emqSummary`, `overviewHealth`, APIs e deploy Railway.

## V8 — Rastreamento > Links: lista operacional
- Removeu GlassCard/spotlight/animação de entrada dos itens da lista.
- Simplificou status para dot + texto, sem pills/pulsos infinitos.
- Consolidou alertas técnicos em um indicador de problemas e moveu detalhes para expansão sob demanda.
- Removeu barra de conversão redundante; mantém cliques, conversões, taxa e receita como métricas principais.
- Moveu versões, países, idiomas, pixel, domínio e Cloaker para detalhes progressivos.
- Simplificou o bloco A/B e o menu de ações secundárias.
- Simplificou o estado vazio de busca, sem GlassCard decorativo.

## V8.1 — Rastreamento > Links: seleção em massa e estado vazio
- Transforma a barra de seleção em uma toolbar contextual discreta, sem aparência de card.
- Mantém Ativar, Pausar, Excluir e Limpar com hierarquia visual distinta e confirmação destrutiva estável.
- Simplifica o estado vazio inicial, removendo GlassCard, borda tracejada e ornamentação excessiva.
- Mantém `Novo link` acessível no onboarding com o mesmo padrão visual da página.
- Preserva integralmente seleção múltipla, ações em massa, criação de links, APIs e regras de negócio.

## V9.2 — Rastreamento > Links: QR Code e exclusão individual
- Simplifica o modal de QR Code para uma surface sólida, sem GlassCard espesso, pulse ou shadow excessiva.
- Mantém nome, URL, QR e ações de copiar/baixar com hierarquia mais direta e responsiva.
- Remove o efeito visual "Red Room" da exclusão individual de links.
- Simplifica a mensagem de risco e apresenta cliques/conversões como texto, sem badges vermelhos.
- Adiciona a aparência `quiet` opcional ao `ConfirmDialog`; demais usos continuam no visual legado até suas próprias auditorias.
- Preserva focus trap, ESC, retorno de foco, confirmação digitada, busy state, callbacks e toda a lógica de QR/exclusão.

## V11 — Rastreamento > Pixel: aba Pixels
- Remove o GlassCard do header da aba e padroniza busca + CTA contextual.
- Simplifica loading e estados vazios, sem pulse contínuo, caixa dashed ou ícone promocional.
- Reestrutura o PixelCard com status inline, ID/checkouts/atividade editoriais e sem mini-cards, pills, gradients ou glow.
- Mantém intactos callbacks, bindings, teste, instalação, cópias, cobertura, estados busy e toda a lógica de dados.

## V11.1 — Rastreamento > Pixel: overlays operacionais
- Simplifica o modal de instalação do pixel para uma surface sólida, sem GlassCard, glow, badge ou mini-card explicativo.
- Refina a verificação de instalação com campo, ação e retorno em fluxo editorial, preservando todos os detalhes técnicos existentes.
- Reorganiza o teste de conexão para título/contexto/evento/pré-requisitos/resultado, sem alert cards ou microtipografia.
- Simplifica o vínculo de checkouts e o GatewaySelector compartilhado para uma lista com divisores, sem mini-cards por gateway.
- Aplica `appearance="quiet"` somente à exclusão de Pixel, preservando o ConfirmDialog global e os demais usos.
- Preserva geração/cópia do script, verificação de URL, testes, token/testEventCode, bindings, callbacks, APIs e editor de Pixel.

## V11.2 — Rastreamento > Pixel: editor
- Remove o GlassCard pesado do editor e reorganiza o formulário em seções editoriais de identidade, credenciais, status, eventos, teste e checkouts.
- Padroniza inputs, labels, helpers e footer; elimina microtipografia, uppercase técnico e superfícies internas desnecessárias.
- Substitui o checkbox cru de status pelo Switch acessível já existente no projeto.
- Mantém eventos como seleção múltipla por checkbox e integra o GatewaySelector refinado diretamente no fluxo do formulário.
- Simplifica o tratamento visual de erros e os estados de criação/edição sem alterar payload, validações, callbacks ou APIs.
- Preserva token, testEventCode, eventos, gateways, modo create/edit, a11y modal e comportamento Railway/backend.

## V12 — Rastreamento > Checkouts: aba principal e GatewayCard

- Remove o GlassCard do cabeçalho de Checkouts e alinha busca/CTA ao padrão já usado em Pixels.
- Troca loading pulsante por skeleton estático e simplifica os estados vazios de dados e de busca.
- Redesenha o GatewayCard como bloco operacional: provider textual, webhook em linha, pixels ativos vinculados sem pills e status sem animação.
- Remove cores dominantes por provider, mini-cards internos, microtipografia e o destaque verde permanente do teste de integração.
- Preserva integralmente webhooks, vínculos, filtros, teste, edição/exclusão, callbacks e APIs.

## V12.1 — Rastreamento > Checkouts: modal de conexão
- Padroniza o fluxo de criação para "Conectar checkout" e mantém "Editar checkout" na edição.
- Simplifica descrição, labels, select, campo de nome e ajuda específica por plataforma.
- Corrige a orientação sobre vínculo com Pixels sem adicionar seleção de Pixels ao modal.
- Simplifica erro e footer, preservando providers, payload, `secret`, create/edit e callbacks existentes.

## V13 — Rastreamento > Entregas: resumo, filtros e histórico principal
- Remove o GlassCard e os mini-cards de Total/Aprovadas/Falhas do bloco principal de Entregas.
- Converte o resumo em faixa editorial e os filtros em navegação textual com underline cyan, sem segmented control colorido.
- Simplifica estados vazios e corrige a orientação para usar `Testar integração` em Checkouts.
- Reestrutura o histórico como lista operacional com divisores, sem card por linha, pills de gateway/order ID ou badge de status.
- Mantém gateway, pedido, valor, tempo relativo e status em hierarquia editorial e apresenta falhas CAPI em linhas legíveis por Pixel.
- Preserva integralmente dados, filtros, contadores, `row.capi`, APIs e deixa Diagnóstico/Fila/Quarentena fora desta leva.


## V13.1 — Rastreamento > Entregas: diagnóstico de entrega
- Remove o nesting visual do Diagnóstico de entrega e integra o `EventDeliveryPanel` diretamente à página.
- Simplifica filtro de Pixel, retry pendente, erro, loading e estado vazio sem criar novos cards ou ações.
- Reestrutura os envios ao TikTok como lista expansível com divisores, status inline, tempo relativo e Pixel em hierarquia editorial.
- Mantém mensagem de resposta e Event ID no detalhe expandido, com tipografia mais legível e sem mini-cards.
- Preserva integralmente `usePixelLog`, `usePixelHealth`, filtros, status, ordenação, limite, APIs e retry; Fila e Quarentena permanecem fora desta leva.

## V13.2 — Rastreamento > Entregas: fila e quarentena
- Remove o GlassCard externo de `Fila e notificações recusadas` em Entregas, renomeia o bloco para `Fila e quarentena` e mantém o diagnóstico recolhido por padrão.
- Adiciona `appearance="embedded"` a `QueueHealthPanel` e `QuarantinePanel`, preservando a aparência padrão usada em Gateways > Diagnóstico avançado.
- Reestrutura Saúde da fila como resumo editorial de fila, worker, latência e retry CAPI, sem mini-cards nem `StatusBadge` no modo embedded.
- Mantém o warning operacional de Redis, reposiciona `Forçar reenvio` e move idempotência, dedup, órfãos, presença, ASN, TTLs e entradas para `Detalhes de infraestrutura`.
- Simplifica Webhooks em quarentena para lista com divisores, contagem textual e detalhe expandido; mantém o payload cru em bloco técnico e troca pulse por spinner durante resolução.
- Preserva integralmente polling, Redis, retry, `/api/ops/drain-retry`, quarentena, `/api/conversion/quarantine/resolve`, toasts, dados e comportamento dos painéis compartilhados em Gateways.

## V14 — Rastreamento > Domínios: experiência principal e lifecycle

- Adicionada âncora visual simples `Domínios` e refinado o resumo editorial de total, ativos, configurando e atenção sem introduzir cards de KPI.
- Removido o `GlassCard` do cadastro; input, CTA, erro e aviso de provisionamento degradado agora seguem a linguagem de formulário SaaS aplicada nas demais áreas.
- Simplificados loading e empty state, removendo a apresentação promocional/dashed sem alterar `ErrorState` compartilhado.
- `DomainCard` passou a usar uma surface operacional neutra: status e uso deixaram de ser pills, ações contextuais foram preservadas e o hover ornamental foi removido.
- Lifecycle `DNS → HTTPS → Ativo` foi integrado diretamente ao card, mantendo exatamente a máquina de estados e a semântica de erro existentes.
- Diagnóstico e próxima ação passaram a ser linhas operacionais discretas, sem mini-alert cards.
- `DNS e detalhes` continua funcional, com abertura automática após cadastro e somente um domínio expandido por vez; o conteúdo interno de `DnsInstructions` foi preservado para a V14.1.
- Footer e atalhos `Usar em Links` / `Usar no Cloaker` foram mantidos, com tipografia mais legível.
- APIs, payloads, polling, verificação, diagnóstico, toasts, DNS, exclusão e tour permaneceram funcionalmente intactos.

## V14.1 — Rastreamento > Domínios: DNS, exclusão e onboarding
- Refina `DNS e detalhes` como lista técnica contínua com divisores, preservando CNAME/TXT/ownership/certificate, compatibilidade `name`/`host`, valores completos e cópia individual.
- Adiciona affordance discreta ao accordion de DNS, mantendo `expandedHost`, abertura automática após cadastro e apenas um domínio expandido por vez.
- Aplica `appearance="quiet"` somente à confirmação de exclusão de Domínios, preservando `tone="danger"`, confirmação digitada para domínios verificados, callbacks e comportamento do `ConfirmDialog` compartilhado.
- Corrige o tour de Domínios para duas etapas reais (`Adicionar domínio` e `Acompanhar configuração`), remove a etapa desatualizada de uso e adiciona os anchors `domains-add` e `domains-list` na UI atual.
- Preserva lifecycle, polling, verificação, diagnóstico, payloads, endpoints, prioridade das fontes DNS, clipboard/toasts e toda a experiência principal implementada na V14.

## V15 — Rastreamento > Cloaker: estrutura e Resultados
- Adiciona uma âncora visual simples para Cloaker e converte `Resultados / Regras / Links` em tabs textuais com underline cyan, sem segmented cards, ícones ou animação de slide.
- Remove o GlassCard e a ornamentação do painel de Resultados, reorganizando principal, seguro e percentual bloqueado em uma faixa editorial sem CountUp, glow ou mini-cards coloridos.
- Substitui pills de motivos por uma lista operacional legível e mantém o aviso de `/t.js` como warning integrado, sem alert card pesado.
- Mantém Ferramentas recolhidas e reorganiza sticky verdict, ASN e velocity em três operações claras, com inputs e ações no padrão atual do dashboard.
- Reestrutura Resultados por link como lista contínua com divisores, termos visuais `principal/seguro`, barra proporcional fina e gráfico de 14 dias sem glow.
- Aplica `ConfirmDialog` quiet aos resets de contadores, preservando APIs, Redis/sticky/replay/velocity, ordenação, timezone, toasts e toda a lógica existente.
- Regras, simulador, Links protegidos, editor, histórico e tour permanecem funcional e visualmente fora desta leva.

## V15.1 — Rastreamento > Cloaker: Regras e validação
- Reorganiza `Regras` em uma coluna de configuração prioritária e uma coluna de validação, removendo os GlassCards concorrentes sem alterar as tabs ou as demais áreas do Cloaker.
- Simplifica `Proteção global` em uma sequência autoexplicativa: estado mestre, comportamento para suspeitos, sensibilidade, destino seguro e salvamento; remove badges, banners duplicados e option-cards.
- Mantém as configurações avançadas recolhidas e converte velocity, bloqueio recorrente e as 11 camadas de detecção em campos e listas operacionais, com warnings de Redis/Challenge JS preservados e mais claros.
- Corrige a nomenclatura visual do bloqueio por anúncio para refletir acessos de alto risco repetidos, preservando campos, limites, payloads e lógica existentes.
- Converte `Testar acesso` em `Validar configuração`, explicita que o teste usa a última configuração salva e torna os cenários sintéticos mais claros sem alterar perfis ou endpoint.
- Separa o veredito real do preview local de threshold: o resultado principal usa o threshold salvo e `Simular outro limite` fica recolhido, sem alterar nem salvar configuração.
- Move IP, UA, latência e sinais por camada para `Detalhes técnicos`, preservando todos os sinais/pesos e usando amber/verde por semântica em vez de cards e pills.
- Preserva optimistic concurrency, dirty/saved state, conflito entre sessões, APIs, backend, motor de decisão, Redis, thresholds, Railway e demais áreas do Cloaker.

## V15.2 — Rastreamento > Cloaker: Links protegidos e editor
- Remove o GlassCard e a ornamentação da aba Links, reorganizando resumo, busca, ordenação, seleção em massa e lista como fluxo operacional contínuo alinhado às demais áreas do dashboard.
- Corrige a semântica visual de `enabled`: a interface passa a falar em `Proteção ativa/desativada`, deixando claro que a URL continua funcionando e segue para o destino principal quando a proteção está desligada.
- Reestrutura cada link sem pills, glow, hover-float ou stagger; mantém URL, sensibilidade, segmentação, métricas, teste rápido, cópia, edição, histórico e ações com hierarquia mais legível.
- Passa a exibir o modo observação efetivo considerando a configuração global, sem alterar ou sincronizar valores salvos, e aplica `ConfirmDialog` quiet às exclusões individual e em massa.
- Redesenha o drawer de criação/edição com destinos, herança do destino seguro global, domínio, proteção, comportamento para suspeitos, sensibilidade e segmentação em uma sequência autoexplicativa.
- Corrige a copy do destino seguro vazio para refletir a herança real `link → padrão global → página neutra` e esclarece quando o modo observação global afeta o comportamento do link.
- Preserva links antigos com sensibilidade `custom` e threshold existente sem introduzir novo configurador ou alterar o payload; `strict/balanced/loose` passam a ser apresentados como Rígida/Equilibrada/Leve.
- Refina `GeoMultiSelect` com estado sem restrição textual, tokens neutros, tipografia legível e dropdown mais discreto, preservando busca, código manual, paste múltiplo, flags e remoção.
- Preserva APIs, idempotência de criação, revisão otimista, domínios, tracking, motor de decisão, Redis, histórico e backend/Railway.
