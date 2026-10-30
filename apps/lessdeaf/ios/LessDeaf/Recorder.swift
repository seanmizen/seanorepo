import AVFoundation
import FluidAudio
import UIKit

/// Records the mic. It can write a WAV file at the native rate, and it can
/// cut 16-bit PCM chunks for the homelab. It always sends 16 kHz mono copies
/// to the live pipeline.
final class Recorder {
    private let engine = AVAudioEngine()
    private var file: AVAudioFile?
    private var chunker: PCMChunker?

    /// Starts the session and the tap. Returns facts about the input route.
    /// - Parameters:
    ///   - url: The WAV file to write, or nil to keep no local audio.
    ///   - onChunk: Gets each PCM chunk of about `chunkSeconds`, or nil to cut no chunks.
    func start(
        writingTo url: URL?,
        chunkSeconds: Double = 5,
        onChunk: (@Sendable (Data) -> Void)?,
        onSamples: @escaping @Sendable ([Float]) -> Void,
        onLevel: @escaping @Sendable (Float) -> Void
    ) throws -> DeviceInfo {
        let session = AVAudioSession.sharedInstance()
        // Measurement mode turns off Apple's voice processing. Raw audio is
        // what the comparison bench needs.
        try session.setCategory(.record, mode: .measurement)
        try session.setActive(true)

        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0 else { throw RecorderError.noInput }

        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatLinearPCM,
            AVSampleRateKey: format.sampleRate,
            AVNumberOfChannelsKey: format.channelCount,
            AVLinearPCMBitDepthKey: 16,
            AVLinearPCMIsFloatKey: false,
            AVLinearPCMIsBigEndianKey: false,
        ]
        let file = try url.map {
            try AVAudioFile(forWriting: $0, settings: settings, commonFormat: .pcmFormatFloat32, interleaved: false)
        }
        self.file = file
        let chunker = onChunk.map {
            PCMChunker(bytesPerChunk: Int(format.sampleRate * chunkSeconds) * Int(format.channelCount) * 2, onChunk: $0)
        }
        self.chunker = chunker

        let converter = AudioConverter()
        input.installTap(onBus: 0, bufferSize: 4096, format: format) { buffer, _ in
            try? file?.write(from: buffer)
            chunker?.append(buffer)
            onLevel(Self.rms(buffer))
            if let samples = try? converter.resampleBuffer(buffer) {
                onSamples(samples)
            }
        }
        engine.prepare()
        try engine.start()

        return DeviceInfo(
            model: Self.machineIdentifier(),
            systemVersion: UIDevice.current.systemVersion,
            inputPort: session.currentRoute.inputs.first?.portName ?? "unknown",
            sampleRate: format.sampleRate,
            channels: Int(format.channelCount),
            appVersion: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?"
        )
    }

    func stop() {
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        // The tap is gone, so no buffer can arrive during the flush.
        chunker?.flush()
        chunker = nil
        // Releasing the AVAudioFile closes it and writes the WAV header.
        file = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private static func rms(_ buffer: AVAudioPCMBuffer) -> Float {
        guard let channel = buffer.floatChannelData?[0], buffer.frameLength > 0 else { return 0 }
        var sum: Float = 0
        for i in 0..<Int(buffer.frameLength) { sum += channel[i] * channel[i] }
        return (sum / Float(buffer.frameLength)).squareRoot()
    }

    /// For example "iPhone17,1". `UIDevice.model` only says "iPhone".
    private static func machineIdentifier() -> String {
        var info = utsname()
        uname(&info)
        return withUnsafeBytes(of: &info.machine) { raw in
            String(decoding: raw.prefix { $0 != 0 }, as: UTF8.self)
        }
    }
}

enum RecorderError: LocalizedError {
    case noInput

    var errorDescription: String? {
        switch self {
        case .noInput: "No microphone input is available."
        }
    }
}

/// Converts float buffers to 16-bit little-endian PCM, interleaved, and cuts
/// it into chunks. The tap calls `append` on the audio thread.
final class PCMChunker {
    private let bytesPerChunk: Int
    private let onChunk: @Sendable (Data) -> Void
    private var data = Data()

    init(bytesPerChunk: Int, onChunk: @escaping @Sendable (Data) -> Void) {
        self.bytesPerChunk = bytesPerChunk
        self.onChunk = onChunk
        data.reserveCapacity(bytesPerChunk)
    }

    func append(_ buffer: AVAudioPCMBuffer) {
        guard let channels = buffer.floatChannelData else { return }
        let frames = Int(buffer.frameLength)
        let count = Int(buffer.format.channelCount)
        var samples = [Int16](repeating: 0, count: frames * count)
        for frame in 0..<frames {
            for channel in 0..<count {
                let value = max(-1, min(1, channels[channel][frame]))
                samples[frame * count + channel] = Int16(value * Float(Int16.max))
            }
        }
        samples.withUnsafeBytes { data.append(contentsOf: $0) }
        if data.count >= bytesPerChunk { flush() }
    }

    func flush() {
        guard !data.isEmpty else { return }
        onChunk(data)
        data = Data()
        data.reserveCapacity(bytesPerChunk)
    }
}
