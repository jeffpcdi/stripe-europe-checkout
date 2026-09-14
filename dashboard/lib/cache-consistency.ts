// Predicado pequeno para revalidar apenas caches afetados por uma mutação.
// Mantém a lógica de SWR consistente entre telas sem acoplar componentes aos
// detalhes internos do cache. '*' no fim do path significa prefixo de pathname.
export function apiCacheKeyMatches(
  key: unknown,
  paths: readonly string[],
  params?: Record<string, string | null | undefined>,
): boolean {
  if (typeof key !== 'string') return false
  const [pathname, query = ''] = key.split('?', 2)
  const pathMatches = paths.some((path) =>
    path.endsWith('*') ? pathname.startsWith(path.slice(0, -1)) : pathname === path,
  )
  if (!pathMatches) return false
  if (!params) return true

  const search = new URLSearchParams(query)
  return Object.entries(params).every(([name, value]) => {
    if (value == null || value === '') return true
    return search.get(name) === value
  })
}
