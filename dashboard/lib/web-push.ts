"use client"

// Cliente Web Push — inscreve/remove o aparelho atual nas notificações
// nativas (iPhone/Android/desktop). Fluxo: registrar SW → pedir permissão →
// PushManager.subscribe(VAPID) → POST /api/webpush/subscribe.

// O Next roda com basePath /dashboard — o SW é servido sob esse prefixo.
const SW_PATH = "/dashboard/sw.js"

export type WebPushSupport =
  | { supported: true; platform: 'ios' | 'other'; standalone: boolean; permission: NotificationPermission }
  | { supported: false; reason: string; needsInstall?: boolean; platform: 'ios' | 'other'; standalone: boolean; permission?: NotificationPermission }

/** Detecta suporte. No iOS, Web Push só funciona com o site instalado na Tela de Início. */
export function checkSupport(): WebPushSupport {
  if (typeof window === "undefined") return { supported: false, reason: "SSR" }
  const isIOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const platform = isIOS ? 'ios' : 'other'
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  const permission = "Notification" in window ? Notification.permission : undefined

  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    if (isIOS && !standalone) {
      return {
        supported: false,
        needsInstall: true,
        platform,
        standalone,
        permission,
        reason: "No iPhone, adicione o site à Tela de Início primeiro (Compartilhar → Adicionar à Tela de Início).",
      }
    }
    if (isIOS) {
      return {
        supported: false,
        platform,
        standalone,
        permission,
        reason: "Este iPhone/iPad precisa do iOS/iPadOS 16.4 ou mais recente para receber Web Push.",
      }
    }
    return { supported: false, platform, standalone, permission, reason: "Este navegador não suporta notificações push." }
  }
  if (isIOS && !standalone) {
    return {
      supported: false,
      needsInstall: true,
      platform,
      standalone,
      permission,
      reason: "No iPhone, abra pelo ícone da Tela de Início para ativar as notificações.",
    }
  }
  return { supported: true, platform, standalone, permission: Notification.permission }
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/")
  const raw = atob(b64)
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

async function getRegistration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration(SW_PATH)
  if (existing) return existing
  return navigator.serviceWorker.register(SW_PATH)
}

/** Inscreve este aparelho. Lança Error com mensagem amigável em falhas. */
export async function subscribeDevice(): Promise<{ devices: number }> {
  const support = checkSupport()
  if (!support.supported) throw new Error(support.reason)

  const permission = await Notification.requestPermission()
  if (permission !== "granted") {
    throw new Error("Permissão negada. Habilite as notificações nos ajustes do navegador.")
  }

  const reg = await getRegistration()
  await navigator.serviceWorker.ready

  const keyRes = await fetch("/api/webpush/public-key", { credentials: "include" })
  const keyJson = await keyRes.json().catch(() => ({})) as { ok?: boolean; error?: string; key?: string }
  if (!keyRes.ok || !keyJson.ok || !keyJson.key) {
    if (keyRes.status === 401 && typeof window !== 'undefined') window.location.href = '/login'
    throw new Error(keyJson.error || `Falha ao obter a chave do servidor (${keyRes.status})`)
  }

  const subscription =
    (await reg.pushManager.getSubscription()) ||
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(keyJson.key) as BufferSource,
    }))

  const res = await fetch("/api/webpush/subscribe", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription: subscription.toJSON() }),
  })
  const json = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; devices?: number }
  if (!res.ok || !json.ok) {
    if (res.status === 401 && typeof window !== 'undefined') window.location.href = '/login'
    throw new Error(json.error || `Falha ao registrar o aparelho (${res.status})`)
  }
  return { devices: Number(json.devices) || 0 }
}

/** Remove a inscrição deste aparelho. */
export async function unsubscribeDevice(): Promise<{ devices: number }> {
  const reg = await navigator.serviceWorker.getRegistration(SW_PATH)
  const subscription = await reg?.pushManager.getSubscription()
  if (!subscription) return { devices: -1 }

  const res = await fetch("/api/webpush/unsubscribe", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  })
  const json = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; devices?: number }
  if (!res.ok || !json.ok) {
    if (res.status === 401 && typeof window !== 'undefined') window.location.href = '/login'
    throw new Error(json.error || `Falha ao remover o aparelho (${res.status})`)
  }
  await subscription.unsubscribe()
  return { devices: Number.isFinite(Number(json.devices)) ? Number(json.devices) : -1 }
}

/** true se ESTE aparelho já está inscrito. */
export async function isThisDeviceSubscribed(): Promise<boolean> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false
  const reg = await navigator.serviceWorker.getRegistration(SW_PATH)
  const sub = await reg?.pushManager.getSubscription()
  return !!sub && Notification.permission === "granted"
}
