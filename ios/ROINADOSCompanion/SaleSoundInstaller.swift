import Foundation

enum SaleSoundInstaller {
    static let fileName = "roi-sale.wav"

    static func installIfNeeded() {
        do {
            let library = try FileManager.default.url(
                for: .libraryDirectory,
                in: .userDomainMask,
                appropriateFor: nil,
                create: true
            )
            let sounds = library.appending(path: "Sounds", directoryHint: .isDirectory)
            try FileManager.default.createDirectory(at: sounds, withIntermediateDirectories: true)
            let destination = sounds.appending(path: fileName)
            guard !FileManager.default.fileExists(atPath: destination.path) else { return }
            try buildSaleChime().write(to: destination, options: .atomic)
        } catch {
            // Som customizado é um refinamento; nunca bloqueia o companion.
        }
    }

    private static func buildSaleChime() -> Data {
        let sampleRate = 44_100
        let duration = 0.42
        let frames = Int(Double(sampleRate) * duration)
        var pcm = Data(capacity: frames * 2)

        func envelope(_ t: Double) -> Double {
            let attack = min(1, t / 0.018)
            let decay = exp(-7.0 * t)
            return attack * decay
        }

        for frame in 0..<frames {
            let t = Double(frame) / Double(sampleRate)
            let note1 = sin(2 * .pi * 880 * t)
            let note2 = t >= 0.07 ? sin(2 * .pi * 1320 * (t - 0.07)) * 0.70 : 0
            let note3 = t >= 0.12 ? sin(2 * .pi * 1760 * (t - 0.12)) * 0.42 : 0
            let mixed = max(-1, min(1, (note1 + note2 + note3) * envelope(t) * 0.42))
            var sample = Int16(mixed * Double(Int16.max)).littleEndian
            withUnsafeBytes(of: &sample) { pcm.append(contentsOf: $0) }
        }

        var data = Data()
        func appendASCII(_ text: String) { data.append(text.data(using: .ascii)!) }
        func append16(_ value: UInt16) {
            var v = value.littleEndian
            withUnsafeBytes(of: &v) { data.append(contentsOf: $0) }
        }
        func append32(_ value: UInt32) {
            var v = value.littleEndian
            withUnsafeBytes(of: &v) { data.append(contentsOf: $0) }
        }

        let dataSize = UInt32(pcm.count)
        appendASCII("RIFF")
        append32(36 + dataSize)
        appendASCII("WAVE")
        appendASCII("fmt ")
        append32(16)
        append16(1)
        append16(1)
        append32(UInt32(sampleRate))
        append32(UInt32(sampleRate * 2))
        append16(2)
        append16(16)
        appendASCII("data")
        append32(dataSize)
        data.append(pcm)
        return data
    }
}
