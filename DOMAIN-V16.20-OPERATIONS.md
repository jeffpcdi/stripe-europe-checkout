# V16.20 — Operação de Domínios (Cloudflare for SaaS)

## Arquitetura

`domínio do cliente → Cloudflare Custom Hostname → Worker → Railway public origin → ROI-NADOS`

Novos domínios **não** são cadastrados em Railway Custom Domains. Registros legados com `provider=railway` continuam sendo administrados pelo provider antigo.

## Hosts técnicos

Exemplo recomendado (ajuste somente se já houver conflito na zona):

- `proxy-fallback.roi-nados.top` — fallback origin técnico.
- `customers.roi-nados.top` — CNAME target mostrado no onboarding DNS.

Esses hosts são infraestrutura; nunca aparecem como URL pública do cliente.

## Ativação segura

1. Gere `EDGE_DOMAIN_SECRET` com alta entropia e configure o mesmo valor como secret no Worker e no Railway.
2. Configure `EDGE_ORIGIN_HOST` com o hostname público Railway (`*.up.railway.app`).
3. Na zona Cloudflare, crie o fallback origin técnico conforme o padrão oficial para Worker-as-origin (registro originless/proxied apropriado) e marque-o como Fallback Origin.
4. Crie `customers.roi-nados.top` como CNAME proxied apontando para o fallback técnico.
5. Deploye `cloudflare/domain-edge-worker.mjs` como Worker.
6. Adicione rota wildcard da zona para o Worker. Se a rota puder interceptar o domínio principal, crie rotas mais específicas sem Worker para `roi-nados.top/*` e outros hosts próprios que devam bypassar a edge.
7. Confirme no painel/API que o Fallback Origin está `active`.
8. Configure no Railway: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`, `CLOUDFLARE_CNAME_TARGET`, `CLOUDFLARE_FALLBACK_ORIGIN`, `EDGE_DOMAIN_SECRET`, `EDGE_ORIGIN_HOST`.
9. Somente depois altere `CLOUDFLARE_EDGE_READY=true`.

Enquanto `CLOUDFLARE_EDGE_READY=false`, `/api/domains` reporta automação indisponível e nenhum novo Custom Hostname é criado.

## Rollback

1. Volte `CLOUDFLARE_EDGE_READY=false` para congelar novos provisionamentos.
2. Remova/desative a rota Worker wildcard (não apague Custom Hostnames existentes antes de analisar o impacto).
3. Restaure qualquer DNS técnico alterado a partir do snapshot capturado antes da ativação.
4. Faça rollback do deploy Railway para a release anterior, se necessário.
5. Não remova `roi-nados.top` nem domínios Railway legados automaticamente.

## E2E obrigatório

- Adicionar um domínio de teste pela dashboard.
- Confirmar Custom Hostname criado no Cloudflare.
- Configurar DNS do cliente para `CLOUDFLARE_CNAME_TARGET`.
- Esperar `status=active` e `ssl.status=active`.
- Confirmar `https://dominio/slug`, `/go/:slug`, `/c/:slug`, cookies, query string e tracking.
- Confirmar que Railway Custom Domains não aumentou.
- Remover o domínio de teste e confirmar que não ficou Custom Hostname órfão.

## Apex

Apex (`cliente.com`) depende do DNS do cliente suportar mecanismo equivalente a CNAME no apex (flattening/ALIAS/ANAME). Sem isso, orientar uso de subdomínio. Apex Proxying universal é produto separado e não faz parte desta versão.
