// ── Camada de persistência (Neon Postgres) — MULTI-TENANT ────────────────
// Guarda contas, sessões de login, gateways, leads, eventos, contadores de
// variantes e sessões ao vivo de forma DURÁVEL, isolados por conta
// (account_id). O stats.js continua com a API síncrona (arquivo local como
// cache quente) e faz "write-through" assíncrono para cá. No boot, hidratamos
// o cache a partir do banco — assim os dados sobrevivem a deploys/reinícios.
//
// Convenções multi-tenant:
//  - Toda tabela de dados tem a coluna account_id (text).
//  - Tabelas com PK "de nome" (variants, pixels, links, config) usam chave
//    namespaced `${accountId}:${nome}` na PK para evitar colisão entre
//    contas; a coluna account_id permite filtrar.
//  - Dados legados (account_id IS NULL) são atribuídos ao PRIMEIRO usuário
//    cadastrado (admin) via claimLegacyData().
const { neon } = require('@neondatabase/serverless');
const crypto = require('crypto');

const URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL || null;
// Aceita DATABASE_URL (padrão), POSTGRES_URL ou NEON_DATABASE_URL (prefixo usado
// pela integração Neon do v0/Vercel) como fonte da connection string.
const enabled = !!URL;
const sql = enabled ? neon(URL) : null;

if (!enabled) {
  console.warn('[db] DATABASE_URL não definido — persistência desativada (modo só-arquivo).');
}

let ready = false;

// Item 249: status por migração — o /api/health reporta se a tabela
// custom_domains e a coluna accounts.currency migraram com sucesso no boot.
const migrations = { customDomains: false, accountCurrency: false, quarantine: false };

// Chave namespaced por conta para tabelas keyed-by-name.
function nsKey(accountId, name) {
  return (accountId || 'legacy') + ':' + String(name || '');
}

