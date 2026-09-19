import Foundation

enum ROIAPIError: Error {
    case notConfigured
    case invalidResponse
    case unauthorized
}

enum ROIAPIClient {
    static func widgetSnapshot() async throws -> WidgetSnapshot {
        guard let base = CompanionConfig.apiBaseURL,
              let token = CompanionCredentials.token(),
              !token.isEmpty
        else { throw ROIAPIError.notConfigured }

        let url = base.appending(path: "api/v1/widget")
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.timeoutInterval = 12

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw ROIAPIError.invalidResponse }
        if http.statusCode == 401 { throw ROIAPIError.unauthorized }
        guard (200..<300).contains(http.statusCode) else { throw ROIAPIError.invalidResponse }

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try decoder.decode(WidgetSnapshot.self, from: data)
    }
}
