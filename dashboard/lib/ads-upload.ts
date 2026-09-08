// Uploads podem ser repetidos: o servidor identifica o conteúdo e reutiliza a URL.
export function creativeFileError(file: File, kind: 'video' | 'image'): string | null {
  if (!(kind === 'video' ? /\.(mp4|mov)$/i : /\.(png|jpe?g|webp)$/i).test(file.name)) {
    return kind === 'video' ? 'Selecione um vídeo MP4 ou MOV.' : 'Selecione uma imagem JPG, PNG ou WebP.'
  }
  if (!file.size) return 'O arquivo está vazio.'
  if (file.size > (kind === 'video' ? 500 : 5) * 1024 * 1024) return `O limite é ${kind === 'video' ? 500 : 5} MB por arquivo.`
  return null
}

export async function uploadWithRetry(file: File, kind: 'video' | 'image', options: { signal?: AbortSignal } = {}): Promise<Response> {
  const error = creativeFileError(file, kind)
  if (error) throw new Error(error)
  for (let attempt = 0; attempt < 3; attempt++) {
    options.signal?.throwIfAborted()
    const controller = new AbortController()
    const abort = () => controller.abort()
    options.signal?.addEventListener('abort', abort, { once: true })
    const timeout = setTimeout(abort, 10 * 60 * 1000)
    let retry = false
    try {
      const response = await fetch(`/api/ads/upload?${new URLSearchParams({ kind, filename: file.name })}`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/octet-stream' },
        body: file, signal: controller.signal,
      })
      if (attempt === 2 || ![408, 429, 500, 502, 503, 504].includes(response.status)) {
        const body = await response.text()
        return new Response(body, { status: response.status, headers: response.headers })
      }
      await response.body?.cancel()
      retry = true
    } catch (cause) {
      if (options.signal?.aborted) throw cause
      if (attempt === 2) throw new Error('O envio foi interrompido. Tente novamente com o arquivo já selecionado.')
      retry = true
    } finally {
      clearTimeout(timeout)
      options.signal?.removeEventListener('abort', abort)
    }
    if (retry) await new Promise<void>((resolve) => setTimeout(resolve, (attempt + 1) * 1000))
  }
  throw new Error('Não foi possível enviar o arquivo.')
}
