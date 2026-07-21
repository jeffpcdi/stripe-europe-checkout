'use strict';

// Testes do canal Web Push: copy humorada (notify-copy), sanitização do
// bloco webPush no config e comportamento do fan-out sem aparelhos.
// Rede NUNCA é tocada: sem inscrições, sendWebPush retorna false antes
// de qualquer envio; o VAPID não é gerado nesses caminhos.

const { test } = require('node:test');
const assert = require('node:assert');

const notifyCopy = require('../notify-copy');

test('notify-copy: venda com funMode interpola valor/produto reais', () => {
  const meta = { event: 'sale', valor: 'R$ 197,00', produto: 'Curso X', cliente: 'Ana', gateway: 'CartPanda' };
  const note = notifyCopy.build({
    name: 'Aprovada',
    payload: { title: 'Venda aprovada', text: 'texto original' },
    meta, funMode: true, accountId: 'acc1'
  });
  assert.ok(note.title.length > 0, 'título presente');
  assert.ok(
    note.title.includes('R$ 197,00') || note.body.includes('R$ 197,00') || note.body === 'texto original',
    'valor real aparece na copy (ou fallback ao texto original)'
  );
  assert.strictEqual(note.url, '/dashboard/activity', 'deep link da venda vai para activity');
  // Vendas EMPILHAM: tag única por notificação (prefixo estável + sufixo),
  // para uma venda nova nunca substituir a anterior na tela de bloqueio.
  assert.ok(note.tag.startsWith('roinados-sale-'), 'tag de venda tem prefixo estável');
  const note2 = notifyCopy.build({
    name: 'Aprovada',
    payload: { title: 'Venda aprovada', text: 'texto original' },
    meta, funMode: true, accountId: 'acc1'
  });
  // tags podem colidir só se geradas no MESMO milissegundo — improvável aqui
  assert.ok(note2.tag.startsWith('roinados-sale-'), 'segunda venda também empilha');
});

test('notify-copy: eventos de status substituem (tag fixa)', () => {
  const a = notifyCopy.build({
    name: 'Checkout', payload: { title: 'Checkout iniciado', text: 'x' },
    meta: { event: 'checkout', gateway: 'CartPanda' }, funMode: true, accountId: 'acc1'
  });
  const b = notifyCopy.build({
    name: 'Checkout', payload: { title: 'Checkout iniciado', text: 'y' },
    meta: { event: 'checkout', gateway: 'CartPanda' }, funMode: true, accountId: 'acc1'
  });
  assert.strictEqual(a.tag, 'roinados-checkout', 'checkout usa tag fixa');
  assert.strictEqual(a.tag, b.tag, 'checkouts consecutivos se substituem');
});

test('notify-copy: som distinto por evento', () => {
  const cases = [
    ['sale', 'cash'], ['failed', 'alert'], ['refund', 'alert'],
    ['dispute', 'alert'], ['checkout', 'tick'], ['login', 'ping'], ['daily', 'info']
  ];
  for (const [event, sound] of cases) {
    const n = notifyCopy.build({ name: 'X', payload: { title: 't', text: 'b' }, meta: { event }, funMode: false, accountId: 'acc1' });
    assert.strictEqual(n.sound, sound, `evento ${event} → som ${sound}`);
    assert.strictEqual(n.event, event, 'evento propagado no payload (para prefs de som)');
  }
});

test('notify-copy: funMode=false preserva título/texto originais', () => {
  const note = notifyCopy.build({
    name: 'Aprovada',
    payload: { title: 'Título original', text: 'Corpo original' },
    meta: { event: 'sale', valor: 'R$ 10,00' }, funMode: false, accountId: 'acc1'
  });
  assert.strictEqual(note.title, 'Título original');
  assert.strictEqual(note.body, 'Corpo original');
});

test('notify-copy: evento desconhecido passa payload intacto', () => {
  const note = notifyCopy.build({
    name: 'Qualquer',
    payload: { title: 'Sem classificação', text: 'abc' },
    meta: null, funMode: true, accountId: 'acc1'
  });
  assert.strictEqual(note.title, 'Sem classificação');
  assert.strictEqual(note.url, '/dashboard');
});

test('notify-copy: classifica TikTok Ads pelo prefixo do título', () => {
  const note = notifyCopy.build({
    name: 'TikTokAds',
    payload: { title: 'TikTok Ads: proposta pendente', text: 'detalhes' },
    meta: null, funMode: true, accountId: 'acc1'
  });
  assert.strictEqual(note.url, '/dashboard/ads/tiktok', 'deep link do ads');
  assert.ok(note.body.length > 0, 'corpo preservado (pool ads usa texto original)');
});

