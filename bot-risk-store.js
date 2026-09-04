'use strict';

const crypto = require('crypto');
const redisMod = require('./redis');

const client = redisMod.redis;
const redisOn = () => !!(redisMod.enabled && client);
const HASH_KEY = process.env.BOT_RISK_HASH_KEY || process.env.AUTH_SECRET || 'roi-nados-bot-risk-v1';
const memCounters = new Map();
const memBlocks = new Map();
const memLogs = new Map();

function digest(accountId, value) {
  return crypto.createHmac('sha256', HASH_KEY)
    .update(String(accountId || 'default') + '\0' + String(value || ''))
    .digest('hex');
}

function blockKey(accountId, ipHash) {
  return 'botdeny:' + String(accountId || 'default') + ':' + ipHash;
}

function counterKey(accountId, adHash, ipHash) {
  return 'botrisk:' + String(accountId || 'default') + ':' + adHash + ':' + ipHash;
}

function logKey(accountId) {
  return 'botrisklog:' + String(accountId || 'default');
}

function cleanAdKey(value) {
  return String(value || 'desconhecido').trim().replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 120) || 'desconhecido';
}

async function isBlocked(accountId, ip) {
  if (!ip) return { blocked: false };
  const ipHash = digest(accountId, ip);
  const key = blockKey(accountId, ipHash);
  let row = memBlocks.get(key) || null;
  if (row && row.expiresAt <= Date.now()) { memBlocks.delete(key); row = null; }
  if (redisOn()) {
    try {
      const raw = await client.get(key);
      if (raw) row = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (_) { /* proteção local segue ativa */ }
  }
  return row ? { blocked: true, ipHash, ...row } : { blocked: false, ipHash };
}

async function pushLog(accountId, row) {
  const key = logKey(accountId);
  const list = memLogs.get(key) || [];
  list.unshift(row);
  if (list.length > 200) list.length = 200;
  memLogs.set(key, list);
  if (!redisOn()) return;
  try {
    const pipe = client.pipeline();
    pipe.lpush(key, JSON.stringify(row));
    pipe.ltrim(key, 0, 199);
    pipe.expire(key, 30 * 86400);
    await pipe.exec();
  } catch (_) {}
}

async function recordHighRisk(input) {
  const p = input || {};
  if (!p.accountId || !p.ip) return { count: 0, blocked: false };
  const adKey = cleanAdKey(p.adKey);
  const ipHash = digest(p.accountId, p.ip);
  const adHash = digest(p.accountId, adKey).slice(0, 24);
  const windowSec = Math.max(300, Math.min(86400, Math.round(Number(p.windowMin) || 30) * 60));
  const threshold = Math.max(3, Math.min(100, Math.round(Number(p.threshold) || 8)));
  const ttlSec = Math.max(3600, Math.min(30 * 86400, Math.round(Number(p.ttlHours) || 24) * 3600));
  const cKey = counterKey(p.accountId, adHash, ipHash);
  let count = 0;
  if (redisOn()) {
    try {
      count = Number(await client.incr(cKey)) || 0;
      if (count === 1) await client.expire(cKey, windowSec);
    } catch (_) { count = 0; }
  }
  if (!count) {
    const now = Date.now();
    const current = memCounters.get(cKey);
    if (!current || current.expiresAt <= now) {
      memCounters.set(cKey, { count: 1, expiresAt: now + windowSec * 1000 });
      count = 1;
    } else {
      current.count += 1;
      count = current.count;
    }
  }
  if (count < threshold) return { count, threshold, blocked: false, ipHash, adKey };

  const key = blockKey(p.accountId, ipHash);
  const existing = await isBlocked(p.accountId, p.ip);
  const row = {
    id: ipHash,
    ipHash,
    adKey,
    count,
    score: Math.max(0, Number(p.score) || 0),
    reason: String(p.reason || 'score alto recorrente').slice(0, 120),
    blockedAt: new Date().toISOString(),
    expiresAt: Date.now() + ttlSec * 1000,
  };
  memBlocks.set(key, row);
  if (redisOn()) {
    try { await client.set(key, JSON.stringify(row), { ex: ttlSec }); } catch (_) {}
  }
  if (!existing.blocked) await pushLog(p.accountId, row);
  return { count, threshold, blocked: true, newlyBlocked: !existing.blocked, ipHash, adKey, row };
}

async function listBlocks(accountId, limit) {
  const key = logKey(accountId);
  let rows = memLogs.get(key) || [];
  if (redisOn()) {
    try {
      const raw = await client.lrange(key, 0, Math.max(0, Math.min(200, Number(limit) || 100) - 1));
      const parsed = (raw || []).map((value) => {
        try { return typeof value === 'string' ? JSON.parse(value) : value; } catch (_) { return null; }
      }).filter(Boolean);
      if (parsed.length) rows = parsed;
    } catch (_) {}
  }
  const now = Date.now();
  return rows.slice(0, Math.max(1, Math.min(200, Number(limit) || 100))).map((row) => ({
    ...row,
    active: Number(row.expiresAt) > now,
  }));
}

async function unblock(accountId, ipHash) {
  const clean = String(ipHash || '').replace(/[^a-f0-9]/gi, '').toLowerCase();
  if (clean.length !== 64) return false;
  memBlocks.delete(blockKey(accountId, clean));
  if (!redisOn()) return true;
  try { await client.del(blockKey(accountId, clean)); return true; } catch (_) { return false; }
}

module.exports = { digest, isBlocked, recordHighRisk, listBlocks, unblock, _internals: { cleanAdKey } };
