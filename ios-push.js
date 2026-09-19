'use strict';

const http2 = require('http2');
const crypto = require('crypto');

let cachedJwt = null;
let cachedJwtAt = 0;

function configured() {
  return Boolean(
    process.env.APNS_TEAM_ID &&
    process.env.APNS_KEY_ID &&
    process.env.APNS_BUNDLE_ID &&
    (process.env.APNS_PRIVATE_KEY || process.env.APNS_PRIVATE_KEY_B64)
  );
}

function base64url(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function privateKey() {
  if (process.env.APNS_PRIVATE_KEY_B64) {
    return Buffer.from(process.env.APNS_PRIVATE_KEY_B64, 'base64').toString('utf8');
  }
  return String(process.env.APNS_PRIVATE_KEY || '').replace(/\\n/g, '\n');
}

function providerToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedJwt && now - cachedJwtAt < 45 * 60) return cachedJwt;

  const header = base64url(JSON.stringify({ alg: 'ES256', kid: process.env.APNS_KEY_ID }));
  const claims = base64url(JSON.stringify({ iss: process.env.APNS_TEAM_ID, iat: now }));
  const unsigned = header + '.' + claims;
  const key = crypto.createPrivateKey(privateKey());
  const signature = crypto.sign('sha256', Buffer.from(unsigned), {
    key,
    dsaEncoding: 'ieee-p1363',
  });
  cachedJwt = unsigned + '.' + base64url(signature);
  cachedJwtAt = now;
  return cachedJwt;
}

function endpoint() {
  return process.env.APNS_SANDBOX === 'true'
    ? 'https://api.sandbox.push.apple.com'
    : 'https://api.push.apple.com';
}

function payloadFor(note) {
  const event = String(note.event || '');
  const saleSound = event === 'sale' || event === 'test';
  const isDailyReport = event === 'daily';
  const interruptionLevel = note.priority === 'critical'
    ? 'time-sensitive'
    : (isDailyReport ? 'passive' : 'active');
  const category = (event === 'sale' || event === 'test')
    ? 'ROI_SALE'
    : (isDailyReport ? 'ROI_DAILY' : (event.startsWith('ads_') ? 'ROI_AUTOMATION' : ''));
  const aps = {
    alert: {
      title: String(note.title || 'ROI-NADOS').slice(0, 120),
      body: String(note.body || '').slice(0, 500),
    },
    'thread-id': isDailyReport ? 'reports' : (event.startsWith('ads_') ? 'automation' : (event || 'general')),
    'interruption-level': interruptionLevel,
  };
  if (category) aps.category = category;
  if (!isDailyReport) aps.sound = saleSound ? 'roi-sale.wav' : 'default';
  if (event === 'sale') aps['content-available'] = 1;
  if (note.badge === true) aps.badge = 1;
  return JSON.stringify({
    aps,
    url: String(note.url || '/dashboard').slice(0, 500),
    event,
  });
}

function sendOne(deviceToken, note) {
  return new Promise((resolve) => {
    if (!configured()) return resolve({ ok: false, status: 0, reason: 'not_configured' });
    const token = String(deviceToken || '').replace(/[^a-f0-9]/gi, '');
    if (!/^[a-f0-9]{64,200}$/i.test(token)) {
      return resolve({ ok: false, status: 0, reason: 'invalid_device_token' });
    }

    let client;
    try {
      client = http2.connect(endpoint());
    } catch (error) {
      return resolve({ ok: false, status: 0, reason: error.message });
    }

    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      try { client.close(); } catch (_) {}
      resolve(result);
    };

    client.once('error', (error) => finish({ ok: false, status: 0, reason: error.message }));

    let jwt;
    try {
      jwt = providerToken();
    } catch (error) {
      return finish({ ok: false, status: 0, reason: 'provider_token: ' + error.message });
    }

    const event = String(note.event || '');
    const ttlSeconds = note.priority === 'critical' ? 24 * 3600 : (event === 'daily' ? 6 * 3600 : 3600);
    const headers = {
      ':method': 'POST',
      ':path': '/3/device/' + token,
      authorization: 'bearer ' + jwt,
      'apns-topic': process.env.APNS_BUNDLE_ID,
      'apns-push-type': 'alert',
      'apns-priority': event === 'daily' ? '5' : '10',
      'apns-expiration': String(Math.floor(Date.now() / 1000) + ttlSeconds),
      'content-type': 'application/json',
    };
    if (note.tag) headers['apns-collapse-id'] = String(note.tag).slice(0, 64);
    const req = client.request(headers);

    let status = 0;
    let body = '';
    req.setEncoding('utf8');
    req.on('response', (headers) => { status = Number(headers[':status']) || 0; });
    req.on('data', (chunk) => { body += chunk; });
    req.on('error', (error) => finish({ ok: false, status, reason: error.message }));
    req.on('end', () => {
      let reason = '';
      try { reason = JSON.parse(body || '{}').reason || ''; } catch (_) {}
      finish({ ok: status === 200, status, reason });
    });
    req.end(payloadFor(note));
  });
}

async function sendToDevices(devices, note) {
  const list = Array.isArray(devices) ? devices : [];
  if (!list.length || !configured()) return { ok: false, delivered: 0, invalidTokens: [] };

  const results = await Promise.all(list.map(async (device) => {
    const result = await sendOne(device.token, note);
    return { device, result };
  }));
  const invalidTokens = results
    .filter(({ result }) => result.status === 410 || result.reason === 'BadDeviceToken' || result.reason === 'Unregistered')
    .map(({ device }) => device.token);
  return {
    ok: results.some(({ result }) => result.ok),
    delivered: results.filter(({ result }) => result.ok).length,
    invalidTokens,
    results,
  };
}

module.exports = { configured, sendOne, sendToDevices, _payloadFor: payloadFor };