// Cria as tabelas se ainda não existirem. Idempotente.
async function init() {
  if (!enabled) return false;
  try {
    // ── Contas / sessões de login / gateways (multi-tenant) ──────────────
    await sql`CREATE TABLE IF NOT EXISTS accounts (
      id text PRIMARY KEY,
      email text UNIQUE NOT NULL,
      password_hash text NOT NULL,
      name text,
      role text NOT NULL DEFAULT 'user',
      created_at timestamptz NOT NULL DEFAULT now()
    )`;
    await sql`CREATE TABLE IF NOT EXISTS account_sessions (
      token text PRIMARY KEY,
      account_id text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL
    )`;
    await sql`CREATE INDEX IF NOT EXISTS account_sessions_expires_idx ON account_sessions (expires_at)`;
    await sql`CREATE TABLE IF NOT EXISTS gateways (
      id text PRIMARY KEY,
      account_id text NOT NULL,
      provider text NOT NULL,
      name text,
      webhook_token text UNIQUE NOT NULL,
      secret text,
      config jsonb NOT NULL DEFAULT '{}'::jsonb,
      last_event_at timestamptz,
      last_event_status text,
      created_at timestamptz NOT NULL DEFAULT now()
    )`;
    await sql`CREATE INDEX IF NOT EXISTS gateways_account_idx ON gateways (account_id)`;

    await sql`CREATE TABLE IF NOT EXISTS leads (
      id text PRIMARY KEY,
      data jsonb NOT NULL,
      stage text,
      status text,
      gateway text,
      country text,
      country_name text,
      orphan boolean DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
    await sql`CREATE INDEX IF NOT EXISTS leads_created_idx ON leads (created_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS leads_country_idx ON leads (country)`;

    await sql`CREATE TABLE IF NOT EXISTS events (
      id text PRIMARY KEY,
      type text,
      at timestamptz NOT NULL DEFAULT now(),
      data jsonb NOT NULL
    )`;
    await sql`CREATE INDEX IF NOT EXISTS events_at_idx ON events (at DESC)`;
    // Item 448: o índice por conta+data (para o arquivamento varrer barato) é
    // criado mais abaixo como events_account_idx — DEPOIS do ALTER TABLE que
    // garante a coluna account_id. Criá-lo aqui quebrava o init em bancos
    // legados onde events ainda não tinha a coluna (erro "column account_id
    // does not exist" abortava TODAS as migrações seguintes).

    // Item 448: arquivo frio de eventos. O feed quente (tabela `events`) é
    // limitado por retenção; o que passa da janela é MOVIDO para cá em vez de
    // apagado — o histórico completo continua disponível para relatórios,
    // mas sem inchar as queries do dia a dia.
    await sql`CREATE TABLE IF NOT EXISTS events_archive (
      id text PRIMARY KEY,
      account_id text,
      type text,
      at timestamptz NOT NULL,
      data jsonb NOT NULL,
      archived_at timestamptz NOT NULL DEFAULT now()
    )`;
    await sql`CREATE INDEX IF NOT EXISTS events_archive_acc_at_idx ON events_archive (account_id, at DESC)`;

    // Itens 417/439: trilha de auditoria da conta — ações sensíveis (login,
    // criação/remoção de link, reset de stats, import de backup, acesso a
    // rotas sensíveis…) com IP mascarado. Visível na aba Config.
    await sql`CREATE TABLE IF NOT EXISTS account_audit (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      account_id text NOT NULL,
      at timestamptz NOT NULL DEFAULT now(),
      action text NOT NULL,
      detail text,
      ip_masked text
    )`;
    await sql`CREATE INDEX IF NOT EXISTS account_audit_acc_at_idx ON account_audit (account_id, at DESC)`;

    // ── Quarentena de webhooks REJEITADOS (prioridade máxima do handoff) ──
    // Antes, um webhook rejeitado na normalização tinha o corpo DESCARTADO (só
    // os nomes das chaves iam para o log) — a evidência sumia e o erro ficava
    // indiagnosticável. Aqui gravamos o PAYLOAD CRU e completo + headers de
    // TODA rejeição (segredo/assinatura inválida, amount inválido, formato
    // desconhecido) ANTES de responder o erro. Retenção: 30 dias (pruneQuarantine).
    await sql`CREATE TABLE IF NOT EXISTS conversion_quarantine (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      received_at timestamptz NOT NULL DEFAULT now(),
      account_id text,
      route text,
      raw_payload jsonb,
      headers jsonb,
      rejection_reason text,
      gateway_hint text,
      resolved boolean NOT NULL DEFAULT false,
      resolved_at timestamptz
    )`;
    await sql`CREATE INDEX IF NOT EXISTS conversion_quarantine_recv_idx ON conversion_quarantine (received_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS conversion_quarantine_acc_idx ON conversion_quarantine (account_id, received_at DESC)`;
    migrations.quarantine = true;

    // ── Dedup DURÁVEL de receita por pedido (Risco 5) ────────────────────
    // O dedup do Redis (evId) expira em ~2h; um retry do gateway depois disso
    // re-emitia a venda e DUPLICAVA a receita em todas as métricas. Aqui
    // registramos cada CompletePayment por (conta, gateway, order_id) com
    // retenção de 90 dias — um retry (mesmo dias depois) é reconhecido e a
    // receita não é recontada. account_id/gateway usam '' em vez de NULL
    // porque compõem a PRIMARY KEY (colunas de PK não aceitam NULL).
    await sql`CREATE TABLE IF NOT EXISTS processed_orders (
      account_id text NOT NULL DEFAULT '',
      gateway text NOT NULL DEFAULT '',
      order_id text NOT NULL,
      processed_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (account_id, gateway, order_id)
    )`;
    await sql`CREATE INDEX IF NOT EXISTS processed_orders_at_idx ON processed_orders (processed_at)`;
    migrations.processedOrders = true;

    await sql`CREATE TABLE IF NOT EXISTS variants (
      name text PRIMARY KEY,
      data jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;

    await sql`CREATE TABLE IF NOT EXISTS sessions (
      visitor_id text PRIMARY KEY,
      page text,
      referrer text,
      country text,
      country_name text,
      city text,
      ua text,
      ip text,
      variant text,
      first_seen timestamptz NOT NULL DEFAULT now(),
      last_seen timestamptz NOT NULL DEFAULT now(),
      pageviews integer DEFAULT 1
    )`;
    await sql`CREATE INDEX IF NOT EXISTS sessions_last_idx ON sessions (last_seen DESC)`;

    // Config da dashboard — uma linha por conta (key = account_id).
    await sql`CREATE TABLE IF NOT EXISTS config (
      key text PRIMARY KEY,
      data jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;

    // Pixels TikTok (backup durável; slug = `${accountId}:${slug}`).
    await sql`CREATE TABLE IF NOT EXISTS pixels (
      slug text PRIMARY KEY,
      data jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;

    // Links de checkout externos (/go/:slug) — config + contadores A/B.
    await sql`CREATE TABLE IF NOT EXISTS links (
      slug text PRIMARY KEY,
      data jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;

    // Log de disparos server-side (CAPI) para o painel.
    await sql`CREATE TABLE IF NOT EXISTS pixel_events (
      id text PRIMARY KEY,
      pixel text,
      event text,
      event_id text,
      lead_id text,
      status text,
      response jsonb,
      at timestamptz NOT NULL DEFAULT now()
    )`;
    await sql`CREATE INDEX IF NOT EXISTS pixel_events_at_idx ON pixel_events (at DESC)`;

    // ── Coluna account_id (multi-tenancy) em todas as tabelas de dados ────
    await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS account_id text`;
    await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS account_id text`;
    await sql`ALTER TABLE variants ADD COLUMN IF NOT EXISTS account_id text`;
    await sql`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS account_id text`;
    await sql`ALTER TABLE pixels ADD COLUMN IF NOT EXISTS account_id text`;
    await sql`ALTER TABLE links ADD COLUMN IF NOT EXISTS account_id text`;
    await sql`ALTER TABLE pixel_events ADD COLUMN IF NOT EXISTS account_id text`;
    await sql`CREATE INDEX IF NOT EXISTS leads_account_idx ON leads (account_id, created_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS events_account_idx ON events (account_id, at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS sessions_account_idx ON sessions (account_id, last_seen DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS pixels_account_idx ON pixels (account_id)`;
    await sql`CREATE INDEX IF NOT EXISTS links_account_idx ON links (account_id)`;
    await sql`CREATE INDEX IF NOT EXISTS pixel_events_account_idx ON pixel_events (account_id, at DESC)`;

    // ── Domínios personalizados DURÁVEIS (itens 241/243/244/248) ──────────
    // Antes viviam só no jsonb da config — sem tabela própria, sem índice de
    // unicidade entre contas. host é PK (item 244: um domínio identifica UMA
    // conta no /go//c/checkout); uso = 'checkout' | 'cloaker' | 'ambos'
    // (item 243). Migração idempotente (item 248): CREATE/ALTER IF NOT EXISTS,
    // rodada em todo boot via initWithRetry (item 249).
    await sql`CREATE TABLE IF NOT EXISTS custom_domains (
      host text PRIMARY KEY,
      account_id text,
      uso text NOT NULL DEFAULT 'ambos',
      verificado boolean NOT NULL DEFAULT false,
      verificado_em timestamptz,
      provider_id text,
      provider_note text,
      dns jsonb,
      criado_em timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
    await sql`CREATE INDEX IF NOT EXISTS custom_domains_account_idx ON custom_domains (account_id, host)`;
    migrations.customDomains = true;

    // ── Moeda por conta persistida na própria conta (itens 242/248) ───────
    // O item 147 (moeda por conta) guardava só na config; a coluna garante a
    // persistência mesmo se a config for recriada. Default BRL não quebra
    // contas EUR existentes: o valor efetivo vem da config e é espelhado aqui.
    await sql`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS currency text DEFAULT 'BRL'`;
    migrations.accountCurrency = true;

    // ── Item 414: metadados de dispositivo nas sessões de login ───────────
    // ua + IP mascarado gravados no login permitem listar "sessões ativas"
    // na aba Config com contexto suficiente para reconhecer cada dispositivo
    // (sem guardar o IP completo — mesma máscara da auditoria do item 417).
    await sql`ALTER TABLE account_sessions ADD COLUMN IF NOT EXISTS ua text`;
    await sql`ALTER TABLE account_sessions ADD COLUMN IF NOT EXISTS ip_masked text`;

    // ── Item 420: 2FA TOTP opcional ───────────────────────────────────────
    // Secret base32 do autenticador (Google Authenticator etc.). NULL = 2FA
    // desligado. O secret nunca sai do servidor depois de confirmado.
    await sql`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS totp_secret text`;

    ready = true;
    console.log('[db] Neon pronto (tabelas multi-tenant verificadas).');
    return true;
  } catch (err) {
    console.error('[db] Erro ao inicializar:', err.message);
    return false;
  }
}

// init com retry — uma falha transitória de rede no boot não pode deixar o
// processo rodando sem persistência (era um dos vetores de perda de config).
async function initWithRetry(attempts) {
  const max = Math.max(1, attempts || 3);
  for (let i = 1; i <= max; i++) {
    if (await init()) return true;
    if (i < max) {
      console.warn('[db] init falhou, tentando de novo (' + i + '/' + max + ')...');
      await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }
  return false;
}

// ── Contas ────────────────────────────────────────────────────────────────
async function createAccount(acc) {
  if (!enabled || !acc || !acc.id || !acc.email) return null;
  try {
    const rows = await sql`INSERT INTO accounts (id, email, password_hash, name, role)
      VALUES (${acc.id}, ${acc.email.toLowerCase()}, ${acc.passwordHash}, ${acc.name || null}, ${acc.role || 'user'})
      ON CONFLICT (email) DO NOTHING
      RETURNING id, email, name, role, created_at`;
    return rows.length ? rows[0] : null;
  } catch (err) { console.error('[db] createAccount:', err.message); return null; }
}

async function getAccountByEmail(email) {
  if (!enabled || !email) return null;
  try {
    const rows = await sql`SELECT id, email, password_hash, name, role, created_at, totp_secret
      FROM accounts WHERE email = ${email.toLowerCase()} LIMIT 1`;
    return rows.length ? rows[0] : null;
  } catch (err) { console.error('[db] getAccountByEmail:', err.message); return null; }
}

async function getAccountById(id) {
  if (!enabled || !id) return null;
  try {
    // BUG corrigido (item 411): faltava password_hash no SELECT — a troca de
    // senha usa esta função para conferir a senha atual e SEMPRE respondia
    // "Senha atual incorreta" (verifyPassword contra undefined). O único
    // consumidor é auth.changePassword; nada serializa o objeto inteiro.
    const rows = await sql`SELECT id, email, password_hash, name, role, created_at, totp_secret
      FROM accounts WHERE id = ${id} LIMIT 1`;
    return rows.length ? rows[0] : null;
  } catch (err) { console.error('[db] getAccountById:', err.message); return null; }
}

async function countAccounts() {
  if (!enabled) return -1;
  try {
    const rows = await sql`SELECT count(*)::int AS n FROM accounts`;
    return rows[0].n;
  } catch (err) { console.error('[db] countAccounts:', err.message); return -1; }
}

// Conta padrão para tráfego público sem domínio mapeado: o primeiro admin
// (ou a conta mais antiga). Usado por publicAccountId() no server.js.
async function getFirstAccountId() {
  if (!enabled) return null;
  try {
    const rows = await sql`SELECT id FROM accounts ORDER BY (role = 'admin') DESC, created_at ASC LIMIT 1`;
    return rows.length ? rows[0].id : null;
  } catch (err) { console.error('[db] getFirstAccountId:', err.message); return null; }
}

// Migração: atribui todos os dados legados (account_id IS NULL) à conta
// informada (o primeiro admin). Idempotente — roda no registro do 1º usuário.
async function claimLegacyData(accountId) {
  if (!enabled || !accountId) return false;
  try {
    await sql`UPDATE leads SET account_id = ${accountId} WHERE account_id IS NULL`;
    await sql`UPDATE events SET account_id = ${accountId} WHERE account_id IS NULL`;
    await sql`UPDATE sessions SET account_id = ${accountId} WHERE account_id IS NULL`;
    await sql`UPDATE pixel_events SET account_id = ${accountId} WHERE account_id IS NULL`;
    // Item 247: domínios legados (sem dono) vão para o primeiro admin.
    await sql`UPDATE custom_domains SET account_id = ${accountId} WHERE account_id IS NULL`;
    // Tabelas keyed-by-name: além do account_id, a PK ganha o namespace.
    await sql`UPDATE variants SET account_id = ${accountId}, name = ${accountId} || ':' || name
      WHERE account_id IS NULL AND position(':' in name) = 0`;
    await sql`UPDATE pixels SET account_id = ${accountId}, slug = ${accountId} || ':' || slug
      WHERE account_id IS NULL AND position(':' in slug) = 0`;
    await sql`UPDATE links SET account_id = ${accountId}, slug = ${accountId} || ':' || slug
      WHERE account_id IS NULL AND position(':' in slug) = 0`;
    // Config global 'main' vira a config do admin.
    await sql`UPDATE config SET key = ${accountId} WHERE key = 'main'
      AND NOT EXISTS (SELECT 1 FROM config c2 WHERE c2.key = ${accountId})`;
    console.log('[db] Dados legados atribuídos à conta ' + accountId + '.');
    return true;
  } catch (err) { console.error('[db] claimLegacyData:', err.message); return false; }
}

// ── Sessões de login ──────────────────────────────────────────────────────
// Item 414: meta opcional { ua, ipMasked } identifica o dispositivo na lista
// de sessões ativas da aba Config.
async function createAuthSession(accountId, ttlDays, meta) {
  if (!enabled || !accountId) return null;
  const token = crypto.randomBytes(32).toString('hex');
  const days = Math.max(1, ttlDays || 30);
  const ua = meta && meta.ua ? String(meta.ua).slice(0, 300) : null;
  const ipMasked = meta && meta.ipMasked ? String(meta.ipMasked).slice(0, 60) : null;
  try {
    await sql`INSERT INTO account_sessions (token, account_id, expires_at, ua, ip_masked)
      VALUES (${token}, ${accountId}, now() + make_interval(days => ${days}), ${ua}, ${ipMasked})`;
    return token;
  } catch (err) { console.error('[db] createAuthSession:', err.message); return null; }
}

// Item 414: lista as sessões ativas da conta SEM expor o token — cada sessão
// é identificada pelo md5(token) ("sid"), suficiente para encerrar uma
// específica sem que a resposta sirva para sequestrar a sessão.
async function listAuthSessions(accountId) {
  if (!enabled || !accountId) return [];
  try {
    return await sql`SELECT md5(token) AS sid, created_at, expires_at, ua, ip_masked
      FROM account_sessions
      WHERE account_id = ${accountId} AND expires_at > now()
      ORDER BY created_at DESC`;
  } catch (err) { console.error('[db] listAuthSessions:', err.message); return []; }
}

// Item 414: encerra UMA sessão pelo sid (md5 do token), escopada à conta.
// Retorna o token real apagado para o auth limpar o cache em memória.
async function deleteAuthSessionBySid(accountId, sid) {
  if (!enabled || !accountId || !sid) return null;
  try {
    const rows = await sql`DELETE FROM account_sessions
      WHERE account_id = ${accountId} AND md5(token) = ${sid} RETURNING token`;
    return rows.length ? rows[0].token : null;
  } catch (err) { console.error('[db] deleteAuthSessionBySid:', err.message); return null; }
}

async function getAuthSession(token) {
  if (!enabled || !token) return null;
  try {
    const rows = await sql`SELECT s.token, s.account_id, s.expires_at, a.email, a.name, a.role
      FROM account_sessions s JOIN accounts a ON a.id = s.account_id
      WHERE s.token = ${token} AND s.expires_at > now() LIMIT 1`;
    return rows.length ? rows[0] : null;
  } catch (err) { console.error('[db] getAuthSession:', err.message); return null; }
}

async function deleteAuthSession(token) {
  if (!enabled || !token) return;
  try { await sql`DELETE FROM account_sessions WHERE token = ${token}`; }
  catch (err) { console.error('[db] deleteAuthSession:', err.message); }
}

// Item 482: renovação deslizante — estende o prazo da sessão para +ttlDays a
// partir de agora. O auth só chama quando restam menos da metade do TTL,
// então usuário ativo nunca é deslogado e o UPDATE é raro (não por request).
async function touchAuthSession(token, ttlDays) {
  if (!enabled || !token) return;
  const days = Math.max(1, ttlDays || 30);
  try {
    await sql`UPDATE account_sessions
      SET expires_at = now() + make_interval(days => ${days})
      WHERE token = ${token} AND expires_at > now()`;
  } catch (err) { console.error('[db] touchAuthSession:', err.message); }
}

// Item 411: troca de senha.
async function updateAccountPassword(accountId, passwordHash) {
  if (!enabled || !accountId) return false;
  try {
    const rows = await sql`UPDATE accounts SET password_hash = ${passwordHash} WHERE id = ${accountId} RETURNING id`;
    return rows.length > 0;
  } catch (err) { console.error('[db] updateAccountPassword:', err.message); return false; }
}

// Item 413: edição do nome da conta (exibido no cabeçalho da dashboard).
async function updateAccountName(accountId, name) {
  if (!enabled || !accountId) return false;
  try {
    const rows = await sql`UPDATE accounts SET name = ${name} WHERE id = ${accountId} RETURNING id`;
    return rows.length > 0;
  } catch (err) { console.error('[db] updateAccountName:', err.message); return false; }
}

// Item 420: liga/desliga o 2FA — secret base32 ou NULL para desativar.
async function setAccountTotp(accountId, secret) {
  if (!enabled || !accountId) return false;
  try {
    const rows = await sql`UPDATE accounts SET totp_secret = ${secret || null} WHERE id = ${accountId} RETURNING id`;
    return rows.length > 0;
  } catch (err) { console.error('[db] setAccountTotp:', err.message); return false; }
}

// Item 324/425 (LGPD): anonimiza leads mais antigos que N dias — remove
// e-mail, telefone e nome do jsonb, mantendo os agregados (país, valor,
// estágio) intactos para não quebrar relatórios. Retorna quantos anonimizou.
async function anonymizeOldLeads(accountId, days, limit) {
  if (!enabled || !accountId || !days) return 0;
  const lim = Math.max(1, Math.min(limit || 500, 2000));
  try {
    const rows = await sql`UPDATE leads
      SET data = (data - 'email' - 'phone' - 'customer') || '{"anonymized":true}'::jsonb,
          updated_at = now()
      WHERE account_id = ${accountId}
        AND created_at < now() - make_interval(days => ${Math.round(days)})
        AND NOT (data ? 'anonymized')
        AND (data ? 'email' OR data ? 'phone' OR data ? 'customer')
        AND id IN (SELECT id FROM leads WHERE account_id = ${accountId}
                   AND created_at < now() - make_interval(days => ${Math.round(days)})
                   AND NOT (data ? 'anonymized') LIMIT ${lim})
      RETURNING id`;
    return rows.length;
  } catch (err) { console.error('[db] anonymizeOldLeads:', err.message); return 0; }
}

// Item 428: pré-visualização da zona de perigo — o que existe hoje na conta.
async function accountDataCounts(accountId) {
  if (!enabled || !accountId) return null;
  try {
    const [r] = await sql`SELECT
      (SELECT count(*) FROM leads WHERE account_id = ${accountId}) AS leads,
      (SELECT count(*) FROM events WHERE account_id = ${accountId}) AS events,
      (SELECT count(*) FROM events_archive WHERE account_id = ${accountId}) AS events_arquivados,
      (SELECT count(*) FROM links WHERE account_id = ${accountId}) AS links,
      (SELECT count(*) FROM pixels WHERE account_id = ${accountId}) AS pixels,
      (SELECT count(*) FROM gateways WHERE account_id = ${accountId}) AS gateways,
      (SELECT count(*) FROM custom_domains WHERE account_id = ${accountId}) AS dominios,
      (SELECT count(*) FROM account_sessions WHERE account_id = ${accountId} AND expires_at > now()) AS sessoes,
      (SELECT count(*) FROM account_audit WHERE account_id = ${accountId}) AS auditoria`;
    return r || null;
  } catch (err) { console.error('[db] accountDataCounts:', err.message); return null; }
}

// Item 427: exclusão da conta com cascata TOTAL — apaga tudo que pertence à
// conta em todas as tabelas. Irreversível por design; a rota exige senha.
async function deleteAccountCascade(accountId) {
  if (!enabled || !accountId) return false;
  try {
    await sql`DELETE FROM account_sessions WHERE account_id = ${accountId}`;
    await sql`DELETE FROM account_audit   WHERE account_id = ${accountId}`;
    await sql`DELETE FROM leads           WHERE account_id = ${accountId}`;
    await sql`DELETE FROM events          WHERE account_id = ${accountId}`;
    await sql`DELETE FROM events_archive  WHERE account_id = ${accountId}`;
    await sql`DELETE FROM sessions        WHERE account_id = ${accountId}`;
    await sql`DELETE FROM variants        WHERE account_id = ${accountId}`;
    await sql`DELETE FROM pixel_events    WHERE account_id = ${accountId}`;
    await sql`DELETE FROM pixels          WHERE account_id = ${accountId} OR slug LIKE ${accountId + ':%'}`;
    await sql`DELETE FROM links           WHERE account_id = ${accountId} OR slug LIKE ${accountId + ':%'}`;
    await sql`DELETE FROM gateways        WHERE account_id = ${accountId}`;
    await sql`DELETE FROM custom_domains  WHERE account_id = ${accountId}`;
    await sql`DELETE FROM conversion_quarantine WHERE account_id = ${accountId}`;
    await sql`DELETE FROM config          WHERE key = ${accountId}`;
    await sql`DELETE FROM accounts        WHERE id = ${accountId}`;
    return true;
  } catch (err) { console.error('[db] deleteAccountCascade:', err.message); return false; }
}

// Item 415: derruba todas as sessões da conta exceto a atual (logout global).
async function deleteOtherAuthSessions(accountId, keepToken) {
  if (!enabled || !accountId) return 0;
  try {
    const rows = await sql`DELETE FROM account_sessions
      WHERE account_id = ${accountId} AND token <> ${keepToken || ''} RETURNING token`;
    return rows.length;
  } catch (err) { console.error('[db] deleteOtherAuthSessions:', err.message); return 0; }
}

async function pruneAuthSessions() {
  if (!enabled) return 0;
  try {
    const rows = await sql`DELETE FROM account_sessions WHERE expires_at < now() RETURNING token`;
    return rows.length;
  } catch (err) { console.error('[db] pruneAuthSessions:', err.message); return 0; }
}

// ── Gateways (1 webhook por gateway) ───────────────────────────────���──────
async function upsertGateway(g) {
  if (!enabled || !g || !g.id || !g.accountId) return null;
  try {
    const rows = await sql`INSERT INTO gateways (id, account_id, provider, name, webhook_token, secret, config)
      VALUES (${g.id}, ${g.accountId}, ${g.provider}, ${g.name || null}, ${g.webhookToken},
              ${g.secret || null}, ${JSON.stringify(g.config || {})}::jsonb)
      ON CONFLICT (id) DO UPDATE SET
        provider = EXCLUDED.provider, name = EXCLUDED.name,
        secret = EXCLUDED.secret, config = EXCLUDED.config
      RETURNING *`;
    return rows.length ? rows[0] : null;
  } catch (err) { console.error('[db] upsertGateway:', err.message); return null; }
}

async function deleteGateway(accountId, id) {
  if (!enabled || !id) return;
  try { await sql`DELETE FROM gateways WHERE id = ${id} AND account_id = ${accountId}`; }
  catch (err) { console.error('[db] deleteGateway:', err.message); }
}

async function loadGateways(accountId) {
  if (!enabled) return { ok: false, data: null };
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const rows = accountId
        ? await sql`SELECT * FROM gateways WHERE account_id = ${accountId} ORDER BY created_at DESC`
        : await sql`SELECT * FROM gateways ORDER BY created_at DESC`;
      return { ok: true, data: rows };
    } catch (err) {
      console.error('[db] loadGateways (tentativa ' + attempt + '/3):', err.message);
      if (attempt < 3) await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
  return { ok: false, data: null };
}

async function getGatewayByToken(token) {
  if (!enabled || !token) return null;
  try {
    const rows = await sql`SELECT * FROM gateways WHERE webhook_token = ${token} LIMIT 1`;
    return rows.length ? rows[0] : null;
  } catch (err) { console.error('[db] getGatewayByToken:', err.message); return null; }
}

async function touchGateway(id, status) {
  if (!enabled || !id) return;
  try {
    await sql`UPDATE gateways SET last_event_at = now(), last_event_status = ${status || null} WHERE id = ${id}`;
  } catch (err) { console.error('[db] touchGateway:', err.message); }
}

// ── Leads / eventos / variantes (write-through, por conta) ────────────────
async function upsertLead(accountId, lead) {
  if (!enabled || !lead || !lead.id) return;
  try {
    await sql`INSERT INTO leads (id, account_id, data, stage, status, gateway, country, country_name, orphan, created_at, updated_at)
      VALUES (${lead.id}, ${accountId || null}, ${JSON.stringify(lead)}::jsonb, ${lead.stage || null}, ${lead.status || null},
              ${lead.gateway || null}, ${lead.country || null}, ${lead.countryName || null},
              ${!!lead.orphan}, ${lead.at || new Date().toISOString()}, now())
      ON CONFLICT (id) DO UPDATE SET
        data = EXCLUDED.data, stage = EXCLUDED.stage, status = EXCLUDED.status,
        gateway = EXCLUDED.gateway, country = EXCLUDED.country, country_name = EXCLUDED.country_name,
        orphan = EXCLUDED.orphan, account_id = COALESCE(leads.account_id, EXCLUDED.account_id), updated_at = now()`;
  } catch (err) { console.error('[db] upsertLead:', err.message); }
}

// Risco 7: fallback de MATCH no banco. O cache em memória guarda só os últimos
// MAX_LEADS; um comprador antigo podado do cache viraria órfã mesmo existindo
// no Neon. Busca por contato (e-mail e, se preciso, telefone), escopada por
// conta (IS NOT DISTINCT FROM = fronteira estrita: null casa só com null,
// coerente com o Risco 2). Retorna os `data` (JSON) dos até 5 leads mais
// recentes para o chamador re-hidratar no cache e casar.
async function findLeadsByContact(accountId, opts) {
  if (!enabled) return [];
  const { email, phone } = opts || {};
  try {
    const out = [];
    const em = email ? String(email).trim().toLowerCase() : '';
    if (em) {
      const rows = await sql`SELECT data FROM leads
        WHERE account_id IS NOT DISTINCT FROM ${accountId || null}
          AND lower(data->>'email') = ${em}
        ORDER BY created_at DESC LIMIT 5`;
      rows.forEach((r) => { if (r && r.data) out.push(r.data); });
    }
    // telefone: compara os ÚLTIMOS 9 dígitos (mesma regra do normPhoneKey),
    // ignorando DDI/formatação. Só se o e-mail não trouxe nada.
    const tail = phone ? String(phone).replace(/\D/g, '').replace(/^00/, '').slice(-9) : '';
    if (!out.length && tail.length >= 8) {
      const rows = await sql`SELECT data FROM leads
        WHERE account_id IS NOT DISTINCT FROM ${accountId || null}
          AND right(regexp_replace(data->>'phone', '[^0-9]', '', 'g'), 9) = ${tail}
        ORDER BY created_at DESC LIMIT 5`;
      rows.forEach((r) => { if (r && r.data) out.push(r.data); });
    }
    return out;
  } catch (err) { console.error('[db] findLeadsByContact:', err.message); return []; }
}

async function insertEvent(accountId, evt) {
  if (!enabled || !evt || !evt.id) return;
  try {
    await sql`INSERT INTO events (id, account_id, type, at, data)
      VALUES (${evt.id}, ${accountId || null}, ${evt.type || 'info'}, ${evt.at || new Date().toISOString()}, ${JSON.stringify(evt)}::jsonb)
      ON CONFLICT (id) DO NOTHING`;
  } catch (err) { console.error('[db] insertEvent:', err.message); }
}

// Item 448: move eventos além da janela de retenção (dias) para o arquivo
// frio, em lotes. Idempotente e barato: roda "pegando carona no tráfego".
// Retorna quantos eventos foram arquivados nesta passada.
async function archiveOldEvents(retentionDays, batch) {
  if (!enabled) return 0;
  const days = Math.max(7, Math.min(3650, Math.round(Number(retentionDays) || 90)));
  const limit = Math.max(100, Math.min(5000, Math.round(Number(batch) || 2000)));
  try {
    // CTE: seleciona os IDs antigos, insere no arquivo e remove da quente —
    // tudo numa query só (atômico por statement no Postgres).
    const rows = await sql`
      WITH old AS (
        SELECT id, account_id, type, at, data FROM events
        WHERE at < now() - (${days} || ' days')::interval
        ORDER BY at ASC
        LIMIT ${limit}
      ), moved AS (
        INSERT INTO events_archive (id, account_id, type, at, data)
        SELECT id, account_id, type, at, data FROM old
        ON CONFLICT (id) DO NOTHING
        RETURNING id
      )
      DELETE FROM events WHERE id IN (SELECT id FROM old)
      RETURNING id`;
    return Array.isArray(rows) ? rows.length : 0;
  } catch (err) {
    console.error('[db] archiveOldEvents:', err.message);
    return 0;
  }
}

// Itens 417/439: grava uma entrada na trilha de auditoria. Fire-and-forget —
// auditoria nunca pode quebrar a ação que está auditando.
async function insertAudit(accountId, action, detail, ipMasked) {
  if (!enabled || !accountId || !action) return;
  try {
    await sql`INSERT INTO account_audit (account_id, action, detail, ip_masked)
      VALUES (${accountId}, ${action}, ${detail || null}, ${ipMasked || null})`;
  } catch (err) { console.error('[db] insertAudit:', err.message); }
}

async function listAudit(accountId, limit) {
  if (!enabled || !accountId) return [];
  const n = Math.max(1, Math.min(200, Number(limit) || 50));
  try {
    return await sql`SELECT id, at, action, detail, ip_masked
      FROM account_audit WHERE account_id = ${accountId}
      ORDER BY at DESC LIMIT ${n}`;
  } catch (err) { console.error('[db] listAudit:', err.message); return []; }
}

// ── Quarentena de webhooks rejeitados ──────────────────────────────────────
// Grava o payload cru + headers de uma rejeição. Fire-and-forget do ponto de
// vista do webhook: NUNCA pode quebrar a resposta ao gateway (o chamador dá
// catch). accountId pode ser null (rota legada /api/conversion sem token).
async function insertQuarantine(entry) {
  if (!enabled || !entry) return null;
  try {
    const rows = await sql`INSERT INTO conversion_quarantine
      (account_id, route, raw_payload, headers, rejection_reason, gateway_hint)
      VALUES (
        ${entry.accountId || null},
        ${String(entry.route || '').slice(0, 120) || null},
        ${JSON.stringify(entry.rawPayload ?? null)}::jsonb,
        ${JSON.stringify(entry.headers ?? null)}::jsonb,
        ${String(entry.rejectionReason || '').slice(0, 300) || null},
        ${String(entry.gatewayHint || '').slice(0, 60) || null}
      )
      RETURNING id`;
    return rows.length ? rows[0].id : null;
  } catch (err) { console.error('[db] insertQuarantine:', err.message); return null; }
}

// Lista a quarentena da conta (admin também vê os itens legados sem account_id,
// mesma fronteira do log de conversões). includeResolved=false esconde os já
// tratados. Limite defensivo de 200.
async function listQuarantine(accountId, isAdmin, opts) {
  if (!enabled) return [];
  const o = opts || {};
  const n = Math.max(1, Math.min(200, Number(o.limit) || 100));
  const includeResolved = !!o.includeResolved;
  try {
    if (isAdmin) {
      return await sql`SELECT id, received_at, account_id, route, raw_payload, headers,
          rejection_reason, gateway_hint, resolved, resolved_at
        FROM conversion_quarantine
        WHERE (account_id = ${accountId} OR account_id IS NULL)
          AND (${includeResolved} OR resolved = false)
        ORDER BY received_at DESC LIMIT ${n}`;
    }
    return await sql`SELECT id, received_at, account_id, route, raw_payload, headers,
        rejection_reason, gateway_hint, resolved, resolved_at
      FROM conversion_quarantine
      WHERE account_id = ${accountId}
        AND (${includeResolved} OR resolved = false)
      ORDER BY received_at DESC LIMIT ${n}`;
  } catch (err) { console.error('[db] listQuarantine:', err.message); return []; }
}

// Conta os itens NÃO resolvidos (badge do painel). Mesma fronteira do list.
async function countQuarantine(accountId, isAdmin) {
  if (!enabled) return 0;
  try {
    const rows = isAdmin
      ? await sql`SELECT count(*)::int AS n FROM conversion_quarantine
          WHERE (account_id = ${accountId} OR account_id IS NULL) AND resolved = false`
      : await sql`SELECT count(*)::int AS n FROM conversion_quarantine
          WHERE account_id = ${accountId} AND resolved = false`;
    return rows.length ? rows[0].n : 0;
  } catch (err) { console.error('[db] countQuarantine:', err.message); return 0; }
}

// Marca um item como resolvido (escopado à conta; admin cobre os legados).
async function resolveQuarantine(accountId, isAdmin, id) {
  if (!enabled || !id) return false;
  try {
    const rows = isAdmin
      ? await sql`UPDATE conversion_quarantine SET resolved = true, resolved_at = now()
          WHERE id = ${id} AND (account_id = ${accountId} OR account_id IS NULL) RETURNING id`
      : await sql`UPDATE conversion_quarantine SET resolved = true, resolved_at = now()
          WHERE id = ${id} AND account_id = ${accountId} RETURNING id`;
    return rows.length > 0;
  } catch (err) { console.error('[db] resolveQuarantine:', err.message); return false; }
}

// Risco 5: dedup DURÁVEL de receita. Retorna true se o pedido é NOVO (registra
// e segue o fluxo), false se já foi processado antes (retry do gateway — a
// receita NÃO deve ser recontada). Atômico via INSERT ... ON CONFLICT DO
// NOTHING, imune a corrida entre dois retries simultâneos. Fail-open: com o
// banco desativado ou em erro, devolve true para não BLOQUEAR vendas legítimas
// (o dedup de curto prazo do Redis ainda cobre a janela de retries imediatos).
async function markOrderProcessed(accountId, gateway, orderId) {
  if (!enabled) return true;
  if (!orderId) return true; // sem order_id não há chave estável p/ deduplicar
  try {
    const rows = await sql`INSERT INTO processed_orders (account_id, gateway, order_id)
      VALUES (${accountId || ''}, ${String(gateway || '').slice(0, 30)}, ${String(orderId).slice(0, 200)})
      ON CONFLICT (account_id, gateway, order_id) DO NOTHING
      RETURNING order_id`;
    return rows.length > 0;
  } catch (err) { console.error('[db] markOrderProcessed:', err.message); return true; }
}

// Retenção do dedup durável: apaga pedidos com mais de 90 dias. Boot + diária.
async function pruneProcessedOrders() {
  if (!enabled) return 0;
  try {
    const rows = await sql`DELETE FROM processed_orders
      WHERE processed_at < now() - interval '90 days' RETURNING order_id`;
    return rows.length;
  } catch (err) { console.error('[db] pruneProcessedOrders:', err.message); return 0; }
}

// Retenção: apaga o que passou de 30 dias. Roda no boot + diariamente.
async function pruneQuarantine() {
  if (!enabled) return 0;
  try {
    const rows = await sql`DELETE FROM conversion_quarantine
      WHERE received_at < now() - interval '30 days' RETURNING id`;
    return rows.length;
  } catch (err) { console.error('[db] pruneQuarantine:', err.message); return 0; }
}

async function upsertVariant(accountId, name, data) {
  if (!enabled || !name) return;
  try {
    await sql`INSERT INTO variants (name, account_id, data, updated_at)
      VALUES (${nsKey(accountId, name)}, ${accountId || null}, ${JSON.stringify(data)}::jsonb, now())
      ON CONFLICT (name) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`;
  } catch (err) { console.error('[db] upsertVariant:', err.message); }
}

// Carrega o estado persistido de UMA conta para hidratar o cache no boot.
async function loadState(accountId, limitLeads, limitEvents) {
  if (!enabled) return null;
  try {
    const [leadRows, eventRows, variantRows] = await Promise.all([
      accountId
        ? sql`SELECT data FROM leads WHERE account_id = ${accountId} ORDER BY created_at DESC LIMIT ${limitLeads || 8000}`
        : sql`SELECT data FROM leads ORDER BY created_at DESC LIMIT ${limitLeads || 8000}`,
      accountId
        ? sql`SELECT data FROM events WHERE account_id = ${accountId} ORDER BY at DESC LIMIT ${limitEvents || 4000}`
        : sql`SELECT data FROM events ORDER BY at DESC LIMIT ${limitEvents || 4000}`,
      accountId
        ? sql`SELECT name, data FROM variants WHERE account_id = ${accountId}`
        : sql`SELECT name, data FROM variants`
    ]);
    const variants = {};
    variantRows.forEach((r) => {
      const clean = r.name.includes(':') ? r.name.slice(r.name.indexOf(':') + 1) : r.name;
      variants[clean] = r.data;
    });
    return {
      leads: leadRows.map((r) => r.data),
      events: eventRows.map((r) => r.data),
      variants
    };
  } catch (err) {
    console.error('[db] loadState:', err.message);
    return null;
  }
}

async function reset(accountId) {
  if (!enabled) return;
  try {
    if (accountId) {
      await sql`DELETE FROM leads WHERE account_id = ${accountId}`;
      await sql`DELETE FROM events WHERE account_id = ${accountId}`;
      await sql`DELETE FROM variants WHERE account_id = ${accountId}`;
      await sql`DELETE FROM sessions WHERE account_id = ${accountId}`;
    } else {
      await sql`TRUNCATE leads, events, variants, sessions`;
    }
  } catch (err) { console.error('[db] reset:', err.message); }
}

// ── Sessões ao vivo (heartbeat, por conta) ──���─────────────────────────────
async function upsertSession(accountId, s) {
  if (!enabled || !s || !s.visitorId) return;
  try {
    await sql`INSERT INTO sessions (visitor_id, account_id, page, referrer, country, country_name, city, ua, ip, variant, first_seen, last_seen, pageviews)
      VALUES (${s.visitorId}, ${accountId || null}, ${s.page || null}, ${s.referrer || null}, ${s.country || null},
              ${s.countryName || null}, ${s.city || null}, ${s.ua || null}, ${s.ip || null},
              ${s.variant || null}, now(), now(), 1)
      ON CONFLICT (visitor_id) DO UPDATE SET
        page = EXCLUDED.page, referrer = COALESCE(sessions.referrer, EXCLUDED.referrer),
        country = COALESCE(EXCLUDED.country, sessions.country),
        country_name = COALESCE(EXCLUDED.country_name, sessions.country_name),
        city = COALESCE(EXCLUDED.city, sessions.city),
        ua = COALESCE(sessions.ua, EXCLUDED.ua),
        ip = COALESCE(sessions.ip, EXCLUDED.ip),
        variant = COALESCE(EXCLUDED.variant, sessions.variant),
        account_id = COALESCE(sessions.account_id, EXCLUDED.account_id),
        last_seen = now(),
        pageviews = sessions.pageviews + 1`;
  } catch (err) { console.error('[db] upsertSession:', err.message); }
}

// ── Config durável (por conta) ────────────────────────────────────────────
async function saveConfig(accountId, data) {
  if (!enabled || !data) return;
  const key = accountId || 'main';
  try {
    await sql`INSERT INTO config (key, data, updated_at)
      VALUES (${key}, ${JSON.stringify(data)}::jsonb, now())
      ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`;
  } catch (err) { console.error('[db] saveConfig:', err.message); }
}

// Retorna { ok, data }: ok=false significa ERRO de leitura (não sobrescrever
// nada!); ok=true com data=null significa "confirmado: não há config salva".
async function loadConfig(accountId) {
  if (!enabled) return { ok: false, data: null };
  const key = accountId || 'main';
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const rows = await sql`SELECT data FROM config WHERE key = ${key} LIMIT 1`;
      return { ok: true, data: rows.length ? rows[0].data : null };
    } catch (err) {
      console.error('[db] loadConfig (tentativa ' + attempt + '/3):', err.message);
      if (attempt < 3) await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
  return { ok: false, data: null };
}

// Lê as configs de TODAS as contas (para resolver domínio → conta).
async function loadAllConfigs() {
  if (!enabled) return { ok: false, data: null };
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const rows = await sql`SELECT key, data FROM config`;
      return { ok: true, data: rows };
    } catch (err) {
      console.error('[db] loadAllConfigs (tentativa ' + attempt + '/3):', err.message);
      if (attempt < 3) await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
  return { ok: false, data: null };
}

// ── Domínios personalizados duráveis (itens 241–252) ──────────────────────
// Fonte durável dos customDomains da config: o cache quente continua no
// config.js (jsonb por conta) e o write-through assíncrono espelha aqui
// (item 252). No boot, config.hydrate() reconcilia a partir desta tabela.
async function upsertCustomDomain(accountId, d) {
  if (!enabled || !d || !d.host) return false;
  try {
    await sql`INSERT INTO custom_domains (host, account_id, uso, verificado, verificado_em, provider_id, provider_note, dns, criado_em, updated_at)
      VALUES (${d.host}, ${accountId || null}, ${d.uso || 'ambos'}, ${d.verificado === true},
              ${d.verificadoEm || null}, ${d.providerId || null}, ${d.providerNote || null},
              ${d.dns ? JSON.stringify(d.dns) : null}::jsonb,
              ${d.criadoEm || new Date().toISOString()}, now())
      ON CONFLICT (host) DO UPDATE SET
        account_id = COALESCE(custom_domains.account_id, EXCLUDED.account_id),
        uso = EXCLUDED.uso,
        verificado = EXCLUDED.verificado,
        verificado_em = EXCLUDED.verificado_em,
        provider_id = COALESCE(EXCLUDED.provider_id, custom_domains.provider_id),
        provider_note = EXCLUDED.provider_note,
        dns = COALESCE(EXCLUDED.dns, custom_domains.dns),
        updated_at = now()`;
    return true;
  } catch (err) { console.error('[db] upsertCustomDomain:', err.message); return false; }
}

async function deleteCustomDomain(accountId, host) {
  if (!enabled || !host) return false;
  try {
    // Só o dono (ou linha legada sem dono) pode remover — isolamento por conta.
    if (accountId) {
      await sql`DELETE FROM custom_domains WHERE host = ${host} AND (account_id = ${accountId} OR account_id IS NULL)`;
    } else {
      await sql`DELETE FROM custom_domains WHERE host = ${host} AND account_id IS NULL`;
    }
    return true;
  } catch (err) { console.error('[db] deleteCustomDomain:', err.message); return false; }
}

// Mesmo contrato do loadConfig: { ok, data } — erro de leitura NUNCA deve
// ser tratado como "não há domínios salvos". accountId=null lê todas as contas.
async function loadCustomDomains(accountId) {
  if (!enabled) return { ok: false, data: null };
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const rows = accountId
        ? await sql`SELECT * FROM custom_domains WHERE account_id = ${accountId} ORDER BY criado_em ASC`
        : await sql`SELECT * FROM custom_domains ORDER BY criado_em ASC`;
      return {
        ok: true,
        data: rows.map((r) => ({
          host: r.host,
          accountId: r.account_id,
          uso: r.uso || 'ambos',
          verificado: r.verificado === true,
          verificadoEm: r.verificado_em ? new Date(r.verificado_em).toISOString() : null,
          providerId: r.provider_id || null,
          providerNote: r.provider_note || null,
          dns: r.dns || null,
          criadoEm: r.criado_em ? new Date(r.criado_em).toISOString() : null
        }))
      };
    } catch (err) {
      console.error('[db] loadCustomDomains (tentativa ' + attempt + '/3):', err.message);
      if (attempt < 3) await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
  return { ok: false, data: null };
}

// ── Moeda por conta (item 242) ───────────────────��────────────────────────
async function setAccountCurrency(id, currency) {
  if (!enabled || !id) return false;
  const cur = String(currency || '').toUpperCase();
  if (!/^[A-Z]{3}$/.test(cur)) return false;
  try {
    await sql`UPDATE accounts SET currency = ${cur} WHERE id = ${id}`;
    return true;
  } catch (err) { console.error('[db] setAccountCurrency:', err.message); return false; }
}

// Lê as moedas de TODAS as contas (hidratação no boot). Contrato { ok, data }.
async function loadAccountCurrencies() {
  if (!enabled) return { ok: false, data: null };
  try {
    const rows = await sql`SELECT id, currency FROM accounts WHERE currency IS NOT NULL`;
    return { ok: true, data: rows };
  } catch (err) { console.error('[db] loadAccountCurrencies:', err.message); return { ok: false, data: null }; }
}

// ── Pixels TikTok (por conta; PK namespaced) ──────────────────────────────
// Retorna TRUE só quando a escrita foi confirmada pelo Postgres. Antes engolia
// o erro e retornava void, então quem chamava (pixel-store.save) achava que o
// pixel tinha sido salvo mesmo quando o banco falhava — a config "sumia" no
// próximo restart. Agora o estado propaga para o chamador decidir o fallback.
async function upsertPixel(accountId, slug, data) {
  if (!enabled || !slug) return false;
  try {
    await sql`INSERT INTO pixels (slug, account_id, data, updated_at)
      VALUES (${nsKey(accountId, slug)}, ${accountId || null}, ${JSON.stringify(data)}::jsonb, now())
      ON CONFLICT (slug) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`;
    return true;
  } catch (err) { console.error('[db] upsertPixel:', err.message); return false; }
}

async function deletePixel(accountId, slug) {
  if (!enabled || !slug) return false;
  try {
    await sql`DELETE FROM pixels WHERE slug = ${nsKey(accountId, slug)}`;
    return true;
  } catch (err) { console.error('[db] deletePixel:', err.message); return false; }
}

// Mesmo contrato do loadConfig: { ok, data } — erro de leitura NUNCA deve
// ser tratado como "não há pixels salvos".
async function loadPixels(accountId) {
  if (!enabled) return { ok: false, data: null };
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const rows = accountId
        ? await sql`SELECT slug, data FROM pixels WHERE account_id = ${accountId}`
        : await sql`SELECT slug, data FROM pixels`;
      return {
        ok: true,
        data: rows.map((r) => {
          const clean = r.slug.includes(':') ? r.slug.slice(r.slug.indexOf(':') + 1) : r.slug;
          return { slug: clean, ...r.data };
        })
      };
    } catch (err) {
      console.error('[db] loadPixels (tentativa ' + attempt + '/3):', err.message);
      if (attempt < 3) await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
  return { ok: false, data: null };
}

// Busca um pixel pelo token público (para /px/:token.js) — qualquer conta.
async function getPixelByToken(token) {
  if (!enabled || !token) return null;
  try {
    const rows = await sql`SELECT slug, account_id, data FROM pixels
      WHERE data->>'token' = ${token} LIMIT 1`;
    if (!rows.length) return null;
    const r = rows[0];
    const clean = r.slug.includes(':') ? r.slug.slice(r.slug.indexOf(':') + 1) : r.slug;
    return { slug: clean, accountId: r.account_id, ...r.data };
  } catch (err) { console.error('[db] getPixelByToken:', err.message); return null; }
}

// ── Links de checkout externos (por conta; PK namespaced) ─────────────────
async function upsertLink(accountId, slug, data) {
  if (!enabled || !slug) return;
  try {
    await sql`INSERT INTO links (slug, account_id, data, updated_at)
      VALUES (${nsKey(accountId, slug)}, ${accountId || null}, ${JSON.stringify(data)}::jsonb, now())
      ON CONFLICT (slug) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`;
  } catch (err) { console.error('[db] upsertLink:', err.message); }
}

async function deleteLink(accountId, slug) {
  if (!enabled || !slug) return;
  try {
    await sql`DELETE FROM links WHERE slug = ${nsKey(accountId, slug)}`;
  } catch (err) { console.error('[db] deleteLink:', err.message); }
}

// Mesmo contrato do loadConfig: { ok, data }.
async function loadLinks(accountId) {
  if (!enabled) return { ok: false, data: null };
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const rows = accountId
        ? await sql`SELECT slug, account_id, data FROM links WHERE account_id = ${accountId}`
        : await sql`SELECT slug, account_id, data FROM links`;
      return {
        ok: true,
        data: rows.map((r) => {
          const clean = r.slug.includes(':') ? r.slug.slice(r.slug.indexOf(':') + 1) : r.slug;
          return { slug: clean, accountId: r.account_id, ...r.data };
        })
      };
    } catch (err) {
      console.error('[db] loadLinks (tentativa ' + attempt + '/3):', err.message);
      if (attempt < 3) await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
  return { ok: false, data: null };
}

// ── Log de disparos CAPI (por conta) ──────────────────────────────────────
async function insertPixelEvent(accountId, evt) {
  if (!enabled || !evt || !evt.id) return;
  try {
    await sql`INSERT INTO pixel_events (id, account_id, pixel, event, event_id, lead_id, status, response, at)
      VALUES (${evt.id}, ${accountId || null}, ${evt.pixel || null}, ${evt.event || null}, ${evt.eventId || null},
              ${evt.leadId || null}, ${evt.status || null},
              ${JSON.stringify(evt.response || {})}::jsonb, ${evt.at || new Date().toISOString()})
      ON CONFLICT (id) DO NOTHING`;
  } catch (err) { console.error('[db] insertPixelEvent:', err.message); }
}

async function loadPixelEvents(accountId, limit) {
  if (!enabled) return null;
  try {
    const rows = accountId
      ? await sql`SELECT id, pixel, event, event_id, lead_id, status, response, at
          FROM pixel_events WHERE account_id = ${accountId} ORDER BY at DESC LIMIT ${limit || 200}`
      : await sql`SELECT id, pixel, event, event_id, lead_id, status, response, at
          FROM pixel_events ORDER BY at DESC LIMIT ${limit || 200}`;
    return rows;
  } catch (err) {
    console.error('[db] loadPixelEvents:', err.message);
    return null;
  }
}

// Mantém o log de disparos enxuto (padrão: 14 dias).
async function prunePixelEvents(olderThanDays) {
  if (!enabled) return 0;
  const days = Math.max(1, Number(olderThanDays) || 14);
  try {
    const rows = await sql`DELETE FROM pixel_events
      WHERE at < now() - make_interval(days => ${days})
      RETURNING id`;
    return rows.length;
  } catch (err) {
    console.error('[db] prunePixelEvents:', err.message);
    return 0;
  }
}

// ── Diagnóstico: ping real no banco (para o /api/health) ─────────────────
async function ping() {
  if (!enabled) return { ok: false, reason: 'sem DATABASE_URL' };
  try {
    const t0 = Date.now();
    await sql`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - t0 };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

// ── Manutenção: apaga sessões antigas (evita crescimento sem limite) ─────
async function pruneSessions(olderThanDays) {
  if (!enabled) return 0;
  const days = Math.max(1, Number(olderThanDays) || 30);
  try {
    const rows = await sql`DELETE FROM sessions
      WHERE last_seen < now() - make_interval(days => ${days})
      RETURNING visitor_id`;
    if (rows.length) console.log('[db] pruneSessions: ' + rows.length + ' sessões antigas removidas.');
    return rows.length;
  } catch (err) {
    console.error('[db] pruneSessions:', err.message);
    return 0;
  }
}

module.exports = {
  enabled,
  isReady: () => ready,
  init, initWithRetry,
  // contas / auth / migração
  createAccount, getAccountByEmail, getAccountById, countAccounts, getFirstAccountId, claimLegacyData,
  createAuthSession, getAuthSession, deleteAuthSession, pruneAuthSessions,
  listAuthSessions, deleteAuthSessionBySid, updateAccountName, setAccountTotp,
  anonymizeOldLeads, accountDataCounts, deleteAccountCascade,
  // gateways
  upsertGateway, deleteGateway, loadGateways, getGatewayByToken, touchGateway,
  // dados por conta
  upsertLead, findLeadsByContact, insertEvent, archiveOldEvents, insertAudit, listAudit, touchAuthSession, updateAccountPassword, deleteOtherAuthSessions, upsertVariant, loadState, reset, upsertSession,
  // quarentena de webhooks rejeitados
  insertQuarantine, listQuarantine, countQuarantine, resolveQuarantine, pruneQuarantine,
  // dedup durável de receita por pedido (Risco 5)
  markOrderProcessed, pruneProcessedOrders,
  saveConfig, loadConfig, loadAllConfigs, ping, pruneSessions,
  upsertPixel, deletePixel, loadPixels, getPixelByToken,
  upsertLink, deleteLink, loadLinks,
  insertPixelEvent, loadPixelEvents, prunePixelEvents,
  // domínios personalizados duráveis + moeda por conta (itens 241–252)
  upsertCustomDomain, deleteCustomDomain, loadCustomDomains,
  setAccountCurrency, loadAccountCurrencies,
  migrationStatus: () => Object.assign({}, migrations)
};
