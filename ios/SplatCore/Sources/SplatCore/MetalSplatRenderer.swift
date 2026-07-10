import Foundation
import Metal
import simd

public enum SplatRendererError: LocalizedError, Sendable {
    case noMetalDevice
    case pipelineCreationFailed(String)
    case bufferAllocationFailed

    public var errorDescription: String? {
        switch self {
        case .noMetalDevice:
            "No Metal device available on this machine."
        case .pipelineCreationFailed(let detail):
            "Failed to build Metal splat pipeline: \(detail)"
        case .bufferAllocationFailed:
            "Could not allocate GPU buffers for this splat."
        }
    }
}

/// Metal renderer for 3D Gaussian splats (SH0 / DC color).
///
/// Draws back-to-front alpha-blended billboards after a CPU depth sort.
/// Designed for on-device viewing of Savor `.ply` exports on iPhone.
public final class MetalSplatRenderer: @unchecked Sendable {
    public let device: MTLDevice
    public let commandQueue: MTLCommandQueue

    private let pipelineState: MTLRenderPipelineState
    private let depthState: MTLDepthStencilState

    private var splatBuffer: MTLBuffer?
    private var orderBuffer: MTLBuffer?
    private var uniformBuffer: MTLBuffer?
    private var packed: [PackedSplat] = []
    private var order: [UInt32] = []
    private var depths: [Float] = []

    public private(set) var splatCount: Int = 0
    public var clearColor = MTLClearColor(red: 0.93, green: 0.94, blue: 0.96, alpha: 1)

    public struct Camera: Sendable {
        public var eye: SIMD3<Float>
        public var target: SIMD3<Float>
        public var up: SIMD3<Float>
        public var fovy: Float

        public init(
            eye: SIMD3<Float> = SIMD3(1.7, -1.05, 3.0),
            target: SIMD3<Float> = .zero,
            up: SIMD3<Float> = SIMD3(0, -1, 0),
            fovy: Float = .pi / 3.5
        ) {
            self.eye = eye
            self.target = target
            self.up = up
            self.fovy = fovy
        }

        public mutating func orbit(yaw: Float, pitch: Float, radius: Float) {
            let cy = cos(yaw), sy = sin(yaw)
            let cp = cos(pitch), sp = sin(pitch)
            eye = target + SIMD3(sy * cp, -sp, cy * cp) * radius
        }
    }

    public var camera = Camera()

    public init(device: MTLDevice? = MTLCreateSystemDefaultDevice()) throws {
        guard let device else { throw SplatRendererError.noMetalDevice }
        guard let queue = device.makeCommandQueue() else {
            throw SplatRendererError.noMetalDevice
        }
        self.device = device
        self.commandQueue = queue

        let library: MTLLibrary
        if let bundleLib = try? device.makeDefaultLibrary(bundle: .module) {
            library = bundleLib
        } else if let defaultLib = device.makeDefaultLibrary() {
            library = defaultLib
        } else {
            throw SplatRendererError.pipelineCreationFailed("Missing Metal library")
        }

        guard let vertex = library.makeFunction(name: "splat_vertex"),
              let fragment = library.makeFunction(name: "splat_fragment") else {
            throw SplatRendererError.pipelineCreationFailed("Missing shader functions")
        }

        let desc = MTLRenderPipelineDescriptor()
        desc.vertexFunction = vertex
        desc.fragmentFunction = fragment
        desc.colorAttachments[0].pixelFormat = .bgra8Unorm_srgb
        desc.colorAttachments[0].isBlendingEnabled = true
        desc.colorAttachments[0].rgbBlendOperation = .add
        desc.colorAttachments[0].alphaBlendOperation = .add
        desc.colorAttachments[0].sourceRGBBlendFactor = .one
        desc.colorAttachments[0].destinationRGBBlendFactor = .oneMinusSourceAlpha
        desc.colorAttachments[0].sourceAlphaBlendFactor = .one
        desc.colorAttachments[0].destinationAlphaBlendFactor = .oneMinusSourceAlpha
        desc.depthAttachmentPixelFormat = .depth32Float

        do {
            pipelineState = try device.makeRenderPipelineState(descriptor: desc)
        } catch {
            throw SplatRendererError.pipelineCreationFailed(error.localizedDescription)
        }

        let depthDesc = MTLDepthStencilDescriptor()
        depthDesc.depthCompareFunction = .always
        depthDesc.isDepthWriteEnabled = false
        guard let depthState = device.makeDepthStencilState(descriptor: depthDesc) else {
            throw SplatRendererError.pipelineCreationFailed("Depth state")
        }
        self.depthState = depthState
    }

    /// Suggested orbit radius after loading (unit-normalized clouds ≈ 2.5–3.5).
    public private(set) var suggestedRadius: Float = 3.4

