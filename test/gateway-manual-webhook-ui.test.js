'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const view = fs.readFileSync(
  path.join(__dirname, '..', 'dashboard', 'components', 'gateways', 'gateways-view.tsx'),
  'utf8',
);

assert.ok(!/Conexão Mágica de Receita|handleMagicConnect|Simula a mágica/.test(view),
  'a interface não pode prometer conexão automática inexistente');
assert.ok(/Novo gateway/.test(view) && /setCreating\(true\)/.test(view),
  'o usuário consegue abrir o cadastro manual de gateway');
assert.ok(/\{g\.webhookUrl\}/.test(view),
  'cada gateway exibe sua URL exclusiva de webhook');
assert.ok(/handleCopy\(g\.id, g\.webhookUrl\)/.test(view) && /'Copiar'/.test(view),
  'a URL exclusiva pode ser copiada para colar no painel do provedor');
assert.ok(/apiSend\('\/api\/gateways', 'POST'/.test(view),
  'o cadastro manual continua usando a API real de gateways');
assert.ok(/QueueHealthPanel/.test(view) && /QuarantinePanel/.test(view),
  'o diagnóstico operacional do webhook permanece na tela');

console.log('gateway-manual-webhook-ui.test.js: OK');
