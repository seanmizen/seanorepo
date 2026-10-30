import AVFoundation
import SwiftUI

/// One saved session: its transcript and, when the audio exists on the phone
/// or the homelab, a player. Tap a line to play from it.
struct SessionDetailView: View {
    @Environment(SessionController.self) private var controller
    let session: SessionMetadata

    @State private var transcript: PipelineOutput?
    @State private var player = SessionPlayer()
    @State private var errorMessage: String?
    @State private var isDownloading = false

    var body: some View {
        VStack(spacing: 0) {
            TimelineView(.periodic(from: .now, by: 0.25)) { _ in
                lines(current: player.currentTime)
            }
            playerBar
        }
        .navigationTitle(session.startedAt.formatted(date: .abbreviated, time: .shortened))
        .navigationBarTitleDisplayMode(.inline)
        .task {
            transcript = SessionStore.transcript(for: session.id)
            if let url = SessionStore.audioURL(for: session.id) { load(url) }
        }
        .onDisappear { player.stop() }
    }

    private func lines(current: TimeInterval) -> some View {
        List {
                Section {
                    LabeledContent("Room", value: session.room.rawValue.capitalized)
                    LabeledContent("Speakers", value: "\(session.speakerCount)")
                    LabeledContent("Mic", value: session.micSetup.label)
                    if !session.placement.isEmpty { LabeledContent("Placement", value: session.placement) }
                    if !session.notes.isEmpty { Text(session.notes).font(.footnote) }
                }
                Section("Transcript") {
                    if let segments = transcript?.segments, !segments.isEmpty {
                        ForEach(segments) { segment in
                            let isCurrent = player.isLoaded && segment.start <= current && current < segment.end + 0.5
                            Button {
                                player.play(from: segment.start)
                            } label: {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("\(SpeakerStyle.name(segment.speaker)) · \(Self.clock(segment.start))")
                                        .font(.caption.bold())
                                        .foregroundStyle(SpeakerStyle.color(segment.speaker))
                                    Text(segment.text).foregroundStyle(.primary)
                                }
                            }
                            .disabled(!player.isLoaded)
                            .listRowBackground(isCurrent ? Color.accentColor.opacity(0.15) : nil)
                            .id(segment.id)
                        }
                    } else {
                        Text("This session has no transcript.").foregroundStyle(.secondary)
                    }
                }
        }
    }

    @ViewBuilder private var playerBar: some View {
        HStack(spacing: 16) {
            if player.isLoaded {
                Button {
                    player.toggle()
                } label: {
                    Image(systemName: player.isPlaying ? "pause.circle.fill" : "play.circle.fill").font(.system(size: 44))
                }
                Text("\(Self.clock(player.currentTime)) / \(Self.clock(player.duration))").monospacedDigit()
                Spacer()
            } else if session.uploadAudio, let client = controller.settings.client {
                Button(isDownloading ? "Downloading" : "Play from the homelab") {
                    Task { await download(client) }
                }
                .disabled(isDownloading)
                Spacer()
            } else {
                Text(session.isLiveListen ? "Live listen: no audio was kept." : "No audio on this phone.")
                    .foregroundStyle(.secondary)
                Spacer()
            }
            if let errorMessage { Text(errorMessage).font(.caption).foregroundStyle(.red) }
        }
        .padding()
        .background(.bar)
    }

    private func load(_ url: URL) {
        do {
            try player.load(url)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func download(_ client: HomelabClient) async {
        isDownloading = true
        defer { isDownloading = false }
        do {
            load(try await client.downloadAudio(session.id))
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private static func clock(_ seconds: TimeInterval) -> String {
        Duration.seconds(max(0, seconds)).formatted(.time(pattern: .minuteSecond))
    }
}

/// A thin wrapper on AVAudioPlayer. The view reads `currentTime` on a timer.
@MainActor
@Observable
final class SessionPlayer: NSObject, AVAudioPlayerDelegate {
    private var player: AVAudioPlayer?
    private(set) var isPlaying = false

    var isLoaded: Bool { player != nil }
    var duration: TimeInterval { player?.duration ?? 0 }
    var currentTime: TimeInterval { player?.currentTime ?? 0 }

    func load(_ url: URL) throws {
        let player = try AVAudioPlayer(contentsOf: url)
        player.delegate = self
        player.prepareToPlay()
        self.player = player
    }

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor in self.isPlaying = false }
    }

    func play(from time: TimeInterval? = nil) {
        guard let player else { return }
        try? AVAudioSession.sharedInstance().setCategory(.playback)
        try? AVAudioSession.sharedInstance().setActive(true)
        if let time { player.currentTime = time }
        player.play()
        isPlaying = true
    }

    func toggle() {
        if isPlaying {
            player?.pause()
            isPlaying = false
        } else {
            play()
        }
    }

    func stop() {
        player?.stop()
        isPlaying = false
    }
}
