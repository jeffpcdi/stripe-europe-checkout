// Item 347: cópia com fallback — navigator.clipboard só existe em contexto
// seguro (HTTPS) e fora de iframes com permissão negada. Em HTTP/iframe o
// caminho antigo falhava em silêncio: o usuário via "Copiado" sem nada no
// clipboard. O fallback usa textarea invisível + execCommand('copy'), que
// funciona nesses contextos. Retorna se a cópia de fato aconteceu.
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // permissão negada / iframe — tenta o fallback abaixo
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    ta.style.pointerEvents = 'none'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}
