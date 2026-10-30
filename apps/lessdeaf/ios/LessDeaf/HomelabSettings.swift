import Foundation
import Observation

/// The homelab address and key, and the storage defaults for a new session.
@MainActor
@Observable
final class HomelabSettings {
    private static let defaults = UserDefaults.standard

    var baseURL: String { didSet { Self.defaults.set(baseURL, forKey: "homelab.url") } }
    var key: String { didSet { Keychain.set(key, for: "homelab.key") } }
    var keepAudioOnPhone: Bool { didSet { Self.defaults.set(keepAudioOnPhone, forKey: "default.keepAudio") } }
    var uploadAudio: Bool { didSet { Self.defaults.set(uploadAudio, forKey: "default.uploadAudio") } }
    var uploadTranscript: Bool { didSet { Self.defaults.set(uploadTranscript, forKey: "default.uploadTranscript") } }

    init() {
        baseURL = Self.defaults.string(forKey: "homelab.url") ?? "https://lessdeaf.seanmizen.com"
        key = Keychain.get("homelab.key")
        keepAudioOnPhone = Self.defaults.object(forKey: "default.keepAudio") as? Bool ?? true
        uploadAudio = Self.defaults.bool(forKey: "default.uploadAudio")
        uploadTranscript = Self.defaults.bool(forKey: "default.uploadTranscript")
    }

    var client: HomelabClient? {
        guard !key.isEmpty, let url = URL(string: baseURL.trimmingCharacters(in: .whitespaces)),
              url.scheme == "https" || url.scheme == "http", url.host != nil else { return nil }
        return HomelabClient(baseURL: url, key: key)
    }

    var isConfigured: Bool { client != nil }

    /// Copies the defaults into a new session draft.
    func apply(to metadata: inout SessionMetadata) {
        metadata.keepAudioOnPhone = keepAudioOnPhone
        metadata.uploadAudio = uploadAudio && isConfigured
        metadata.uploadTranscript = uploadTranscript && isConfigured
    }
}
