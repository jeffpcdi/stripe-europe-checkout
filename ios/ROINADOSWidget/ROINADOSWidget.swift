import SwiftUI
import WidgetKit

struct ROIWidgetEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot?
}

struct ROIWidgetProvider: TimelineProvider {
    func placeholder(in context: Context) -> ROIWidgetEntry {
        ROIWidgetEntry(date: .now, snapshot: nil)
    }

    func getSnapshot(in context: Context, completion: @escaping (ROIWidgetEntry) -> Void) {
        Task {
            let snapshot = (try? await ROIAPIClient.widgetSnapshot()) ?? WidgetSnapshotCache.load()
            completion(ROIWidgetEntry(date: .now, snapshot: snapshot))
        }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<ROIWidgetEntry>) -> Void) {
        Task {
            let snapshot = (try? await ROIAPIClient.widgetSnapshot()) ?? WidgetSnapshotCache.load()
            let entry = ROIWidgetEntry(date: .now, snapshot: snapshot)
            let refresh = Calendar.current.date(byAdding: .minute, value: 15, to: .now) ?? .now.addingTimeInterval(900)
            completion(Timeline(entries: [entry], policy: .after(refresh)))
        }
    }
}

struct ROIWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: ROIWidgetEntry

    var body: some View {
        Group {
            if let snapshot = entry.snapshot {
                if family == .systemSmall {
                    small(snapshot)
                } else if family == .systemLarge {
                    large(snapshot)
                } else if family == .accessoryRectangular {
                    lockScreen(snapshot)
                } else if family == .accessoryInline {
                    inline(snapshot)
                } else if family == .accessoryCircular {
                    circular(snapshot)
                } else {
                    medium(snapshot)
                }
            } else {
                unavailable
            }
        }
        .containerBackground(.fill.tertiary, for: .widget)
        .widgetURL(CompanionConfig.dashboardURL())
    }

    private func small(_ snapshot: WidgetSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("HOJE")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(money(snapshot.today.revenueCents, currency: snapshot.currency))
                    .font(.title3.weight(.bold))
                    .minimumScaleFactor(0.75)
                if let delta = snapshot.trend?.revenueDeltaPct {
                    Text(deltaLabel(delta))
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(delta >= 0 ? .green : .red)
                }
            }
            Spacer()
            HStack {
                metric("Vendas", "\(snapshot.today.sales)")
                Spacer()
                metric("ROAS", ratio(snapshot.media.roas))
            }
            if !snapshot.attention.isEmpty {
                Label("Atenção", systemImage: "exclamationmark.circle.fill")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.orange)
            }
        }
    }

    private func medium(_ snapshot: WidgetSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("ROI-NADOS · HOJE")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.secondary)
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(money(snapshot.today.revenueCents, currency: snapshot.currency))
                            .font(.title2.weight(.bold))
                        if let delta = snapshot.trend?.revenueDeltaPct {
                            Text(deltaLabel(delta))
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(delta >= 0 ? .green : .red)
                        }
                    }
                }
                Spacer()
                if !snapshot.attention.isEmpty {
                    Image(systemName: "exclamationmark.circle.fill")
                        .foregroundStyle(.orange)
                        .accessibilityLabel("Operação precisa de atenção")
                } else if let lastSale = snapshot.lastSale {
                    VStack(alignment: .trailing, spacing: 2) {
                        Text("ÚLTIMA VENDA")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.secondary)
                        Text(money(lastSale.amountCents, currency: lastSale.currency))
                            .font(.caption.weight(.semibold))
                    }
                }
            }

            Divider()

            HStack {
                metric("Vendas", "\(snapshot.today.sales)")
                Spacer()
                metric("ROAS", ratio(snapshot.media.roas))
                Spacer()
                metric("Lucro", money(snapshot.profitability.netProfitCents, currency: snapshot.currency))
            }
        }
    }

    private func large(_ snapshot: WidgetSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("ROI-NADOS · HOJE")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.secondary)
                    Text(money(snapshot.today.revenueCents, currency: snapshot.currency))
                        .font(.title.weight(.bold))
                        .minimumScaleFactor(0.72)
                }
                Spacer()
                if let delta = snapshot.trend?.revenueDeltaPct {
                    Text(deltaLabel(delta))
                        .font(.caption.weight(.bold))
                        .foregroundStyle(delta >= 0 ? .green : .red)
                }
            }

            Divider()

            HStack {
                metric("Vendas", "\(snapshot.today.sales)")
                Spacer()
                metric("ROAS", ratio(snapshot.media.roas))
                Spacer()
                metric("Lucro", money(snapshot.profitability.netProfitCents, currency: snapshot.currency))
            }

            HStack {
                metric("TikTok", moneyAmount(snapshot.media.tiktokSpend, currency: snapshot.media.currency ?? snapshot.currency))
                Spacer()
                metric("Conversão", String(format: "%.1f%%", snapshot.today.conversion))
                Spacer()
                metric("Leads", "\(snapshot.today.leads)")
            }

            Divider()

            if !snapshot.attention.isEmpty {
                Label(attentionLabel(snapshot.attention), systemImage: "exclamationmark.triangle.fill")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.orange)
            } else if let lastSale = snapshot.lastSale {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("ÚLTIMA VENDA")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.secondary)
                        Text(money(lastSale.amountCents, currency: lastSale.currency))
                            .font(.headline.weight(.semibold))
                    }
                    Spacer()
                    Text(lastSale.at.formatted(date: .omitted, time: .shortened))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            } else {
                Text("Operação estável · aguardando a próxima venda")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer(minLength: 0)
            Text(freshness(snapshot))
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
    }

    private func lockScreen(_ snapshot: WidgetSnapshot) -> some View {
        HStack(alignment: .center, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text("ROI-NADOS")
                    .font(.caption2.weight(.semibold))
                Text(money(snapshot.today.revenueCents, currency: snapshot.currency))
                    .font(.headline.weight(.bold))
                    .minimumScaleFactor(0.7)
            }
            Spacer(minLength: 4)
            VStack(alignment: .trailing, spacing: 2) {
                Text("\(snapshot.today.sales) vendas")
                    .font(.caption.weight(.semibold))
                Text("ROAS " + ratio(snapshot.media.roas))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func inline(_ snapshot: WidgetSnapshot) -> some View {
        Text("ROI · \(money(snapshot.today.revenueCents, currency: snapshot.currency)) · \(snapshot.today.sales) vendas")
    }

    private func circular(_ snapshot: WidgetSnapshot) -> some View {
        Gauge(value: min(Double(snapshot.today.sales), 20), in: 0...20) {
            Text("ROI")
        } currentValueLabel: {
            Text("\(snapshot.today.sales)")
                .font(.headline.weight(.bold))
        }
        .gaugeStyle(.accessoryCircular)
    }

    private func freshness(_ snapshot: WidgetSnapshot) -> String {
        let age = max(0, Date().timeIntervalSince(snapshot.generatedAt))
        if age < 120 { return "Atualizado agora" }
        if age < 3600 { return "Atualizado há \(Int(age / 60)) min" }
        return "Dados de " + snapshot.generatedAt.formatted(date: .omitted, time: .shortened)
    }

    private func deltaLabel(_ value: Double) -> String {
        let sign = value > 0 ? "+" : ""
        return sign + String(format: "%.0f%%", value)
    }

    private var unavailable: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("ROI-NADOS")
                .font(.headline)
            Text("Abra o Companion para conectar a conta.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private func metric(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption2).foregroundStyle(.secondary)
            Text(value).font(.caption.weight(.semibold)).lineLimit(1).minimumScaleFactor(0.75)
        }
    }

    private func moneyAmount(_ value: Double?, currency: String) -> String {
        guard let value else { return "—" }
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.currencyCode = currency
        formatter.maximumFractionDigits = 0
        return formatter.string(from: NSNumber(value: value)) ?? "\(currency) \(Int(value))"
    }

    private func attentionLabel(_ attention: [String]) -> String {
        if attention.contains("spend_without_sales") { return "TikTok com gasto sem venda registrada" }
        if attention.contains("negative_profit") { return "Lucro líquido do dia está negativo" }
        return "Operação precisa de atenção"
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
}

struct ROINADOSWidget: Widget {
    let kind = "ROINADOSWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: ROIWidgetProvider()) { entry in
            ROIWidgetView(entry: entry)
        }
        .configurationDisplayName("ROI-NADOS")
        .description("Receita, vendas, ROAS, lucro e tendência do dia.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryRectangular, .accessoryInline, .accessoryCircular])
    }
}

