'use strict';
const assert = require('assert');
const security = require('../domain-security');

let pass = 0;
function ok(cond, msg) {
  assert.ok(cond, msg);
  pass++;
}

// Redes que uma URL fornecida pelo usuário nunca deve conseguir alcançar.
for (const ip of [
  '127.0.0.1', '10.0.0.10', '172.16.2.3', '192.168.1.10',
  '169.254.169.254', '100.64.0.1', '192.0.2.10', '198.51.100.2',
  '203.0.113.9', '::1', 'fc00::1', 'fe80::1', '2001:db8::1',
]) ok(!security.isPublicIp(ip), 'bloqueia IP privado/reservado: ' + ip);

ok(security.isPublicIp('1.1.1.1'), 'aceita IPv4 público');
ok(security.isPublicIp('8.8.8.8'), 'aceita outro IPv4 público');
ok(security.isPublicIp('2606:4700:4700::1111'), 'aceita IPv6 global público');

// Prova do app é vinculada simultaneamente ao host e à conta.
const beforeNodeEnv = process.env.NODE_ENV;
const beforeSecret = process.env.DOMAIN_PROOF_SECRET;
const beforePrevious = process.env.DOMAIN_PROOF_SECRET_PREVIOUS;
process.env.NODE_ENV = 'test';
process.env.DOMAIN_PROOF_SECRET = 'domain-proof-test-secret-abcdefghijklmnopqrstuvwxyz';
const proof = security.domainProof('checkout.example.com', 'acct-a');
ok(security.verifyDomainProof('checkout.example.com', 'acct-a', proof), 'prova válida para host+conta corretos');
ok(!security.verifyDomainProof('other.example.com', 'acct-a', proof), 'prova não reutiliza em outro host');
ok(!security.verifyDomainProof('checkout.example.com', 'acct-b', proof), 'prova não reutiliza em outra conta');
// Rolling deploy: uma instância nova aceita por pouco tempo a prova emitida pela chave anterior.
process.env.DOMAIN_PROOF_SECRET_PREVIOUS = process.env.DOMAIN_PROOF_SECRET;
process.env.DOMAIN_PROOF_SECRET = 'domain-proof-new-secret-abcdefghijklmnopqrstuvwxyz';
ok(security.verifyDomainProof('checkout.example.com', 'acct-a', proof), 'rotação aceita DOMAIN_PROOF_SECRET_PREVIOUS');

// Produção deve falhar cedo sem secret dedicado.
process.env.NODE_ENV = 'production';
delete process.env.DOMAIN_PROOF_SECRET;
let threw = false;
try { security.assertProductionConfig(); } catch (err) { threw = err && err.code === 'missing_domain_proof_secret'; }
ok(threw, 'produção recusa iniciar sem DOMAIN_PROOF_SECRET');

if (beforeNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = beforeNodeEnv;
if (beforeSecret === undefined) delete process.env.DOMAIN_PROOF_SECRET; else process.env.DOMAIN_PROOF_SECRET = beforeSecret;
if (beforePrevious === undefined) delete process.env.DOMAIN_PROOF_SECRET_PREVIOUS; else process.env.DOMAIN_PROOF_SECRET_PREVIOUS = beforePrevious;

console.log('\n[domain-security] ' + pass + ' asserts OK');
