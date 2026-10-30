import Foundation

/// A disk queue of uploads to the homelab. Each job is a file in
/// `Application Support/uploads/<session id>/`, so the queue survives an
/// app restart and a lost network. A job file is deleted only after the
/// server accepts it.
///
/// Jobs of one session run in this order:
/// 1. `session.json` - the metadata (PUT again whenever it changes)
/// 2. `<seq>.pcm` - audio chunks, 16-bit PCM, lowest number first
/// 3. `finish.json` - `{"parts": n}`, only when no chunk is left
/// 4. `transcript-<pipeline>.json`
///
/// A job that the server refuses for good (a 4xx answer) gets the
/// `.failed` extension. It stays on disk and the queue goes on.
actor Uploader {
    private let root: URL
    private let client: @Sendable () async -> HomelabClient?
    private var isDraining = false

    init(client: @escaping @Sendable () async -> HomelabClient?) {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        root = support.appendingPathComponent("uploads", isDirectory: true)
        self.client = client
    }

    func enqueueMetadata(_ metadata: SessionMetadata) {
        write(try? JSONEncoder.lessdeaf.encode(metadata), id: metadata.id, name: "session.json")
    }

    func enqueuePart(_ id: String, seq: Int, _ pcm: Data) {
        write(pcm, id: id, name: String(format: "%06d.pcm", seq))
    }

    func enqueueFinish(_ id: String, parts: Int) {
        write(try? JSONEncoder().encode(["parts": parts]), id: id, name: "finish.json")
    }

    func enqueueTranscript(_ id: String, _ output: PipelineOutput) {
        write(try? JSONEncoder.lessdeaf.encode(output), id: id, name: "transcript-\(output.pipeline).json")
    }

    /// The number of jobs that wait, for all sessions.
    func pendingCount() -> Int {
        sessionFolders().reduce(0) { $0 + jobs(in: $1).count }
    }

    /// Starts the queue if it is not running. Call it after an enqueue, at
    /// app start and when the settings change.
    func kick() {
        guard !isDraining else { return }
        isDraining = true
        Task { await drain() }
    }

    private func drain() async {
        var delay: UInt64 = 2
        while true {
            guard let client = await client() else { break }
            guard let (folder, job) = nextJob() else { break }
            do {
                try await perform(job, session: folder.lastPathComponent, client: client)
                try? FileManager.default.removeItem(at: job)
                removeIfEmpty(folder)
                delay = 2
            } catch let error as HomelabError where error.isPermanent {
                print("lessdeaf: the homelab refused \(job.lastPathComponent): \(error.localizedDescription)")
                try? FileManager.default.moveItem(at: job, to: job.appendingPathExtension("failed"))
            } catch {
                print("lessdeaf: upload failed, retry in \(delay) s: \(error.localizedDescription)")
                try? await Task.sleep(nanoseconds: delay * 1_000_000_000)
                delay = min(delay * 2, 60)
            }
        }
        isDraining = false
    }

    private func perform(_ job: URL, session id: String, client: HomelabClient) async throws {
        let name = job.lastPathComponent
        let data = try Data(contentsOf: job)
        if name == "session.json" {
            try await client.putMetadata(id, data)
        } else if name.hasSuffix(".pcm"), let seq = Int(name.dropLast(4)) {
            try await client.putPart(id, seq: seq, data)
        } else if name == "finish.json" {
            let parts = try JSONDecoder().decode([String: Int].self, from: data)["parts"] ?? 0
            try await client.finishAudio(id, parts: parts)
        } else if name.hasPrefix("transcript-"), name.hasSuffix(".json") {
            let pipeline = String(name.dropFirst("transcript-".count).dropLast(".json".count))
            try await client.putTranscript(id, pipeline: pipeline, data)
        }
    }

    /// The first job of the oldest session that has one.
    private func nextJob() -> (URL, URL)? {
        for folder in sessionFolders() {
            if let job = jobs(in: folder).first { return (folder, job) }
        }
        return nil
    }

    private func jobs(in folder: URL) -> [URL] {
        let files = (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? []
        let names = Set(files.map(\.lastPathComponent))
        let parts = names.filter { $0.hasSuffix(".pcm") }.sorted()
        var order: [String] = []
        if names.contains("session.json") { order.append("session.json") }
        order += parts
        if parts.isEmpty, names.contains("finish.json") { order.append("finish.json") }
        // A transcript waits for the audio, so the server never has a
        // transcript for a session whose audio is still half sent.
        if parts.isEmpty, !names.contains("finish.json") {
            order += names.filter { $0.hasPrefix("transcript-") && $0.hasSuffix(".json") }.sorted()
        }
        return order.map { folder.appendingPathComponent($0) }
    }

    private func sessionFolders() -> [URL] {
        let folders = (try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)) ?? []
        return folders.sorted { $0.lastPathComponent < $1.lastPathComponent }
    }

    private func write(_ data: Data?, id: String, name: String) {
        guard let data else { return }
        let folder = root.appendingPathComponent(id, isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            try data.write(to: folder.appendingPathComponent(name), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        } catch {
            print("lessdeaf: could not queue \(name): \(error.localizedDescription)")
        }
    }

    private func removeIfEmpty(_ folder: URL) {
        let left = (try? FileManager.default.contentsOfDirectory(atPath: folder.path)) ?? []
        if left.isEmpty { try? FileManager.default.removeItem(at: folder) }
    }
}
