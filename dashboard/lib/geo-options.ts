// Opções de país/idioma para os seletores do cloaker. O usuário escolhe pelo
// NOME (não precisa saber a sigla ISO); guardamos/enviamos só o código, que é
// o que o backend compara com a geo do IP (paises) e o accept-language (idiomas).
// A lista é generosa mas não exaustiva — o backend (geoip) aceita qualquer ISO,
// então o seletor também permite adicionar um código digitado manualmente.

export interface GeoOption {
  code: string // ISO alpha-2 (país) ou ISO 639-1 (idioma)
  name: string // rótulo em português
}

// Mercados de tráfego mais comuns primeiro (lusófonos, LATAM, Europa, resto).
export const COUNTRY_OPTIONS: GeoOption[] = [
  { code: 'BR', name: 'Brasil' },
  { code: 'PT', name: 'Portugal' },
  { code: 'AO', name: 'Angola' },
  { code: 'MZ', name: 'Moçambique' },
  { code: 'CV', name: 'Cabo Verde' },
  { code: 'US', name: 'Estados Unidos' },
  { code: 'CA', name: 'Canadá' },
  { code: 'MX', name: 'México' },
  { code: 'AR', name: 'Argentina' },
  { code: 'CL', name: 'Chile' },
  { code: 'CO', name: 'Colômbia' },
  { code: 'PE', name: 'Peru' },
  { code: 'UY', name: 'Uruguai' },
  { code: 'PY', name: 'Paraguai' },
  { code: 'BO', name: 'Bolívia' },
  { code: 'EC', name: 'Equador' },
  { code: 'VE', name: 'Venezuela' },
  { code: 'ES', name: 'Espanha' },
  { code: 'FR', name: 'França' },
  { code: 'DE', name: 'Alemanha' },
  { code: 'GB', name: 'Reino Unido' },
  { code: 'IE', name: 'Irlanda' },
  { code: 'IT', name: 'Itália' },
  { code: 'NL', name: 'Países Baixos' },
  { code: 'BE', name: 'Bélgica' },
  { code: 'CH', name: 'Suíça' },
  { code: 'AT', name: 'Áustria' },
  { code: 'PL', name: 'Polónia' },
  { code: 'SE', name: 'Suécia' },
  { code: 'NO', name: 'Noruega' },
  { code: 'DK', name: 'Dinamarca' },
  { code: 'FI', name: 'Finlândia' },
  { code: 'LU', name: 'Luxemburgo' },
  { code: 'GR', name: 'Grécia' },
  { code: 'RO', name: 'Roménia' },
  { code: 'CZ', name: 'Chéquia' },
  { code: 'HU', name: 'Hungria' },
  { code: 'AU', name: 'Austrália' },
  { code: 'NZ', name: 'Nova Zelândia' },
  { code: 'AE', name: 'Emirados Árabes' },
  { code: 'ZA', name: 'África do Sul' },
  { code: 'JP', name: 'Japão' },
  { code: 'IN', name: 'Índia' },
]

export const LANGUAGE_OPTIONS: GeoOption[] = [
  { code: 'pt', name: 'Português' },
  { code: 'es', name: 'Espanhol' },
  { code: 'en', name: 'Inglês' },
  { code: 'fr', name: 'Francês' },
  { code: 'de', name: 'Alemão' },
  { code: 'it', name: 'Italiano' },
  { code: 'nl', name: 'Neerlandês' },
  { code: 'sv', name: 'Sueco' },
  { code: 'pl', name: 'Polaco' },
  { code: 'ro', name: 'Romeno' },
  { code: 'el', name: 'Grego' },
  { code: 'ja', name: 'Japonês' },
  { code: 'zh', name: 'Chinês' },
  { code: 'ar', name: 'Árabe' },
  { code: 'ru', name: 'Russo' },
]

export function labelForCountry(code: string): string {
  const c = COUNTRY_OPTIONS.find((o) => o.code === code.toUpperCase())
  return c ? c.name : code.toUpperCase()
}

export function labelForLanguage(code: string): string {
  const l = LANGUAGE_OPTIONS.find((o) => o.code === code.toLowerCase())
  return l ? l.name : code.toLowerCase()
}
