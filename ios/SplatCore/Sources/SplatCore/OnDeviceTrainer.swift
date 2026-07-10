import CoreGraphics
import Foundation
import ImageIO
import Metal
import simd
import UniformTypeIdentifiers

public enum OnDeviceTrainerError: LocalizedError, Sendable {
    case noMetal
    case noFrames
    case noSeeds
    case pipeline(String)
    case cancelled
    case emptyResult

    public var errorDescription: String? {
        switch self {
        case .noMetal: "Metal is required for on-device training."
        case .noFrames: "Capture has no ARKit frames to train on."
        case .noSeeds: "Need a LiDAR / depth seed cloud before training."
        case .pipeline(let d): "Trainer pipeline error: \(d)"
        case .cancelled: "Training cancelled."
        case .emptyResult: "Training produced no valid gaussians."
        }
    }
}

public struct TrainProgress: Sendable {
    public var step: Int
    public var totalSteps: Int
    public var loss: Float
    public var splatCount: Int
    public var message: String

    public var fraction: Double {
        guard totalSteps > 0 else { return 0 }
        return min(1, Double(step) / Double(totalSteps))
    }
}

public struct TrainConfig: Sendable {
    public var steps: Int
    public var trainResolution: Int
    public var maxGaussians: Int
    public var colorLR: Float
    public var opacityLR: Float
    public var scaleLR: Float
    public var positionLR: Float

    public static let fast = TrainConfig(steps: 400, trainResolution: 256, maxGaussians: 20_000, colorLR: 0.04, opacityLR: 0.05, scaleLR: 0.01, positionLR: 0.0004)
    public static let balanced = TrainConfig(steps: 800, trainResolution: 320, maxGaussians: 30_000, colorLR: 0.03, opacityLR: 0.04, scaleLR: 0.008, positionLR: 0.0003)
    public static let high = TrainConfig(steps: 2000, trainResolution: 384, maxGaussians: 45_000, colorLR: 0.02, opacityLR: 0.03, scaleLR: 0.006, positionLR: 0.0002)

    public init(steps: Int, trainResolution: Int, maxGaussians: Int, colorLR: Float, opacityLR: Float, scaleLR: Float, positionLR: Float) {
        self.steps = steps
        self.trainResolution = trainResolution
        self.maxGaussians = maxGaussians
        self.colorLR = colorLR
        self.opacityLR = opacityLR
        self.scaleLR = scaleLR
        self.positionLR = positionLR
    }
}

/// On-device 3DGS trainer (SH0) for ARKit-captured sessions.
///
/// Mobile prototype — not a full Brush replacement. No densification, SH0 only,
/// hundreds–thousands of steps. Output is cleaned + normalized like desktop splatClean.
public final class OnDeviceTrainer: @unchecked Sendable {
    private let device: MTLDevice
    private let queue: MTLCommandQueue
    private let forwardPSO: MTLComputePipelineState
    private let backwardPSO: MTLComputePipelineState

    public init(device: MTLDevice? = MTLCreateSystemDefaultDevice()) throws {
        guard let device, let queue = device.makeCommandQueue() else {
            throw OnDeviceTrainerError.noMetal
        }
        self.device = device
        self.queue = queue

        let library: MTLLibrary
        if let lib = try? device.makeDefaultLibrary(bundle: .module) {
            library = lib
        } else if let lib = device.makeDefaultLibrary() {
            library = lib
        } else {
            throw OnDeviceTrainerError.pipeline("Missing Metal library")
        }

        guard let f = library.makeFunction(name: "train_forward"),
              let b = library.makeFunction(name: "train_backward_adam") else {
            throw OnDeviceTrainerError.pipeline("Missing train kernels")
        }
        forwardPSO = try device.makeComputePipelineState(function: f)
        backwardPSO = try device.makeComputePipelineState(function: b)
    }

