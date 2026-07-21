export type StableIdempotencyState = {
  signature: string
  key: string
}

export function resolveStableIdempotencyKey(
  current: StableIdempotencyState | null,
  signature: string,
  createKey: () => string,
) {
  if (current && current.signature === signature) return current
  return { signature, key: createKey() }
}
