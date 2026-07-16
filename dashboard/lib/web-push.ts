"use client"

// Cliente Web Push — inscreve/remove o aparelho atual nas notificações
// nativas (iPhone/Android/desktop). Fluxo: registrar SW → pedir permissão →
// PushManager.subscribe(VAPID) → POST /api/webpush/subscribe.

// O Next roda com basePath /dashboard — o SW é servido sob esse prefixo.
const SW_PATH = "/dashboard/sw.js"

export type WebPushSupport =
  | { supported: true }
  | { supported: false; reason: string; needsInstall?: boolean }

/** Detecta suporte. No iOS, Web Push só funciona com o site instalado na Tela de Início. */
export function checkSupport(): WebPushSupport {
  if (typeof window === "undefined") return { supported: false, reason: "SSR" }
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true

  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    if (isIOS && !standalone) {
      return {
        supported: false,
        needsInstall: true,
        reason: "No iPhone, adicione o site à Tela de Início primeiro (Compartilhar → Adicionar à Tela de Início).",
      }
    }
    return { supported: false, reason: "Este navegador não suporta notificações push." }
  }
  if (isIOS && !standalone) {
    return {
      supported: false,
      needsInstall: true,
      reason: "No iPhone, abra pelo ícone da Tela de Início para ativar as notificações.",
    }
  }
  return { supported: true }
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
  const keyJson = await keyRes.json()
  if (!keyJson.ok) throw new Error(keyJson.error || "Falha ao obter a chave do servidor")

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
  const json = await res.json()
  if (!json.ok) throw new Error(json.error || "Falha ao registrar o aparelho")
  return { devices: json.devices }
}

/** Remove a inscrição deste aparelho. */
export async function unsubscribeDevice(): Promise<{ devices: number }> {
  const reg = await navigator.serviceWorker.getRegistration(SW_PATH)
  const subscription = await reg?.pushManager.getSubscription()
  if (!subscription) return { devices: -1 }

  await fetch("/api/webpush/unsubscribe", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  })
  await subscription.unsubscribe()
  return { devices: -1 }
}

/** true se ESTE aparelho já está inscrito. */
export async function isThisDeviceSubscribed(): Promise<boolean> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false
  const reg = await navigator.serviceWorker.getRegistration(SW_PATH)
  const sub = await reg?.pushManager.getSubscription()
  return !!sub && Notification.permission === "granted"
}
