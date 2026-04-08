import SwiftUI

@main
struct AppleMusicAlbumCompanionApp: App {
    @StateObject private var model = CompanionViewModel()

    var body: some Scene {
        WindowGroup {
            ContentView(model: model)
                .onAppear {
                    model.start()
                }
                .onDisappear {
                    model.stop()
                }
        }
        .windowResizability(.contentSize)
    }
}
