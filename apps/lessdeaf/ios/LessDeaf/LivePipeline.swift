import FluidAudio
import Foundation

/// Pipeline 1: Parakeet TDT v3 ASR plus LS-EEND streaming diarization, both
/// from FluidAudio.
///
/// - Every 16 kHz block goes to LS-EEND at once. It commits frames every 100 ms.
/// - The ASR runs on chunks of about 6 s. Each chunk ends at the quietest
///   20 ms frame in its last 1.5 s, so a cut seldom splits a word.
/// - Each word gets the speaker whose diarizer segments overlap it most.
actor LivePipeline {
    static let name = "fluidaudio-parakeet-v3+lseend-dihard3-live"

    private static let sampleRate = 16_000
    private static let targetChunk = 6 * sampleRate
    private static let cutSearch = sampleRate * 3 / 2
    private static let frame = sampleRate / 50
    private static let minimumChunk = sampleRate

    private var asr: AsrManager?
    private var decoderLayers = 2
    private var diarizer: LSEENDDiarizer?

    private var pending: [Float] = []
    private var pendingStart = 0
    private var words: [TranscriptWord] = []
    /// Fixed at session start. If the models finish loading during a session,
    /// that session stays record-only, so its times match the WAV file.
    private var isActive = false

    var isReady: Bool { asr != nil && diarizer != nil }

    func prepare() async throws {
        let models = try await AsrModels.downloadAndLoad(version: .v3)
        let asr = AsrManager(config: .default)
        try await asr.loadModels(models)
        decoderLayers = await asr.decoderLayerCount
        self.asr = asr
        diarizer = try await LSEENDDiarizer(variant: .dihard3)
    }

    /// Clears the state from the last session. The models stay loaded.
    func reset() {
        pending.removeAll()
        pendingStart = 0
        words.removeAll()
        diarizer?.reset()
        isActive = isReady
    }

    /// Takes one block of 16 kHz mono samples. Returns the full transcript
    /// when it changed, or nil.
    func ingest(_ samples: [Float]) async -> [TranscriptSegment]? {
        guard isActive else { return nil }
        do {
            try diarizer?.addAudio(samples, sourceSampleRate: Double(Self.sampleRate))
            _ = try diarizer?.process()
        } catch {
            print("lessdeaf: diarizer failed: \(error)")
        }

        pending.append(contentsOf: samples)
        guard pending.count >= Self.targetChunk else { return nil }

        let cut = quietestCut()
        let chunk = Array(pending[..<cut])
        let chunkStart = pendingStart
        pending.removeFirst(cut)
        pendingStart += cut

        await transcribe(chunk, startingAt: chunkStart)
        return segments()
    }

    /// Transcribes the remaining audio and closes the diarizer. Returns the
    /// final transcript, with every word assigned again on the full timeline.
    func finish() async -> [TranscriptSegment] {
        guard isActive else { return [] }
        isActive = false
        if pending.count >= Self.minimumChunk {
            await transcribe(pending, startingAt: pendingStart)
        }
        pending.removeAll()
        _ = try? diarizer?.finalizeSession()
        return segments()
    }

    private func quietestCut() -> Int {
        let searchStart = max(Self.minimumChunk, pending.count - Self.cutSearch)
        var best = pending.count
        var bestEnergy = Float.greatestFiniteMagnitude
        var position = searchStart
        while position + Self.frame <= pending.count {
            var energy: Float = 0
            for i in position..<(position + Self.frame) { energy += pending[i] * pending[i] }
            if energy < bestEnergy {
                bestEnergy = energy
                best = position + Self.frame / 2
            }
            position += Self.frame
        }
        return best
    }

    private func transcribe(_ chunk: [Float], startingAt start: Int) async {
        guard let asr else { return }
        let offset = Double(start) / Double(Self.sampleRate)
        var state = TdtDecoderState.make(decoderLayers: decoderLayers)
        do {
            let result = try await asr.transcribe(chunk, decoderState: &state)
            words.append(contentsOf: Self.words(from: result.tokenTimings ?? [], offset: offset))
        } catch {
            print("lessdeaf: ASR failed on the chunk at \(offset) s: \(error)")
        }
    }

    /// Joins SentencePiece tokens into words. A token that starts with a
    /// space starts a new word.
    private static func words(from tokens: [TokenTiming], offset: Double) -> [TranscriptWord] {
        var result: [TranscriptWord] = []
        for token in tokens {
            let text = token.token.trimmingCharacters(in: .whitespaces)
            guard !text.isEmpty else { continue }
            if token.token.hasPrefix(" ") || result.isEmpty {
                result.append(TranscriptWord(
                    text: text, start: token.startTime + offset, end: token.endTime + offset,
                    confidence: token.confidence))
            } else {
                result[result.count - 1].text += text
                result[result.count - 1].end = token.endTime + offset
                result[result.count - 1].confidence = min(result[result.count - 1].confidence, token.confidence)
            }
        }
        return result
    }

    /// Groups the words into segments, one segment per run of one speaker.
    private func segments() -> [TranscriptSegment] {
        let speakers = diarizer.map { Array($0.timeline.speakers.values) } ?? []
        let speech: [(speaker: Int, start: Double, end: Double)] = speakers.flatMap { speaker in
            speaker.finalizedSegments.map {
                (speaker: $0.speakerIndex, start: Double($0.startTime), end: Double($0.endTime))
            }
        }

        var result: [TranscriptSegment] = []
        for word in words {
            let speaker = Self.speaker(for: word, in: speech)
            if var last = result.last, last.speaker == speaker, word.start - last.end < 2 {
                last.words.append(word)
                last.end = word.end
                result[result.count - 1] = last
            } else {
                result.append(TranscriptSegment(speaker: speaker, start: word.start, end: word.end, words: [word]))
            }
        }
        return result
    }

    private static func speaker(
        for word: TranscriptWord, in speech: [(speaker: Int, start: Double, end: Double)]
    ) -> Int? {
        var overlap: [Int: Double] = [:]
        for segment in speech {
            let shared = min(word.end, segment.end) - max(word.start, segment.start)
            if shared > 0 { overlap[segment.speaker, default: 0] += shared }
        }
        return overlap.max { $0.value < $1.value }?.key
    }
}
