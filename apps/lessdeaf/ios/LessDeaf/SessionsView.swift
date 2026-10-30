import SwiftUI

struct SessionsView: View {
    @Environment(SessionController.self) private var controller
    @State private var sessions: [SessionMetadata] = []

    var body: some View {
        NavigationStack {
            List {
                ForEach(sessions, id: \.id) { session in
                    HStack {
                        NavigationLink {
                            SessionDetailView(session: session)
                        } label: {
                            VStack(alignment: .leading) {
                                Text(session.startedAt.formatted(date: .abbreviated, time: .shortened))
                                Text(summary(session)).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        ShareLink(items: SessionStore.files(for: session.id)) {
                            Image(systemName: "square.and.arrow.up")
                        }
                        .buttonStyle(.borderless)
                    }
                }
                .onDelete { offsets in
                    for index in offsets { try? SessionStore.delete(sessions[index].id) }
                    reload()
                }
            }
            .overlay {
                if sessions.isEmpty {
                    ContentUnavailableView("No sessions", systemImage: "waveform", description: Text("Recorded sessions show here and in the Files app, under lessdeaf."))
                }
            }
            .navigationTitle("Sessions")
            .onAppear(perform: reload)
            .onChange(of: controller.savedCount) { reload() }
        }
    }

    private func reload() {
        sessions = SessionStore.listSessions()
    }

    private func summary(_ session: SessionMetadata) -> String {
        let duration = session.durationSeconds.map {
            Duration.seconds($0).formatted(.time(pattern: .minuteSecond))
        } ?? "unfinished"
        let storage = session.isLiveListen
            ? "live listen"
            : [session.keepAudioOnPhone ? "phone" : nil, session.uploadAudio ? "homelab" : nil]
                .compactMap { $0 }.joined(separator: " + ")
        return "\(duration) · \(session.room.rawValue) · \(session.speakerCount) speakers · \(storage)"
    }
}
