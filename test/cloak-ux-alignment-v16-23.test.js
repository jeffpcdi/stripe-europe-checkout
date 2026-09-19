'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const view = read('dashboard/components/cloak/cloak-view.tsx');
assert.match(view, /usePersistedState<CloakTab>\('cloak:tab', 'traffic'\)/);
assert.match(view, />Campanhas<\/Tabs\.Trigger>/);
assert.match(view, />Resultados<\/Tabs\.Trigger>/);
assert.match(view, />Proteção<\/Tabs\.Trigger>/);
assert.match(view, /<h1[^>]*>Cloaker<\/h1>/);

const list = read('dashboard/components/cloak/cloak-entries-panel.tsx');
assert.match(list, /function campaignKeyFor\(e: CloakEntry\)/);
assert.match(list, /return id \? `campaign:\$\{id\}` : `legacy:\$\{e\.slug\}`/);
assert.doesNotMatch(list, /statBySlug/);
assert.doesNotMatch(list, /selected\.has\(e\.slug\)/);
assert.doesNotMatch(list, /testing === e\.slug/);
assert.doesNotMatch(list, /link\.tipo === 'cloak' \? '\/c'/);
assert.match(list, /Usar no anúncio/);
assert.match(list, /<CloakLinkKitDialog campaign=\{publishing\}/);
assert.match(list, /Nova campanha/);

const editor = read('dashboard/components/cloak/cloak-entry-editor.tsx');
assert.match(editor, /aria-label=\{entry \? 'Editar campanha' : 'Nova campanha'\}/);
assert.match(editor, />Nome da campanha<\/label>/);
assert.match(editor, />Endereço público<\/label>/);
assert.match(editor, /Proteção e segmentação/);
assert.match(editor, /Criar campanha/);
assert.doesNotMatch(editor, /<option value="custom">Personalizada<\/option>/);
assert.match(editor, /d\.uso === 'cloaker' \|\| \(entry && d\.host === entry\.dominio\)/);

assert.match(editor, /const durableCampaign = !entry \|\| Boolean\(entry\.id \|\| entry\.campaignId\)/);
assert.match(editor, /const endpoint = durableCampaign \? '\/api\/cloak\/campaigns' : '\/api\/cloak\/entries'/);

const kit = read('dashboard/components/cloak/cloak-link-kit-dialog.tsx');
assert.match(kit, /URL do site/);
assert.match(kit, /Parâmetros da URL/);
assert.match(kit, /Use no campo de URL do anúncio/);
assert.match(kit, /Cole os parâmetros no campo de parâmetros da URL/);

const stats = read('dashboard/components/cloak/cloak-stats-panel.tsx');
assert.match(stats, /filter\(\(link\) => link\.tipo === 'cloak'\)/);
assert.match(stats, /campaign:\$\{link\.campaignId\}/);
assert.match(stats, /Resultados das campanhas/);
assert.match(stats, /Regras da campanha/);
assert.match(stats, /Risco técnico/);
assert.match(stats, /Enviados ao seguro/);
assert.doesNotMatch(stats, /link\.tipo === 'cloak' \? '\/c'/);
assert.match(stats, /Os links de checkout não serão afetados/);

const config = read('dashboard/components/cloak/cloak-config-panel.tsx');
assert.match(config, /Proteção da conta/);
assert.match(config, /Compatibilidade com o motor legado/);
assert.match(config, /Modo global de observação/);
assert.match(config, /Sensibilidade padrão \/ legado/);

console.log('cloak-ux-alignment-v16-23: campaign-first UX e identidade por campaignId OK');
