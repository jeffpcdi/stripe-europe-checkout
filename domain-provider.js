// ── Domain Provider — automação de domínios personalizados na hospedagem ────
// Encapsula o provedor de hospedagem (hoje Railway) para registrar/consultar/
// remover Custom Domains via API. O resto do app fala só com esta interface
// (enabled/register/status/remove), então trocar de provedor (ex.: Cloudflare
// for SaaS) é mexer só neste arquivo.
//
// SEGURANÇA DO TOKEN (requisito do CLAUDE.md):
//   - O RAILWAY_API_TOKEN é lido EXCLUSIVAMENTE aqui, de process.env.
//   - NUNCA é logado, retornado em resposta de API, escrito em view/HTML nem
//     embutido em mensagem de erro mostrada ao lojista. Erros de API são
//     reescritos para mensagens genéricas antes de sair deste módulo.
//
// DEGRADAÇÃO GRACIOSA (padrão db/redis do projeto):
//   - Sem token/IDs, o módulo NÃO lança no boot: fica enabled=false e o app
//     continua no modo "manual" anterior (o lojista aponta o CNAME e adiciona
//     o domínio na hospedagem na mão). Nada quebra o POST /api/domains.

// Token e IDs vêm só do ambiente. Aceitamos QUALQUER tipo de token do Railway:
//   - Account/Workspace/OAuth token → header "Authorization: Bearer".
//   - Project token (criado em Project Settings → Tokens) → header
//     "Project-Access-Token" (a doc do Railway exige esse header p/ project token).
// Como não dá pra saber o tipo pela string, detectamos o header certo na 1ª
// chamada (tenta Bearer; se der erro de auth, tenta Project-Access-Token) e
// guardamos qual funcionou. Fallback do nome: RAILWAY_API_TOKEN, senão RAILWAY_TOKEN.
const API_TOKEN = process.env.RAILWAY_API_TOKEN || process.env.RAILWAY_TOKEN || '';
const PROJECT_ID = process.env.RAILWAY_PROJECT_ID || '';
const ENVIRONMENT_ID = process.env.RAILWAY_ENVIRONMENT_ID || '';
const SERVICE_ID = process.env.RAILWAY_SERVICE_ID || '';
const API_URL = 'https://backboard.railway.com/graphql/v2';

// enabled = temos tudo para chamar a API. Sem isso, modo manual.
const enabled = !!(API_TOKEN && PROJECT_ID && ENVIRONMENT_ID && SERVICE_ID);

if (enabled) {
  console.log('[domain-provider] Railway habilitado (projeto ' + PROJECT_ID.slice(0, 8) + '…) — detectando tipo de token…');
} else if (API_TOKEN) {
  // Token presente mas faltam IDs (Railway injeta esses IDs automaticamente).
  console.log('[domain-provider] token presente, mas faltam RAILWAY_PROJECT_ID/ENVIRONMENT_ID/SERVICE_ID — modo manual');
} else {
  console.log('[domain-provider] RAILWAY_API_TOKEN ausente — modo manual (aponte o CNAME e adicione o domínio na hospedagem)');
}

// Esquema de auth já descoberto ('bearer' | 'project'), ou null = ainda não sei.
let authScheme = null;

// Monta os headers conforme o esquema. O token nunca é logado.
function headersFor(scheme) {
  const h = { 'Content-Type': 'application/json' };
  if (scheme === 'project') h['Project-Access-Token'] = API_TOKEN;
  else h['Authorization'] = 'Bearer ' + API_TOKEN;
  return h;
}

// POST cru para a API, com timeout. Retorna o JSON (ou lança 'offline').
async function rawFetch(scheme, query, variables) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  let r;
  try {
    r = await fetch(API_URL, {
      method: 'POST',
      headers: headersFor(scheme),
      body: JSON.stringify({ query, variables: variables || {} }),
      signal: ctrl.signal
    });
  } catch (_) {
    clearTimeout(t);
    throw new Error('offline'); // sem detalhes de rede
  }
  clearTimeout(t);
  return r.json().catch(() => null);
}

