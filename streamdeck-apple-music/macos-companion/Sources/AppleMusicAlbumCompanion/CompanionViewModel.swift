import Combine
import Foundation

@MainActor
final class CompanionViewModel: ObservableObject {
    @Published var albumURL: String = ""
    @Published var armedKeyLabel: String = "No key armed"
    @Published var pluginStatus: String = "Waiting for Stream Deck plugin"
    @Published var statusMessage: String = "Arm a Stream Deck key in the plugin inspector, then paste an Apple Music album URL."
    @Published var statusTone: StatusTone = .info

    private var pendingRequestID: String?
    private var refreshTask: Task<Void, Never>?
    private var latestState: SharedPluginState?

    func start() {
        refresh()

        refreshTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(1))
                refresh()
            }
        }
    }

    func stop() {
        refreshTask?.cancel()
        refreshTask = nil
    }

    func assign() {
        guard let validatedURL = AppleMusicURLValidator.validateAlbumURL(albumURL) else {
            statusMessage = "Enter a valid Apple Music album URL."
            statusTone = .error
            return
        }

        refresh()

        guard PluginStateStore.availability(for: latestState) == .available else {
            statusMessage = "The Stream Deck plugin is unavailable. Open Stream Deck and make sure the plugin is installed."
            statusTone = .error
            return
        }

        guard let armedSelection = latestState?.armed else {
            statusMessage = "No Stream Deck key is armed. Select the action in Stream Deck and click Arm Current Key."
            statusTone = .error
            return
        }

        let requestID = UUID().uuidString.lowercased()
        pendingRequestID = requestID

        guard DeepLinkSender.sendAssignment(url: validatedURL, armedToken: armedSelection.token, requestId: requestID) else {
            statusMessage = "Unable to deliver the assignment to Stream Deck."
            statusTone = .error
            pendingRequestID = nil
            return
        }

        statusMessage = "Assignment sent. Waiting for the plugin to confirm the selected key."
        statusTone = .info
    }

    func refresh() {
        latestState = PluginStateStore.load()

        switch PluginStateStore.availability(for: latestState) {
        case .available:
            pluginStatus = "Connected"
        case .unavailable:
            pluginStatus = "Unavailable"
        }

        armedKeyLabel = latestState?.armed?.label ?? "No key armed"

        if let pendingRequestID,
           let result = latestState?.lastAssignment,
           result.requestId == pendingRequestID
        {
            statusMessage = result.message
            statusTone = result.status == .success ? .success : .error
            self.pendingRequestID = nil
        }
    }
}
