// Validação ao vivo do vínculo pixel↔gateway via API autenticada (temporário)
const BASE = 'http://localhost:3000';

// login dev → captura cookie
const login = await fetch(BASE + '/__dev/login', { redirect: 'manual' });
const cookie = (login.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
const H = { Cookie: cookie, 'Content-Type': 'application/json' };

const gws = await (await fetch(BASE + '/api/gateways', { headers: H })).json();
const gwId = gws.gateways[0]?.id;
console.log('[1] gateway existente:', gwId, '(' + gws.gateways[0]?.name + ')');

// cria pixel vinculado
let r = await (await fetch(BASE + '/api/pixels', {
  method: 'POST', headers: H,
  body: JSON.stringify({ slug: 'px-teste-vinculo', name: 'Pixel teste vínculo', pixelCode: 'TESTBIND1', accessToken: 'tok_teste', gatewayIds: [gwId], active: false })
})).json();
console.log('[2] salvo com gatewayIds =', JSON.stringify(r.pixel?.gatewayIds));

// merge-patch sem gatewayIds deve preservar
r = await (await fetch(BASE + '/api/pixels', {
  method: 'POST', headers: H,
  body: JSON.stringify({ slug: 'px-teste-vinculo', active: false })
})).json();
console.log('[3] merge-patch preservou =', JSON.stringify(r.pixel?.gatewayIds));

// id inválido deve ser rejeitado
const bad = await fetch(BASE + '/api/pixels', {
  method: 'POST', headers: H,
  body: JSON.stringify({ slug: 'px-teste-vinculo', gatewayIds: ['gw_naoexiste'], active: false })
});
console.log('[4] id inválido → HTTP', bad.status, JSON.stringify(await bad.json()));

// desvincular (lista vazia) deve funcionar
r = await (await fetch(BASE + '/api/pixels', {
  method: 'POST', headers: H,
  body: JSON.stringify({ slug: 'px-teste-vinculo', gatewayIds: [], active: false })
})).json();
console.log('[5] desvinculado =', JSON.stringify(r.pixel?.gatewayIds));

// limpeza
await fetch(BASE + '/api/pixels/px-teste-vinculo', { method: 'DELETE', headers: H });
console.log('[6] pixel de teste removido — validação concluída');
