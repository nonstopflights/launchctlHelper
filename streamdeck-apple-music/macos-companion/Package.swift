// swift-tools-version: 5.9

import PackageDescription

let package = Package(
    name: "AppleMusicAlbumCompanion",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(
            name: "AppleMusicAlbumCompanion",
            targets: ["AppleMusicAlbumCompanion"]
        )
    ],
    targets: [
        .executableTarget(
            name: "AppleMusicAlbumCompanion"
        )
    ]
)