// Detecta erro de autorização na resposta GraphQL.
function isAuthError(j) {
  return !!(j && j.errors && j.errors.length &&
    /not authorized|unauthorized|forbidden|access denied|invalid token/i.test(String(j.errors[0].message || '')));
}

// Traduz a resposta em data ou erro genérico (nunca expõe token/transporte).
function interpret(j) {
  if (!j) throw new Error('resposta inválida da hospedagem');
  if (j.errors && j.errors.length) {
    const msg = String(j.errors[0].message || '').toLowerCase();
    if (/not authorized|unauthorized|forbidden|access denied|invalid token/.test(msg)) throw new Error('auth');
    if (/already exists|taken|in use|duplicate/.test(msg)) throw new Error('duplicado');
    if (/limit|maximum|quota/.test(msg)) throw new Error('limite');
    throw new Error('falha na hospedagem'); // genérica — nunca expõe o token
  }
  return j.data;
}

// Chamada GraphQL com auto-detecção do header. Se o esquema já é conhecido,
// usa direto; senão tenta Bearer e, em erro de auth, tenta Project-Access-Token
// (erro de auth = nada foi criado, então repetir a mutation é seguro).
async function gql(query, variables) {
  if (authScheme) return interpret(await rawFetch(authScheme, query, variables));

  const jb = await rawFetch('bearer', query, variables);
  if (jb && !isAuthError(jb)) { authScheme = 'bearer'; return interpret(jb); }

  const jp = await rawFetch('project', query, variables);
  if (jp && !isAuthError(jp)) { authScheme = 'project'; return interpret(jp); }

  // Ambos os headers deram erro de auth → token inválido para esta operação.
  throw new Error('auth');
}

// Extrai só o registro CNAME que interessa ao lojista (host → alvo).
function pickCname(dnsRecords) {
  const list = Array.isArray(dnsRecords) ? dnsRecords : [];
  const cname = list.find((d) => String(d.recordType || '').toUpperCase() === 'CNAME') || list[0] || null;
  const txt = list.find((d) => String(d.recordType || '').toUpperCase() === 'TXT') || null;
  return {
    cname: cname ? { host: cname.fqdn || cname.hostlabel || '', target: cname.requiredValue || '' } : null,
    txt: txt ? { host: txt.fqdn || txt.hostlabel || '', value: txt.requiredValue || '' } : null
  };
}

// Lista os custom domains do serviço e acha um pelo nome (case-insensitive).
// Serve para "adotar" um domínio que já existe no Railway — evita ficar preso
// em 'duplicado' quando uma tentativa anterior já o criou (mas o app não
// guardou o providerId). Retorna o mesmo shape de register(), ou null.
async function findByDomain(host) {
  if (!enabled) return null;
  const data = await gql(
    'query($p:String!,$e:String!,$s:String!){domains(projectId:$p,environmentId:$e,serviceId:$s){customDomains{id domain status{dnsRecords{recordType hostlabel fqdn requiredValue currentValue purpose status} verificationToken verified certificateStatus}}}}',
    { p: PROJECT_ID, e: ENVIRONMENT_ID, s: SERVICE_ID }
  );
  const list = (data && data.domains && data.domains.customDomains) || [];
  const want = String(host || '').toLowerCase();
  const cd = list.find((d) => String(d.domain || '').toLowerCase() === want);
  if (!cd) return null;
  return {
    manual: false,
    providerId: cd.id || null,
    verified: !!(cd.status && cd.status.verified),
    verificationToken: (cd.status && cd.status.verificationToken) || null,
    dns: pickCname(cd.status && cd.status.dnsRecords)
  };
}

