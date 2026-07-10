import RealityKit
import SplatCore
import SwiftUI

/// Optional RealityKit host for iOS 26+ native Gaussian splat rendering.
///
/// The shipping viewer uses `SplatMetalView`. This view is ready for Xcode 26's
/// `GaussianSplatComponent` — wire the typed API in `NativeGaussianSplatBuilder`
/// once that SDK is linked.
struct RealitySplatHostView: View {
    var cloud: SplatCloud?
    var autoRotate: Bool

    var body: some View {
        RealityView { content in
            let anchor = Entity()
            anchor.name = "SavorRoot"
            content.add(anchor)
        } update: { content in
            guard let cloud, let root = content.entities.first else { return }
            root.children.removeAll()
            let entity = Entity()
            entity.name = "SavorSplat"
            // Placeholder sphere communicates bounds until GaussianSplatComponent
            // is attached under Xcode 26.
            let radius = max(cloud.radius * 0.08, 0.05)
            let mesh = MeshResource.generateSphere(radius: radius)
            let material = SimpleMaterial(
                color: .init(red: 0.15, green: 0.55, blue: 1.0, alpha: 0.85),
                isMetallic: false
            )
            entity.components.set(ModelComponent(mesh: mesh, materials: [material]))
            if autoRotate {
                entity.components.set(TurntableComponent(radiansPerSecond: 0.35))
            }
            _ = cloud.count
            root.addChild(entity)
        }
    }
}

struct TurntableComponent: Component, Codable {
    var radiansPerSecond: Float
}
