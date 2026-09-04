const fs = require('fs');

const source = fs.readFileSync('dashboard/components/ads/catalog-manager.tsx', 'utf-8');

function getComponentStr(fnName) {
  const lines = source.split('\n');
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith(`function ${fnName}(`) || lines[i].startsWith(`export function ${fnName}(`)) {
      start = i;
      break;
    }
  }
  if (start === -1) return '';
  
  // Also include comment lines right above it
  while (start > 0 && lines[start - 1].trim().startsWith('//')) {
    start--;
  }

  // Find the end by counting braces line by line
  let end = -1;
  let open = 0;
  let started = false;
  for (let i = start; i < lines.length; i++) {
    const l = lines[i];
    for (let j = 0; j < l.length; j++) {
      if (l[j] === '{') {
        open++;
        started = true;
      } else if (l[j] === '}') {
        open--;
      }
    }
    if (started && open === 0) {
      end = i;
      break;
    }
  }
  
  const comp = lines.slice(start, end + 1).join('\n');
  return comp.replace(/^function /m, 'export function ');
}

function getConstStr(constName) {
  const lines = source.split('\n');
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith(`const ${constName}`)) {
      start = i;
      break;
    }
  }
  if (start === -1) return '';
  
  // Find the end by counting brackets/braces line by line
  let end = -1;
  let open = 0;
  let started = false;
  for (let i = start; i < lines.length; i++) {
    const l = lines[i];
    for (let j = 0; j < l.length; j++) {
      if (l[j] === '{' || l[j] === '[') {
        open++;
        started = true;
      } else if (l[j] === '}' || l[j] === ']') {
        open--;
      }
    }
    if (started && open === 0) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end + 1).join('\n');
}

const imports = source.split('\n').slice(0, 30).join('\n');

const editorContent = `
${imports}

${getConstStr('FIELD_LABELS')}
${getConstStr('FIELD_PLACEHOLDERS')}

${getComponentStr('generateSku')}
${getComponentStr('formatPriceForFeed')}
${getComponentStr('stripCurrency')}
${getComponentStr('ProductEditor')}
${getComponentStr('ProductField')}
${getComponentStr('PriceField')}
${getComponentStr('ImageField')}
`;
fs.writeFileSync('dashboard/components/ads/catalog-editor.tsx', editorContent.trim() + '\n');

const listContent = `
${imports}

type CatalogSpec = AdsCatalogSpecResponse
${getConstStr('CURRENCIES')}
${getComponentStr('catalogStatusMeta')}
${getComponentStr('CatalogList')}
${getComponentStr('BusinessCenterBar')}
`;
fs.writeFileSync('dashboard/components/ads/catalog-list.tsx', listContent.trim() + '\n');

const detailContent = `
${imports}
import { ProductEditor, generateSku, formatPriceForFeed } from './catalog-editor'

type CatalogSpec = AdsCatalogSpecResponse
${getConstStr('CURRENCIES')}
${getConstStr('PRIMARY_COLS')}
${getConstStr('FIELD_LABELS')}
${getComponentStr('catalogStatusMeta')}
${getComponentStr('CatalogDetail')}
${getComponentStr('TiktokStatusPanel')}
`;
fs.writeFileSync('dashboard/components/ads/catalog-detail.tsx', detailContent.trim() + '\n');

const managerContent = `
${imports}
import { CatalogList, BusinessCenterBar } from './catalog-list'
import { CatalogDetail } from './catalog-detail'

${getComponentStr('CatalogManager')}
`;
fs.writeFileSync('dashboard/components/ads/catalog-manager.tsx', managerContent.trim() + '\n');

console.log('Done splitting!');