    public func train(
        manifest: CaptureManifest,
        captureDirectory: URL,
        config: TrainConfig,
        onProgress: (@Sendable (TrainProgress) -> Void)? = nil
    ) async throws -> SplatCloud {
        guard !manifest.frames.isEmpty else { throw OnDeviceTrainerError.noFrames }

        let seedURL = captureDirectory.appendingPathComponent(manifest.pointCloudFile ?? "seeds.ply")
        var seeds = (try? PLYSplatWriter.readSeedCloud(from: seedURL)) ?? []
        if seeds.isEmpty {
            seeds = try Self.bootstrapSeeds(from: manifest, directory: captureDirectory, maxCount: min(6000, config.maxGaussians))
        }
        if seeds.count > config.maxGaussians {
            seeds = Array(seeds.prefix(config.maxGaussians))
        }
        guard !seeds.isEmpty else { throw OnDeviceTrainerError.noSeeds }

        let splatBuffer = try makeSplatBuffer(from: seeds)
        let frames = try loadTrainingFrames(manifest: manifest, directory: captureDirectory, resolution: config.trainResolution)
        let lossBuf = try makeLossBuffer(count: seeds.count)

        var lastLoss: Float = 1
        for step in 1...config.steps {
            try Task.checkCancellation()
            let frame = frames[step % frames.count]
            lastLoss = try runStep(
                splatBuffer: splatBuffer,
                lossBuffer: lossBuf,
                splatCount: seeds.count,
                frame: frame,
                config: config,
                step: step
            )
            if step == 1 || step % 10 == 0 || step == config.steps {
                let progress = TrainProgress(
                    step: step,
                    totalSteps: config.steps,
                    loss: lastLoss,
                    splatCount: seeds.count,
                    message: "Training · step \(step)/\(config.steps)"
                )
                onProgress?(progress)
            }
        }

        let raw = try readBackCloud(from: splatBuffer, count: seeds.count)
        let cleaned = raw.cleanedAndNormalized()
        guard cleaned.count > 0 else { throw OnDeviceTrainerError.emptyResult }
        return cleaned
    }

    // MARK: - Internals

    /// Matches TrainShaders.metal TrainSplat (4 × float4 = 64 bytes).
    private struct TrainSplat {
        var positionOpacity: SIMD4<Float> // xyz + opacity logit
        var scalePad: SIMD4<Float>        // xyz log-scale + pad
        var rotation: SIMD4<Float>
        var colorPad: SIMD4<Float>
    }

    private struct TrainCamera {
        var viewMatrix: simd_float4x4
        var projectionMatrix: simd_float4x4
        var screenSize: SIMD2<Float>
        var focalX: Float
        var focalY: Float
        var splatCount: UInt32
        var imageWidth: UInt32
        var imageHeight: UInt32
        var _pad: UInt32 = 0
    }

    private struct TrainUniforms {
        var learningRate: Float
        var colorLR: Float
        var opacityLR: Float
        var scaleLR: Float
        var positionLR: Float
        var splatCount: UInt32
        var pixelCount: UInt32
        var step: UInt32
    }

    private struct LoadedFrame {
        var texture: MTLTexture
        var view: simd_float4x4
        var projection: simd_float4x4
        var width: Int
        var height: Int
        var focalX: Float
        var focalY: Float
    }

    private func makeSplatBuffer(from seeds: [SeedPoint]) throws -> MTLBuffer {
        var initScale: Float = 0.01
        if seeds.count > 1 {
            var sum: Float = 0
            let sample = min(seeds.count, 200)
            for i in 0..<sample {
                let a = seeds[i].position
                let b = seeds[(i * 7 + 13) % seeds.count].position
                sum += length(a - b)
            }
            initScale = max(0.002, (sum / Float(sample)) * 0.5)
        }

        guard let splatBuf = device.makeBuffer(
            length: MemoryLayout<TrainSplat>.stride * seeds.count,
            options: .storageModeShared
        ) else {
            throw OnDeviceTrainerError.pipeline("buffer alloc")
        }

        let ptr = splatBuf.contents().bindMemory(to: TrainSplat.self, capacity: seeds.count)
        let logScale = log(initScale)
        for i in 0..<seeds.count {
            let c = seeds[i].color
            ptr[i] = TrainSplat(
                positionOpacity: SIMD4(seeds[i].position, 0),
                scalePad: SIMD4(logScale, logScale, logScale, 0),
                rotation: SIMD4(0, 0, 0, 1),
                colorPad: SIMD4(c.x, c.y, c.z, 0)
            )
        }
        return splatBuf
    }

    private func makeLossBuffer(count: Int) throws -> MTLBuffer {
        guard let buf = device.makeBuffer(
            length: MemoryLayout<Float>.stride * max(count, 1),
            options: .storageModeShared
        ) else {
            throw OnDeviceTrainerError.pipeline("loss buffer")
        }
        return buf
    }

