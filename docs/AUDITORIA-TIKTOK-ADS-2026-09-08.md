# Revisão do TikTok Ads

## Correções principais

- Públicos: as rotas de criar, criar semelhantes e excluir agora respeitam bloqueio de emergência, política desativada, conta bloqueada e simulação. Públicos de site usam o Pixel central da conta validada. A listagem percorre todas as páginas e não interpreta a string `false` como público pronto. O acesso ao gerenciador foi restaurado em Campanhas; exclusão usa confirmação do painel.
- Automações: uma regra nova fica em estado local até salvar, sem contaminar atualizações de outras regras. Falha ao alterar autonomia mantém a confirmação aberta. Rascunhos e popups são isolados por conta. Alterações de custos, pastas e segurança não são sobrescritas por atualizações em segundo plano.
- Popups: portal compartilhado, foco e rolagem controlados; chaves distintas por tipo de popup e conta impedem janelas duplicadas. O editor de anúncios reinicia com o anúncio selecionado. Importação em massa usa o modal compartilhado.
- Métricas: o detalhe abre no período selecionado e usa dias civis no fuso da conta; a comparação anterior alinha datas, não posições de listas incompletas. Removido o ROAS do detalhe que misturava atribuição global com outra janela e podia usar moeda incorreta. CPA zero é exibido quando há conversões.
- Catálogos: removido atalho legado que prometia Smart+ sem enviar essa modalidade. Criação converge no formulário validado, com uma ação principal. O botão respeita prontidão/capacidade. Preços do feed como `79.90 BRL` aparecem como `R$ 79,90`. O estado do catálogo prioriza pendências/reprovações e alterações não enviadas; os indicadores distinguem validação local de dados remotos.
- Mensagens: simulação de Spark e criação comum não afirmam que houve criação; proposta com falha/atualização pendente não é anunciada como executada. Importação de vídeos diferencia sucesso, falha parcial e ausência de vídeos novos. Falhas de saúde e tarefas não aparecem como listas vazias.
- Interface: indicadores TikTok usam a mesma superfície, ícones, tipografia e animação da Visão geral; cards e controles têm contraste e áreas de toque consistentes. Movimento reduzido é respeitado. “Bloquear novas ações” explica que anúncios já ativos continuam veiculando.

## Validação realizada

- `npm test`: suíte completa aprovada, incluindo automações, escopo de conta, criação, filas, sincronização, catálogo, múltiplos criativos e regressões de interface.
- Novo teste executa os handlers reais de Públicos em isolamento: nenhuma escrita em simulação/bloqueio, conta estrangeira recusada, Pixel central obrigatório; paginação e disponibilidade verificadas com Pipeboard simulado.
- `npm run build`: build Next.js e verificação TypeScript aprovados.
- `node --check ads-routes.js`, `node --check ads-provider.js` e `git diff --check` aprovados.
- Navegação em prévia local isolada: Campanhas, expansão, detalhe e período, duplicação e variações, lançador, Smart+, Spark, Públicos/semelhantes/exclusão, Catálogos/criação/importação em massa/detalhe/editor/lote, Automações/regras/modos/segurança/tarefas/ferramentas.
- Confirmada abertura e fechamento de popups sobrepostos sem duplicação e restauração de rolagem. Falha simulada ao salvar autonomia preserva confirmação. Visualização de 390 × 844: indicadores, importação em massa e segurança sem transbordamento horizontal. Console da prévia final sem erros.

## Limites da validação

A prévia usa respostas de demonstração e recusa escritas. Os testes não confirmam entrega de anúncios, permissões atuais do Pipeboard, processamento de públicos, webhooks ou execução 24/7 em produção. Não houve publicação, push ou operação real em contas de anúncios. A criação de públicos semelhantes ainda depende de aceitação dos parâmetros pelo conector vivo; a revisão não substitui seu readback operacional. Componentes e fluxos condicionados a incidentes reais foram revisados no código/testes, sem fabricar incidentes na conta.
