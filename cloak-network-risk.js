'use strict';

// Classificação genérica de infraestrutura de hosting/cloud compartilhada entre
// o motor legado e o V6. Não contém redes escolhidas por pertencerem a
// plataformas de anúncios ou revisores específicos.
const DATACENTER_ASNS = new Set([
  15169, 8075, 16509, 14618, 16276, 24940, 14061, 20473, 63949, 51167,
  31898, 45102, 132203, 37963, 60781, 8100, 62240, 9009, 49505, 50673,
  29802, 53667, 46844, 19318, 55286,
]);

function normalizeAsn(value) {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n > 0 && n <= 4294967295 ? n : 0;
}

function isDatacenterAsn(value) {
  const asn = normalizeAsn(value);
  return asn > 0 && DATACENTER_ASNS.has(asn);
}

module.exports = { DATACENTER_ASNS, normalizeAsn, isDatacenterAsn };
