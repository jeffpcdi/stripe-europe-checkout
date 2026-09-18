'use strict';

const crypto = require('crypto');

// Slugs de um único segmento. A lista protege as superfícies públicas do SaaS
// mesmo quando o resolver limpo /:slug estiver no fim do pipeline Express.
const RESERVED = new Set([
  'api', 'dashboard', 'login', 'logout', 'register', 'healthz',
  'go', 'c', 'l', 'px', 't-js', 'px-js', 'assets', 'uploads', 'feed', 'hook',
  'privacidade', 'termos', 'safe', '_safe', '__domain-check', '__dev',
  'manifest-webmanifest', 'sw-js', 'favicon', 'favicon-ico', 'robots-txt', 'sitemap-xml',
]);

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // 31 símbolos, sem 0/o/1/i/l

function normalize(input) {
  return String(input || '')
    .trim()
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function isReserved(input) {
  const slug = normalize(input);
  return !slug || RESERVED.has(slug) || slug.startsWith('__');
}

function validate(input) {
  const raw = String(input || '').trim();
  const slug = normalize(raw);
  if (!slug) return { ok: false, slug: '', code: 'slug_invalid', error: 'Informe um endereço válido.' };
  if (slug.length < 3) return { ok: false, slug, code: 'slug_too_short', error: 'O endereço precisa ter pelo menos 3 caracteres.' };
  if (isReserved(slug)) return { ok: false, slug, code: 'slug_reserved', error: 'Este endereço é reservado pelo sistema. Escolha outro.' };
  return { ok: true, slug };
}

function generate(length = 8) {
  const size = Math.max(6, Math.min(16, Number(length) || 8));
  const bytes = crypto.randomBytes(size);
  let out = '';
  for (let i = 0; i < size; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

// Reserva em memória serializa criações/renomes no processo atual. É deliberadamente
// pequena: a fase atual é single-account/single-replica; a futura etapa multi-tenant
// poderá mover esta invariável para um registro durável único sem mudar os callers.
const reservations = new Set();
function reservationKey(accountId, slug) { return String(accountId || '') + '|' + normalize(slug); }
function reserve(accountId, slug) {
  const key = reservationKey(accountId, slug);
  if (!key.endsWith('|') && !reservations.has(key)) { reservations.add(key); return true; }
  return false;
}
function release(accountId, slug) { reservations.delete(reservationKey(accountId, slug)); }

module.exports = { RESERVED, normalize, validate, isReserved, generate, reserve, release };
