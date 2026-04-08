import Foundation

enum PluginStateStore {
    static func load() -> SharedPluginState? {
        guard let data = try? Data(contentsOf: AppConstants.sharedStatePath) else {
            return nil
        }

        return try? JSONDecoder().decode(SharedPluginState.self, from: data)
    }

    static func availability(for state: SharedPluginState?) -> PluginAvailability {
        guard let state,
              let updatedAt = ISO8601DateFormatter().date(from: state.updatedAt),
              Date().timeIntervalSince(updatedAt) <= AppConstants.staleAfter
        else {
            return .unavailable
        }

        return .available
    }
}
