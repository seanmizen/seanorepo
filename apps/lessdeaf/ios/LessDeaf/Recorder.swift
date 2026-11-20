import AVFoundation
import FluidAudio
import UIKit

/// Records the mic to a WAV file at the native rate, and sends 16 kHz mono
/// copies to the live pipeline.
final class Recorder {
    private let engine = AVAudioEngine()
    private var file: AVAudioFile?

    /// Starts the session and the tap. Returns facts about the input route.
    func start(
        writingTo url: URL,
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
        let file = try AVAudioFile(
            forWriting: url, settings: settings, commonFormat: .pcmFormatFloat32, interleaved: false)
        self.file = file

        let converter = AudioConverter()
        input.installTap(onBus: 0, bufferSize: 4096, format: format) { buffer, _ in
            try? file.write(from: buffer)
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
