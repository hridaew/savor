import Metal
import MetalKit
import simd
import SplatCore
import SwiftUI
import UIKit

struct SplatMetalView: UIViewRepresentable {
    var plyURL: URL?
    var autoRotate: Bool
    var resetToken: Int
    var yaw: Float
    var pitch: Float
    var radius: Float
    var onLoadProgress: ((Double) -> Void)?
    var onLoaded: ((Int) -> Void)?
    var onError: ((String) -> Void)?

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeUIView(context: Context) -> MTKView {
        let view = MTKView()
        view.device = MTLCreateSystemDefaultDevice()
        view.colorPixelFormat = .bgra8Unorm_srgb
        view.depthStencilPixelFormat = .depth32Float
        view.clearColor = MTLClearColor(red: 0.93, green: 0.94, blue: 0.96, alpha: 1)
        view.isPaused = false
        view.enableSetNeedsDisplay = false
        view.framebufferOnly = true
        view.isMultipleTouchEnabled = true

        context.coordinator.attach(to: view)
        return view
    }

    func updateUIView(_ uiView: MTKView, context: Context) {
        let coordinator = context.coordinator
        coordinator.autoRotate = autoRotate
        coordinator.onLoadProgress = onLoadProgress
        coordinator.onLoaded = onLoaded
        coordinator.onError = onError
        coordinator.applyCamera(yaw: yaw, pitch: pitch, radius: radius)
        if coordinator.resetToken != resetToken {
            coordinator.resetToken = resetToken
            coordinator.resetCamera()
        }
        if coordinator.loadedURL != plyURL {
            coordinator.load(url: plyURL)
        }
    }

    @MainActor
    final class Coordinator: NSObject, MTKViewDelegate {
        var renderer: MetalSplatRenderer?
        var autoRotate = true
        var resetToken = 0
        var loadedURL: URL?
        var yaw: Float = 0.35
        var pitch: Float = 0.25
        var radius: Float = 3.4
        var onLoadProgress: ((Double) -> Void)?
        var onLoaded: ((Int) -> Void)?
        var onError: ((String) -> Void)?

        private var lastDraw: CFTimeInterval = CACurrentMediaTime()
        private var loadTask: Task<Void, Never>?

        func attach(to view: MTKView) {
            do {
                let renderer = try MetalSplatRenderer(device: view.device)
                self.renderer = renderer
                view.delegate = self
                applyCamera(yaw: yaw, pitch: pitch, radius: radius)
            } catch {
                onError?(error.localizedDescription)
            }
        }

        func load(url: URL?) {
            loadTask?.cancel()
            loadedURL = url
            guard let url else { return }
            onLoadProgress?(0.05)

            // Decode off the main actor; only hop back with a Sendable SplatCloud.
            loadTask = Task { [weak self] in
                let result: Result<SplatCloud, Error> = await Task.detached(priority: .userInitiated) {
                    Result { try PLYSplatLoader.load(url: url) }
                }.value

                guard let self, !Task.isCancelled else { return }

                switch result {
                case .success(let cloud):
                    self.onLoadProgress?(0.85)
                    do {
                        try self.renderer?.load(cloud)
                        self.resetCamera()
                        self.onLoadProgress?(1)
                        self.onLoaded?(cloud.count)
                    } catch {
                        self.onError?(error.localizedDescription)
                    }
                case .failure(let error):
                    self.onError?(error.localizedDescription)
                }
            }
        }

        func resetCamera() {
            yaw = 0.35
            pitch = 0.25
            radius = 3.4
            applyCamera(yaw: yaw, pitch: pitch, radius: radius)
        }

        func applyCamera(yaw: Float, pitch: Float, radius: Float) {
            self.yaw = yaw
            self.pitch = pitch
            self.radius = radius
            renderer?.camera.orbit(yaw: yaw, pitch: pitch, radius: radius)
        }

        func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {}

        func draw(in view: MTKView) {
            let now = CACurrentMediaTime()
            let dt = Float(now - lastDraw)
            lastDraw = now
            if autoRotate {
                yaw += dt * 0.35
                applyCamera(yaw: yaw, pitch: pitch, radius: radius)
            }
            guard let renderer,
                  let drawable = view.currentDrawable else { return }
            let size = SIMD2<Float>(Float(view.drawableSize.width), Float(view.drawableSize.height))
            renderer.render(
                colorTexture: drawable.texture,
                depthTexture: view.depthStencilTexture,
                drawable: drawable,
                drawableSize: size
            )
        }
    }
}

/// Orbit / pinch gesture overlay that drives the Metal camera.
struct SplatOrbitGestureOverlay: View {
    @Binding var yaw: Float
    @Binding var pitch: Float
    @Binding var radius: Float
    @State private var dragStart: CGSize = .zero
    @State private var pinchStart: Float = 3.4

    var body: some View {
        Color.clear
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { value in
                        let dx = Float(value.translation.width - dragStart.width)
                        let dy = Float(value.translation.height - dragStart.height)
                        dragStart = value.translation
                        yaw += dx * 0.008
                        pitch = max(-1.2, min(1.2, pitch + dy * 0.008))
                    }
                    .onEnded { _ in dragStart = .zero }
            )
            .simultaneousGesture(
                MagnificationGesture()
                    .onChanged { scale in
                        let next = pinchStart / Float(scale)
                        radius = max(1.2, min(12, next))
                    }
                    .onEnded { _ in pinchStart = radius }
            )
    }
}
