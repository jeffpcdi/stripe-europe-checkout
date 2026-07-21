# Plano de refinamento do Pixel TikTok

## Objetivo do produto

O Pixel deve responder, sem conhecimento técnico, a quatro perguntas do operador:

1. A tag está publicada em todas as páginas certas?
2. O navegador realmente executou a tag?
3. A Events API entregou o evento ao TikTok?
4. Os sinais enviados permitem que o TikTok reconheça a pessoa e atribua a venda?

O valor do Pixel não é apenas contar visitas. Ele costura anúncio, landing page, VSL, checkout e confirmação do gateway no mesmo visitante. Essa jornada melhora atribuição, leitura do funil, criação de públicos e otimização das campanhas.

## Jornada do usuário

1. Criar o pixel com Pixel Code e Access Token do mesmo datasource no TikTok.
2. Vincular o gateway que confirma Pagamento e Compra.
3. Abrir **Como instalar** e escolher HTML, Google Tag Manager, Next/React ou Vários domínios.
4. Publicar o mesmo bloco em todos os arquivos/layouts do produto.
5. Abrir a página como visitante e usar **Verificar instalação**.
6. Conferir em **Cobertura real** se Navegador e CAPI aparecem para cada hospedagem.
7. Testar Carrinho/Checkout e confirmar que Compra chega exclusivamente pelo webhook do gateway.
8. Acompanhar Saúde, EMQ e recomendações de dados.

## Contrato integrado

### Identidade e deduplicação

- `vid` é persistido no navegador e pode ser transferido apenas para links/domínios autorizados.
- `ttclid` e UTMs são persistidos e transferidos junto com o visitante.
- Cada navegação real recebe um `event_id` único. O mesmo ID é compartilhado pelo Pixel do navegador e pela CAPI.
- Dois pixels na mesma página usam o mesmo evento de navegação, mas continuam isolados por Pixel Code/token.
- Recarregar ou revisitar a mesma rota cria outro evento legítimo; não há mais colisão por hora.

### Entrega

- Eventos de navegação entram numa fila local limitada a 40 itens e 48 horas.
- A fila usa `fetch keepalive` no fluxo normal e `sendBeacon` na saída.
- O item só sai da fila depois que o backend aceita, deduplica ou enfileira o retry da CAPI.
- Falhas temporárias do TikTok continuam na fila server-side de retry.
- E-mail e telefone nunca são gravados na fila local; trafegam apenas para o backend da conta.

### Dados captados

- URL, título, referrer, domínio, rota e navegação de SPA.
- UTMs, `ttclid`, `_ttp`, IP e user agent.
- Identidade estável por `external_id` hasheado.
- E-mail e telefone válidos para Advanced Matching, hasheados antes da Events API.
- Produto, SKU, nome, preço e moeda quando presentes em metatags ou no evento manual.
- Jornada de páginas e cliques marcados.
- Pagamento e Compra somente de fonte confiável: webhook de gateway.

### Segurança e privacidade

- Token explícito inválido nunca cai no pixel único da conta.
- Tags e webhooks são isolados por conta, pixel e gateway.
- Links externos só recebem identidade se o host estiver em `data-link-domains` ou o link tiver `data-roinados-link`.
- `data-consent="required"` permite aguardar a CMP.
- `RoiNadosPixel.consent('grant' | 'revoke')` controla o início e a revogação.
- `data-roinados-ignore` exclui um campo/formulário do Advanced Matching.
- `data-advanced-matching="off"` desliga a captura automática.

## Múltiplos arquivos e hospedagens

### Vários arquivos no mesmo host

Cole o mesmo bloco em cada arquivo HTML, ou uma única vez no template/layout compartilhado. O loader é idempotente: carregar o mesmo token duas vezes na mesma página não duplica a instalação.

### SPA, Next e React

Instale no layout raiz. O tracker observa `pushState`, `replaceState`, `popstate` e mudanças de hash. Cada mudança real de rota recebe um novo `event_id`.

### Landing, VSL, checkout e upsell em hosts diferentes

Use `data-link-domains="checkout.exemplo.com,upsell.exemplo.com"` em todas as tags que apontam para esses hosts. O tracker decora os links no HTML, links inseridos depois por frameworks e o link no instante do clique.

Quando só um link deve transportar a identidade, marque-o com `data-roinados-link`. Links de terceiros não autorizados ficam intocados.

## Variáveis que podem perder um evento