    public func load(_ cloud: SplatCloud) throws {
        packed = cloud.packed()
        splatCount = packed.count
        order = Array(0..<UInt32(splatCount))
        depths = Array(repeating: 0, count: splatCount)

        let splatBytes = MemoryLayout<PackedSplat>.stride * max(splatCount, 1)
        let orderBytes = MemoryLayout<UInt32>.stride * max(splatCount, 1)

        guard let sb = device.makeBuffer(length: splatBytes, options: .storageModeShared),
              let ob = device.makeBuffer(length: orderBytes, options: .storageModeShared),
              let ub = device.makeBuffer(length: MemoryLayout<GPUUniforms>.stride, options: .storageModeShared)
        else {
            throw SplatRendererError.bufferAllocationFailed
        }

        if splatCount > 0 {
            packed.withUnsafeBytes { raw in
                sb.contents().copyMemory(from: raw.baseAddress!, byteCount: splatBytes)
            }
            order.withUnsafeBytes { raw in
                ob.contents().copyMemory(from: raw.baseAddress!, byteCount: orderBytes)
            }
        }

        splatBuffer = sb
        orderBuffer = ob
        uniformBuffer = ub

        // Frame the cloud — cleaned exports are ~unit radius; raw ARKit clouds can be meters-scale.
        camera.target = cloud.center
        let r = max(cloud.radius, 0.05)
        suggestedRadius = max(1.5, min(12, r * 2.8))
        camera.orbit(yaw: 0.35, pitch: 0.25, radius: suggestedRadius)
    }

    public func render(
        colorTexture: MTLTexture,
        depthTexture: MTLTexture?,
        drawable: MTLDrawable?,
        drawableSize: SIMD2<Float>
    ) {
        guard splatCount > 0,
              let splatBuffer,
              let orderBuffer,
              let uniformBuffer,
              let commandBuffer = commandQueue.makeCommandBuffer()
        else { return }

        let aspect = max(drawableSize.x / max(drawableSize.y, 1), 0.01)
        let projection = perspectiveRH(fovy: camera.fovy, aspect: aspect, near: 0.05, far: 100)
        let viewMatrix = lookAtRH(eye: camera.eye, target: camera.target, up: camera.up)

        sortBackToFront(viewMatrix: viewMatrix)
        order.withUnsafeBytes { raw in
            orderBuffer.contents().copyMemory(
                from: raw.baseAddress!,
                byteCount: MemoryLayout<UInt32>.stride * splatCount
            )
        }

        let focalY = drawableSize.y / (2 * tan(camera.fovy * 0.5))
        let focalX = focalY * aspect
        var uniforms = GPUUniforms(
            viewMatrix: viewMatrix,
            projectionMatrix: projection,
            screenSize: drawableSize,
            focalX: focalX,
            focalY: focalY,
            splatCount: UInt32(splatCount)
        )
        withUnsafeBytes(of: &uniforms) { raw in
            uniformBuffer.contents().copyMemory(from: raw.baseAddress!, byteCount: raw.count)
        }

        let pass = MTLRenderPassDescriptor()
        pass.colorAttachments[0].texture = colorTexture
        pass.colorAttachments[0].loadAction = .clear
        pass.colorAttachments[0].storeAction = .store
        pass.colorAttachments[0].clearColor = clearColor
        if let depthTexture {
            pass.depthAttachment.texture = depthTexture
            pass.depthAttachment.loadAction = .clear
            pass.depthAttachment.storeAction = .dontCare
            pass.depthAttachment.clearDepth = 1
        }

        guard let encoder = commandBuffer.makeRenderCommandEncoder(descriptor: pass) else { return }
        encoder.setRenderPipelineState(pipelineState)
        encoder.setDepthStencilState(depthState)
        encoder.setVertexBuffer(splatBuffer, offset: 0, index: 0)
        encoder.setVertexBuffer(orderBuffer, offset: 0, index: 1)
        encoder.setVertexBuffer(uniformBuffer, offset: 0, index: 2)
        encoder.drawPrimitives(type: .triangleStrip, vertexStart: 0, vertexCount: 4, instanceCount: splatCount)
        encoder.endEncoding()

        if let drawable {
            commandBuffer.present(drawable)
        }
        commandBuffer.commit()
    }

    private func sortBackToFront(viewMatrix: simd_float4x4) {
        for i in 0..<splatCount {
            let p = packed[i].position
            let view = viewMatrix * SIMD4(p.x, p.y, p.z, 1)
            depths[i] = view.z
            order[i] = UInt32(i)
        }
        order.sort { depths[Int($0)] < depths[Int($1)] }
    }
}

struct GPUUniforms {
    var viewMatrix: simd_float4x4
    var projectionMatrix: simd_float4x4
    var screenSize: SIMD2<Float>
    var focalX: Float
    var focalY: Float
    var splatCount: UInt32
    var _padA: UInt32 = 0
    var _padB: UInt32 = 0
    var _padC: UInt32 = 0
}

public func perspectiveRH(fovy: Float, aspect: Float, near: Float, far: Float) -> simd_float4x4 {
    let y = 1 / tan(fovy * 0.5)
    let x = y / aspect
    let z = far / (near - far)
    return simd_float4x4(columns: (
        SIMD4(x, 0, 0, 0),
        SIMD4(0, y, 0, 0),
        SIMD4(0, 0, z, -1),
        SIMD4(0, 0, z * near, 0)
    ))
}

public func lookAtRH(eye: SIMD3<Float>, target: SIMD3<Float>, up: SIMD3<Float>) -> simd_float4x4 {
    let z = normalize(eye - target)
    let x = normalize(cross(up, z))
    let y = cross(z, x)
    let t = SIMD3(-dot(x, eye), -dot(y, eye), -dot(z, eye))
    return simd_float4x4(columns: (
        SIMD4(x.x, y.x, z.x, 0),
        SIMD4(x.y, y.y, z.y, 0),
        SIMD4(x.z, y.z, z.z, 0),
        SIMD4(t.x, t.y, t.z, 1)
    ))
}
