import Foundation
import UIKit
import UserNotifications

enum CompanionPushRegistrar {
    static func register(deviceToken: Data) async {
        guard let base = CompanionConfig.apiBaseURL,
              let token = CompanionCredentials.token(),
              !token.isEmpty
        else { return }

        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        let url = base.appending(path: "api/v1/companion/register")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 12
        request.httpBody = try? JSONSerialization.data(withJSONObject: [
            "deviceToken": hex,
            "name": UIDevice.current.name,
        ])

        _ = try? await URLSession.shared.data(for: request)
    }
}

final class CompanionAppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        SaleSoundInstaller.installIfNeeded()
        UNUserNotificationCenter.current().delegate = self

        Task { @MainActor in
            let center = UNUserNotificationCenter.current()
            let granted = (try? await center.requestAuthorization(options: [.alert, .badge, .sound])) ?? false
            if granted {
                application.registerForRemoteNotifications()
            }
        }
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Task { await CompanionPushRegistrar.register(deviceToken: deviceToken) }
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .list, .sound, .badge])
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        defer { completionHandler() }
        let rawPath = response.notification.request.content.userInfo["url"] as? String ?? "/dashboard"
        guard let url = CompanionConfig.dashboardURL(path: rawPath) else { return }
        Task { @MainActor in
            UIApplication.shared.open(url, options: [:], completionHandler: nil)
        }
    }
}
