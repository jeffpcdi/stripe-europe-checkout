const fs = require('fs');

const lines = fs.readFileSync('dashboard/components/ads/catalog-manager.tsx', 'utf-8').split('\n');

function getRange(start, end) {
  return lines.slice(start - 1, end).join('\n') + '\n';
}

const imports = getRange(1, 30);
const consts = getRange(31, 72);
const catalogStatusMeta = getRange(74, 99);
const catalogManager = getRange(101, 192);
const businessCenterBar = getRange(197, 327);
const catalogList = getRange(330, 560);
const catalogDetail = getRange(563, 1368);
const tiktokStatusPanel = getRange(1372, 1459);
const productField = getRange(1462, 1497);
const generateSku = getRange(1508, 1511);
const formatPriceForFeed = getRange(1513, 1527);
const stripCurrency = getRange(1531, 1534);
const productEditor = getRange(1536, 1674);
const priceField = getRange(1679, 1713);
const imageField = getRange(1719, 1860);

const fixExport = (code) => code.replace(/^function /gm, 'export function ');

const editorContent = `
${imports}
${getRange(37, 70)}
${fixExport(generateSku)}
${fixExport(formatPriceForFeed)}
${fixExport(stripCurrency)}
${fixExport(productEditor)}
${fixExport(productField)}
${fixExport(priceField)}
${fixExport(imageField)}
`;
fs.writeFileSync('dashboard/components/ads/catalog-editor.tsx', editorContent.trim() + '\n');

const listContent = `
${imports}
${consts}
${catalogStatusMeta}
${fixExport(catalogList)}
${fixExport(businessCenterBar)}
`;
fs.writeFileSync('dashboard/components/ads/catalog-list.tsx', listContent.trim() + '\n');

const detailContent = `
${imports}
import { ProductEditor, generateSku } from './catalog-editor'
${consts}
${catalogStatusMeta}
${fixExport(catalogDetail)}
${fixExport(tiktokStatusPanel)}
`;
fs.writeFileSync('dashboard/components/ads/catalog-detail.tsx', detailContent.trim() + '\n');

const managerContent = `
${imports}
import { CatalogList, BusinessCenterBar } from './catalog-list'
import { CatalogDetail } from './catalog-detail'
${catalogManager}
`;
fs.writeFileSync('dashboard/components/ads/catalog-manager.tsx', managerContent.trim() + '\n');

console.log('Files generated successfully.');
