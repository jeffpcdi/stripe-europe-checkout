# Criação de campanhas de catálogo — matriz de falhas

Atualizado em 03/08/2026. Este documento cobre o fluxo automático
`PRODUCT_SALES → conjunto CATALOG/VIDEO → anúncio SINGLE_VIDEO/Product Link`.
As três entidades sempre nascem pausadas.

## Fontes verificadas

- [TikTok — criar um conjunto de anúncios](https://ads.tiktok.com/help/article/create-ad-group?lang=en):
  hierarquia, targeting, orçamento, agenda e limite do nome.
- [TikTok — orçamentos diários](https://ads.tiktok.com/help/article/about-daily-budgets?lang=en):
  mínimo de campanha e conjunto e coerência entre os níveis.
- [TikTok — criar Smart+ Catalog Ads](https://ads.tiktok.com/help/article/how-to-create-video-shopping-ads-catalog):
  catálogo elegível, mínimo de quatro produtos e escopos de produto.
- [TikTok — estados da campanha](https://ads.tiktok.com/help/article/campaign-statuses-and-definitions):
  conta em análise, suspensa, sem saldo e estados que impedem entrega.
- [Pipeboard — TikTok Ads MCP](https://pipeboard.co/guides/tiktok-ads-mcp):
  tools de criação, leitura, upload e targeting usadas pela dashboard.
- Schemas vivos do Pipeboard e histórico Neon da conta foram confrontados em
  03/08/2026. O código `40002` apareceu com causas diferentes; ele nunca deve
  ser usado sozinho para decidir retry.

## Cobertura por etapa

| Etapa | Falha | Resposta da dashboard |
| --- | --- | --- |
| Conta | advertiser não autorizado, limitado, em análise ou suspenso | bloqueia antes de upload/escrita e informa a conta a corrigir |
| Catálogo | ID ausente, catálogo fora do BC, menos de 4 aprovados, acesso revogado | valida vínculo/auditoria antes de enfileirar; não cria estrutura parcial |
| Pixel | Pixel ausente ou inválido, evento de Compra ainda não recebido | resolve o vínculo central e consulta eventos reais antes da primeira escrita |
| Orçamento | mínimo, modo ou dono ABO/CBO incompatível | normaliza no domínio e falha antes da rede; nunca converte a estrutura silenciosamente |
| Targeting | país sem `location_id`, placements ausentes ou região inválida | consulta regiões aceitas e envia TikTok-only explicitamente |
| Identidade | tipo incompatível ou acesso revogado | usa somente `BC_AUTH_TT` do mesmo BC e tenta outra identidade elegível |
| Vídeo/capa | arquivo, processamento, formato vertical, capa indisponível | preserva `videoId`, espera processamento e reutiliza o mesmo asset |
| Nome | nome já existe ou foi ocupado durante a criação | consulta todos os nomes e incrementa a sequência (`01 → 02…`) automaticamente |
| Campanha | rate limit, agenda vencida, indisponibilidade explícita | retry com backoff e contador durável, somente quando a API prova que não escreveu |
| Conjunto/anúncio | Pixel, catálogo, orçamento, identidade, criativo ou CTA rejeitado | causa semântica, etapa e `request_id` preservados; estrutura pai permanece pausada |
| Transporte | timeout/rede depois de um `create` | não repete cegamente, pois a resposta é ambígua e poderia duplicar uma entidade |
| Readback | três IDs criados, mas hierarquia ainda não visível | aguarda consistência eventual sem recriar campanha, conjunto, anúncio ou vídeo |

## Regras de operação

1. `40002` não significa “erro temporário”; a mensagem precisa ser classificada.
2. Nome duplicado é resolvido no servidor. O usuário não precisa editar nem
   entrar no Ads Manager.
3. O nome efetivo é persistido antes da escrita e mostrado no cartão do run.
4. Retry automático de escrita só ocorre quando é comprovadamente seguro.
5. Qualquer erro desconhecido mantém detalhes técnicos e `request_id`, mas não
   recebe uma correção inventada.
6. Sucesso só existe após o readback confirmar os três níveis pausados, catálogo
   correto, Pixel/Compra, identidade, criativo, Product Link e ausência de URL manual.
