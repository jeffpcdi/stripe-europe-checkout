# Handoff — instruções para um novo chat do v0 (conta diferente, sem memória)

> Copie o conteúdo abaixo e cole como primeira mensagem no novo chat. Ele assume que o
> repositório GitHub já está conectado, mas que **Neon e Blob se perderam** (eram de outra
> conta v0) e precisam ser reconectados do zero.

---

## Cole a partir daqui

Olá. Este projeto é um **rastreador de conversões + dashboard de TikTok Ads** (Node/Express no backend + Next.js App Router em `dashboard/`). O código está no repositório conectado. Preciso da sua ajuda para (1) **restaurar as integrações que se perderam** e (2) depois executar um plano de refatoração que já está versionado no repo.

### Contexto de arquitetura (leia antes de agir)
- **Backend:** `server.js` (Express), com módulos `stats.js` (estado em memória + cache), `db.js` (camada Neon/Postgres), `presence.js` (ao vivo, usa Redis), `ads-routes.js` (integração TikTok Ads), `ads-bulk.js`.
- **Frontend:** pasta `dashboard/` (Next.js). Views principais em `dashboard/components/overview`, `funnel`, `activity`, `ads`, `geo`. Hooks de dados em `dashboard/lib/api.ts` (SWR). Agregação client-side em `dashboard/lib/metrics.ts`.
- **Modelo de dados:** estado quente em memória (caps de 3.000 eventos / 8.000 leads), snapshot em disco, e **Neon como fonte durável** (write-through). Redis (Upstash) para presença/tempo real.

### Passo 1 — Reconectar integrações (CRÍTICO, faça primeiro)
1. **Neon (Postgres):** conecte a integração Neon. Isso repõe `DATABASE_URL` / `NEON_DATABASE_URL` / `POSTGRES_URL`.
   - No boot, `db.js` roda `CREATE TABLE IF NOT EXISTS` para todas as tabelas — então **um banco Neon vazio se auto-inicializa** ao subir o servidor. As tabelas esperadas são: `accounts`, `account_sessions`, `gateways`, `leads`, `events`, `events_archive`, `account_audit`, `variants`, `sessions`, `config`, `pixels`, `links`, `pixel_events`, `custom_domains`.
   - **Atenção:** os dados históricos (leads/eventos/contas) do banco antigo **não** vêm junto. Se houver um dump/export do Neon anterior, importe-o; senão, o app começa vazio (funcional, sem histórico).
2. **Uploads:** anexe um Volume persistente no Railway. Criativos e feeds são servidos pelo próprio app; não há Vercel Blob nem `BLOB_READ_WRITE_TOKEN`.
3. **Redis (Upstash):** se o tempo-real for necessário, conecte Upstash for Redis. Repõe `KV_REST_API_URL/TOKEN`, `UPSTASH_REDIS_REST_URL/TOKEN`, `REDIS_URL`. Sem ele, a presença "ao vivo" degrada, mas o app sobe.

### Passo 2 — Repor variáveis de ambiente restantes
Estas NÃO vêm de integração e precisam ser preenchidas manualmente em Project Settings → Vars
(peça ao usuário os valores; nunca invente):
- `PIPEBOARD_API_KEY` — chave `pk_...` do Pipeboard (nova integração de TikTok Ads; ver plano). Substitui a antiga `ZERNIO_API_KEY`.
- `CONVERSION_WEBHOOK_SECRET` — segredo do webhook de conversão.
- `TIKTOK_ACCESS_TOKEN`, `TIKTOK_PIXEL_CODE` — CAPI/pixel do TikTok.
- `PUSHCUT_WEBHOOK_URL` — notificações (opcional).
- `PRIMARY_HOST`, `COOKIE_DOMAIN`, `DASHBOARD_UPSTREAM_URL` — hosts/roteamento.
- Cloudflare (domínios custom, opcional): `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`, `CLOUDFLARE_CNAME_TARGET`, `CLOUDFLARE_FALLBACK_ORIGIN`.
- `EVENT_RETENTION_DAYS` (opcional, default 90).

### Passo 3 — Executar os planos versionados
Na raiz do repositório existem dois arquivos de plano. **Leia-os antes de codar** e siga fase a fase:
- `PLANO-UNIFICACAO-DASHBOARD.md` — unificar as abas Visão Geral + Funil + Atividade numa única página com globo central; corrige 2 bugs (UTM com macro literal e incoerência de receita no funil por vendas órfãs). Tem 6 fases ordenadas por impacto ÷ risco, com critério de "pronto quando" em cada uma.
- `PLANO-MIGRACAO-PIPEBOARD.md` (se presente) — substituir a integração antiga (Zernio) pelo Pipeboard MCP para TikTok Ads.

Comece confirmando comigo qual dos dois planos devo executar primeiro. Não altere backend e frontend ao mesmo tempo — vá por fases, com build limpo (`pnpm exec next build`) ao fim de cada uma.

### Regras de trabalho
- Não remova imports antes de remover o uso do código.
- Só edite arquivos que precisam mudar.
- Teste no navegador (skill agent-browser) as mudanças visíveis antes de dar por concluído.
- A `PIPEBOARD_API_KEY`/segredos só existem no ambiente publicado — testes de API ao vivo só funcionam no deploy, não no sandbox.

## Fim do texto para colar

---

## Notas para você (usuário) — não precisa colar
- Os nomes de env acima foram extraídos do código (`process.env.*`). Guarde os **valores** num lugar seguro antes de trocar de conta — o v0 não migra segredos entre contas.
- Se você tiver acesso ao painel do Neon antigo, faça um **dump** (`pg_dump`) antes de desconectar, para reimportar o histórico de leads/eventos na conta nova.
- `RAILWAY_*` aparecem no código porque o deploy de produção é no Railway; não são necessários para rodar no v0/Vercel.
