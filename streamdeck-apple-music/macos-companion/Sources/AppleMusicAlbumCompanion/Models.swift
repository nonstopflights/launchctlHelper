import Foundation

struct ArmedSelection: Decodable {
    let armedAt: String
    let context: String
    let label: String
    let token: String
}

struct AssignmentResult: Decodable {
    let completedAt: String
    let context: String?
    let label: String?
    let message: String
    let requestId: String
    let status: Status
    let url: String?

    enum Status: String, Decodable {
        case error
        case success
    }
}

struct SharedPluginState: Decodable {
    let armed: ArmedSelection?
    let available: Bool
    let lastAssignment: AssignmentResult?
    let pluginUUID: String
    let updatedAt: String

    enum CodingKeys: String, CodingKey {
        case armed
        case available
        case lastAssignment
        case pluginUUID = "pluginUuid"
        case updatedAt
    }
}

enum PluginAvailability {
    case available
    case unavailable
}

enum StatusTone {
    case error
    case info
    case success
    case warning
}