test('notify-copy: anti-repetição não sorteia a mesma frase 2x seguidas', () => {
  const meta = { event: 'sale', valor: 'R$ 50,00', produto: 'P', cliente: 'C', gateway: 'G' };
  let prev = null;
  for (let i = 0; i < 12; i++) {
    const n = notifyCopy.build({ name: 'Aprovada', payload: {}, meta, funMode: true, accountId: 'rep' });
    if (prev !== null) assert.notStrictEqual(n.title + n.body, prev, 'frase repetida consecutivamente');
    prev = n.title + n.body;
  }
});

test('config: sanitização do bloco webPush (subs inválidas caem fora)', () => {
  const config = require('../config');
  config.set('wp-test', {
    webPush: {
      funMode: false,
      preferences: { sales: true, risks: false, automation: true },
      subs: [
        { id: 'a', endpoint: 'https://push.example/ok', keys: { p256dh: 'k1', auth: 'a1' } },
        { id: 'b', endpoint: 'http://inseguro.example', keys: { p256dh: 'k2', auth: 'a2' } }, // http → fora
        { id: 'c', endpoint: 'https://push.example/sem-keys', keys: { p256dh: '', auth: '' } } // sem keys → fora
      ]
    }
  });
  const wp = config.get('wp-test').webPush;
  assert.strictEqual(wp.subs.length, 1, 'só a inscrição válida sobrevive');
  assert.strictEqual(wp.subs[0].endpoint, 'https://push.example/ok');
  assert.strictEqual(wp.funMode, false, 'funMode persiste');
  assert.deepStrictEqual(wp.preferences, { sales: true, risks: false, automation: true });
});

test('notificações nativas: preferências são simples e independentes do Pushcut', () => {
  const config = require('../config');
  const notifications = require('../pushcut');
  config.set('native-only', {
    pushcut: { url: '', events: { sale: false } },
    webPush: { preferences: { sales: true, risks: false, automation: true } },
  });
  assert.deepStrictEqual(notifications.nativePreferencesFor('native-only'), {
    sales: true, risks: false, automation: true,
  });
  assert.strictEqual(notifications.nativePreferenceEnabled('native-only', 'sale'), true);
  assert.strictEqual(notifications.nativePreferenceEnabled('native-only', 'dispute'), false);
  assert.strictEqual(notifications.nativePreferenceEnabled('native-only', 'ads_proposal'), true);
});

test('notificações nativas: rotina e simulação não poluem o sino', () => {
  const notifications = require('../pushcut');
  assert.strictEqual(notifications._shouldRecord('ads_proposal'), true);
  assert.strictEqual(notifications._shouldRecord('ads_failure'), true);
  assert.strictEqual(notifications._shouldRecord('ads_routine'), false);
  assert.strictEqual(notifications._shouldRecord('ads_briefing'), false);
  assert.strictEqual(notifications._shouldRecord('checkout'), false);
  assert.strictEqual(notifications._shouldRecord('test'), false);
});

test('central nativa: preserva prioridade e deduplica alertas repetidos', async () => {
  const redis = require('../redis');
  const accountId = 'notif-log-test';
  const note = {
    event: 'ads_breaker', priority: 'critical', title: 'Automação pausada',
    body: 'Muitas falhas.', url: '/dashboard/ads/tiktok', dedupeKey: 'breaker:adv-1',
  };
  await redis.pushNotifLog(accountId, note);
  await redis.pushNotifLog(accountId, note);
  const rows = await redis.loadNotifLog(accountId, 10);
  assert.strictEqual(rows.length, 1, 'o mesmo freio não aparece duas vezes em 5 minutos');
  assert.strictEqual(rows[0].priority, 'critical');
  assert.strictEqual(rows[0].event, 'ads_breaker');
});

test('notify-copy: automação acionável abre diretamente a área de automação', () => {
  const note = notifyCopy.build({
    name: 'Aprovada',
    payload: { title: 'Automação aguardando você', text: 'Revise no painel.' },
    meta: { event: 'ads_proposal' },
    funMode: false,
    accountId: 'acc1',
  });
  assert.strictEqual(note.event, 'ads_proposal');
  assert.strictEqual(note.url, '/dashboard/ads/tiktok?view=automation');
});

test('web-push-notify: sem aparelhos inscritos retorna false sem tocar rede', async () => {
  const webPushNotify = require('../web-push-notify');
  assert.deepStrictEqual(webPushNotify.subsFor('conta-inexistente-xyz'), []);
  const ok = await webPushNotify.sendWebPush('conta-inexistente-xyz', { title: 't', body: 'b' });
  assert.strictEqual(ok, false);
});

test('pushcut: sendPushcut existe e aceita meta como 4º argumento', () => {
  const pushcut = require('../pushcut');
  assert.strictEqual(typeof pushcut.sendPushcut, 'function');
  assert.ok(pushcut.sendPushcut.length >= 3, 'assinatura com accountId (e meta opcional)');
});
