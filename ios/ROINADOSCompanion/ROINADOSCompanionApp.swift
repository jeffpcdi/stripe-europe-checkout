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

                Section("iPhone") {
                    Label("Widgets: Receita, Vendas, ROAS e Lucro", systemImage: "rectangle.3.group")
                    Label("Venda: som próprio ROI-NADOS", systemImage: "speaker.wave.2")
                    Label("Alertas: APNs nativo", systemImage: "bell.badge")

                    if notificationNeedsSettings {
                        Button("Abrir Ajustes de notificações") {
                            guard let settingsURL = URL(string: UIApplication.openSettingsURLString) else { return }
                            UIApplication.shared.open(settingsURL)
                        }
                    }
                }
            }
            .navigationTitle("ROI-NADOS")
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
            let snapshot = try await ROIAPIClient.widgetSnapshot()
            status = "\(snapshot.today.sales) venda(s) hoje · conexão ativa."
            SaleSoundInstaller.installIfNeeded()
            WidgetCenter.shared.reloadAllTimelines()
            UIApplication.shared.registerForRemoteNotifications()
        } catch {
            status = "Não foi possível validar o token/servidor."
        }
    }
}
