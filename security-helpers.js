'use strict';
/*
 * Helpers de segurança compartilhados (extraídos do server.js — item 60 do
 * plano, para permitir teste unitário direto sem subir o servidor).
 *
 * - ipPrivado(ip): true quando o IP é privado/loopback/link-local/CGNAT —
 *   base da proteção anti-SSRF do verify-url (o fetch nunca pode alcançar
 *   rede interna, mesmo que o DNS do host aponte para dentro).
 * - hostSeguro(hostname): resolve o DNS e exige que TODOS os endereços
 *   sejam públicos (bloqueia rebinding parcial: um A público + um privado).
 * - normHost(input)/DOMAIN_RE: normalização e validação de domínio
 *   personalizado (aceita colar URL completa; devolve host minúsculo ou null).
 */
const dnsp = require('dns').promises;

const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

function ipPrivado(ip) {
  if (!ip) return true;
  if (ip.includes(':')) { // IPv6: bloqueia loopback, link-local e ULA
    const low = ip.toLowerCase();
    return low === '::1' || low.startsWith('fe80') || low.startsWith('fc') || low.startsWith('fd') || low.startsWith('::ffff:127.');
  }
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isFinite(n))) return true;
  return p[0] === 10 || p[0] === 127 || p[0] === 0 ||
    (p[0] === 169 && p[1] === 254) ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 168) ||
    (p[0] === 100 && p[1] >= 64 && p[1] <= 127);
}

async function hostSeguro(hostname, lookup) {
  try {
    const doLookup = lookup || ((h) => dnsp.lookup(h, { all: true }));
    const addrs = await doLookup(hostname);
    if (!addrs.length) return false;
    return addrs.every((a) => !ipPrivado(a.address));
  } catch (_) { return false; }
}

function normHost(input) {
  const s = String(input || '').trim().toLowerCase();
  if (!s) return null;
  try {
    const h = new URL(s.includes('://') ? s : 'https://' + s).hostname;
    return DOMAIN_RE.test(h) ? h : null;
  } catch (_) { return null; }
}

module.exports = { ipPrivado, hostSeguro, normHost, DOMAIN_RE };
