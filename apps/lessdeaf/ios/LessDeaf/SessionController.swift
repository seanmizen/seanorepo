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

    let settings: HomelabSettings
    let uploader: Uploader

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
    var pendingUploads = 0

    private let pipeline = LivePipeline()
    private let recorder = Recorder()
    private var consumer: Task<Void, Never>?
    private var chunkConsumer: Task<Int, Never>?
    private var input: AsyncStream<[Float]>.Continuation?
    private var chunkInput: AsyncStream<Data>.Continuation?
    private var metadata: SessionMetadata?
    private var folder: URL?

    init() {
        let settings = HomelabSettings()
        self.settings = settings
        uploader = Uploader(client: { await settings.client })
        settings.apply(to: &draft)
        Task { await kickUploads() }
    }

    /// The draft needs consent only when it keeps audio.
    var canStart: Bool { draft.isLiveListen || draft.consent }

    func loadModels() async {
        modelState = .loading
        do {
            try await pipeline.prepare()
            modelState = .ready
        } catch {
            modelState = .failed(error.localizedDescription)
        }
    }

    func kickUploads() async {
        await uploader.kick()
        pendingUploads = await uploader.pendingCount()
    }

    /// Records even when the models are not ready. The audio is sample data
    /// for the comparison bench, so it has value with no live transcript.
    func start() async {
        guard !isRecording, canStart else { return }
        errorMessage = nil
        segments = []
        await pipeline.reset()

        let now = Date.now
        var metadata = draft
        metadata.id = SessionStore.newSessionID(at: now)
        metadata.startedAt = now
        if !settings.isConfigured {
            metadata.uploadAudio = false
            metadata.uploadTranscript = false
        }
        if metadata.isLiveListen { metadata.consent = false }

        let (stream, continuation) = AsyncStream<[Float]>.makeStream()
        let (chunks, chunkContinuation) = AsyncStream<Data>.makeStream()
        do {
            let folder = try SessionStore.folder(for: metadata.id)
            metadata.device = try recorder.start(
                writingTo: metadata.keepAudioOnPhone ? folder.appendingPathComponent(SessionStore.audioName) : nil,
                onChunk: metadata.uploadAudio ? { chunkContinuation.yield($0) } : nil,
                onSamples: { continuation.yield($0) },
                onLevel: { level in Task { @MainActor [weak self] in self?.level = level } }
            )
            try SessionStore.write(metadata, to: folder.appendingPathComponent(SessionStore.metadataName))
            self.folder = folder
        } catch {
            continuation.finish()
            chunkContinuation.finish()
            recorder.stop()
            errorMessage = error.localizedDescription
            return
        }

        self.metadata = metadata
        input = continuation
        chunkInput = chunkContinuation
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

        if metadata.uploadAudio {
            // The metadata goes first: the server needs the sample rate.
            await uploader.enqueueMetadata(metadata)
            let uploader = uploader
            let id = metadata.id
            chunkConsumer = Task {
                var seq = 0
                for await chunk in chunks {
                    await uploader.enqueuePart(id, seq: seq, chunk)
                    await uploader.kick()
                    seq += 1
                }
                return seq
            }
        } else {
            chunkContinuation.finish()
        }
    }

    func stop() async {
        guard isRecording, var metadata, let folder else { return }
        recorder.stop()
        input?.finish()
        chunkInput?.finish()
        isRecording = false
        isFinishing = true
        level = 0

        await consumer?.value
        let parts = await chunkConsumer?.value
        segments = await pipeline.finish()
        metadata.durationSeconds = startedAt.map { Date.now.timeIntervalSince($0) }
        let output = segments.isEmpty
            ? nil
            : PipelineOutput(pipeline: LivePipeline.name, createdAt: .now, segments: segments)

        do {
            try SessionStore.write(metadata, to: folder.appendingPathComponent(SessionStore.metadataName))
            if let output {
                try SessionStore.write(output, to: folder.appendingPathComponent(SessionStore.liveName))
            }
        } catch {
            errorMessage = error.localizedDescription
        }

        if metadata.uploadAudio || metadata.uploadTranscript {
            await uploader.enqueueMetadata(metadata)
            if let parts { await uploader.enqueueFinish(metadata.id, parts: parts) }
            if metadata.uploadTranscript, let output { await uploader.enqueueTranscript(metadata.id, output) }
            await kickUploads()
        }

        self.metadata = nil
        self.folder = nil
        consumer = nil
        chunkConsumer = nil
        input = nil
        chunkInput = nil
        startedAt = nil
        isFinishing = false
        savedCount += 1
        draft.consent = false
    }

    /// Starts a new draft with the storage defaults. Keeps the room and mic.
    func newDraft() {
        segments = []
        settings.apply(to: &draft)
    }
}
