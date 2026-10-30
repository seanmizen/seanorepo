import SwiftUI

struct RecordView: View {
    @Environment(SessionController.self) private var controller

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if controller.isRecording || !controller.segments.isEmpty {
                    TranscriptView(segments: controller.segments)
                } else {
                    SessionForm()
                }
                RecordBar()
            }
            .navigationTitle("lessdeaf")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { ModelBadge() }
                if !controller.isRecording, !controller.segments.isEmpty {
                    ToolbarItem(placement: .topBarLeading) {
                        Button("New") { controller.newDraft() }
                    }
                }
            }
        }
    }
}

private struct SessionForm: View {
    @Environment(SessionController.self) private var controller

    var body: some View {
        @Bindable var controller = controller
        Form {
            Section("Room") {
                Picker("Room", selection: $controller.draft.room) {
                    ForEach(SessionMetadata.Room.allCases) { Text($0.rawValue.capitalized).tag($0) }
                }
                Stepper("Speakers: \(controller.draft.speakerCount)", value: $controller.draft.speakerCount, in: 1...12)
            }
            Section("Mic") {
                Picker("Setup", selection: $controller.draft.micSetup) {
                    ForEach(SessionMetadata.MicSetup.allCases) { Text($0.label).tag($0) }
                }
                TextField("Placement, for example: on the table, 1 m", text: $controller.draft.placement)
            }
            Section("Notes") {
                TextField("Anything that helps later", text: $controller.draft.notes, axis: .vertical)
            }
            StorageSection()
            if !controller.draft.isLiveListen {
                Section {
                    Toggle("All speakers agree to this recording", isOn: $controller.draft.consent)
                } footer: {
                    Text("lessdeaf keeps the raw audio as sample data. Record only people who agree.")
                }
            }
            if let error = controller.errorMessage {
                Section { Text(error).foregroundStyle(.red) }
            }
        }
    }
}

private struct StorageSection: View {
    @Environment(SessionController.self) private var controller

    var body: some View {
        @Bindable var controller = controller
        let homelab = controller.settings.isConfigured
        Section {
            Toggle("Keep audio on this phone", isOn: $controller.draft.keepAudioOnPhone)
            Toggle("Send audio to the homelab", isOn: $controller.draft.uploadAudio)
                .disabled(!homelab)
            Toggle("Send the transcript to the homelab", isOn: $controller.draft.uploadTranscript)
                .disabled(!homelab)
        } header: {
            Text("Storage")
        } footer: {
            if controller.draft.isLiveListen {
                Text("Live listen: lessdeaf keeps no audio. Only the transcript is saved.")
            } else if !homelab {
                Text("To send to the homelab, set its address and key in Settings.")
            }
        }
    }
}

private struct TranscriptView: View {
    let segments: [TranscriptSegment]

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 12) {
                    if segments.isEmpty {
                        Text("Listening. The first words show after about 6 seconds.")
                            .foregroundStyle(.secondary)
                    }
                    ForEach(segments) { segment in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(SpeakerStyle.name(segment.speaker))
                                .font(.caption.bold())
                                .foregroundStyle(SpeakerStyle.color(segment.speaker))
                            Text(segment.text).font(.title3)
                        }
                        .id(segment.id)
                    }
                }
                .padding()
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .onChange(of: segments) {
                if let last = segments.last { withAnimation { proxy.scrollTo(last.id, anchor: .bottom) } }
            }
        }
    }
}

private struct RecordBar: View {
    @Environment(SessionController.self) private var controller

    var body: some View {
        HStack(spacing: 16) {
            if let startedAt = controller.startedAt {
                TimelineView(.periodic(from: startedAt, by: 1)) { context in
                    Text(Duration.seconds(context.date.timeIntervalSince(startedAt)).formatted(.time(pattern: .minuteSecond)))
                        .monospacedDigit()
                }
                ProgressView(value: min(Double(controller.level) * 8, 1))
            } else if controller.isFinishing {
                ProgressView()
                Text("Saving")
            } else {
                Spacer()
            }
            Button {
                Task {
                    if controller.isRecording { await controller.stop() } else { await controller.start() }
                }
            } label: {
                Image(systemName: controller.isRecording ? "stop.circle.fill" : "record.circle")
                    .font(.system(size: 56))
                    .foregroundStyle(.red)
            }
            .disabled(controller.isFinishing || (!controller.isRecording && !controller.canStart))
        }
        .padding()
        .background(.bar)
    }
}

private struct ModelBadge: View {
    @Environment(SessionController.self) private var controller

    var body: some View {
        switch controller.modelState {
        case .loading:
            Label("Loading models", systemImage: "arrow.down.circle").labelStyle(.titleAndIcon).font(.caption)
        case .ready:
            Label("Live", systemImage: "checkmark.circle").font(.caption).foregroundStyle(.green)
        case .failed(let message):
            Button {
                Task { await controller.loadModels() }
            } label: {
                Label("Record only", systemImage: "exclamationmark.triangle").font(.caption)
            }
            .help(message)
        }
    }
}

enum SpeakerStyle {
    private static let colors: [Color] = [.blue, .orange, .green, .purple, .pink, .teal, .brown, .indigo, .mint, .cyan]

    static func name(_ speaker: Int?) -> String {
        guard let speaker else { return "Unknown" }
        return "Speaker \(speaker + 1)"
    }

    static func color(_ speaker: Int?) -> Color {
        guard let speaker else { return .secondary }
        return colors[speaker % colors.count]
    }
}
