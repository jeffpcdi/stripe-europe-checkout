const fs = require('fs');
let lines = fs.readFileSync('dashboard/components/ads/catalog-detail.tsx', 'utf-8').split('\n');
lines = lines.slice(0, 933);
fs.writeFileSync('dashboard/components/ads/catalog-detail.tsx', lines.join('\n') + '\n');
