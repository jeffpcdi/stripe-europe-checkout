'use strict';
// Item 568: `npm run doctor` — diagnóstico local de ambiente com saída amigável.
// NÃO conecta em nada nem faz I/O de rede: apenas inspeciona env vars e o estado
// dos módulos que degradam graciosamente, dizendo em que MODO o app vai subir e
// o que cada ausência desliga. Zero dependências, seguro de rodar a qualquer hora.
//
// Nunca imprime o VALOR de um segredo — só se está presente/ausente.

const path = require('path');
process.chdir(path.join(__dirname, '..'));

// Carrega .env.development.local se existir (mesmo arquivo que o `npm run dev` lê)
try { require('fs').accessSync('.env.development.local'); process.loadEnvFile('.env.development.local'); } catch (_) {}

const C = process.stdout.isTTY
  ? { g: '\x1b[32m', y: '\x1b[33m', r: '\x1b[31m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' }
  : { g: '', y: '', r: '', d: '', b: '', x: '' };

const has = (k) => typeof process.env[k] === 'string' && process.env[k].trim() !== '';
const ok = (m) => console.log(`  ${C.g}OK${C.x}   ${m}`);
const warn = (m) => console.log(`  ${C.y}AVISO${C.x} ${m}`);
const info = (m) => console.log(`  ${C.d}·${C.x}    ${m}`);

let warns = 0;
const w = (m) => { warns++; warn(m); };

console.log(`\n${C.b}ROI-NADOS · diagnóstico de ambiente${C.x}`);
console.log(`${C.d}Node ${process.version} · ${process.env.NODE_ENV || 'development'}${C.x}\n`);

// ── 1. Persistência (Neon) ───────────────────────────────────────────────
console.log(`${C.b}Persistência (Neon/Postgres)${C.x}`);
if (has('DATABASE_URL') || has('POSTGRES_URL')) {
  ok('DATABASE_URL presente — leads, config e sessões persistem entre reinícios.');
} else {
  w('DATABASE_URL ausente — MODO SÓ-MEMÓRIA: dados somem ao reiniciar e o login não persiste. OK para dev, NÃO para produção.');
}

// ── 2. Cache/estado efêmero (Redis) ──────────────────────────────────────
console.log(`\n${C.b}Cache & rate-limit (Redis/Upstash)${C.x}`);
if ((has('KV_REST_API_URL') && has('KV_REST_API_TOKEN')) || (has('UPSTASH_REDIS_REST_URL') && has('UPSTASH_REDIS_REST_TOKEN')) || (has('UPSTASH_FOR_REDIS_KV_REST_API_URL') && has('UPSTASH_FOR_REDIS_KV_REST_API_TOKEN'))) {
  ok('Redis presente — rate-limit e presença "ao vivo" compartilhados entre instâncias.');
} else {
  w('Redis ausente — rate-limit e presença ficam por-processo (funciona, mas não escala horizontalmente).');
}

// ── 3. TikTok CAPI ───────────────────────────────────────────────────────
console.log(`\n${C.b}TikTok Events API (server-side)${C.x}`);
if (has('TIKTOK_ACCESS_TOKEN') && has('TIKTOK_PIXEL_CODE')) {
  ok('Token + pixel padrão configurados via env (contas também podem cadastrar os seus no painel).');
} else {
  info('Sem token/pixel padrão no env — as conversões usam os pixels cadastrados por conta no painel. Normal se cada cliente traz o seu.');
}

// ── 4. Webhooks de gateway ───────────────────────────────────────────────
console.log(`\n${C.b}Webhooks de conversão${C.x}`);
if (has('CONVERSION_WEBHOOK_SECRET')) {
  ok('CONVERSION_WEBHOOK_SECRET presente — webhooks de gateway são verificados por HMAC/segredo.');
} else {
  info('Sem segredo global — cada conta usa seu próprio token de webhook (modelo multi-tenant padrão).');
}

// ── 5. Notificações push ─────────────────────────────────────────────────
console.log(`\n${C.b}Notificações (Pushcut)${C.x}`);
if (has('PUSHCUT_WEBHOOK_URL')) ok('URL padrão do Pushcut no env.');
else info('Sem Pushcut padrão — cada conta configura o seu no painel (opcional).');

// ── 6. Domínios (Railway) ────────────────────────────────────────────────
console.log(`\n${C.b}Domínios personalizados (Railway API)${C.x}`);
if (has('RAILWAY_API_TOKEN') || has('RAILWAY_TOKEN')) {
  ok('Token da Railway presente — adição de domínio personalizado é automática.');
} else {
  info('Sem token da Railway — modo manual: o operador aponta o CNAME e adiciona o domínio na hospedagem.');
}

// ── 7. Sanidade de arquivos ──────────────────────────────────────────────
console.log(`\n${C.b}Arquivos${C.x}`);
const fs = require('fs');
for (const f of ['server.js', 'package.json', 'dashboard/package.json']) {
  if (fs.existsSync(f)) ok(`${f} presente.`);
  else w(`${f} AUSENTE — projeto incompleto.`);
}
const built = fs.existsSync('dashboard/.next');
if (built) ok('dashboard/.next presente — build do painel disponível.');
else info('dashboard/.next ausente — rode `npm run build` antes de `npm start` (em dev o Next serve sozinho).');

// ── Resumo ───────────────────────────────────────────────────────────────
console.log('');
if (warns === 0) {
  console.log(`${C.g}${C.b}Tudo pronto.${C.x} Nenhum aviso — o app sobe em modo completo.\n`);
} else {
  console.log(`${C.y}${C.b}${warns} aviso(s).${C.x} O app AINDA SOBE (degradação graciosa) — veja acima o que cada ausência desliga.\n`);
}
// doctor é informativo: nunca falha o processo (não quebra CI por "modo dev").
process.exit(0);
