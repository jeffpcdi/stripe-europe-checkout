import Foundation
import UIKit
import UserNotifications
import WidgetKit

enum CompanionPushRegistrar {
    static func configureCategories() {
        let openSales = UNNotificationAction(
            identifier: "OPEN_SALES",
            title: "Ver vendas",
            options: [.foreground]
        )
        let openDaily = UNNotificationAction(
            identifier: "OPEN_DAILY",
            title: "Abrir resumo",
            options: [.foreground]
        )
        let openAutomation = UNNotificationAction(
            identifier: "OPEN_AUTOMATION",
            title: "Revisar",
            options: [.foreground]
        )
        let categories: Set<UNNotificationCategory> = [
            UNNotificationCategory(identifier: "ROI_SALE", actions: [openSales], intentIdentifiers: [], options: []),
            UNNotificationCategory(identifier: "ROI_DAILY", actions: [openDaily], intentIdentifiers: [], options: []),
            UNNotificationCategory(identifier: "ROI_AUTOMATION", actions: [openAutomation], intentIdentifiers: [], options: []),
        ]
        UNUserNotificationCenter.current().setNotificationCategories(categories)
    }

    @MainActor
    static func registerIfAuthorized(application: UIApplication = .shared) async -> Bool {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral:
            application.registerForRemoteNotifications()
            return true
        default:
            return false
        }
    }

    @MainActor
    static func requestAuthorizationAndRegister(application: UIApplication = .shared) async -> Bool {
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()

        if settings.authorizationStatus == .notDetermined {
            let granted = (try? await center.requestAuthorization(options: [.alert, .badge, .sound])) ?? false
            if granted {
                application.registerForRemoteNotifications()
            }
            return granted
        }

        return await registerIfAuthorized(application: application)
    }

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
        CompanionPushRegistrar.configureCategories()
        UNUserNotificationCenter.current().delegate = self

        Task { @MainActor in
            _ = await CompanionPushRegistrar.registerIfAuthorized(application: application)
        }
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Task { await CompanionPushRegistrar.register(deviceToken: deviceToken) }
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        WidgetCenter.shared.reloadAllTimelines()
        Task {
            try? await UNUserNotificationCenter.current().setBadgeCount(0)
        }
    }

    func application(
        _ application: UIApplication,
        didReceiveRemoteNotification userInfo: [AnyHashable: Any],
        fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void
    ) {
        WidgetCenter.shared.reloadAllTimelines()
        completionHandler(.newData)
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        WidgetCenter.shared.reloadAllTimelines()
        completionHandler([.banner, .list, .sound, .badge])
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        defer { completionHandler() }
        WidgetCenter.shared.reloadAllTimelines()
        Task {
            try? await UNUserNotificationCenter.current().setBadgeCount(0)
        }
        let payloadPath = response.notification.request.content.userInfo["url"] as? String ?? "/dashboard"
        let rawPath: String
        switch response.actionIdentifier {
        case "OPEN_SALES":
            rawPath = "/dashboard/activity"
        case "OPEN_DAILY":
            rawPath = "/dashboard"
        case "OPEN_AUTOMATION":
            rawPath = "/dashboard/ads/tiktok?tab=automation"
        default:
            rawPath = payloadPath
        }
        guard let url = CompanionConfig.dashboardURL(path: rawPath) else { return }
        Task { @MainActor in
            UIApplication.shared.open(url, options: [:], completionHandler: nil)
        }
    }
}