    private func loadTrainingFrames(
        manifest: CaptureManifest,
        directory: URL,
        resolution: Int
    ) throws -> [LoadedFrame] {
        var loaded: [LoadedFrame] = []
        let stride = max(1, manifest.frames.count / 48)
        for (idx, frame) in manifest.frames.enumerated() where idx % stride == 0 {
            let url = directory.appendingPathComponent("frames").appendingPathComponent(frame.imageFile)
            guard let cg = loadCGImage(url: url) else { continue }
            let resized = try resizeTexture(cgImage: cg, maxSide: resolution)
            let aspect = Float(resized.width) / Float(resized.height)

            // Prefer ARKit intrinsics when present; fall back to a fixed fovy.
            let fovy: Float
            let focalX: Float
            let focalY: Float
            let K = frame.intrinsicsMatrix
            let fy = K[1, 1]
            if fy > 1 {
                let scaleY = Float(resized.height) / Float(max(frame.imageHeight, 1))
                let scaleX = Float(resized.width) / Float(max(frame.imageWidth, 1))
                focalY = fy * scaleY
                focalX = K[0, 0] * scaleX
                fovy = 2 * atan(Float(resized.height) / (2 * focalY))
            } else {
                fovy = .pi / 3
                focalY = Float(resized.height) / (2 * tan(fovy * 0.5))
                focalX = focalY * aspect
            }

            let projection = perspectiveRH(fovy: fovy, aspect: aspect, near: 0.01, far: 100)
            let c2w = frame.transformMatrix
            let view = c2w.inverse
            loaded.append(LoadedFrame(
                texture: resized,
                view: view,
                projection: projection,
                width: resized.width,
                height: resized.height,
                focalX: focalX,
                focalY: focalY
            ))
        }
        if loaded.isEmpty { throw OnDeviceTrainerError.noFrames }
        return loaded
    }

    private func runStep(
        splatBuffer: MTLBuffer,
        lossBuffer: MTLBuffer,
        splatCount: Int,
        frame: LoadedFrame,
        config: TrainConfig,
        step: Int
    ) throws -> Float {
        let desc = MTLTextureDescriptor.texture2DDescriptor(
            pixelFormat: .rgba16Float,
            width: frame.width,
            height: frame.height,
            mipmapped: false
        )
        desc.usage = [.shaderRead, .shaderWrite]
        guard let pred = device.makeTexture(descriptor: desc),
              let alpha = device.makeTexture(descriptor: desc),
              let cmd = queue.makeCommandBuffer(),
              let enc = cmd.makeComputeCommandEncoder()
        else {
            throw OnDeviceTrainerError.pipeline("step resources")
        }

        memset(lossBuffer.contents(), 0, MemoryLayout<Float>.stride * splatCount)

        var cam = TrainCamera(
            viewMatrix: frame.view,
            projectionMatrix: frame.projection,
            screenSize: SIMD2(Float(frame.width), Float(frame.height)),
            focalX: frame.focalX,
            focalY: frame.focalY,
            splatCount: UInt32(splatCount),
            imageWidth: UInt32(frame.width),
            imageHeight: UInt32(frame.height)
        )
        var uniforms = TrainUniforms(
            learningRate: 0.01,
            colorLR: config.colorLR,
            opacityLR: config.opacityLR,
            scaleLR: config.scaleLR,
            positionLR: config.positionLR,
            splatCount: UInt32(splatCount),
            pixelCount: UInt32(frame.width * frame.height),
            step: UInt32(step)
        )

        enc.setComputePipelineState(forwardPSO)
        enc.setBuffer(splatBuffer, offset: 0, index: 0)
        enc.setBytes(&cam, length: MemoryLayout<TrainCamera>.stride, index: 1)
        enc.setTexture(pred, index: 0)
        enc.setTexture(alpha, index: 1)
        let fwdGrid = MTLSize(width: frame.width, height: frame.height, depth: 1)
        let fwdTG = MTLSize(width: 16, height: 16, depth: 1)
        enc.dispatchThreads(fwdGrid, threadsPerThreadgroup: fwdTG)

        enc.setComputePipelineState(backwardPSO)
        enc.setBuffer(splatBuffer, offset: 0, index: 0)
        enc.setBytes(&cam, length: MemoryLayout<TrainCamera>.stride, index: 1)
        enc.setBytes(&uniforms, length: MemoryLayout<TrainUniforms>.stride, index: 2)
        enc.setBuffer(lossBuffer, offset: 0, index: 3)
        enc.setTexture(pred, index: 0)
        enc.setTexture(frame.texture, index: 1)
        let bwdCount = MTLSize(width: splatCount, height: 1, depth: 1)
        let bwdTG = MTLSize(width: min(256, backwardPSO.maxTotalThreadsPerThreadgroup), height: 1, depth: 1)
        enc.dispatchThreads(bwdCount, threadsPerThreadgroup: bwdTG)
        enc.endEncoding()
        cmd.commit()
        cmd.waitUntilCompleted()

        if let error = cmd.error {
            throw OnDeviceTrainerError.pipeline(error.localizedDescription)
        }

        let losses = lossBuffer.contents().bindMemory(to: Float.self, capacity: splatCount)
        var sum: Float = 0
        var n = 0
        for i in 0..<splatCount {
            let v = losses[i]
            if v.isFinite && v > 0 {
                sum += v
                n += 1
            }
        }
        return n > 0 ? sum / Float(n) : 0
    }

