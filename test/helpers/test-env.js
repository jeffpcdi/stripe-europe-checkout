'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const EXTERNAL_ENV = [
  'DATABASE_URL', 'POSTGRES_URL', 'NEON_DATABASE_URL',
  'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN',
  'KV_REST_API_URL', 'KV_REST_API_TOKEN',
  'UPSTASH_FOR_REDIS_KV_REST_API_URL', 'UPSTASH_FOR_REDIS_KV_REST_API_TOKEN',
  'REDIS_URL', 'PIPEBOARD_API_KEY', 'TIKTOK_ADVERTISER_ID',
  'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
  'ANTHROPIC_API_KEY', 'ZERNIO_API_KEY', 'RESEND_API_KEY',
];

function isolateUnitTest(prefix) {
  if (process.env.ALLOW_EXTERNAL_TEST_SERVICES !== '1') {
    for (const key of EXTERNAL_ENV) delete process.env[key];
  }
  if (!process.env.DATA_DIR) {
    process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), prefix || 'roi-nados-test-'));
  }
  process.env.NODE_ENV = 'test';
  return process.env.DATA_DIR;
}

module.exports = { isolateUnitTest, EXTERNAL_ENV };
