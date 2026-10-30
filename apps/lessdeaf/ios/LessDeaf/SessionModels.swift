import Foundation

/// What the person recording tells us about a session. Saved as `session.json`.
struct SessionMetadata: Codable {
    enum Room: String, Codable, CaseIterable, Identifiable {
        case quiet, cafe, pub, party, other
        var id: String { rawValue }
    }

    enum MicSetup: String, Codable, CaseIterable, Identifiable {
        case phoneMic, externalArray, lapel, other
        var id: String { rawValue }

        var label: String {
            switch self {
            case .phoneMic: "Phone mic"
            case .externalArray: "External mic array"
            case .lapel: "Lapel mics"
            case .other: "Other"
            }
        }
    }

    var id: String
    var startedAt: Date
    var durationSeconds: Double?
    var room: Room = .quiet
    var speakerCount = 2
    var micSetup: MicSetup = .phoneMic
    var placement = ""
    var notes = ""
    var consent = false
    var device: DeviceInfo?

    /// Where the audio goes. With both audio switches off, the session is
    /// "live listen": only the transcript survives.
    var keepAudioOnPhone = true
    var uploadAudio = false
    var uploadTranscript = false

    var isLiveListen: Bool { !keepAudioOnPhone && !uploadAudio }
}

/// Recording facts that the app reads from the system.
struct DeviceInfo: Codable {
    var model: String
    var systemVersion: String
    var inputPort: String
    var sampleRate: Double
    var channels: Int
    var appVersion: String
}

/// The common output format. Every pipeline writes one of these, so the
/// scoring tool can compare pipelines on the same audio.
struct PipelineOutput: Codable {
    var pipeline: String
    var createdAt: Date
    var segments: [TranscriptSegment]
}

/// One run of words from one speaker. `speaker` is nil when the diarizer
/// found no speech under the words.
struct TranscriptSegment: Codable, Identifiable, Equatable {
    var speaker: Int?
    var start: Double
    var end: Double
    var words: [TranscriptWord]

    var id: Double { start }
    var text: String { words.map(\.text).joined(separator: " ") }
}

struct TranscriptWord: Codable, Equatable {
    var text: String
    var start: Double
    var end: Double
    var confidence: Float
}

extension JSONEncoder {
    static let lessdeaf: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }()
}

extension JSONDecoder {
    static let lessdeaf: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }()
}
