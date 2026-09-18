const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'

export function normalizePublicSlug(input: string): string {
  return String(input || '')
    .trim()
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

export function randomPublicSlug(length = 8): string {
  const size = Math.max(6, Math.min(16, length || 8))
  const bytes = new Uint8Array(size)
  globalThis.crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < bytes.length; i++) out += ALPHABET[bytes[i] % ALPHABET.length]
  return out
}
