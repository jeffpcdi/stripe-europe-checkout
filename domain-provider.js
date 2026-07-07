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

// Token e IDs vêm só do ambiente. Nomes próprios para não colidir com a CLI
// do Railway (RAILWAY_TOKEN é usado pela CLI e é project-scoped, que NÃO
// autoriza mutations de domínio — por isso exigimos um Workspace/Account token).
const API_TOKEN = process.env.RAILWAY_API_TOKEN || '';
const PROJECT_ID = process.env.RAILWAY_PROJECT_ID || '';
const ENVIRONMENT_ID = process.env.RAILWAY_ENVIRONMENT_ID || '';
const SERVICE_ID = process.env.RAILWAY_SERVICE_ID || '';
const API_URL = 'https://backboard.railway.com/graphql/v2';

// enabled = temos tudo para chamar a API. Sem isso, modo manual.
const enabled = !!(API_TOKEN && PROJECT_ID && ENVIRONMENT_ID && SERVICE_ID);

if (enabled) {
  console.log('[domain-provider] Railway conectado (projeto ' + PROJECT_ID.slice(0, 8) + '…)');
} else if (API_TOKEN) {
  // Token presente mas faltam IDs (Railway injeta esses IDs automaticamente).
  console.log('[domain-provider] token presente, mas faltam RAILWAY_PROJECT_ID/ENVIRONMENT_ID/SERVICE_ID — modo manual');
} else {
  console.log('[domain-provider] RAILWAY_API_TOKEN ausente — modo manual (aponte o CNAME e adicione o domínio na hospedagem)');
}

// Chamada GraphQL crua. Nunca deixa o token vazar: em erro, lança mensagem
// genérica (o corpo da resposta da Railway não inclui o token, mas por higiene
// não repassamos detalhes de transporte que possam conter cabeçalhos).
async function gql(query, variables) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  let r;
  try {
    r = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + API_TOKEN },
      body: JSON.stringify({ query, variables: variables || {} }),
      signal: ctrl.signal
    });
  } catch (_) {
    clearTimeout(t);
    throw new Error('offline'); // sem detalhes de rede
  }
  clearTimeout(t);
  const j = await r.json().catch(() => null);
  if (!j) throw new Error('resposta inválida da hospedagem');
  if (j.errors && j.errors.length) {
    const msg = String(j.errors[0].message || '').toLowerCase();
    if (/not authorized|unauthorized|forbidden/.test(msg)) throw new Error('auth');
    if (/already exists|taken|in use|duplicate/.test(msg)) throw new Error('duplicado');
    if (/limit|maximum|quota/.test(msg)) throw new Error('limite');
    throw new Error('falha na hospedagem'); // genérica — nunca expõe o token
  }
  return j.data;
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

// Registra o domínio na hospedagem. Retorna os registros DNS que o lojista
// precisa criar (CNAME + eventual TXT de verificação) e o id do provedor.
async function register(host) {
  if (!enabled) return { manual: true };
  const data = await gql(
    'mutation($input:CustomDomainCreateInput!){customDomainCreate(input:$input){id status{dnsRecords{recordType hostlabel fqdn requiredValue currentValue purpose status} verificationToken verified}}}',
    { input: { domain: host, projectId: PROJECT_ID, environmentId: ENVIRONMENT_ID, serviceId: SERVICE_ID } }
  );
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
async function status(providerId) {
  if (!enabled || !providerId) return null;
  const data = await gql(
    'query($id:String!){customDomain(id:$id){id status{dnsRecords{recordType hostlabel fqdn requiredValue currentValue purpose status} verificationToken verified certificateStatus}}}',
    { id: providerId }
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

module.exports = { enabled, register, status, remove };
