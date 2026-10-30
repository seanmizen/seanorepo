import SwiftUI

@main
struct LessDeafApp: App {
    @State private var controller = SessionController()

    var body: some Scene {
        WindowGroup {
            TabView {
                RecordView()
                    .tabItem { Label("Record", systemImage: "waveform") }
                SessionsView()
                    .tabItem { Label("Sessions", systemImage: "folder") }
            }
            .environment(controller)
            .task { await controller.loadModels() }
        }
    }
}
