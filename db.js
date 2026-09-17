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
const crypto = require('crypto');
const { normalizeDurableCoverage, normalizeHost, DEFAULT_WINDOW_DAYS } = require('./pixel-runtime-coverage');

const URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL || null;
const isPlaceholder = !URL || /USER:PASSWORD@HOST|HOST\/DATABASE|example\.com/i.test(URL);
const enabled = !isPlaceholder && !!URL;
let neon = null;
if (enabled) {
  try { ({ neon } = require('@neondatabase/serverless')); }
  catch (err) {
    // Em instalações sem banco configurado o driver não é necessário. Quando
    // DATABASE_URL existe, falhar cedo evita subir uma instância que aparenta
    // estar saudável mas não consegue persistir nada.
    err.message = 'DATABASE_URL está configurada, mas @neondatabase/serverless não está instalado: ' + err.message;
    throw err;
  }
}
const sql = enabled ? neon(URL) : null;

if (isPlaceholder) {
  console.log('[db] DATABASE_URL não configurada ou placeholder — Neon e autenticação desativados.');
}

let ready = false;

// Item 249: status por migração — o /api/health reporta se a tabela
// custom_domains e a coluna accounts.currency migraram com sucesso no boot.
const migrations = { customDomains: false, accountCurrency: false, quarantine: false, notifications: false, presenceTenant: false };

// Chave namespaced por conta para tabelas keyed-by-name.
function nsKey(accountId, name) {
  return (accountId || 'legacy') + ':' + String(name || '');
}

// Cria as tabelas se ainda não existirem. Idempotente.
async function init() {
  if (!sql) return false;
  ready = false;
  for (const key of Object.keys(migrations)) migrations[key] = false;
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

    // ── Fase 6: agregação diária de eventos (rollup) ──────────────────────
    // Relatórios de longo período (30d/tudo) varriam milhares de linhas de
    // `events` a cada request. Esta tabela guarda UMA linha por
    // (conta, dia, tipo, moeda) com contagem e receita somada. Preenchida por
    // recompute idempotente (aggregateDaily) no mesmo sweep horário do
    // arquivamento — reprocessar o mesmo dia NUNCA duplica (ON CONFLICT
    // sobrescreve). day é a data UTC; currency = '' para tipos sem moeda.
    await sql`CREATE TABLE IF NOT EXISTS events_daily (
      account_id text NOT NULL DEFAULT '',
      day date NOT NULL,
      type text NOT NULL DEFAULT 'info',
      currency text NOT NULL DEFAULT '',
      count integer NOT NULL DEFAULT 0,
      revenue_cents bigint NOT NULL DEFAULT 0,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (account_id, day, type, currency)
    )`;
    await sql`CREATE INDEX IF NOT EXISTS events_daily_acc_day_idx ON events_daily (account_id, day DESC)`;
    migrations.eventsDaily = true;

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

    // Central nativa de notificações. Redis continua como cache rápido, mas o
    // sino não perde o histórico quando o processo reinicia ou o Redis está off.
    await sql`CREATE TABLE IF NOT EXISTS notifications (
      id text PRIMARY KEY,
      account_id text NOT NULL,
      event text NOT NULL DEFAULT '',
      priority text NOT NULL DEFAULT 'normal',
      title text NOT NULL,
      body text,
      url text NOT NULL DEFAULT '/dashboard',
      dedupe_key text,
      created_at timestamptz NOT NULL DEFAULT now()
    )`;
    await sql`CREATE INDEX IF NOT EXISTS notifications_acc_at_idx ON notifications (account_id, created_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS notifications_dedupe_idx ON notifications (account_id, dedupe_key, created_at DESC)`;
    migrations.notifications = true;

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
    await sql`ALTER TABLE pixel_events ADD COLUMN IF NOT EXISTS emq integer`;
    await sql`ALTER TABLE pixel_events ADD COLUMN IF NOT EXISTS emq_fields jsonb NOT NULL DEFAULT '[]'::jsonb`;
    // V16.12: garante que dados legados continuem participando dos agregados
    // duráveis mesmo se claimLegacyData() de uma instalação antiga não tiver
    // alcançado tabelas criadas depois (ex.: events_archive). A convenção já
    // existente do produto é atribuir legado ao primeiro admin/conta antiga.
    await sql`UPDATE leads SET account_id = (SELECT id FROM accounts ORDER BY (role = 'admin') DESC, created_at ASC LIMIT 1)
      WHERE account_id IS NULL AND EXISTS (SELECT 1 FROM accounts)`;
    await sql`UPDATE events SET account_id = (SELECT id FROM accounts ORDER BY (role = 'admin') DESC, created_at ASC LIMIT 1)
      WHERE account_id IS NULL AND EXISTS (SELECT 1 FROM accounts)`;
    await sql`UPDATE events_archive SET account_id = (SELECT id FROM accounts ORDER BY (role = 'admin') DESC, created_at ASC LIMIT 1)
      WHERE (account_id IS NULL OR account_id = '') AND EXISTS (SELECT 1 FROM accounts)`;
    await sql`CREATE INDEX IF NOT EXISTS leads_account_idx ON leads (account_id, created_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS events_account_idx ON events (account_id, at DESC)`;
    // V16.12: sessões ao vivo precisam ser únicas POR CONTA. O schema legado
    // usava visitor_id como PK global, o que permitia uma conta sobrescrever a
    // sessão homônima de outra. Fazemos a migração de forma idempotente no boot:
    //  1) atribui sessões legadas ao primeiro dono conhecido quando possível;
    //  2) usa '' apenas como namespace legado quando ainda não existe conta;
    //  3) troca a PK global por (account_id, visitor_id).
    // Como a PK antiga já garantia visitor_id único, a troca não pode criar
    // duplicatas durante a migração. Novos registros passam a coexistir por conta.
    await sql`UPDATE sessions s
      SET account_id = COALESCE(
        s.account_id,
        (SELECT a.id FROM accounts a ORDER BY (a.role = 'admin') DESC, a.created_at ASC LIMIT 1),
        ''
      )
      WHERE s.account_id IS NULL`;
    await sql`ALTER TABLE sessions ALTER COLUMN account_id SET DEFAULT ''`;
    await sql`ALTER TABLE sessions ALTER COLUMN account_id SET NOT NULL`;
    await sql`DO $$
      DECLARE pk_name text; pk_def text;
      BEGIN
        SELECT c.conname, pg_get_constraintdef(c.oid) INTO pk_name, pk_def
        FROM pg_constraint c
        WHERE c.conrelid = 'sessions'::regclass AND c.contype = 'p'
        LIMIT 1;
        IF pk_def IS DISTINCT FROM 'PRIMARY KEY (account_id, visitor_id)' THEN
          IF pk_name IS NOT NULL THEN
            EXECUTE format('ALTER TABLE sessions DROP CONSTRAINT %I', pk_name);
          END IF;
          ALTER TABLE sessions ADD CONSTRAINT sessions_pkey PRIMARY KEY (account_id, visitor_id);
        END IF;
      END $$`;
    await sql`CREATE INDEX IF NOT EXISTS sessions_account_idx ON sessions (account_id, last_seen DESC)`;
    migrations.presenceTenant = true;
    await sql`CREATE INDEX IF NOT EXISTS pixels_account_idx ON pixels (account_id)`;
    // Pixels antigos podem não ter `data.updatedAt`; promove uma revisão durável
    // usando o timestamp já persistido na própria linha. A partir daqui o mesmo
    // valor lógico é usado pelo CAS de edição/delete e devolvido ao frontend.
    await sql`UPDATE pixels
      SET data = jsonb_set(data, '{updatedAt}', to_jsonb(updated_at::text), true)
      WHERE COALESCE(data->>'updatedAt', '') = ''`;
    // Um TikTok Pixel Code identifica uma integração dentro da conta. Antes a
    // duplicidade era checada só no cache do processo, então dois requests
    // concorrentes podiam persistir o mesmo código. Não alteramos duplicatas
    // históricas automaticamente: auditamos e só instalamos a constraint quando
    // o banco já está consistente.
    const pixelCodeDupes = await sql`SELECT account_id, btrim(data->>'pixelCode') AS pixel_code, count(*)::int AS total
      FROM pixels
      WHERE account_id IS NOT NULL AND btrim(COALESCE(data->>'pixelCode', '')) <> ''
      GROUP BY account_id, btrim(data->>'pixelCode')
      HAVING count(*) > 1
      LIMIT 20`;
    if (!pixelCodeDupes.length) {
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS pixels_account_pixel_code_uidx
        ON pixels (account_id, (btrim(data->>'pixelCode')))
        WHERE account_id IS NOT NULL AND btrim(COALESCE(data->>'pixelCode', '')) <> ''`;
    } else {
      console.warn('[db] Pixels: índice único de Pixel Code não criado; duplicatas legadas detectadas:',
        pixelCodeDupes.map((r) => String(r.account_id) + ':' + String(r.pixel_code)).join(', '));
    }
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
      provider text,
      provider_note text,
      dns jsonb,
      status text NOT NULL DEFAULT 'pending_dns',
      ssl_status text,
      last_checked_at timestamptz,
      last_error text,
      retry_count integer NOT NULL DEFAULT 0,
      next_check_at timestamptz,
      criado_em timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
    await sql`CREATE INDEX IF NOT EXISTS custom_domains_account_idx ON custom_domains (account_id, host)`;
    migrations.customDomains = true;

    // ── Moeda por conta persistida na própria conta (itens 242/248) ───────
    // O item 147 (moeda por conta) guardava só na config; a coluna garante a
    // persistência mesmo se a config for recriada. Default BRL não quebra
    // contas EUR existentes: o valor efetivo vem da config e é espelhado aqui.
    // ── Migrações ADITIVAS de colunas — cada uma isolada ──────────────────
    // Regra dura: uma coluna aditiva que falhe NÃO pode abortar o resto do
    // boot. Antes, tudo rodava no mesmo try do init(): se qualquer statement
    // anterior lançasse, o ADD COLUMN de `totp_secret` nunca rodava e, como o
    // SELECT de conta cita essa coluna, o LOGIN INTEIRO caía ("senha
    // incorreta" com a senha certa). Cada ALTER abaixo é independente e
    // idempotente (ADD COLUMN IF NOT EXISTS) — falha de uma é logada, não
    // propaga.
    const safeAlter = async (label, run) => {
      try { await run(); } catch (e) { console.error('[db] migração ' + label + ' falhou (segue):', e && e.message); }
    };
    await safeAlter('accounts.currency', async () => {
      await sql`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS currency text DEFAULT 'BRL'`;
      migrations.accountCurrency = true;
    });
    // Domínios: o estado operacional precisa sobreviver a restart/deploy e não
    // pode depender apenas do JSON da config. Migração aditiva e idempotente.
    await safeAlter('custom_domains.provider', () => sql`ALTER TABLE custom_domains ADD COLUMN IF NOT EXISTS provider text`);
    await safeAlter('custom_domains.status', () => sql`ALTER TABLE custom_domains ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending_dns'`);
    await safeAlter('custom_domains.ssl_status', () => sql`ALTER TABLE custom_domains ADD COLUMN IF NOT EXISTS ssl_status text`);
    await safeAlter('custom_domains.last_checked_at', () => sql`ALTER TABLE custom_domains ADD COLUMN IF NOT EXISTS last_checked_at timestamptz`);
    await safeAlter('custom_domains.last_error', () => sql`ALTER TABLE custom_domains ADD COLUMN IF NOT EXISTS last_error text`);
    await safeAlter('custom_domains.retry_count', () => sql`ALTER TABLE custom_domains ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0`);
    await safeAlter('custom_domains.next_check_at', () => sql`ALTER TABLE custom_domains ADD COLUMN IF NOT EXISTS next_check_at timestamptz`);
    // ── Item 414: metadados de dispositivo nas sessões de login ───────────
    await safeAlter('account_sessions.ua', () => sql`ALTER TABLE account_sessions ADD COLUMN IF NOT EXISTS ua text`);
    await safeAlter('account_sessions.ip_masked', () => sql`ALTER TABLE account_sessions ADD COLUMN IF NOT EXISTS ip_masked text`);
    // ── Item 420: 2FA TOTP opcional — coluna CRÍTICA p/ o SELECT de conta ──
    await safeAlter('accounts.totp_secret', () => sql`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS totp_secret text`);

    ready = true;
    console.log('[db] Neon pronto (tabelas multi-tenant verificadas).');
    return true;
  } catch (err) {
    console.error('[db] Falha ao inicializar Neon; persistência indisponível:', err.message);
    ready = false;
    return false;
  }
}

