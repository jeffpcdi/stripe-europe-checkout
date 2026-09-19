/* Service worker do ROI-NADOS — recebe Web Push e mostra a notificação
 * nativa (iPhone/Android/desktop) com logo, título e copy do servidor.
 * O payload vem de web-push-notify.js: {title, body, url, tag, actions[]}. */

self.addEventListener("install", () => {
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener("push", (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { title: "ROI-NADOS", body: event.data ? event.data.text() : "" }
  }

  const title = data.title || "ROI-NADOS"
  // Haptics são best-effort fora do iOS. O iPhone controla o feedback físico
  // e pode ignorar totalmente a opção vibrate de Web Notifications.
  const VIBRATE = {
    cash: [200, 100, 200, 100, 400],
    alert: [400, 150, 400, 150, 600],
    tick: [80],
    ping: [120],
    info: [150, 80, 150],
  }
  const options = {
    body: data.body || "",
    icon: "/dashboard/icon-192.png",
    badge: "/dashboard/badge-96.png",
    tag: data.tag || undefined, // agrupa notificações do mesmo evento
    data: { url: data.url || "/dashboard" },
    // silent:false pede uma notificação não silenciosa; o SO/navegador ainda
    // decide se haverá som conforme Foco, modo silencioso e preferências locais.
    // O ROI-NADOS nunca promete som customizado em background.
    silent: false,
    vibrate: data.priority === "critical" ? VIBRATE.alert : (VIBRATE[data.sound] || [150]),
    // "critical" é prioridade interna do ROI-NADOS e NÃO equivale ao
    // entitlement Apple Critical Alerts; aqui apenas solicita maior urgência.
    renotify: data.priority === "critical" && Boolean(data.tag),
    // Ações são best-effort; plataformas que não suportam simplesmente ignoram.
    actions: Array.isArray(data.actions) ? data.actions.slice(0, 2) : [],
  }

  const promises = [
    self.registration.showNotification(title, options),
      // Avisa as abas abertas do painel para tocar o som do evento
      // (ex.: 'cash' = cha-ching de dinheiro quando cai venda).
    data.sound
      ? self.clients
          .matchAll({ type: "window", includeUncontrolled: true })
          .then((clients) => {
            for (const client of clients) {
              client.postMessage({ type: "roi-sound", sound: data.sound, event: data.event || "" })
            }
          })
      : Promise.resolve(),
  ]

  // iOS/iPadOS Home Screen web apps suportam Badging API. Um ponto é mais
  // honesto que um contador inventado: indica "há algo novo" sem manter estado
  // duplicado no service worker.
  if ("setAppBadge" in self.navigator) {
    promises.push(self.navigator.setAppBadge().catch(() => {}))
  }

  event.waitUntil(Promise.all(promises))
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  if ("clearAppBadge" in self.navigator) {
    event.waitUntil(self.navigator.clearAppBadge().catch(() => {}))
  }
  // Deep link: ação clicada > url do payload > painel
  const action = (event.notification.data || {}).url || "/dashboard"
  const url = event.action
    ? (event.notification.actions || []).find((a) => a.action === event.action)?.action || action
    : action

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // Se o painel já está aberto, foca e navega; senão abre janela nova
      for (const client of clients) {
        if ("focus" in client) {
          client.focus()
          if ("navigate" in client) client.navigate(url)
          return
        }
      }
      return self.clients.openWindow(url)
    }),
  )
})
