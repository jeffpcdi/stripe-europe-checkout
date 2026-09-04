const fs = require('fs');
const lines = fs.readFileSync('dashboard/components/ads/catalog-manager.tsx', 'utf-8').split('\n');

const search = (str) => {
  return lines.findIndex(l => l.includes(str)) + 1;
};

console.log('CatalogManager:', search('export function CatalogManager('));
console.log('BusinessCenterBar:', search('function BusinessCenterBar('));
console.log('CatalogList:', search('function CatalogList('));
console.log('CatalogDetail:', search('function CatalogDetail('));
console.log('TiktokStatusPanel:', search('function TiktokStatusPanel('));
console.log('ProductField:', search('function ProductField('));
console.log('generateSku:', search('function generateSku('));
console.log('formatPriceForFeed:', search('function formatPriceForFeed('));
console.log('stripCurrency:', search('function stripCurrency('));
console.log('ProductEditor:', search('function ProductEditor('));
console.log('PriceField:', search('function PriceField('));
console.log('ImageField:', search('function ImageField('));
