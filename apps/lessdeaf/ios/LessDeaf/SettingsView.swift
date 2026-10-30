import SwiftUI

struct SettingsView: View {
    @Environment(SessionController.self) private var controller
    @State private var checkResult: String?
    @State private var isChecking = false

    var body: some View {
        @Bindable var settings = controller.settings
        NavigationStack {
            Form {
                Section {
                    TextField("https://lessdeaf.example.com", text: $settings.baseURL)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    SecureField("Key (LESSDEAF_KEY)", text: $settings.key)
                    Button(isChecking ? "Checking" : "Test connection") {
                        Task { await check() }
                    }
                    .disabled(!settings.isConfigured || isChecking)
                    if let checkResult { Text(checkResult).font(.footnote) }
                } header: {
                    Text("Homelab")
                } footer: {
                    Text("The lessdeaf backend, apps/lessdeaf/server. On the LAN, an http://….local address also works.")
                }

                Section {
                    Toggle("Keep audio on this phone", isOn: $settings.keepAudioOnPhone)
                    Toggle("Send audio to the homelab", isOn: $settings.uploadAudio)
                    Toggle("Send the transcript to the homelab", isOn: $settings.uploadTranscript)
                } header: {
                    Text("Defaults for a new session")
                } footer: {
                    Text("Turn off both audio switches for live listen: only the transcript is saved.")
                }

                Section("Upload queue") {
                    LabeledContent("Waiting", value: "\(controller.pendingUploads)")
                    Button("Retry now") { Task { await controller.kickUploads() } }
                }
            }
            .navigationTitle("Settings")
            .task { await controller.kickUploads() }
            .onChange(of: settings.key) { Task { await controller.kickUploads() } }
        }
    }

    private func check() async {
        guard let client = controller.settings.client else { return }
        isChecking = true
        defer { isChecking = false }
        do {
            let count = try await client.check()
            checkResult = "Connected. The homelab holds \(count) sessions."
            await controller.kickUploads()
        } catch {
            checkResult = "Failed: \(error.localizedDescription)"
        }
    }
}
