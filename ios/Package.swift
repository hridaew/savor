// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "SplatCore",
    platforms: [
        .iOS(.v18),
        .macOS(.v15),
    ],
    products: [
        .library(name: "SplatCore", targets: ["SplatCore"]),
    ],
    targets: [
        .target(
            name: "SplatCore",
            path: "SplatCore/Sources/SplatCore"
        ),
        .testTarget(
            name: "SplatCoreTests",
            dependencies: ["SplatCore"],
            path: "SplatCore/Tests"
        ),
    ],
    swiftLanguageModes: [.v6]
)
