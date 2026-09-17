'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const storePath = require.resolve('../pixel-store');
const dbPath = require.resolve('../db');
const redisPath = require.resolve('../redis');

function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
function freshStore(seed = []) {
  const rows = new Map(seed.map((p) => [p.acc + ':' + p.slug, clone(p)]));
  const db = {
    enabled: true,
    loadPixels: async () => ({ ok: true, data: [...rows.values()].map(clone) }),
    createPixel: async (acc, slug, data) => {
      const key = acc + ':' + slug;
      if (rows.has(key)) return { ok: false, conflict: 'slug' };
      const dup = [...rows.values()].find((p) => p.acc === acc && p.pixelCode === data.pixelCode);
      if (dup) return { ok: false, conflict: 'pixel_code' };
      const next = { ...clone(data), acc, slug };
      rows.set(key, next);
      return { ok: true, data: clone(next), updatedAt: next.updatedAt };
    },
    updatePixelVersioned: async (acc, slug, patch, expected, nextUpdatedAt) => {
      const key = acc + ':' + slug;
      const current = rows.get(key);
      if (!current || current.updatedAt !== expected) {
        return { ok: false, conflict: 'revision', currentUpdatedAt: current && current.updatedAt, current: clone(current) };
      }
      if (patch.pixelCode) {
        const dup = [...rows.values()].find((p) => p.acc === acc && p.slug !== slug && p.pixelCode === patch.pixelCode);
        if (dup) return { ok: false, conflict: 'pixel_code', currentUpdatedAt: current.updatedAt, current: clone(current) };
      }
      const next = { ...current, ...clone(patch), updatedAt: nextUpdatedAt };
      rows.set(key, next);
      return { ok: true, data: clone(next), updatedAt: nextUpdatedAt };
    },
    deletePixelVersioned: async (acc, slug, expected) => {
      const key = acc + ':' + slug;
      const current = rows.get(key);
      if (!current || current.updatedAt !== expected) {
        return { ok: false, conflict: 'revision', currentUpdatedAt: current && current.updatedAt, current: clone(current) };
      }
      rows.delete(key);
      return { ok: true, data: clone(current) };
    },
  };
  const redis = { enabled: false, loadPixelSnapshot: async () => [] };
  delete require.cache[storePath];
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: db };
  require.cache[redisPath] = { id: redisPath, filename: redisPath, loaded: true, exports: redis };
  return { store: require('../pixel-store'), rows };
}

(async () => {
  let env = freshStore();
  await env.store.init();
  const created = await env.store.save('acc-a', {
    name: 'Principal', pixelCode: 'PX-A', accessToken: 'tok-a', gatewayIds: [],
    events: { ViewContent: true, InitiateCheckout: true, AddPaymentInfo: true, CompletePayment: true, AddToCart: true },
  }, { createOnly: true });
  assert.equal(created.gatewayBindingMode, 'explicit');
  assert.ok(created.updatedAt);

  const duplicate = await Promise.allSettled([
    env.store.save('acc-b', { name: 'Mesmo', pixelCode: 'PX-1' }, { createOnly: true }),
    env.store.save('acc-b', { name: 'Mesmo', pixelCode: 'PX-2' }, { createOnly: true }),
  ]);
  assert.equal(duplicate.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(duplicate.filter((r) => r.status === 'rejected').length, 1);
  assert.equal(duplicate.find((r) => r.status === 'rejected').reason.code, 'pixel_create_conflict');

  const base = env.store.get('acc-a', 'principal');
  const edits = await Promise.allSettled([
    env.store.save('acc-a', { slug: base.slug, name: 'A venceu' }, { expectedUpdatedAt: base.updatedAt }),
    env.store.save('acc-a', { slug: base.slug, name: 'B não pode sobrescrever' }, { expectedUpdatedAt: base.updatedAt }),
  ]);
  assert.equal(edits.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(edits.filter((r) => r.status === 'rejected').length, 1);
  assert.equal(edits.find((r) => r.status === 'rejected').reason.code, 'pixel_revision_conflict');
  assert.notEqual(env.store.get('acc-a', base.slug).name, 'B não pode sobrescrever');

  const beforePatch = env.store.get('acc-a', base.slug);
  const paused = await env.store.save('acc-a', { slug: base.slug, active: false }, { expectedUpdatedAt: beforePatch.updatedAt });
  assert.equal(paused.active, false);
  assert.equal(paused.accessToken, 'tok-a');
  assert.equal(paused.events.CompletePayment, true);
  const cleared = await env.store.save('acc-a', { slug: base.slug, accessToken: '' }, { expectedUpdatedAt: paused.updatedAt });
  assert.equal(cleared.accessToken, '');

  await assert.rejects(
    env.store.remove('acc-a', base.slug, { expectedUpdatedAt: paused.updatedAt }),
    (e) => e && e.code === 'pixel_revision_conflict',
  );
  assert.ok(env.store.get('acc-a', base.slug));
  await env.store.remove('acc-a', base.slug, { expectedUpdatedAt: cleared.updatedAt });
  assert.equal(env.store.get('acc-a', base.slug), null);

  const root = path.resolve(__dirname, '..');
  const dbSource = fs.readFileSync(path.join(root, 'db.js'), 'utf8');
  const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'dashboard/components/conversions/conversions-view.tsx'), 'utf8');
  const modal = fs.readFileSync(path.join(root, 'dashboard/components/conversions/link-gateways-modal.tsx'), 'utf8');
  assert.match(dbSource, /pg_advisory_xact_lock/);
  assert.match(dbSource, /COALESCE\(data->>'updatedAt', ''\) = \$\{String\(expectedUpdatedAt\)\}/);
  assert.match(dbSource, /pixels_account_pixel_code_uidx/);
  assert.match(serverSource, /pixel_revision_required/);
  assert.match(ui, /_createOnly: !pixel/);
  assert.match(ui, /_baseUpdatedAt: pixel\?\.updatedAt/);
  assert.match(ui, /clearAccessToken/);
  assert.match(modal, /_baseUpdatedAt: pixel\.updatedAt/);
  assert.equal(fs.existsSync(path.join(root, 'dashboard/components/pixels/pixels-view.tsx')), false, 'UI Pixel antiga deve ser removida');

  delete require.cache[storePath];
  delete require.cache[dbPath];
  delete require.cache[redisPath];
  console.log('pixel-config-contract-v16-15: CREATE/UPDATE/DELETE CAS, patch e UI ativa OK');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
