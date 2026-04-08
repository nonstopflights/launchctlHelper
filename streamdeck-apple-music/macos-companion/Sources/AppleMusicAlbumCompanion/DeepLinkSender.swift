import AppKit
import Foundation

enum DeepLinkSender {
    static func sendAssignment(url: URL, armedToken: String, requestId: String) -> Bool {
        var components = URLComponents()
        components.scheme = "streamdeck"
        components.host = "plugins"
        components.path = "/message/\(AppConstants.pluginUUID)/assign"
        components.queryItems = [
            URLQueryItem(name: "streamdeck", value: "hidden"),
            URLQueryItem(name: "requestId", value: requestId),
            URLQueryItem(name: "armedToken", value: armedToken),
            URLQueryItem(name: "url", value: url.absoluteString)
        ]

        guard let deepLinkURL = components.url else {
            return false
        }

        return NSWorkspace.shared.open(deepLinkURL)
    }
}
