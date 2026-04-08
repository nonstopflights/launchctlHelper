import Foundation

enum AppleMusicURLValidator {
    static func validateAlbumURL(_ rawValue: String) -> URL? {
        let trimmed = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)

        guard let url = URL(string: trimmed),
              url.scheme == "https",
              url.host?.lowercased() == "music.apple.com"
        else {
            return nil
        }

        let pathComponents = url.pathComponents.filter { $0 != "/" }
        let queryItems = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let containsTrackQuery = queryItems.contains(where: { $0.name == "i" })

        guard pathComponents.contains("album"),
              !containsTrackQuery
        else {
            return nil
        }

        return url
    }
}
