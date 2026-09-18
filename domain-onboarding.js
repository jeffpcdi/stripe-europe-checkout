'use strict';

const dns = require('dns').promises;

const SECOND_LEVEL_SUFFIXES = new Set([
  'com.br', 'net.br', 'org.br', 'com.ar', 'com.mx', 'com.co', 'co.uk', 'org.uk',
  'com.au', 'net.au', 'co.nz', 'co.jp', 'co.kr', 'com.sg', 'com.tr', 'com.cn',
]);

const PROVIDERS = [
  {
    id: 'cloudflare',
    label: 'Cloudflare',
    patterns: [/\.cloudflare\.com$/i],
    steps: [
      'Abra a zona DNS do domínio na sua conta.',
      'Crie os registros exibidos abaixo exatamente com o nome e o valor informados.',
      'Se o registro CNAME tiver opção de proxy, use o modo somente DNS durante a validação quando indicado.',
      'Salve as alterações e volte ao ROI-NADOS.',
      'Clique em Verificar agora ou aguarde a verificação automática.',
    ],
  },
  {
    id: 'hostinger',
    label: 'Hostinger',
    patterns: [/dns-parking\.com$/i, /hostinger\./i],
    steps: [
      'Abra Domínios e acesse o editor da zona DNS.',
      'Crie os registros exibidos abaixo exatamente com o nome e o valor informados.',
      'Salve as alterações da zona DNS.',
      'Volte ao ROI-NADOS e clique em Verificar agora, ou aguarde a verificação automática.',
    ],
  },
  {
    id: 'registrobr',
    label: 'Registro.br',
    patterns: [/\.dns\.br$/i, /registro\.br$/i],
    steps: [
      'Abra o domínio e entre na configuração de DNS.',
      'Edite a zona DNS somente se o domínio estiver usando o DNS administrado ali.',
      'Adicione os registros exibidos abaixo exatamente como aparecem.',
      'Salve e volte ao ROI-NADOS para acompanhar a validação.',
    ],
  },
  {
    id: 'godaddy',
    label: 'GoDaddy',
    patterns: [/domaincontrol\.com$/i],
    steps: [
      'Abra o gerenciamento de DNS do domínio.',
      'Adicione os registros exibidos abaixo com o tipo, nome e valor informados.',
      'Salve as alterações.',
      'Volte ao ROI-NADOS e acompanhe a verificação automática.',
    ],
  },
  {
    id: 'namecheap',
    label: 'Namecheap',
    patterns: [/registrar-servers\.com$/i],
    steps: [
      'Abra o domínio e acesse Advanced DNS.',
      'Adicione os registros exibidos abaixo com os mesmos nomes e valores.',
      'Salve a zona DNS.',
      'Volte ao ROI-NADOS e acompanhe a validação.',
    ],
  },
];

const UNIVERSAL_GUIDE = {
  id: 'unknown',
  label: 'seu provedor DNS',
  steps: [
    'Abra o local onde o DNS deste domínio é administrado.',
    'Crie os registros exibidos abaixo exatamente com o tipo, nome e valor informados.',
    'Salve as alterações.',
    'Volte ao ROI-NADOS e clique em Verificar agora, ou aguarde a verificação automática.',
  ],
};


function candidateZones(host) {
  const labels = String(host || '').toLowerCase().replace(/\.$/, '').split('.').filter(Boolean);
  if (labels.length < 2) return [];
  const suffix2 = labels.slice(-2).join('.');
  const minimum = SECOND_LEVEL_SUFFIXES.has(suffix2) ? 3 : 2;
  const out = [];
  for (let size = labels.length; size >= minimum; size -= 1) out.push(labels.slice(labels.length - size).join('.'));
  return out;
}

function providerFromNameservers(nameservers) {
  const ns = (Array.isArray(nameservers) ? nameservers : []).map((value) => String(value || '').toLowerCase().replace(/\.$/, '')).filter(Boolean);
  for (const provider of PROVIDERS) {
    if (ns.some((name) => provider.patterns.some((pattern) => pattern.test(name)))) {
      return { provider: provider.id, providerLabel: provider.label, confidence: 'high', steps: provider.steps.slice() };
    }
  }
  return { provider: UNIVERSAL_GUIDE.id, providerLabel: UNIVERSAL_GUIDE.label, confidence: 'low', steps: UNIVERSAL_GUIDE.steps.slice() };
}

async function detectDnsProvider(host, resolver) {
  const api = resolver || dns;
  const zones = candidateZones(host);
  for (const zone of zones) {
    try {
      const nameservers = await api.resolveNs(zone);
      if (!Array.isArray(nameservers) || !nameservers.length) continue;
      const detected = providerFromNameservers(nameservers);
      return {
        ...detected,
        zone,
        nameservers: nameservers.map((value) => String(value || '').replace(/\.$/, '')),
      };
    } catch (_) { /* tenta a zona pai */ }
  }
  return { ...providerFromNameservers([]), zone: null, nameservers: [] };
}

module.exports = {
  candidateZones,
  providerFromNameservers,
  detectDnsProvider,
};
