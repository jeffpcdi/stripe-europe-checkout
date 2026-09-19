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

  event.waitUntil((async () => {
    const title = data.title || "ROI-NADOS"
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
    const visibleClients = clients.filter((client) => client.visibilityState === "visible")
    const hasVisibleClient = visibleClients.length > 0

    // Haptics são best-effort fora do iOS. O iPhone controla o feedback físico
    // e pode ignorar totalmente a opção vibrate de Web Notifications.
    const VIBRATE = {
      cash: [90, 50, 120],
      alert: [160, 80, 160],
      tick: [50],
      ping: [80],
      info: [70],
    }

    const options = {
      body: data.body || "",
      icon: "/dashboard/icon-192.png",
      badge: "/dashboard/badge-96.png",
      lang: "pt-BR",
      tag: data.tag || undefined,
      data: { url: data.url || "/dashboard" },
      // Dashboard visível: o feedback sonoro é local e curto. Em background,
      // omitimos `silent` para respeitar o padrão do aparelho/Foco.
      // "critical" é prioridade interna do ROI-NADOS e NÃO equivale ao
      // entitlement Apple Critical Alerts.
      renotify: !hasVisibleClient && data.priority === "critical" && Boolean(data.tag),
      actions: Array.isArray(data.actions) ? data.actions.slice(0, 2) : [],
    }
    if (hasVisibleClient) {
      options.silent = true
    } else {
      options.vibrate = data.priority === "critical" ? VIBRATE.alert : (VIBRATE[data.sound] || [70])
    }

    const promises = [self.registration.showNotification(title, options)]

    if (hasVisibleClient && data.sound) {
      promises.push(Promise.resolve().then(() => {
        for (const client of visibleClients) {
          client.postMessage({
            type: "roi-notification",
            sound: data.sound,
            event: data.event || "",
            title,
            body: data.body || "",
            url: data.url || "/dashboard",
            priority: data.priority || "normal",
          })
        }
      }))
    }

    // iOS/iPadOS Home Screen web apps suportam Badging API. Um ponto é mais
    // honesto que um contador inventado: indica "há algo novo" sem manter
    // estado duplicado no service worker.
    if (data.badge === true && "setAppBadge" in self.navigator) {
      promises.push(self.navigator.setAppBadge().catch(() => {}))
    }

    await Promise.all(promises)
  })())
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  // Deep link: ação clicada > url do payload > painel
  const action = (event.notification.data || {}).url || "/dashboard"
  const url = event.action
    ? (event.notification.actions || []).find((a) => a.action === event.action)?.action || action
    : action

  const tasks = []
  if ("clearAppBadge" in self.navigator) {
    tasks.push(self.navigator.clearAppBadge().catch(() => {}))
  }
  tasks.push(
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
  event.waitUntil(Promise.all(tasks))
})
