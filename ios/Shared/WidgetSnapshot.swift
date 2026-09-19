import Foundation

struct WidgetSnapshot: Codable {
    struct Today: Codable {
        let sales: Int
        let revenueCents: Int
        let leads: Int
        let conversion: Double
    }

    struct Media: Codable {
        let tiktokSpend: Double?
        let currency: String?
        let roas: Double?
    }

    struct Profitability: Codable {
        let netProfitCents: Int
        let quality: String
    }

    struct Trend: Codable {
        let previousSales: Int
        let previousRevenueCents: Int
        let salesDelta: Int
        let revenueDeltaPct: Double?
    }

    struct LastSale: Codable {
        let at: Date
        let amountCents: Int
        let currency: String
    }

    let ok: Bool
    let version: Int
    let generatedAt: Date
    let timeZone: String
    let currency: String
    let today: Today
    let media: Media
    let profitability: Profitability
    let trend: Trend?
    let lastSale: LastSale?
    let attention: [String]
}


enum WidgetSnapshotCache {
    private static let key = "roi.widget.snapshot.v2"

    static func save(_ snapshot: WidgetSnapshot) {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        guard let data = try? encoder.encode(snapshot) else { return }
        UserDefaults(suiteName: CompanionConfig.appGroup)?.set(data, forKey: key)
    }

    static func load() -> WidgetSnapshot? {
        guard let data = UserDefaults(suiteName: CompanionConfig.appGroup)?.data(forKey: key) else {
            return nil
        }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try? decoder.decode(WidgetSnapshot.self, from: data)
    }
}
