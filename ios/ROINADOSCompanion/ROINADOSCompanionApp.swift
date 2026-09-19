import SwiftUI
import UserNotifications
import WidgetKit

@main
struct ROINADOSCompanionApp: App {
    @UIApplicationDelegateAdaptor(CompanionAppDelegate.self) private var appDelegate

    var body: some Scene {
        WindowGroup {
            CompanionSetupView()
        }
    }
}

struct CompanionSetupView: View {
    @State private var baseURL = CompanionConfig.apiBaseURL?.absoluteString ?? ""
    @State private var token = CompanionCredentials.token() ?? ""
    @State private var status = ""
    @State private var saving = false
    @State private var notificationNeedsSettings = false
    @State private var snapshot: WidgetSnapshot?
    @State private var refreshingSnapshot = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Conexão") {
                    TextField("https://seu-dominio.com/", text: $baseURL)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                    SecureField("Token do Companion", text: $token)
                        .textInputAutocapitalization(.never)
                }

                Section {
                    Button(saving ? "Validando…" : "Salvar e validar") {
                        Task { await save() }
                    }
                    .disabled(saving || baseURL.isEmpty || token.isEmpty)

                    if !status.isEmpty {
                        Text(status)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }

                if let snapshot {
                    Section("Hoje") {
                        LabeledContent("Receita", value: money(snapshot.today.revenueCents, currency: snapshot.currency))
                        LabeledContent("Vendas", value: "\(snapshot.today.sales)")
                        LabeledContent("ROAS", value: ratio(snapshot.media.roas))
                        LabeledContent("Lucro", value: money(snapshot.profitability.netProfitCents, currency: snapshot.currency))

                        HStack {
                            Button(refreshingSnapshot ? "Atualizando…" : "Atualizar widgets") {
                                Task { await refreshSnapshot() }
                            }
                            .disabled(refreshingSnapshot)

                            Spacer()

                            if let salesURL = CompanionConfig.dashboardURL(path: "/dashboard/activity") {
                                Link("Ver vendas", destination: salesURL)
                            }
                        }
                    }
                }

                Section("iPhone") {
                    Label("Widgets: Executivo + Vendas", systemImage: "rectangle.3.group")
                    Label("Venda: som próprio ROI-NADOS", systemImage: "speaker.wave.2")
                    Label("Alertas: APNs nativo com ações rápidas", systemImage: "bell.badge")
                    Text("Para adicionar um widget, mantenha pressionada a Tela de Início ou a Tela Bloqueada e procure por ROI-NADOS.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)

                    if notificationNeedsSettings {
                        Button("Abrir Ajustes de notificações") {
                            guard let settingsURL = URL(string: UIApplication.openSettingsURLString) else { return }
                            UIApplication.shared.open(settingsURL)
                        }
                    }

                    if let dashboardURL = CompanionConfig.dashboardURL() {
                        Link("Abrir dashboard completa", destination: dashboardURL)
                    }
                }
            }
            .navigationTitle("ROI-NADOS")
        }
        .task {
            await refreshSnapshot()
        }
        .onOpenURL { url in
            guard url.scheme == "roinados", url.host == "pair" else { return }
            Task { await handlePairingURL(url) }
        }
    }

    @MainActor
    private func handlePairingURL(_ url: URL) async {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let server = components.queryItems?.first(where: { $0.name == "server" })?.value,
              let incomingToken = components.queryItems?.first(where: { $0.name == "token" })?.value,
              let serverURL = URL(string: server),
              !incomingToken.isEmpty
        else {
            status = "Link de pareamento inválido."
            return
        }

        baseURL = serverURL.absoluteString
        token = incomingToken
        await save()
    }

    @MainActor
    private func refreshSnapshot() async {
        guard CompanionConfig.apiBaseURL != nil, CompanionCredentials.token() != nil else { return }
        refreshingSnapshot = true
        defer { refreshingSnapshot = false }
        if let latest = try? await ROIAPIClient.widgetSnapshot() {
            snapshot = latest
            WidgetCenter.shared.reloadAllTimelines()
        } else if snapshot == nil {
            snapshot = WidgetSnapshotCache.load()
        }
    }

    private func ratio(_ value: Double?) -> String {
        guard let value else { return "—" }
        return String(format: "%.2f×", value)
    }

    private func money(_ cents: Int, currency: String) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.currencyCode = currency
        formatter.maximumFractionDigits = 0
        return formatter.string(from: NSNumber(value: Double(cents) / 100.0)) ?? "\(currency) \(cents / 100)"
    }

    @MainActor
    private func save() async {
        saving = true
        defer { saving = false }

        let raw = baseURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: raw) else {
            status = "URL inválida."
            return
        }

        do {
            CompanionConfig.setAPIBaseURL(url)
            try CompanionCredentials.save(token: token.trimmingCharacters(in: .whitespacesAndNewlines))
            let latest = try await ROIAPIClient.widgetSnapshot()
            snapshot = latest
            SaleSoundInstaller.installIfNeeded()
            WidgetCenter.shared.reloadAllTimelines()

            let notificationsReady = await CompanionPushRegistrar.requestAuthorizationAndRegister()
            let notificationSettings = await UNUserNotificationCenter.current().notificationSettings()
            notificationNeedsSettings = notificationSettings.authorizationStatus == .denied
            status = notificationsReady
                ? "\(latest.today.sales) venda(s) hoje · widgets e alertas ativos."
                : "\(latest.today.sales) venda(s) hoje · widgets ativos; alertas desativados."
        } catch {
            status = "Não foi possível validar o token/servidor."
        }
    }
}