// init com retry — uma falha transitória de rede no boot não pode deixar o
// processo rodando sem persistência (era um dos vetores de perda de config).
async function initWithRetry(attempts) {
  if (!enabled) return false;
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

// Uma coluna aditiva ainda não migrada (ex.: totp_secret do 2FA) NÃO pode
// derrubar o login: se `init()` abortar antes do ALTER, o SELECT que cita a
// coluna lança e o login inteiro passa a responder "senha incorreta" mesmo com
// a senha certa (e o cadastro bate no ON CONFLICT). `missingColumnError` detecta
// esse caso para refazer a leitura sem a coluna (2FA tratado como desligado).
function missingColumnError(err) {
  const m = String((err && err.message) || err);
  // Postgres 42703 = undefined_column; a mensagem cita o nome da coluna.
  return /totp_secret/i.test(m) || /column .* does not exist/i.test(m) || /42703/.test(m);
}

async function getAccountByEmail(email) {
  if (!enabled || !email) return null;
  const e = email.toLowerCase();
  try {
    const rows = await sql`SELECT id, email, password_hash, name, role, created_at, totp_secret
      FROM accounts WHERE email = ${e} LIMIT 1`;
    return rows.length ? rows[0] : null;
  } catch (err) {
    if (missingColumnError(err)) {
      try {
        const rows = await sql`SELECT id, email, password_hash, name, role, created_at
          FROM accounts WHERE email = ${e} LIMIT 1`;
        return rows.length ? Object.assign({ totp_secret: null }, rows[0]) : null;
      } catch (err2) { console.error('[db] getAccountByEmail fallback:', err2.message); return null; }
    }
    console.error('[db] getAccountByEmail:', err.message); return null;
  }
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
  } catch (err) {
    if (missingColumnError(err)) {
      try {
        const rows = await sql`SELECT id, email, password_hash, name, role, created_at
          FROM accounts WHERE id = ${id} LIMIT 1`;
        return rows.length ? Object.assign({ totp_secret: null }, rows[0]) : null;
      } catch (err2) { console.error('[db] getAccountById fallback:', err2.message); return null; }
    }
    console.error('[db] getAccountById:', err.message); return null;
  }
}

async function countAccounts() {
  if (!enabled) return -1;
  try {
    const rows = await sql`SELECT count(*)::int AS n FROM accounts`;
    return rows[0].n;
  } catch (err) { console.error('[db] countAccounts:', err.message); return -1; }
}

