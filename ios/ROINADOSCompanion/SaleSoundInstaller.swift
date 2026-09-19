import Foundation

enum SaleSoundInstaller {
    static let fileName = "roi-sale-v2.wav"

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
        let duration = 0.40
        let frames = Int(Double(sampleRate) * duration)
        var pcm = Data(capacity: frames * 2)

        func tone(_ frequency: Double, start: Double, decay: Double, gain: Double, at time: Double) -> Double {
            let local = time - start
            guard local >= 0 else { return 0 }
            let attack = min(1, local / 0.014)
            let envelope = attack * exp(-decay * local)
            return sin(2 * .pi * frequency * local) * envelope * gain
        }

        for frame in 0..<frames {
            let t = Double(frame) / Double(sampleRate)
            let first = tone(880, start: 0.00, decay: 12.0, gain: 0.27, at: t)
            let second = tone(1320, start: 0.07, decay: 11.0, gain: 0.19, at: t)
            let shimmer = tone(1760, start: 0.12, decay: 10.0, gain: 0.12, at: t)
            let mixed = max(-1, min(1, first + second + shimmer))
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