| Camada | Causa | Como detectar | Proteção/ação |
| --- | --- | --- | --- |
| Publicação | tag ausente em um arquivo/layout | URL sem execução em Cobertura real | instalar em todos os arquivos ou no layout raiz |
| Cache | CDN/GTM mantém tag antiga | HTML/runtime mostra token antigo | publicar container e limpar cache |
| JavaScript | erro antes do loader | Navegador sem atividade | conferir console, ordem e sintaxe da página |
| CSP | `script-src`/`connect-src` bloqueia TikTok ou dashboard | script existe, mas não executa | liberar os hosts necessários na CSP |
| Bloqueador | ad blocker bloqueia analytics | funciona em janela limpa, falha no browser normal | usar domínio próprio e manter CAPI ativa |
| Consentimento | CMP nunca concede | status sem navegador após aceite esperado | chamar `consent('grant')` no callback real |
| Rede | offline, troca rápida de página, timeout | evento fica pendente | outbox local + keepalive + beacon |
| Deploy | processo reinicia depois do recebimento | conexão sem ACK | cliente preserva e reenvia o item |
| TikTok | 5xx, timeout ou indisponibilidade | fila de retry > 0 | retry server-side automático |
| Credencial | Pixel Code/Access Token incorreto ou expirado | último CAPI em erro | gerar token no mesmo datasource |
| Identidade | `ttclid` removido em redirects | cobertura de ttclid baixa | preservar query e usar linker entre hosts |
| Cookie | `_ttp` ainda não existe no primeiro tick | `_ttp` baixo, demais sinais presentes | sincronização tardia em 1,5s e 5s |
| Multi-host | localStorage não cruza domínio | visitante vira dois leads | `data-link-domains`/`data-roinados-link` |
| SPA | troca de rota sem reload | só primeira página na jornada | hooks de history/hash integrados |
| Duplicação | tag repetida por layout + GTM | dois loaders no HTML | singleton por token evita bootstrap duplicado |
| Deduplicação | ID reaproveitado para visita diferente | volume menor que sessões | ID único por navegação, não por hora |
| Evento manual | nome/token/valor incorreto | evento recusado ou ausente | API explícita por token e propriedades sanitizadas |
| Gateway | webhook ausente ou sem vínculo | Compra não aparece | conectar e vincular o gateway correto |
| Receita | moeda/valor/order_id inválidos | erro no recibo do gateway | validar moeda ISO, valor e ID idempotente |
| Bots | user agent classificado como bot | visita não entra no funil | testar com navegador real e revisar filtro se necessário |
| Rate limit | rajada anormal por IP | parte da rajada ignorada | reduzir disparos duplicados e manter lote humano |

## Qualidade de correspondência (EMQ)

Prioridade dos sinais:

1. `ttclid` preservado desde o clique do anúncio.
2. E-mail ou telefone válido com consentimento.
3. `external_id` estável em toda a jornada.
4. `_ttp` sincronizado após o Pixel TikTok carregar.
5. IP e user agent captados no backend.

O painel mostra a cobertura percentual de `ttclid`, e-mail, telefone e `_ttp` por pixel. Uma taxa CAPI alta com EMQ baixo significa entrega técnica boa, mas reconhecimento insuficiente.

## Critérios de aceite operacional

- Verificação por URL diferencia código estático de execução real.
- Cada hospedagem usada aparece em **Cobertura real**.
- Navegador e CAPI mostram atividade recente para o mesmo pixel.
- Duas visitas à mesma rota geram IDs diferentes.
- Browser e CAPI da mesma visita usam o mesmo ID.
- Offline/reload não apagam itens pendentes da fila local.
- Pixel pausado não dispara.
- Token inválido não roteia para outro pixel.
- Carrinho/Checkout funcionam por atributo e API.
- Compra/Pagamento só funcionam com gateway confiável.
- Dois pixels nunca recebem silenciosamente o evento um do outro.
- O dashboard passa no build de produção e funciona em desktop e mobile.

## Próximas evoluções opcionais

Estas melhorias exigem produto/infra adicional e não bloqueiam o contrato atual:

- domínio first-party dedicado por conta para reduzir bloqueio por listas de anúncios;
- fila de ingestão browser durável em Redis antes de chamar qualquer fornecedor;
- integração pronta com CMPs específicas (Cookiebot, OneTrust e similares);
- templates nativos para Shopify, WooCommerce e Webflow;
- alerta automático quando uma hospedagem ativa deixa de enviar eventos;
- comparação sessões da hospedagem versus eventos recebidos para medir perda estimada;
- exportação de diagnóstico por período para suporte e auditoria.
