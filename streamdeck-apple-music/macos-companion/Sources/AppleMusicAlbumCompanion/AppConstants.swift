import Foundation

enum AppConstants {
    static let pluginUUID = "com.aelchert.apple-music-album"
    static let sharedStatePath = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library")
        .appendingPathComponent("Application Support")
        .appendingPathComponent(pluginUUID)
        .appendingPathComponent("state.json")
    static let staleAfter: TimeInterval = 30
}
