import Foundation
import Observation

@MainActor
@Observable
final class SessionController {
    enum ModelState: Equatable {
        case loading
        case ready
        case failed(String)
    }

    var modelState: ModelState = .loading
    var isRecording = false
    var isFinishing = false
    var startedAt: Date?
    var level: Float = 0
    var segments: [TranscriptSegment] = []
    var errorMessage: String?
    var draft = SessionMetadata(id: "", startedAt: .now)
    /// Changes when a session is saved, so the sessions list reloads.
    var savedCount = 0

    private let pipeline = LivePipeline()
    private let recorder = Recorder()
    private var consumer: Task<Void, Never>?
    private var input: AsyncStream<[Float]>.Continuation?
    private var metadata: SessionMetadata?
    private var folder: URL?

    func loadModels() async {
        modelState = .loading
        do {
            try await pipeline.prepare()
            modelState = .ready
        } catch {
            modelState = .failed(error.localizedDescription)
        }
    }

    /// Records even when the models are not ready. The audio is sample data
    /// for the comparison bench, so it has value with no live transcript.
    func start() async {
        guard !isRecording, draft.consent else { return }
        errorMessage = nil
        segments = []
        await pipeline.reset()

        let now = Date.now
        var metadata = draft
        metadata.id = SessionStore.newSessionID(at: now)
        metadata.startedAt = now

        let (stream, continuation) = AsyncStream<[Float]>.makeStream()
        do {
            let folder = try SessionStore.folder(for: metadata.id)
            metadata.device = try recorder.start(
                writingTo: folder.appendingPathComponent(SessionStore.audioName),
                onSamples: { continuation.yield($0) },
                onLevel: { level in Task { @MainActor [weak self] in self?.level = level } }
            )
            try SessionStore.write(metadata, to: folder.appendingPathComponent(SessionStore.metadataName))
            self.folder = folder
        } catch {
            continuation.finish()
            recorder.stop()
            errorMessage = error.localizedDescription
            return
        }

        self.metadata = metadata
        input = continuation
        startedAt = now
        isRecording = true

        let pipeline = pipeline
        consumer = Task { [weak self] in
            for await samples in stream {
                if let segments = await pipeline.ingest(samples) {
                    self?.segments = segments
                }
            }
        }
    }

    func stop() async {
        guard isRecording, var metadata, let folder else { return }
        recorder.stop()
        input?.finish()
        isRecording = false
        isFinishing = true
        level = 0

        await consumer?.value
        segments = await pipeline.finish()
        metadata.durationSeconds = startedAt.map { Date.now.timeIntervalSince($0) }

        do {
            try SessionStore.write(metadata, to: folder.appendingPathComponent(SessionStore.metadataName))
            if !segments.isEmpty {
                let output = PipelineOutput(pipeline: LivePipeline.name, createdAt: .now, segments: segments)
                try SessionStore.write(output, to: folder.appendingPathComponent(SessionStore.liveName))
            }
        } catch {
            errorMessage = error.localizedDescription
        }

        self.metadata = nil
        self.folder = nil
        consumer = nil
        input = nil
        startedAt = nil
        isFinishing = false
        savedCount += 1
    }
}