// Fonte autoritativa de tenancy para workers de background. Config/estado
// operacional órfão nunca deve criar uma conta SaaS implícita.
async function listAccountIds() {
  if (!enabled) return [];
  try {
    const rows = await sql`SELECT id FROM accounts ORDER BY created_at ASC`;
    return rows.map((row) => String(row.id || '')).filter(Boolean);
  } catch (err) {
    console.error('[db] listAccountIds:', err.message);
    throw err;
  }
}

// Diagnóstico read-only: configs com bloco TikTok Ads, mas sem conta real.
// Não remove nada; o script de auditoria V16.13 usa isto para explicar resíduos.
async function listOrphanAdsConfigs(limit) {
  if (!enabled) return [];
  const n = Math.max(1, Math.min(1000, Number(limit) || 200));
  try {
    return await sql`SELECT c.key, c.data->'pipeboardAds' AS pipeboard_ads, c.updated_at
      FROM config c
      LEFT JOIN accounts a ON a.id = c.key
      WHERE a.id IS NULL AND c.data ? 'pipeboardAds'
      ORDER BY c.updated_at DESC
      LIMIT ${n}`;
  } catch (err) {
    console.error('[db] listOrphanAdsConfigs:', err.message);
    throw err;
  }
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
    await sql`UPDATE events_archive SET account_id = ${accountId} WHERE account_id IS NULL OR account_id = ''`;
    await sql`UPDATE sessions SET account_id = ${accountId} WHERE account_id IS NULL OR account_id = ''`;
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
    await sql`DELETE FROM notifications   WHERE account_id = ${accountId}`;
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
  if (!enabled || !id) return false;
  try { await sql`DELETE FROM gateways WHERE id = ${id} AND account_id = ${accountId}`; return true; }
  catch (err) { console.error('[db] deleteGateway:', err.message); return false; }
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


// P2 Pixels (V16.16): evidência operacional do tracker vem do Neon, não do
// cache quente podado. A consulta expande somente os hosts do JSONB e agrega
// no PostgreSQL por pixel+host; nunca retorna leads completos para o Node.
async function readPixelRuntimeCoverage(accountId, options = {}) {
  if (!enabled) return { ok: false, data: [], error: 'neon_disabled' };
  if (!accountId) return { ok: false, data: [], error: 'account_required' };

  const rawDays = Number(options.windowDays);
  const windowDays = Number.isFinite(rawDays)
    ? Math.max(1, Math.min(DEFAULT_WINDOW_DAYS, Math.floor(rawDays)))
    : DEFAULT_WINDOW_DAYS;
  const pixelSlug = options.pixelSlug ? String(options.pixelSlug).trim() : null;
  const normalizedHost = normalizeHost(options.host) || null;
  // Datas do tracker são geradas com Date#toISOString(). Filtramos o formato
  // canônico antes de agregar para que texto inválido nunca vire evidência.
  const isoPattern = '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9][.][0-9]{3}Z$';

  try {
    const rows = await sql`
      WITH candidate_leads AS (
        SELECT data, updated_at, created_at
        FROM leads
        WHERE account_id = ${accountId}
          AND updated_at >= now() - (${windowDays} * interval '1 day')
          AND (${pixelSlug}::text IS NULL OR data->>'pixelSlug' = ${pixelSlug})
      ),
      expanded AS (
        SELECT
          l.data->>'pixelSlug' AS pixel_slug,
          l.data->>'lastSeen' AS last_seen,
          l.updated_at,
          l.created_at,
          site
        FROM candidate_leads l
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE
            WHEN jsonb_typeof(l.data->'sites') = 'array'
              AND jsonb_array_length(l.data->'sites') > 0
              THEN l.data->'sites'
            WHEN NULLIF(btrim(l.data->>'site'), '') IS NOT NULL
              THEN jsonb_build_array(jsonb_build_object('host', l.data->>'site', 'hits', 1))
            ELSE '[]'::jsonb
          END
        ) AS site
      ),
      normalized AS (
        SELECT
          pixel_slug,
          lower(regexp_replace(regexp_replace(btrim(site->>'host'), '^www[.]', '', 'i'), '[.]+$', '')) AS host,
          CASE
            WHEN COALESCE(site->>'hits', '') ~ '^[0-9]+([.][0-9]+)?$'
              AND (site->>'hits')::numeric > 0
              THEN LEAST(2147483647, GREATEST(1, floor((site->>'hits')::numeric)))::bigint
            ELSE 1::bigint
          END AS hits,
          CASE WHEN COALESCE(site->>'lastAt', '') ~ ${isoPattern} THEN site->>'lastAt' ELSE NULL END AS site_last_at,
          CASE WHEN COALESCE(last_seen, '') ~ ${isoPattern} THEN last_seen ELSE NULL END AS last_seen_at,
          updated_at,
          created_at
        FROM expanded
        WHERE NULLIF(btrim(pixel_slug), '') IS NOT NULL
      )
      SELECT
        pixel_slug,
        host,
        SUM(hits)::bigint AS hits,
        MAX(site_last_at) AS last_at,
        MAX(last_seen_at) AS last_seen_at,
        MAX(updated_at) AS updated_at,
        MAX(created_at) AS created_at
      FROM normalized
      WHERE host <> ''
        AND (${normalizedHost}::text IS NULL OR host = ${normalizedHost})
      GROUP BY pixel_slug, host
      ORDER BY pixel_slug ASC, MAX(updated_at) DESC, host ASC
    `;
    return { ok: true, data: normalizeDurableCoverage(rows) };
  } catch (err) {
    console.error('[db] readPixelRuntimeCoverage:', err.message);
    return { ok: false, data: [], error: 'neon_query_failed' };
  }
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

// Fase 6: recomputa o rollup diário de eventos para os últimos `days` dias.
// Idempotente: reagrega a janela inteira a partir de `events` + `events_archive`
// (um evento recém-arquivado continua contando) e faz UPSERT — reprocessar o
// mesmo intervalo produz exatamente os mesmos números, nunca soma em dobro.
// A receita vem do jsonb: coalesce(amount, amountCents) em centavos, só para
// eventos com valor numérico. Chamado no sweep horário (checkEventArchive).
// Retorna quantas linhas (conta, dia, tipo, moeda) foram gravadas.
async function aggregateDaily(days) {
  if (!enabled) return 0;
  const window = Math.max(1, Math.min(400, Math.round(Number(days) || 35)));
  try {
    // Fonte unificada: eventos quentes + arquivados no intervalo. amount está em
    // centavos no data jsonb (chave `amount`, com fallback `amountCents`);
    // filtramos a valores numéricos e não-negativos para não poluir a receita.
    const rows = await sql`
      WITH src AS (
        SELECT account_id, type, at, data FROM events
          WHERE at >= (now()::date - (${window} || ' days')::interval)
        UNION ALL
        SELECT account_id, type, at, data FROM events_archive
          WHERE at >= (now()::date - (${window} || ' days')::interval)
      ), norm AS (
        SELECT
          COALESCE(account_id, '') AS account_id,
          (at AT TIME ZONE 'UTC')::date AS day,
          COALESCE(type, 'info') AS type,
          COALESCE(NULLIF(upper(data->>'currency'), ''), '') AS currency,
          CASE
            WHEN jsonb_typeof(data->'amount') = 'number' THEN GREATEST((data->>'amount')::numeric, 0)
            WHEN jsonb_typeof(data->'amountCents') = 'number' THEN GREATEST((data->>'amountCents')::numeric, 0)
            ELSE 0
          END AS amount_cents
        FROM src
      ), agg AS (
        SELECT account_id, day, type, currency,
               COUNT(*) AS count,
               COALESCE(SUM(amount_cents), 0)::bigint AS revenue_cents
        FROM norm
        GROUP BY account_id, day, type, currency
      )
      INSERT INTO events_daily (account_id, day, type, currency, count, revenue_cents, updated_at)
      SELECT account_id, day, type, currency, count, revenue_cents, now() FROM agg
      ON CONFLICT (account_id, day, type, currency)
      DO UPDATE SET count = EXCLUDED.count,
                    revenue_cents = EXCLUDED.revenue_cents,
                    updated_at = now()
      RETURNING 1`;
    return Array.isArray(rows) ? rows.length : 0;
  } catch (err) {
    console.error('[db] aggregateDaily:', err.message);
    return 0;
  }
}

// Fase 6: lê o rollup diário de uma conta (relatórios de período longo). Sem
// escopo de conta = agrega tudo. Devolve linhas cruas (conta o consumidor soma).
async function readDaily(accountId, days) {
  if (!enabled) return [];
  const window = Math.max(1, Math.min(400, Math.round(Number(days) || 35)));
  try {
    if (accountId) {
      return await sql`SELECT account_id, day, type, currency, count, revenue_cents
        FROM events_daily
        WHERE account_id = ${accountId}
          AND day >= (now()::date - (${window} || ' days')::interval)
        ORDER BY day DESC`;
    }
    return await sql`SELECT account_id, day, type, currency, count, revenue_cents
      FROM events_daily
      WHERE day >= (now()::date - (${window} || ' days')::interval)
      ORDER BY day DESC`;
  } catch (err) {
    console.error('[db] readDaily:', err.message);
    return [];
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

// ── Central nativa de notificações ────────────────────────────────────────
async function insertNotification(accountId, entry) {
  if (!enabled || !accountId || !entry || !entry.title) return null;
  const id = crypto.randomUUID();
  const event = String(entry.event || '').slice(0, 40);
  const priority = entry.priority === 'critical' ? 'critical' : 'normal';
  const title = String(entry.title).slice(0, 120);
  const body = String(entry.body || '').slice(0, 240) || null;
  const url = String(entry.url || '/dashboard').slice(0, 200);
  const dedupeKey = String(entry.dedupeKey || '').slice(0, 160) || null;
  try {
    const rows = dedupeKey
      ? await sql`INSERT INTO notifications (id, account_id, event, priority, title, body, url, dedupe_key)
          SELECT ${id}, ${accountId}, ${event}, ${priority}, ${title}, ${body}, ${url}, ${dedupeKey}
          WHERE NOT EXISTS (
            SELECT 1 FROM notifications
            WHERE account_id = ${accountId} AND dedupe_key = ${dedupeKey}
              AND created_at > now() - interval '5 minutes'
          )
          RETURNING id`
      : await sql`INSERT INTO notifications (id, account_id, event, priority, title, body, url, dedupe_key)
          VALUES (${id}, ${accountId}, ${event}, ${priority}, ${title}, ${body}, ${url}, null)
          RETURNING id`;
    if (rows.length) {
      sql`DELETE FROM notifications
        WHERE account_id = ${accountId} AND created_at < now() - interval '30 days'`.catch(() => {});
    }
    return rows.length ? rows[0].id : null;
  } catch (err) {
    console.error('[db] insertNotification:', err.message);
    return null;
  }
}

async function listNotifications(accountId, limit) {
  if (!enabled || !accountId) return [];
  const n = Math.max(1, Math.min(100, Number(limit) || 20));
  try {
    const rows = await sql`SELECT id, event, priority, title, body, url, created_at
      FROM notifications WHERE account_id = ${accountId}
      ORDER BY created_at DESC LIMIT ${n}`;
    return rows.map((r) => ({
      id: r.id,
      at: new Date(r.created_at).getTime(),
      event: r.event || '',
      priority: r.priority || 'normal',
      title: r.title || '',
      body: r.body || '',
      url: r.url || '/dashboard',
    }));
  } catch (err) {
    console.error('[db] listNotifications:', err.message);
    return [];
  }
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
// NOTHING, imune a corrida entre dois retries simultâneos. Em falha do Neon,
// não confirma nem rejeita o pedido: o worker preserva a conversão para retry.
// Sem banco, somente desenvolvimento mantém o processamento local legado.
async function markOrderProcessed(accountId, gateway, orderId) {
  if (!enabled) {
    if (process.env.NODE_ENV !== 'production') return true;
    const err = new Error('Banco não configurado; confirmação da venda pendente');
    err.code = 'ORDER_PERSISTENCE_UNAVAILABLE';
    throw err;
  }
  if (!orderId) return true; // sem order_id não há chave estável p/ deduplicar
  try {
    const rows = await sql`INSERT INTO processed_orders (account_id, gateway, order_id)
      VALUES (${accountId || ''}, ${String(gateway || '').slice(0, 30)}, ${String(orderId).slice(0, 200)})
      ON CONFLICT (account_id, gateway, order_id) DO NOTHING
      RETURNING order_id`;
    return rows.length > 0;
  } catch (cause) {
    console.error('[db] markOrderProcessed:', cause.message);
    const err = new Error('Não foi possível confirmar a deduplicação da venda no banco');
    err.code = 'ORDER_PERSISTENCE_UNAVAILABLE';
    err.cause = cause;
    throw err;
  }
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


// ── V16.12: agregados duráveis da Visão Geral ─────────────────────────────
// A Home não pode depender do cache quente global (MAX_LEADS/MAX_EVENTS). Estas
// consultas trabalham diretamente no Neon, sempre por conta + janela absoluta.
// A resposta é compacta: agregados, rankings e série diária — nunca milhares de
// leads enviados ao navegador só para somar números.
function _overviewIso(value) {
  const d = new Date(value || '');
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

async function readOverviewPeriod(accountId, from, to, timeZone) {
  if (!enabled || !accountId) return null;
  const fromIso = _overviewIso(from);
  const toIso = _overviewIso(to);
  if (!fromIso || !toIso || new Date(fromIso) > new Date(toIso)) return null;
  const tz = String(timeZone || 'America/Sao_Paulo');
  try {
    const rows = await sql`
      WITH event_src AS (
        SELECT type, at, data FROM events
        WHERE account_id = ${accountId} AND at >= ${fromIso}::timestamptz AND at < ${toIso}::timestamptz
        UNION ALL
        SELECT type, at, data FROM events_archive
        WHERE account_id = ${accountId} AND at >= ${fromIso}::timestamptz AND at < ${toIso}::timestamptz
      ), event_norm AS (
        SELECT
          COALESCE(type, 'info') AS type,
          at,
          COALESCE(NULLIF(upper(data->>'currency'), ''), 'BRL') AS currency,
          COALESCE(NULLIF(data->>'gateway', ''), 'outro') AS gateway,
          CASE
            WHEN jsonb_typeof(data->'amount') = 'number' THEN GREATEST((data->>'amount')::numeric, 0)
            WHEN jsonb_typeof(data->'amountCents') = 'number' THEN GREATEST((data->>'amountCents')::numeric, 0)
            ELSE 0
          END AS amount_cents
        FROM event_src
      ), event_totals AS (
        SELECT
          COUNT(*) FILTER (WHERE type = 'sale')::int AS sales,
          COUNT(*) FILTER (WHERE type = 'failed')::int AS failed,
          COUNT(*) FILTER (WHERE type = 'refund')::int AS refunds,
          COUNT(*) FILTER (WHERE type = 'dispute')::int AS disputes,
          MAX(at) AS last_event_at
        FROM event_norm
      ), event_currency AS (
        SELECT currency,
          COUNT(*) FILTER (WHERE type = 'sale')::int AS sales,
          COALESCE(SUM(amount_cents) FILTER (WHERE type = 'sale'), 0)::bigint AS revenue_cents
        FROM event_norm
        GROUP BY currency
      ), main_currency AS (
        SELECT currency FROM event_currency ORDER BY revenue_cents DESC, sales DESC, currency ASC LIMIT 1
      ), event_daily AS (
        SELECT
          to_char(timezone(${tz}, at), 'YYYY-MM-DD') AS day,
          COALESCE(SUM(amount_cents) FILTER (
            WHERE type = 'sale' AND currency = COALESCE((SELECT currency FROM main_currency), 'BRL')
          ), 0)::bigint AS revenue,
          COUNT(*) FILTER (
            WHERE type = 'sale' AND currency = COALESCE((SELECT currency FROM main_currency), 'BRL')
          )::int AS sales
        FROM event_norm
        GROUP BY 1
        ORDER BY 1
      ), lead_src AS (
        SELECT data, stage, gateway, country, country_name, created_at
        FROM leads
        WHERE account_id = ${accountId}
          AND orphan = false
          AND created_at >= ${fromIso}::timestamptz
          AND created_at < ${toIso}::timestamptz
      ), lead_norm AS (
        SELECT
          data,
          stage,
          COALESCE(NULLIF(gateway, ''), NULLIF(data->>'gateway', '')) AS gateway,
          COALESCE(NULLIF(country, ''), NULLIF(data->>'country', '')) AS country,
          COALESCE(NULLIF(country_name, ''), NULLIF(data->>'countryName', '')) AS country_name,
          created_at,
          CASE WHEN COALESCE(data->>'checkoutAt', data->>'convertedAt', data->>'purchasedAt', data->>'at', '') <> ''
            THEN COALESCE(data->>'checkoutAt', data->>'convertedAt', data->>'purchasedAt', data->>'at')::timestamptz ELSE NULL END AS checkout_at,
          CASE WHEN COALESCE(data->>'paymentStartedAt', data->>'convertedAt', data->>'purchasedAt', data->>'at', '') <> ''
            THEN COALESCE(data->>'paymentStartedAt', data->>'convertedAt', data->>'purchasedAt', data->>'at')::timestamptz ELSE NULL END AS payment_at,
          CASE WHEN COALESCE(data->>'convertedAt', data->>'purchasedAt', data->>'at', '') <> ''
            THEN COALESCE(data->>'convertedAt', data->>'purchasedAt', data->>'at')::timestamptz ELSE NULL END AS purchase_at,
          NULLIF(data #>> '{utm,campaign}', '') AS campaign,
          NULLIF(data->>'linkSlug', '') AS link_slug
        FROM lead_src
      ), lead_summary AS (
        SELECT
          COUNT(*)::int AS visits,
          COUNT(*) FILTER (WHERE stage IN ('checkout','purchased') AND checkout_at >= ${fromIso}::timestamptz AND checkout_at < ${toIso}::timestamptz)::int AS reached_checkout,
          COUNT(*) FILTER (WHERE (NULLIF(data->>'paymentStartedAt','') IS NOT NULL OR stage = 'purchased') AND payment_at >= ${fromIso}::timestamptz AND payment_at < ${toIso}::timestamptz)::int AS payment_started,
          COUNT(*) FILTER (WHERE stage = 'purchased' AND purchase_at >= ${fromIso}::timestamptz AND purchase_at < ${toIso}::timestamptz)::int AS purchased,
          MAX(GREATEST(created_at, COALESCE(checkout_at, created_at), COALESCE(payment_at, created_at), COALESCE(purchase_at, created_at))) AS last_lead_at
        FROM lead_norm
      ), countries AS (
        SELECT country AS code, COALESCE(MAX(country_name), country) AS name,
          COUNT(*)::int AS count,
          COUNT(*) FILTER (WHERE stage = 'purchased' AND purchase_at >= ${fromIso}::timestamptz AND purchase_at < ${toIso}::timestamptz)::int AS purchased
        FROM lead_norm
        WHERE country IS NOT NULL
        GROUP BY country
        ORDER BY count DESC, purchased DESC
      ), campaigns AS (
        SELECT campaign AS name,
          COUNT(*)::int AS leads,
          COUNT(*) FILTER (WHERE stage = 'purchased' AND purchase_at >= ${fromIso}::timestamptz AND purchase_at < ${toIso}::timestamptz)::int AS purchased
        FROM lead_norm
        WHERE campaign IS NOT NULL AND campaign !~ '__[A-Z0-9]+(_[A-Z0-9]+)*__'
        GROUP BY campaign
        ORDER BY purchased DESC, leads DESC, name ASC
        LIMIT 5
      ), lead_daily AS (
        SELECT to_char(timezone(${tz}, created_at), 'YYYY-MM-DD') AS day, COUNT(*)::int AS visits
        FROM lead_norm GROUP BY 1 ORDER BY 1
      )
      SELECT
        COALESCE((SELECT row_to_json(event_totals) FROM event_totals), '{}'::json) AS event_totals,
        COALESCE((SELECT json_agg(event_currency ORDER BY revenue_cents DESC, sales DESC) FROM event_currency), '[]'::json) AS event_currency,
        COALESCE((SELECT json_agg(event_daily ORDER BY day) FROM event_daily), '[]'::json) AS event_daily,
        COALESCE((SELECT row_to_json(lead_summary) FROM lead_summary), '{}'::json) AS lead_summary,
        COALESCE((SELECT json_agg(countries) FROM countries), '[]'::json) AS countries,
        COALESCE((SELECT json_agg(campaigns) FROM campaigns), '[]'::json) AS campaigns,
        COALESCE((SELECT json_agg(lead_daily ORDER BY day) FROM lead_daily), '[]'::json) AS lead_daily`;
    if (!rows || !rows.length) return null;
    const row = rows[0] || {};
    const eventTotals = row.event_totals || {};
    const currencies = Array.isArray(row.event_currency) ? row.event_currency : [];
    const leadSummary = row.lead_summary || {};
    const rev = {};
    currencies.forEach((item) => {
      if (!item || !item.currency) return;
      rev[String(item.currency).toUpperCase()] = Number(item.revenue_cents) || 0;
    });
    const mainCur = currencies.length ? String(currencies[0].currency || 'BRL').toUpperCase() : 'BRL';
    const revenueSales = currencies.length ? Number(currencies[0].sales) || 0 : 0;
    const sales = Number(eventTotals.sales) || 0;
    const failed = Number(eventTotals.failed) || 0;
    const seriesMap = new Map();
    (Array.isArray(row.event_daily) ? row.event_daily : []).forEach((item) => {
      if (!item || !item.day) return;
      seriesMap.set(String(item.day), { day: String(item.day), revenue: Number(item.revenue) || 0, sales: Number(item.sales) || 0, visits: 0 });
    });
    (Array.isArray(row.lead_daily) ? row.lead_daily : []).forEach((item) => {
      if (!item || !item.day) return;
      const day = String(item.day);
      const cur = seriesMap.get(day) || { day, revenue: 0, sales: 0, visits: 0 };
      cur.visits = Number(item.visits) || 0;
      seriesMap.set(day, cur);
    });
    const visits = Number(leadSummary.visits) || 0;
    const purchased = Number(leadSummary.purchased) || 0;
    return {
      rev,
      mainCur,
      sales,
      revenueSales,
      failed,
      refunds: Number(eventTotals.refunds) || 0,
      disputes: Number(eventTotals.disputes) || 0,
      approval: sales + failed ? +((sales / (sales + failed)) * 100).toFixed(1) : 0,
      visits,
      reachedCheckout: Number(leadSummary.reached_checkout) || 0,
      paymentStarted: Number(leadSummary.payment_started) || 0,
      purchased,
      overall: visits ? +((purchased / visits) * 100).toFixed(1) : 0,
      countries: (Array.isArray(row.countries) ? row.countries : []).map((item) => ({
        code: String(item.code || ''), name: String(item.name || item.code || ''),
        count: Number(item.count) || 0, purchased: Number(item.purchased) || 0,
      })),
      series: Array.from(seriesMap.values()).sort((a, b) => a.day.localeCompare(b.day)),
      topCampaigns: (Array.isArray(row.campaigns) ? row.campaigns : []).map((item) => {
        const leads = Number(item.leads) || 0;
        const bought = Number(item.purchased) || 0;
        return { name: String(item.name || ''), leads, purchased: bought, conv: leads ? +((bought / leads) * 100).toFixed(1) : 0 };
      }),
      updatedAt: [eventTotals.last_event_at, leadSummary.last_lead_at]
        .map((v) => v ? new Date(v).toISOString() : null)
        .filter(Boolean)
        .sort()
        .pop() || null,
    };
  } catch (err) {
    console.error('[db] readOverviewPeriod:', err.message);
    return null;
  }
}

// Dados de cobertura/saúde calculados no banco, sem depender do snapshot quente.
// Janela de 365d acompanha a semântica atual de "Tudo" da Home e evita que um
// histórico infinito/LGPD antigo distorça a operação presente.
async function readOverviewHealthFacts(accountId) {
  if (!enabled || !accountId) return null;
  try {
    const rows = await sql`
      WITH lead_src AS (
        SELECT data, stage, orphan, country, created_at, updated_at
        FROM leads
        WHERE account_id = ${accountId} AND created_at >= now() - interval '365 days'
      ), tracked AS (
        SELECT * FROM lead_src WHERE orphan = false
      ), event_src AS (
        SELECT type, at FROM events WHERE account_id = ${accountId} AND at >= now() - interval '365 days'
        UNION ALL
        SELECT type, at FROM events_archive WHERE account_id = ${accountId} AND at >= now() - interval '365 days'
      ), hosts AS (
        SELECT
          COALESCE(NULLIF(site.value->>'host',''), NULLIF(t.data->>'site','')) AS host,
          COALESCE(NULLIF(t.data->>'pixelSlug',''), '') AS pixel_slug,
          GREATEST(1, COALESCE(NULLIF(site.value->>'hits','')::int, 1)) AS hits,
          COALESCE(NULLIF(site.value->>'lastAt','')::timestamptz, NULLIF(t.data->>'lastSeen','')::timestamptz, t.updated_at) AS last_at
        FROM tracked t
        LEFT JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(t.data->'sites') = 'array' THEN
            CASE WHEN jsonb_array_length(t.data->'sites') > 0 THEN t.data->'sites'
              ELSE jsonb_build_array(jsonb_build_object('host', t.data->>'site')) END
          ELSE jsonb_build_array(jsonb_build_object('host', t.data->>'site')) END
        ) site(value) ON true
      ), host_agg AS (
        SELECT host, SUM(hits)::int AS visits, MAX(last_at) AS last_at,
          ARRAY_REMOVE(ARRAY_AGG(DISTINCT NULLIF(pixel_slug,'')), NULL) AS pixels
        FROM hosts WHERE host IS NOT NULL AND host <> '' GROUP BY host
        ORDER BY last_at DESC NULLS LAST
        LIMIT 50
      )
      SELECT
        (SELECT COUNT(*)::int FROM tracked) AS leads_total,
        (SELECT COUNT(*)::int FROM tracked WHERE stage = 'purchased') AS tracked_purchases,
        (SELECT COUNT(*)::int FROM lead_src WHERE orphan = true AND stage = 'purchased') AS orphan_purchases,
        (SELECT COUNT(*)::int FROM event_src WHERE type = 'sale') AS sale_events,
        (SELECT COUNT(*)::int FROM tracked WHERE NULLIF(data->>'linkSlug','') IS NOT NULL
          OR (NULLIF(data #>> '{utm,campaign}','') IS NOT NULL AND (data #>> '{utm,campaign}') !~ '__[A-Z0-9]+(_[A-Z0-9]+)*__')) AS attributed_visits,
        (SELECT COUNT(*)::int FROM tracked WHERE COALESCE(NULLIF(country,''), NULLIF(data->>'country','')) IS NOT NULL) AS country_visits,
        (SELECT MAX(COALESCE(NULLIF(data->>'lastSeen','')::timestamptz, created_at)) FROM tracked) AS last_traffic_at,
        (SELECT MAX(at) FROM event_src WHERE type IN ('sale','failed','refund','dispute')) AS last_payment_at,
        COALESCE((SELECT json_agg(host_agg) FROM host_agg), '[]'::json) AS hosts`;
    return rows && rows.length ? rows[0] : null;
  } catch (err) {
    console.error('[db] readOverviewHealthFacts:', err.message);
    return null;
  }
}

async function reset(accountId) {
  if (!enabled) return true;
  try {
    if (accountId) {
      await sql`DELETE FROM leads WHERE account_id = ${accountId}`;
      await sql`DELETE FROM events WHERE account_id = ${accountId}`;
      await sql`DELETE FROM variants WHERE account_id = ${accountId}`;
      await sql`DELETE FROM sessions WHERE account_id = ${accountId}`;
    } else {
      await sql`TRUNCATE leads, events, variants, sessions`;
    }
    return true;
  } catch (err) {
    console.error('[db] reset:', err.message);
    return false;
  }
}

// ── Sessões ao vivo (heartbeat, por conta) ──���─────────────────────────────
async function upsertSession(accountId, s) {
  if (!enabled || !s || !s.visitorId) return;
  const acc = String(accountId || '');
  try {
    await sql`INSERT INTO sessions (visitor_id, account_id, page, referrer, country, country_name, city, ua, ip, variant, first_seen, last_seen, pageviews)
      VALUES (${s.visitorId}, ${acc}, ${s.page || null}, ${s.referrer || null}, ${s.country || null},
              ${s.countryName || null}, ${s.city || null}, ${s.ua || null}, ${s.ip || null},
              ${s.variant || null}, now(), now(), 1)
      ON CONFLICT (account_id, visitor_id) DO UPDATE SET
        page = EXCLUDED.page, referrer = COALESCE(sessions.referrer, EXCLUDED.referrer),
        country = COALESCE(EXCLUDED.country, sessions.country),
        country_name = COALESCE(EXCLUDED.country_name, sessions.country_name),
        city = COALESCE(EXCLUDED.city, sessions.city),
        ua = COALESCE(sessions.ua, EXCLUDED.ua),
        ip = COALESCE(sessions.ip, EXCLUDED.ip),
        variant = COALESCE(EXCLUDED.variant, sessions.variant),
        last_seen = now(),
        pageviews = sessions.pageviews + 1`;
  } catch (err) { console.error('[db] upsertSession:', err.message); }
}

// ── Config durável (por conta) ────────────────────────────────────────────
async function saveConfig(accountId, data) {
  if (!enabled || !data) return false;
  const key = accountId || 'main';
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await sql`INSERT INTO config (key, data, updated_at)
        VALUES (${key}, ${JSON.stringify(data)}::jsonb, now())
        ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`;
      return true;
    } catch (err) {
      console.error('[db] saveConfig (tentativa ' + attempt + '/3):', err.message);
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }
  return false;
}

// Compare-and-swap da config. Evita que duas instâncias do app gravem snapshots
// completos em paralelo e a última apague uma alteração confirmada pela outra.
// `expectedUpdatedAt` é o timestamp lógico que veio no JSON da versão lida.
async function saveConfigVersioned(accountId, data, expectedUpdatedAt) {
  if (!enabled || !data || !expectedUpdatedAt) return { ok: false, conflict: false };
  const key = accountId || 'main';
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const rows = await sql`UPDATE config
        SET data = ${JSON.stringify(data)}::jsonb, updated_at = now()
        WHERE key = ${key}
          AND COALESCE(data->>'updatedAt', '') = ${String(expectedUpdatedAt)}
        RETURNING key`;
      if (rows.length) return { ok: true, conflict: false };
      return { ok: false, conflict: true };
    } catch (err) {
      console.error('[db] saveConfigVersioned (tentativa ' + attempt + '/3):', err.message);
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
      else return { ok: false, conflict: false, error: err.message };
    }
  }
  return { ok: false, conflict: false };
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
async function claimCustomDomain(accountId, host) {
  if (!enabled || !accountId || !host) return { ok: !enabled, claimed: false, owner: accountId || null };
  try {
    const inserted = await sql`INSERT INTO custom_domains (host, account_id, uso, status, criado_em, updated_at)
      VALUES (${host}, ${accountId}, 'ambos', 'pending_dns', now(), now())
      ON CONFLICT (host) DO NOTHING
      RETURNING account_id`;
    if (inserted.length) return { ok: true, claimed: true, owner: accountId };
    // Migração segura de linhas legadas sem owner: somente uma conta consegue
    // preencher NULL graças ao predicado atômico; as demais enxergam o dono.
    const adopted = await sql`UPDATE custom_domains
      SET account_id = ${accountId}, updated_at = now()
      WHERE host = ${host} AND account_id IS NULL
      RETURNING account_id`;
    if (adopted.length) return { ok: true, claimed: true, owner: accountId };
    const rows = await sql`SELECT account_id FROM custom_domains WHERE host = ${host} LIMIT 1`;
    const owner = rows.length ? rows[0].account_id : null;
    return { ok: owner === accountId, claimed: false, owner };
  } catch (err) {
    console.error('[db] claimCustomDomain:', err.message);
    return { ok: false, claimed: false, owner: null, error: err.message };
  }
}

async function upsertCustomDomain(accountId, d) {
  if (!enabled || !d || !d.host || !accountId) return false;
  try {
    // WHERE no ON CONFLICT é a barreira final contra corrida multi-tenant:
    // uma segunda conta jamais consegue alterar uso/verificação/provider da
    // linha que já pertence a outra conta.
    const rows = await sql`INSERT INTO custom_domains
      (host, account_id, uso, verificado, verificado_em, provider_id, provider, provider_note, dns,
       status, ssl_status, last_checked_at, last_error, retry_count, next_check_at, criado_em, updated_at)
      VALUES (${d.host}, ${accountId}, ${d.uso || 'ambos'}, ${d.verificado === true},
              ${d.verificadoEm || null}, ${d.providerId || null}, ${d.provider || null}, ${d.providerNote || null},
              ${d.dns ? JSON.stringify(d.dns) : null}::jsonb, ${d.status || 'pending_dns'}, ${d.sslStatus || null},
              ${d.lastCheckedAt || null}, ${d.lastError || null}, ${Math.max(0, Number(d.retryCount) || 0)},
              ${d.nextCheckAt || null}, ${d.criadoEm || new Date().toISOString()}, now())
      ON CONFLICT (host) DO UPDATE SET
        account_id = COALESCE(custom_domains.account_id, EXCLUDED.account_id),
        uso = EXCLUDED.uso,
        verificado = EXCLUDED.verificado,
        verificado_em = EXCLUDED.verificado_em,
        provider_id = COALESCE(EXCLUDED.provider_id, custom_domains.provider_id),
        provider = COALESCE(EXCLUDED.provider, custom_domains.provider),
        provider_note = EXCLUDED.provider_note,
        dns = COALESCE(EXCLUDED.dns, custom_domains.dns),
        status = EXCLUDED.status,
        ssl_status = EXCLUDED.ssl_status,
        last_checked_at = EXCLUDED.last_checked_at,
        last_error = EXCLUDED.last_error,
        retry_count = EXCLUDED.retry_count,
        next_check_at = EXCLUDED.next_check_at,
        updated_at = now()
      WHERE custom_domains.account_id IS NULL OR custom_domains.account_id = EXCLUDED.account_id
      RETURNING account_id`;
    return rows.length > 0 && rows[0].account_id === accountId;
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
          provider: r.provider || null,
          providerNote: r.provider_note || null,
          dns: r.dns || null,
          status: r.status || (r.verificado === true ? 'active' : 'pending_dns'),
          sslStatus: r.ssl_status || null,
          lastCheckedAt: r.last_checked_at ? new Date(r.last_checked_at).toISOString() : null,
          lastError: r.last_error || null,
          retryCount: Math.max(0, Number(r.retry_count) || 0),
          nextCheckAt: r.next_check_at ? new Date(r.next_check_at).toISOString() : null,
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
// Contrato profissional de mutação: CREATE, UPDATE e DELETE são operações
// diferentes e a concorrência é decidida NO Postgres, nunca pelo cache local.
// O `updatedAt` lógico viaja dentro do JSON e é o mesmo valor gravado na coluna
// `updated_at`, permitindo CAS estável entre múltiplas instâncias do app.
function pixelDbError(err, op) {
  if (err && String(err.code || '') === '23505') {
    return { ok: false, conflict: 'pixel_code', error: err.message || 'duplicate pixel code' };
  }
  console.error('[db] ' + op + ':', err && err.message || err);
  return { ok: false, conflict: null, error: err && err.message || String(err || 'unknown') };
}

async function createPixel(accountId, slug, data) {
  if (!enabled || !slug || !data) return { ok: false, conflict: null };
  const revision = String(data.updatedAt || new Date().toISOString());
  const stored = { ...data, updatedAt: revision };
  try {
    const pixelCode = String(stored.pixelCode || '').trim();
    const rows = pixelCode
      ? await sql`WITH guard AS (
          SELECT pg_advisory_xact_lock(hashtext(${String(accountId || '')}), hashtext(${pixelCode}))
        )
        INSERT INTO pixels (slug, account_id, data, updated_at)
        SELECT ${nsKey(accountId, slug)}, ${accountId || null}, ${JSON.stringify(stored)}::jsonb, ${revision}::timestamptz
        FROM guard
        WHERE NOT EXISTS (
          SELECT 1 FROM pixels
          WHERE account_id = ${accountId || null}
            AND btrim(COALESCE(data->>'pixelCode', '')) = ${pixelCode}
        )
        ON CONFLICT (slug) DO NOTHING
        RETURNING data, updated_at`
      : await sql`INSERT INTO pixels (slug, account_id, data, updated_at)
          VALUES (${nsKey(accountId, slug)}, ${accountId || null}, ${JSON.stringify(stored)}::jsonb, ${revision}::timestamptz)
          ON CONFLICT (slug) DO NOTHING
          RETURNING data, updated_at`;
    if (!rows.length) {
      const existing = await loadPixel(accountId, slug);
      return { ok: false, conflict: existing ? 'slug' : 'pixel_code' };
    }
    return { ok: true, data: rows[0].data, updatedAt: revision };
  } catch (err) { return pixelDbError(err, 'createPixel'); }
}

async function loadPixel(accountId, slug) {
  if (!enabled || !slug) return null;
  try {
    const rows = await sql`SELECT slug, account_id, data FROM pixels
      WHERE slug = ${nsKey(accountId, slug)} AND account_id = ${accountId || null}
      LIMIT 1`;
    if (!rows.length) return null;
    const r = rows[0];
    const clean = r.slug.includes(':') ? r.slug.slice(r.slug.indexOf(':') + 1) : r.slug;
    return { slug: clean, accountId: r.account_id, ...r.data };
  } catch (err) { console.error('[db] loadPixel:', err.message); return null; }
}

async function updatePixelVersioned(accountId, slug, patch, expectedUpdatedAt, nextUpdatedAt) {
  if (!enabled || !slug || !patch || !expectedUpdatedAt) return { ok: false, conflict: null };
  const revision = String(nextUpdatedAt || new Date().toISOString());
  const safePatch = { ...patch, updatedAt: revision };
  try {
    const pixelCode = Object.prototype.hasOwnProperty.call(safePatch, 'pixelCode')
      ? String(safePatch.pixelCode || '').trim() : '';
    const rows = pixelCode
      ? await sql`WITH guard AS (
          SELECT pg_advisory_xact_lock(hashtext(${String(accountId || '')}), hashtext(${pixelCode}))
        )
        UPDATE pixels p
        SET data = p.data || ${JSON.stringify(safePatch)}::jsonb,
            updated_at = ${revision}::timestamptz
        FROM guard
        WHERE p.slug = ${nsKey(accountId, slug)}
          AND p.account_id = ${accountId || null}
          AND COALESCE(p.data->>'updatedAt', '') = ${String(expectedUpdatedAt)}
          AND NOT EXISTS (
            SELECT 1 FROM pixels other
            WHERE other.account_id = ${accountId || null}
              AND other.slug <> ${nsKey(accountId, slug)}
              AND btrim(COALESCE(other.data->>'pixelCode', '')) = ${pixelCode}
          )
        RETURNING p.data, p.updated_at`
      : await sql`UPDATE pixels
          SET data = data || ${JSON.stringify(safePatch)}::jsonb,
              updated_at = ${revision}::timestamptz
          WHERE slug = ${nsKey(accountId, slug)}
            AND account_id = ${accountId || null}
            AND COALESCE(data->>'updatedAt', '') = ${String(expectedUpdatedAt)}
          RETURNING data, updated_at`;
    if (!rows.length) {
      const current = await loadPixel(accountId, slug);
      if (current && String(current.updatedAt || '') === String(expectedUpdatedAt) && pixelCode) {
        return { ok: false, conflict: 'pixel_code', currentUpdatedAt: current.updatedAt, current };
      }
      return { ok: false, conflict: 'revision', currentUpdatedAt: current && current.updatedAt || null, current };
    }
    return { ok: true, data: rows[0].data, updatedAt: revision };
  } catch (err) { return pixelDbError(err, 'updatePixelVersioned'); }
}

async function deletePixelVersioned(accountId, slug, expectedUpdatedAt) {
  if (!enabled || !slug || !expectedUpdatedAt) return { ok: false, conflict: null };
  try {
    const rows = await sql`DELETE FROM pixels
      WHERE slug = ${nsKey(accountId, slug)}
        AND account_id = ${accountId || null}
        AND COALESCE(data->>'updatedAt', '') = ${String(expectedUpdatedAt)}
      RETURNING data`;
    if (!rows.length) {
      const current = await loadPixel(accountId, slug);
      return { ok: false, conflict: 'revision', currentUpdatedAt: current && current.updatedAt || null, current };
    }
    return { ok: true, data: rows[0].data };
  } catch (err) { return pixelDbError(err, 'deletePixelVersioned'); }
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
  if (!enabled || !slug) return !enabled;
  try {
    await sql`INSERT INTO links (slug, account_id, data, updated_at)
      VALUES (${nsKey(accountId, slug)}, ${accountId || null}, ${JSON.stringify(data)}::jsonb, now())
      ON CONFLICT (slug) DO UPDATE SET account_id = EXCLUDED.account_id, data = EXCLUDED.data, updated_at = now()`;
    return true;
  } catch (err) {
    console.error('[db] upsertLink:', err.message);
    return false;
  }
}

async function deleteLink(accountId, slug) {
  if (!enabled || !slug) return !enabled;
  try {
    await sql`DELETE FROM links WHERE slug = ${nsKey(accountId, slug)}`;
    return true;
  } catch (err) {
    console.error('[db] deleteLink:', err.message);
    return false;
  }
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
    await sql`INSERT INTO pixel_events (id, account_id, pixel, event, event_id, lead_id, status, emq, emq_fields, response, at)
      VALUES (${evt.id}, ${accountId || null}, ${evt.pixel || null}, ${evt.event || null}, ${evt.eventId || null},
              ${evt.leadId || null}, ${evt.status || null}, ${evt.emq == null ? null : evt.emq},
              ${JSON.stringify(evt.emqFields || [])}::jsonb,
              ${JSON.stringify(evt.response || {})}::jsonb, ${evt.at || new Date().toISOString()})
      ON CONFLICT (id) DO NOTHING`;
  } catch (err) { console.error('[db] insertPixelEvent:', err.message); }
}

async function loadPixelEvents(accountId, limit) {
  if (!enabled) return null;
  try {
    const rows = accountId
      ? await sql`SELECT id, pixel, event, event_id, lead_id, status, emq, emq_fields, response, at
          FROM pixel_events WHERE account_id = ${accountId} ORDER BY at DESC LIMIT ${limit || 200}`
      : await sql`SELECT id, pixel, event, event_id, lead_id, status, emq, emq_fields, response, at
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
  createAccount,
  getAccountByEmail,
  getAccountById,
  countAccounts,
  listAccountIds,
  listOrphanAdsConfigs,
  getFirstAccountId,
  claimLegacyData,
  ping,
  createAuthSession,
  getAuthSession,
  deleteAuthSession,
  pruneAuthSessions,
  listAuthSessions,
  deleteAuthSessionBySid,
  updateAccountName,
  setAccountTotp,
  anonymizeOldLeads,
  accountDataCounts,
  deleteAccountCascade,
  // gateways
  upsertGateway,
  deleteGateway,
  loadGateways,
  getGatewayByToken,
  touchGateway,
  // dados por conta
  upsertLead,
  readPixelRuntimeCoverage,
  findLeadsByContact,
  insertEvent,
  archiveOldEvents,
  aggregateDaily,
  readDaily,
  insertAudit,
  listAudit,
  insertNotification,
  listNotifications,
  touchAuthSession,
  updateAccountPassword,
  deleteOtherAuthSessions,
  upsertVariant,
  loadState,
  readOverviewPeriod,
  readOverviewHealthFacts,
  reset,
  upsertSession,
  // quarentena de webhooks rejeitados
  insertQuarantine,
  listQuarantine,
  countQuarantine,
  resolveQuarantine,
  pruneQuarantine,
  // dedup durável de receita por pedido (Risco 5)
  markOrderProcessed,
  pruneProcessedOrders,
  saveConfig,
  saveConfigVersioned,
  loadConfig,
  loadAllConfigs,
  pruneSessions,
  createPixel,
  updatePixelVersioned,
  deletePixelVersioned,
  loadPixel,
  loadPixels,
  getPixelByToken,
  upsertLink,
  deleteLink,
  loadLinks,
  insertPixelEvent,
  loadPixelEvents,
  prunePixelEvents,
  // domínios personalizados duráveis + moeda por conta (itens 241–252)
  claimCustomDomain,
  upsertCustomDomain,
  deleteCustomDomain,
  loadCustomDomains,
  setAccountCurrency,
  loadAccountCurrencies,
  migrationStatus: () => Object.assign({}, migrations)
};
