import Foundation

/// Sessions live in `Documents/sessions/<id>/`. The Files app shows this
/// folder, so sample data can be copied off the phone.
enum SessionStore {
    static let audioName = "audio.wav"
    static let metadataName = "session.json"
    static let liveName = "live.json"

    static var root: URL {
        let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        return documents.appendingPathComponent("sessions", isDirectory: true)
    }

    /// The date and time, plus 4 random characters, so two phones that start
    /// in the same second do not share an ID on the homelab.
    static func newSessionID(at date: Date = .now) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd'T'HH-mm-ss"
        let suffix = UUID().uuidString.prefix(4).lowercased()
        return "\(formatter.string(from: date))-\(suffix)"
    }

    static func folder(for id: String) throws -> URL {
        let url = root.appendingPathComponent(id, isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    static func write<T: Encodable>(_ value: T, to url: URL) throws {
        try JSONEncoder.lessdeaf.encode(value).write(to: url, options: .atomic)
    }

    static func listSessions() -> [SessionMetadata] {
        let folders = (try? FileManager.default.contentsOfDirectory(
            at: root, includingPropertiesForKeys: nil)) ?? []
        return folders.compactMap { folder in
            let url = folder.appendingPathComponent(metadataName)
            guard let data = try? Data(contentsOf: url) else { return nil }
            return try? JSONDecoder.lessdeaf.decode(SessionMetadata.self, from: data)
        }
        .sorted { $0.startedAt > $1.startedAt }
    }

    static func audioURL(for id: String) -> URL? {
        let url = root.appendingPathComponent(id, isDirectory: true).appendingPathComponent(audioName)
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    static func transcript(for id: String) -> PipelineOutput? {
        let url = root.appendingPathComponent(id, isDirectory: true).appendingPathComponent(liveName)
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder.lessdeaf.decode(PipelineOutput.self, from: data)
    }

    static func files(for id: String) -> [URL] {
        let folder = root.appendingPathComponent(id, isDirectory: true)
        return [audioName, metadataName, liveName]
            .map { folder.appendingPathComponent($0) }
            .filter { FileManager.default.fileExists(atPath: $0.path) }
    }

    static func delete(_ id: String) throws {
        try FileManager.default.removeItem(at: root.appendingPathComponent(id, isDirectory: true))
    }
}
