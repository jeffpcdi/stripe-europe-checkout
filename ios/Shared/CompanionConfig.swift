import Foundation
import Security

enum CompanionConfig {
    static let appGroup = "group.com.roinados.companion"
    static let apiBaseKey = "roi.api.base"

    static var keychainAccessGroup: String? {
        Bundle.main.object(forInfoDictionaryKey: "ROINADOS_KEYCHAIN_GROUP") as? String
    }

    static var apiBaseURL: URL? {
        guard
            let defaults = UserDefaults(suiteName: appGroup),
            let raw = defaults.string(forKey: apiBaseKey),
            let url = URL(string: raw)
        else { return nil }
        return url
    }

    static func setAPIBaseURL(_ url: URL) {
        UserDefaults(suiteName: appGroup)?.set(url.absoluteString, forKey: apiBaseKey)
    }

    static func dashboardURL(path: String = "/dashboard") -> URL? {
        guard let base = apiBaseURL,
              var components = URLComponents(url: base, resolvingAgainstBaseURL: false)
        else { return nil }
        components.path = path.hasPrefix("/") ? path : "/" + path
        components.query = nil
        components.fragment = nil
        return components.url
    }
}

enum CompanionCredentials {
    private static let service = "com.roinados.companion"
    private static let account = "readonly-widget-token"

    static func save(token: String) throws {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        if let group = CompanionConfig.keychainAccessGroup, !group.isEmpty {
            query[kSecAttrAccessGroup as String] = group
        }

        SecItemDelete(query as CFDictionary)
        query[kSecValueData as String] = Data(token.utf8)
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw NSError(domain: NSOSStatusErrorDomain, code: Int(status))
        }
    }

    static func token() -> String? {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        if let group = CompanionConfig.keychainAccessGroup, !group.isEmpty {
            query[kSecAttrAccessGroup as String] = group
        }

        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data
        else { return nil }
        return String(data: data, encoding: .utf8)
    }
}
