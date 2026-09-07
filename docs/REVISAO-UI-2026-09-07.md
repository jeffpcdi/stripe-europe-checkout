# Revisão da dashboard — 7 de setembro de 2026

## Organização

A navegação reúne Operação (Visão geral e TikTok Ads), Rastreamento (Conversões, Links, Domínios e Proteção) e Conta. Campanhas, Catálogo e Automações permanecem as três áreas do TikTok Ads. Detalhes de métricas, condições de regras, integrações e ferramentas secundárias ficam recolhidos.

Os estilos compartilhados foram ajustados para contraste, espaço, foco visível, formulários no celular e transições curtas. Cards deixaram de flutuar indiscriminadamente. Modais mantêm o foco durante digitação, prendem o teclado, rolam em telas pequenas e devolvem o foco ao fechar. Animações respeitam a preferência do sistema e do painel.

## Falhas críticas corrigidas

| Antes | Comportamento atual |
| --- | --- |
| Globo misturava histórico e presença; atividade usava radar e contagem simulados | Apenas presença recente da API no globo; atividade mostra o histórico real |
| Falhas de consulta viravam zero ou subtotal da lista | Dados ausentes aparecem como travessão; falhas de atualização têm aviso e tentativa novamente |
| EMQ ausente virava nota 8,5 | Sem nota recente, não há nota nem alegação de qualidade |
| Receita menos anúncios aparecia como lucro líquido | Rótulo “Após anúncios”, com receita atribuída e gasto do mesmo escopo; outros custos explicitamente excluídos |
| Regras personalizadas mostravam valores de um ajuste padrão | Resumos usam parâmetros salvos; desligar/religar preserva a configuração |
| Conexão de domínio simulava DNS/SSL e anunciava sucesso sem verificar | Cadastro, instruções reais e verificação separados; estado pronto vem do backend |
| Smart+ era oferecida por um formulário incompleto | O lançador abre o formulário completo, com capa e término; Spark também tem acesso explícito |
| ESC/foco de popups dependiam de callbacks recriados | Callback estável, apenas o diálogo superior recebe ESC e rolagem é liberada ao fechar o último |

## Validação e limites

- Testes de presença expirada/erro/zero, moedas diferentes, ausência de métricas, regras personalizadas e domínio pendente.
- Testes de foco, Tab/Shift+Tab, ESC e popups sobrepostos.
- Suíte do repositório, TypeScript, build Next.js e revisão do diff.
- Verificação visual por navegador em desktop e celular com APIs locais de teste.

A prévia não inicia o Express operacional nem seus workers. Nenhuma campanha, domínio, evento de compra ou configuração foi enviado aos serviços reais. Build e testes locais não equivalem a validação do deploy ou do estado atual de TikTok/Pipeboard/Neon em produção.

### Refinamento dos quatro indicadores da Visão geral

A pedido do usuário, o indicador “Após anúncios” foi substituído por **Gasto em ADS**:
usa o `spend` oficial de `/api/ads/roas`, na moeda da conta, incluindo todos os status de campanha.
Não calcula receita menos anúncios nem mostra margem. O período Tudo identifica a janela de
90 dias atualmente suportada pela consulta de anúncios. Falhas preservam aviso de atualização.

Os quatro cards agora compartilham `overview-metrics.tsx`: ícones de traço uniforme em bases
quadradas, tipografia numérica proporcional com dígitos de largura fixa, entrada em sequência,
transição dos valores e iluminação/elevação ao passar o mouse. Não há animação decorativa em loop.
Movimento reduzido do sistema e a preferência do app são respeitados. A comparação de receita
só aparece quando há base anterior positiva na mesma moeda. ROAS indefinido e conversão sem
visitantes mostram `—`.

Validação: build de produção e testes de integridade da UI aprovados. Prévia local com fixtures
somente leitura conferida em 1512px (quatro cards alinhados, sem transbordamento) e 390px
(duas colunas, textos legíveis, sem rolagem horizontal), sem erros no console. Os novos testes
cobrem gasto versus lucro, moeda USD com receita BRL, escopo ausente, NaN, zero confirmado,
erro de atualização e ROAS indefinido. Nenhuma campanha real foi alterada nesta validação.

### Reestruturação do globo e da jornada

- Globo: cenário com profundidade, iluminação difusa e direcional, atmosfera mais clara e
  área própria para o canvas. O enquadramento reserva espaço para cabeçalho, controles e países.
- Removidas hastes, etiquetas minúsculas na superfície, arcos e ondas contínuas. O primeiro
  snapshot não simula entrada; aumento na contagem gera uma única onda curta. Erro e reconexão
  restabelecem a base sem criar chegadas fictícias. Os pontos continuam restritos à presença fresca.
- Corrigida a integração do material: a versão instalada de `react-globe.gl` recebe
  `globeMaterial` por prop. O código antigo tentava chamar um método inexistente dentro de um
  `try/catch` silencioso. A configuração agora usa a prop e o callback `onGlobeReady`.
- Controles em barra única: zoom, recentrar, pausar/retomar e tela cheia. Tela cheia preserva
  contador e países; falha da API recebe mensagem. Países podem ser selecionados repetidamente
  para recentrar a câmera. A roda do mouse continua rolando a página.
- Funil em quatro linhas alinhadas, com barras proporcionais e taxas por etapa; divisão sem
  base aparece como `—`. Histórico com local, ação e horário, sem badges repetidos ou siglas
  cruas de países; datas inválidas são excluídas.
- Validação local com fixtures, build e suíte de testes. Nenhuma escrita em campanhas ou
  serviço de produção durante a prévia. Novas regressões cobrem primeira leitura, contagem
  estável, saídas, aumentos de presença, funil vazio e nomes de países.

### TikTok Ads e operação de campanhas

- Filtros Ativas, Pausadas, Todas, Em revisão e Rejeitadas com alvos de 44px, contraste alto e
  seleção evidente também no celular. Contexto da conta, navegação e totais receberam o mesmo acabamento.
- Cada campanha exibe orçamento, gasto, compras informadas pelo TikTok, CPA, CPM, CPC, cliques,
  CTR e exibições. Valores ausentes e divisões sem base mostram `—`; compras não se misturam
  com a atribuição do gateway. Total da conta continua independente do subtotal filtrado.
- Ações Pausar/Ativar e Duplicar sempre visíveis, com nomes. Conjuntos e anúncios têm abertura
  explícita. Ativação confirma nome da campanha, conta e orçamento antes do envio.
- Orçamento CBO permanece na campanha. ABO soma apenas conjuntos completos com a mesma duração;
  não soma o orçamento legado da campanha nem trata total como diário. O ajuste em lote rejeita
  conjuntos ABO e pede edição no nível correto. O antigo slider “gelo/fogo”, com gravação ao
  arrastar, foi removido. Edição agora usa valor numérico e Salvar.
- A interface não informa sucesso operacional para dry-run, zero atualizado ou resposta parcial.
  Solicitações aceitas aguardam a sincronização para mudar o status mostrado. Não houve alteração
  do endpoint de status nem teste com campanhas reais.
- Prévia local conferida em desktop e celular, incluindo confirmação de ativação, expansão e
  rejeição de escrita pela API de teste. Build e testes verificam métricas, CBO/ABO, moeda,
  ausência de base e classificação das respostas de status. Modal de lote usa foco/ESC compartilhados.
