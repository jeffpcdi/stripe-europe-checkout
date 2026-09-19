'use strict'

const fs = require('fs')
const path = require('path')
const assert = require('assert')

const root = path.join(__dirname, '..')
const tree = fs.readFileSync(path.join(root, 'dashboard/components/ads/campaign-tree.tsx'), 'utf8')
const provider = fs.readFileSync(path.join(root, 'ads-provider.js'), 'utf8')
const types = fs.readFileSync(path.join(root, 'dashboard/lib/types.ts'), 'utf8')

assert(tree.includes("useState<'campaign' | 'adgroup' | 'ad'>('campaign')"), 'workspace deve preservar os três níveis operacionais')
assert(tree.includes("'Campanhas', campaigns.length") && tree.includes("'Conjuntos', adGroupCount") && tree.includes("'Anúncios', adCount"), 'seletor deve expor campanhas, conjuntos e anúncios')
assert(tree.includes('selectedEntities') && tree.includes('applyEntityBulkStatus'), 'conjuntos e anúncios devem suportar seleção e status em lote')
assert(tree.includes('entityLabel="conjunto"') && tree.includes('entityLabel="anúncio"'), 'toggles independentes devem identificar o nível correto')
assert(tree.includes('Central do criativo') && tree.includes('setCreativeInspect'), 'anúncio deve abrir central contextual do criativo')
assert(tree.includes('ROI NADOS Control') && tree.includes('Configurar autonomia'), 'workspace deve expor o estado real da automação sem card decorativo')

assert(provider.includes('async function resolveVideoCreativeAssets'), 'provider deve enriquecer assets de vídeo')
assert(provider.includes("'get_tiktok_video_info'"), 'resolver deve usar metadados canônicos do TikTok')
assert(provider.includes('offset += 50'), 'resolver deve agrupar IDs e evitar N+1 por anúncio')
assert(provider.includes("videoAssets.get(ad.videoId)?.coverUrl"), 'árvore deve usar capa resolvida')
assert(!provider.includes("'tiktok:video:' + ad.videoId"), 'árvore não pode voltar a publicar pseudo-URL de vídeo')
assert(!provider.includes("'tiktok:image:' + ad.imageIds[0]"), 'árvore não pode voltar a publicar pseudo-URL de imagem')

assert(types.includes('videoId?: string') && types.includes('imageIds?: string[]'), 'contrato deve preservar IDs canônicos dos assets')

console.log('[OK] TikTok Ads V16.24 — workspace por entidade, operações em lote, central do criativo e preview em lote.')
