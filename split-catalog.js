const fs = require('fs');
const source = fs.readFileSync('dashboard/components/ads/catalog-manager.tsx', 'utf-8');

const importsBlock = `
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  X, Loader2, Plus, Trash2, UploadCloud, Download,
  Copy, Check, AlertCircle, ChevronLeft, PackageOpen,
  Building2, Clock, ShieldCheck, RefreshCw, Pencil, ImageIcon,
  Link2, ChevronDown, History, CopyPlus, SearchCheck, RotateCcw, Layers,
} from 'lucide-react'
import {
  useAdsCatalogs, useAdsCatalogDetail, useAdsCatalogSpec, useAdsCatalogBusinessCenter,
  useAdsCatalogPublications, useAdsCatalogReadiness, useAdsCatalogCapabilities, adsCatalogImportCsv,
  adsCatalogApiUrl, apiSend, ApiError,
} from '@/lib/api'
import { toast } from '@/lib/toast'
import type { AdsCatalog, AdsCatalogCapabilities, AdsCatalogProduct, AdsCatalogSpecResponse, AdsCatalogSyncResponse } from '@/lib/types'
import { useModalA11y } from '@/lib/use-modal-a11y'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { ErrorState } from '@/components/error-state'
import { CatalogReadinessCard } from './catalog-readiness-card'
import { CatalogConnectionCard } from './catalog-connection-card'
import { CatalogCampaignWizard } from './catalog-campaign-wizard'
import { CatalogBatchDialog } from './catalog-batch-dialog'
import { CatalogSyncStatus } from './catalog-sync-status'
`;

const getBlock = (fnName) => {
    let startIdx = source.indexOf(`function ${fnName}(`);
    if (startIdx === -1) startIdx = source.indexOf(`export function ${fnName}(`);
    if (startIdx === -1) return '';
    
    // find opening brace
    let braceIdx = source.indexOf('{', startIdx);
    let open = 1;
    let i = braceIdx + 1;
    while(open > 0 && i < source.length) {
        if (source[i] === '{') open++;
        if (source[i] === '}') open--;
        i++;
    }
    // Also grab any comments right above it
    let preIdx = startIdx;
    while(preIdx > 0 && (source[preIdx-1] === '\n' || source.slice(preIdx-3, preIdx) === '// ')) {
       // simplistic, let's just do startIdx
       break;
    }
    
    // Let's actually find the start of the line
    let lineStart = source.lastIndexOf('\n', startIdx) + 1;
    return source.slice(lineStart, i);
}

const getConst = (constName) => {
    let startIdx = source.indexOf(`const ${constName}`);
    if(startIdx === -1) return '';
    let semiIdx = source.indexOf('\n', startIdx);
    // if it's an object or array, find closing bracket/brace
    if (source.slice(startIdx, semiIdx).includes('{') || source.slice(startIdx, semiIdx).includes('[')) {
        let openChar = source.slice(startIdx, semiIdx).includes('{') ? '{' : '[';
        let closeChar = openChar === '{' ? '}' : ']';
        let braceIdx = source.indexOf(openChar, startIdx);
        let open = 1;
        let i = braceIdx + 1;
        while(open > 0 && i < source.length) {
            if (source[i] === openChar) open++;
            if (source[i] === closeChar) open--;
            i++;
        }
        return source.slice(startIdx, i);
    }
    return source.slice(startIdx, semiIdx);
}

const typeSpec = `type CatalogSpec = AdsCatalogSpecResponse`;
const currencies = getConst('CURRENCIES');
const primaryCols = getConst('PRIMARY_COLS');
const fieldLabels = getConst('FIELD_LABELS');
const fieldPlaceholders = getConst('FIELD_PLACEHOLDERS');
const catalogStatusMeta = getBlock('catalogStatusMeta');

// catalog-editor.tsx
let editorContent = `
${importsBlock}

${fieldLabels}
${fieldPlaceholders}

${getBlock('generateSku')}
${getBlock('formatPriceForFeed')}
${getBlock('stripCurrency')}
${getBlock('ProductEditor').replace('function ProductEditor', 'export function ProductEditor')}
${getBlock('ProductField').replace('function ProductField', 'export function ProductField')}
${getBlock('PriceField').replace('function PriceField', 'export function PriceField')}
${getBlock('ImageField').replace('function ImageField', 'export function ImageField')}
`;
fs.writeFileSync('dashboard/components/ads/catalog-editor.tsx', editorContent.trim() + '\n');

// catalog-list.tsx
let listContent = `
${importsBlock}

${typeSpec}
${currencies}
${catalogStatusMeta}

${getBlock('CatalogList').replace('function CatalogList', 'export function CatalogList')}
${getBlock('BusinessCenterBar').replace('function BusinessCenterBar', 'export function BusinessCenterBar')}
`;
fs.writeFileSync('dashboard/components/ads/catalog-list.tsx', listContent.trim() + '\n');

// catalog-detail.tsx
let detailContent = `
${importsBlock}
import { ProductEditor } from './catalog-editor'

${typeSpec}
${currencies}
${primaryCols}
${fieldLabels}

${getBlock('generateSku')}

${getBlock('CatalogDetail').replace('function CatalogDetail', 'export function CatalogDetail')}
${getBlock('TiktokStatusPanel').replace('function TiktokStatusPanel', 'export function TiktokStatusPanel')}
`;
fs.writeFileSync('dashboard/components/ads/catalog-detail.tsx', detailContent.trim() + '\n');

// catalog-manager.tsx
let managerContent = `
${importsBlock}
import { CatalogList } from './catalog-list'
import { CatalogDetail } from './catalog-detail'
import { BusinessCenterBar } from './catalog-list'

${getBlock('CatalogManager')}
`;
fs.writeFileSync('dashboard/components/ads/catalog-manager.tsx', managerContent.trim() + '\n');

console.log('Files generated successfully.');
