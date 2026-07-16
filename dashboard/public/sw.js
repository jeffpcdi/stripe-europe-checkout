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
  const options = {
    body: data.body || "",
    icon: "/dashboard/icon-192.png",
    badge: "/dashboard/badge-96.png",
    tag: data.tag || undefined, // agrupa notificações do mesmo evento
    data: { url: data.url || "/dashboard" },
    // silent:false garante o som padrão do sistema (iOS/Android/desktop).
    // Som customizado em push fechado não é permitido pela Apple — o
    // cha-ching de dinheiro toca nas abas abertas via postMessage abaixo.
    silent: false,
    // Haptics/Vibração: ritmo da caixa registradora para vendas
    vibrate: data.sound === 'cash' ? [200, 100, 200, 100, 400] : [200, 100, 200],
    // Botões de ação (Android/desktop; iOS ignora — limite da Apple)
    actions: Array.isArray(data.actions) ? data.actions.slice(0, 2) : [],
  }

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      // Avisa as abas abertas do painel para tocar o som do evento
      // (ex.: 'cash' = cha-ching de dinheiro quando cai venda).
      data.sound
        ? self.clients
            .matchAll({ type: "window", includeUncontrolled: true })
            .then((clients) => {
              for (const client of clients) {
                client.postMessage({ type: "roi-sound", sound: data.sound })
              }
            })
        : Promise.resolve(),
    ]),
  )
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
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
