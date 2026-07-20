'use strict';
/*
 * Parte A — direcionamento na criação: gênero, interesses e posicionamento.
 * O buildCreatePayload (fechado em ads-routes) normaliza os campos novos e o
 * createFullAd os injeta no targeting/ad group do TikTok. buildCreatePayload não
 * é exportado (closure), então validamos por leitura de fonte, no mesmo estilo
 * das outras suítes de rota (ads-automation-cpc, ads-smart-plus).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
function ok(cond, label) { assert.ok(cond, label); n++; console.log('  ✓ ' + label); }

const routes = fs.readFileSync(path.join(__dirname, '..', 'ads-routes.js'), 'utf8');
const provider = fs.readFileSync(path.join(__dirname, '..', 'ads-provider.js'), 'utf8');

console.log('buildCreatePayload — normaliza gênero/interesses/posicionamento');
{
  const body = (routes.match(/function buildCreatePayload[\s\S]*?return \{ payload \};/) || [''])[0];
  ok(/b\.gender === 'male' \|\| b\.gender === 'female'/.test(body), 'gênero: só male/female (all/ausente não segmenta)');
  ok(/interestIds[\s\S]{0,200}\/\^\\d\{1,20\}\$\//.test(body), 'interesses: só IDs numéricos');
  ok(/slice\(0, 20\)/.test(body), 'interesses: cap de 20');
  ok(/PLACEMENT_TIKTOK.*PLACEMENT_PANGLE|ALLOWED = \[/.test(body), 'posicionamento: whitelist de valores');
  ok(/payload\.placements/.test(body) && /payload\.gender/.test(body) && /payload\.interestIds/.test(body), 'os 3 campos entram no payload');
}

console.log('createFullAd — injeta no targeting/ad group do TikTok');
{
  const body = (provider.match(/async function createFullAd[\s\S]*?\n}\n/) || [''])[0];
  ok(/targeting\.gender = 'GENDER_MALE'/.test(body), 'gênero → GENDER_MALE');
  ok(/targeting\.gender = 'GENDER_FEMALE'/.test(body), 'gênero → GENDER_FEMALE');
  ok(/targeting\.interest_category_ids = s\.interestIds/.test(body), 'interesses → interest_category_ids');
  ok(/placement_type = 'PLACEMENT_TYPE_NORMAL'/.test(body), 'posicionamento específico → PLACEMENT_TYPE_NORMAL + placements');
  ok(/placement_type = 'PLACEMENT_TYPE_AUTOMATIC'/.test(body), 'default = automático');
  // retrocompat: campos só entram quando presentes
  ok(/if \(Array\.isArray\(s\.interestIds\) && s\.interestIds\.length\)/.test(body), 'interesses são opcionais (retrocompatível)');
}

console.log('\nads-targeting: ' + n + ' asserts OK');