    private func readBackCloud(from buffer: MTLBuffer, count: Int) throws -> SplatCloud {
        let ptr = buffer.contents().bindMemory(to: TrainSplat.self, capacity: count)
        var splats: [GaussianSplat] = []
        splats.reserveCapacity(count)
        for i in 0..<count {
            let s = ptr[i]
            let position = SIMD3(s.positionOpacity.x, s.positionOpacity.y, s.positionOpacity.z)
            let color = SIMD3(s.colorPad.x, s.colorPad.y, s.colorPad.z)
            let logScale = SIMD3(s.scalePad.x, s.scalePad.y, s.scalePad.z)
            guard position.x.isFinite, position.y.isFinite, position.z.isFinite,
                  color.x.isFinite, color.y.isFinite, color.z.isFinite,
                  logScale.x.isFinite, logScale.y.isFinite, logScale.z.isFinite,
                  s.positionOpacity.w.isFinite
            else { continue }

            let opacity = 1 / (1 + exp(-s.positionOpacity.w))
            let scale = SIMD3(exp(logScale.x), exp(logScale.y), exp(logScale.z))
            guard scale.x.isFinite, scale.y.isFinite, scale.z.isFinite else { continue }
            let rot = simd_quatf(ix: s.rotation.x, iy: s.rotation.y, iz: s.rotation.z, r: s.rotation.w)
            splats.append(GaussianSplat(
                position: position,
                color: simd_clamp(color, .zero, .one),
                opacity: opacity,
                scale: scale,
                rotation: rot.normalized
            ))
        }
        return SplatCloud(splats: splats)
    }

    private func loadCGImage(url: URL) -> CGImage? {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
        return CGImageSourceCreateImageAtIndex(source, 0, nil)
    }

    private func resizeTexture(cgImage: CGImage, maxSide: Int) throws -> MTLTexture {
        let w = cgImage.width
        let h = cgImage.height
        let scale = min(1, Float(maxSide) / Float(max(w, h)))
        let tw = max(1, Int(Float(w) * scale))
        let th = max(1, Int(Float(h) * scale))

        let colorSpace = CGColorSpaceCreateDeviceRGB()
        var bytes = [UInt8](repeating: 0, count: tw * th * 4)
        guard let ctx = CGContext(
            data: &bytes,
            width: tw,
            height: th,
            bitsPerComponent: 8,
            bytesPerRow: tw * 4,
            space: colorSpace,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else {
            throw OnDeviceTrainerError.pipeline("CGContext")
        }
        ctx.interpolationQuality = .medium
        ctx.draw(cgImage, in: CGRect(x: 0, y: 0, width: tw, height: th))

        let desc = MTLTextureDescriptor.texture2DDescriptor(
            pixelFormat: .rgba8Unorm_srgb,
            width: tw,
            height: th,
            mipmapped: false
        )
        desc.usage = [.shaderRead]
        guard let tex = device.makeTexture(descriptor: desc) else {
            throw OnDeviceTrainerError.pipeline("texture")
        }
        tex.replace(
            region: MTLRegionMake2D(0, 0, tw, th),
            mipmapLevel: 0,
            withBytes: bytes,
            bytesPerRow: tw * 4
        )
        return tex
    }

    /// Fallback seeds when LiDAR depth wasn't available: random points in front of cameras.
    private static func bootstrapSeeds(
        from manifest: CaptureManifest,
        directory: URL,
        maxCount: Int
    ) throws -> [SeedPoint] {
        var points: [SeedPoint] = []
        let perFrame = max(50, maxCount / max(manifest.frames.count, 1))
        for frame in manifest.frames {
            let c2w = frame.transformMatrix
            let origin = SIMD3(c2w.columns.3.x, c2w.columns.3.y, c2w.columns.3.z)
            let forward = -SIMD3(c2w.columns.2.x, c2w.columns.2.y, c2w.columns.2.z)
            for i in 0..<perFrame {
                let u = Float(i % 10) / 10 - 0.5
                let v = Float(i / 10) / 10 - 0.5
                let depth = 0.4 + Float(i % 7) * 0.08
                let pos = origin + forward * depth + SIMD3(u, v, 0) * depth * 0.4
                points.append(SeedPoint(position: pos, color: SIMD3(0.6, 0.62, 0.65)))
                if points.count >= maxCount { return points }
            }
        }
        return points
    }
}
