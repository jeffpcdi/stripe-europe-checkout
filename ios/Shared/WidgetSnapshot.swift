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

    let ok: Bool
    let version: Int
    let generatedAt: Date
    let timeZone: String
    let currency: String
    let today: Today
    let media: Media
    let profitability: Profitability
    let attention: [String]
}