// Registra o domínio na hospedagem. Retorna os registros DNS que o lojista
// precisa criar (CNAME + eventual TXT de verificação) e o id do provedor.
// Se o domínio JÁ existe no Railway ('duplicado'), adota o existente em vez de
// falhar — assim o lojista recebe o alvo real do Railway (não o fallback manual).
async function register(host) {
  if (!enabled) return { manual: true };
  let data;
  try {
    data = await gql(
      'mutation($input:CustomDomainCreateInput!){customDomainCreate(input:$input){id status{dnsRecords{recordType hostlabel fqdn requiredValue currentValue purpose status} verificationToken verified}}}',
      { input: { domain: host, projectId: PROJECT_ID, environmentId: ENVIRONMENT_ID, serviceId: SERVICE_ID } }
    );
  } catch (e) {
    if (e.message === 'duplicado') {
      const existing = await findByDomain(host); // pode lançar; propaga se falhar
      if (existing && existing.providerId) return existing;
    }
    throw e;
  }
  const cd = data && data.customDomainCreate;
  if (!cd) throw new Error('falha na hospedagem');
  const rec = pickCname(cd.status && cd.status.dnsRecords);
  return {
    manual: false,
    providerId: cd.id || null,
    verified: !!(cd.status && cd.status.verified),
    verificationToken: (cd.status && cd.status.verificationToken) || null,
    dns: rec
  };
}

// Consulta status/registros de um domínio já registrado (por id do provedor).
// A query customDomain exige id E projectId (ambos obrigatórios no schema).
async function status(providerId) {
  if (!enabled || !providerId) return null;
  const data = await gql(
    'query($id:String!,$projectId:String!){customDomain(id:$id,projectId:$projectId){id status{dnsRecords{recordType hostlabel fqdn requiredValue currentValue purpose status} verificationToken verified certificateStatus}}}',
    { id: providerId, projectId: PROJECT_ID }
  );
  const cd = data && data.customDomain;
  if (!cd) return null;
  return {
    verified: !!(cd.status && cd.status.verified),
    certificateStatus: (cd.status && cd.status.certificateStatus) || null,
    dns: pickCname(cd.status && cd.status.dnsRecords)
  };
}

// Remove o domínio da hospedagem (evita acumular contra o teto do provedor).
async function remove(providerId) {
  if (!enabled || !providerId) return { ok: false, skipped: true };
  await gql('mutation($id:String!){customDomainDelete(id:$id)}', { id: providerId });
  return { ok: true };
}

// Autoteste não-bloqueante no boot: descobre qual header autentica e loga um
// sinal claro nos logs do Railway (sem precisar cadastrar um domínio de teste).
// Sondas específicas: project(id) autentica account/workspace; projectToken
// autentica project token. Nunca loga o token.
async function selfTest() {
  if (!enabled) return;
  try {
    const jb = await rawFetch('bearer', 'query($id:String!){project(id:$id){id}}', { id: PROJECT_ID });
    if (jb && jb.data && jb.data.project) {
      authScheme = 'bearer';
      console.log('[domain-provider] Railway conectado — token account/workspace válido (registro automático ATIVO).');
      return;
    }
    const jp = await rawFetch('project', 'query{projectToken{projectId environmentId}}');
    if (jp && jp.data && jp.data.projectToken) {
      authScheme = 'project';
      console.log('[domain-provider] Railway conectado — project token válido (registro automático ATIVO).');
      return;
    }
    console.warn('[domain-provider] token presente mas NÃO autenticou (nem account/workspace nem project). ' +
      'Crie um token em Account Settings → Tokens e defina RAILWAY_API_TOKEN. Seguindo em modo manual.');
  } catch (_) {
    // Rede indisponível no boot não é fatal: a detecção acontece no 1º domínio.
    console.warn('[domain-provider] não foi possível validar o token no boot (rede) — tentará de novo no 1º domínio.');
  }
}

// Dispara sem bloquear o boot do servidor.
if (enabled) { selfTest(); }

module.exports = { enabled, register, status, remove };
