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
