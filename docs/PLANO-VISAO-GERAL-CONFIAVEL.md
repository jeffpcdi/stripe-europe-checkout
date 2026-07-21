# Visão Geral confiável — plano e integração

## Objetivo do usuário

A Visão Geral precisa responder, em poucos segundos:

1. Quanto entrou, quanto foi investido e qual foi o retorno no período?
2. O funil está convertendo ou existe um gargalo?
3. Os números estão completos e atualizados?
4. Se há perda de dados, qual é a causa e onde corrigir?

Ela não deve substituir as telas operacionais. A home resume e orienta; Funil,
Conversões, Links e TikTok Ads concentram investigação e edição.

## Fontes e ritmos

| Informação | Fonte de verdade | Ritmo | Regra de segurança |
| --- | --- | --- | --- |
| Receita e vendas | webhook confirmado do gateway | evento + poll de 12 s | navegador não cria dinheiro |
| Visitas e funil | tracker first-party e links rastreados | evento + poll de 12 s | escopo por conta |
| Presença | heartbeat `/api/live` | 5 s | presença não é histórico |
| Gasto e campanhas | TikTok Ads/Pipeboard | 60 s | advertiser selecionado explícito |
| Pixel/CAPI | loader no navegador + Events API | evento | deduplicação por `event_id` |

Um zero só é exibido como zero quando existe uma fonte configurada e a janela
foi consultada. Ausência de integração, moeda incompatível e falta de dados são
estados diferentes.

## Perdas e inconsistências cobertas

- Venda órfã: webhook recebido sem visita correspondente.
- Origem ausente: visita direta, UTM não enviada ou macro não substituída.
- Virada do dia: navegador fora de Brasília cortando “Hoje” no horário errado.
- Janelas divergentes: 7/30 dias no funil começando no horário atual, enquanto
  TikTok Ads começava à meia-noite.
- Multi-moeda: receita e gasto em moedas diferentes não geram ROAS falso.
- Multi-hospedagem: o loader registra os hosts observados e o diagnóstico aponta
  domínio que recebeu tráfego sem pixel identificado.
- Configuração parcial: link inativo, pixel sem ID/token ou ausência de gateway.
- Frescor cruzado: atividade de outra conta não altera mais o `updatedAt` da
  conta atual.
- Timestamp inválido: eventos com data inválida não entram silenciosamente no
  período.

## Experiência integrada

- “Confiança dos dados” resume cobertura de vendas, origem, hospedagens e
  integrações. Os detalhes ficam recolhidos para não poluir a home.
- Alertas são acionáveis e levam à tela correta; não exibem jargão de banco,
  Redis ou CAPI para o usuário comum.
- A home usa calendário de Brasília. “7 dias” significa hoje e os seis dias
  anteriores; “30 dias”, hoje e os 29 anteriores. O mesmo intervalo é enviado
  ao TikTok Ads.
- O globo foi reduzido para deixar a decisão mais próxima da primeira dobra.
- A tabela completa de leads saiu da home; o funil continua oferecendo acesso
  à análise completa. Isso remove duplicação e melhora mobile/performance.
- Etapas do feed são exibidas em português.
- Textos de moeda e explicações de ROAS quebram linha com segurança no celular.
- Conta sem dados recebe checklist derivado da configuração real, não de flags
  locais.
- O tour explica a diferença entre presença ao vivo, métricas históricas e
  confiança da captura.

## Arquitetura implementada

- `overview-health.js`: agregador puro e testável, sem PII ou chamada externa.
- `GET /api/overview/health`: contrato escopado por conta com frescor, setup,
  cobertura por host e correções prioritárias.
- `stats.js`: `updatedAt` calculado apenas com eventos/leads da própria conta.
- `dashboard/lib/metrics.ts`: janelas de calendário no fuso de Brasília.
- `DataConfidence`: diagnóstico progressivo, carregado depois do primeiro paint.
- `OnboardingChecklist`: reutiliza o contrato consolidado e evita três leituras
  de listas separadas.

## Próximas evoluções seguras

1. Criar comparação opcional com período anterior para receita e conversão.
2. Permitir metas por moeda, sem conversão cambial implícita.
3. Adicionar SLA configurável de frescor por operação (loja 24 h vs. campanhas
   com horários restritos), evitando alertas falsos durante a madrugada.
4. Expor reconciliação por pedido entre gateway e plataforma de anúncios.
5. Oferecer exportação agendada do diagnóstico, sem incluir PII.
6. Medir Core Web Vitals da home em produção e reduzir o globo para modo estático
   em aparelhos com pouca memória.

Essas evoluções não são pré-requisitos para a confiabilidade atual e devem ser
ativadas somente com contrato de dados e testes de isolamento por conta.