struct ROINADOSSalesWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: ROIWidgetEntry

    var body: some View {
        Group {
            if let snapshot = entry.snapshot {
                if family == .accessoryInline {
                    Text("ROI · \(snapshot.today.sales) vendas · \(money(snapshot.today.revenueCents, currency: snapshot.currency))")
                } else if family == .accessoryRectangular {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("VENDAS HOJE").font(.caption2.weight(.semibold))
                        Text("\(snapshot.today.sales) · " + money(snapshot.today.revenueCents, currency: snapshot.currency))
                            .font(.headline.weight(.bold))
                            .minimumScaleFactor(0.72)
                        if let lastSale = snapshot.lastSale {
                            Text("Última " + money(lastSale.amountCents, currency: lastSale.currency) + " · " + lastSale.at.formatted(date: .omitted, time: .shortened))
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                } else {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("VENDAS HOJE")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.secondary)
                        Text("\(snapshot.today.sales)")
                            .font(.system(size: 34, weight: .bold, design: .rounded))
                        Text(money(snapshot.today.revenueCents, currency: snapshot.currency))
                            .font(.headline.weight(.semibold))
                            .minimumScaleFactor(0.75)
                        Spacer()
                        if let lastSale = snapshot.lastSale {
                            Text("Última · " + money(lastSale.amountCents, currency: lastSale.currency))
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    Text("ROI-NADOS").font(.headline)
                    Text("Abra o Companion para conectar a conta.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .containerBackground(.fill.tertiary, for: .widget)
        .widgetURL(CompanionConfig.dashboardURL(path: "/dashboard/activity"))
    }

    private func money(_ cents: Int, currency: String) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.currencyCode = currency
        formatter.maximumFractionDigits = 0
        return formatter.string(from: NSNumber(value: Double(cents) / 100.0)) ?? "\(currency) \(cents / 100)"
    }
}

struct ROINADOSSalesWidget: Widget {
    let kind = "ROINADOSSalesWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: ROIWidgetProvider()) { entry in
            ROINADOSSalesWidgetView(entry: entry)
        }
        .configurationDisplayName("Vendas ROI-NADOS")
        .description("Vendas, receita e última venda do dia.")
        .supportedFamilies([.systemSmall, .accessoryRectangular, .accessoryInline])
    }
}

@main
struct ROINADOSWidgetBundle: WidgetBundle {
    var body: some Widget {
        ROINADOSWidget()
        ROINADOSSalesWidget()
    }
}
