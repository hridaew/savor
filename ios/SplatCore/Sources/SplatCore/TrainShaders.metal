#include <metal_stdlib>
using namespace metal;

// float4 packing — must match OnDeviceTrainer.TrainSplat (64 bytes).
// Never use float3 here: Metal sizeof(float3)==16 and diverges from Swift SIMD3.
struct TrainSplat {
    float4 positionOpacity; // xyz + opacity logit
    float4 scalePad;        // xyz log-scale + pad
    float4 rotation;        // xyzw
    float4 colorPad;        // rgb + pad
};

struct TrainCamera {
    float4x4 viewMatrix;
    float4x4 projectionMatrix;
    float2 screenSize;
    float focalX;
    float focalY;
    uint splatCount;
    uint imageWidth;
    uint imageHeight;
    uint _pad;
};

struct TrainUniforms {
    float learningRate;
    float colorLR;
    float opacityLR;
    float scaleLR;
    float positionLR;
    uint splatCount;
    uint pixelCount;
    uint step;
};

static float sigmoid(float x) { return 1.0 / (1.0 + exp(-x)); }

/// Soft forward: each pixel accumulates nearby gaussian contributions.
/// Simplified mobile trainer — SH0, no densification, tile-free O(N) per pixel.
kernel void train_forward(
    device const TrainSplat *splats [[buffer(0)]],
    constant TrainCamera &cam [[buffer(1)]],
    texture2d<float, access::write> outRGB [[texture(0)]],
    texture2d<float, access::write> outAlpha [[texture(1)]],
    uint2 gid [[thread_position_in_grid]]
) {
    if (gid.x >= cam.imageWidth || gid.y >= cam.imageHeight) return;

    float2 pixel = float2(gid) + 0.5;
    float3 color = float3(0);
    float T = 1.0;

    for (uint i = 0; i < cam.splatCount && T > 1e-3; ++i) {
        TrainSplat s = splats[i];
        float3 mean = s.positionOpacity.xyz;
        if (!all(isfinite(mean))) continue;

        float4 view4 = cam.viewMatrix * float4(mean, 1.0);
        if (view4.z > -0.05 || !isfinite(view4.z)) continue;

        float4 clip = cam.projectionMatrix * view4;
        if (abs(clip.w) < 1e-6) continue;
        float2 ndc = clip.xy / clip.w;
        float2 screen = (ndc * 0.5 + 0.5) * cam.screenSize;
        screen.y = cam.screenSize.y - screen.y;

        float3 scale = exp(clamp(s.scalePad.xyz, float3(-8.0), float3(1.0)));
        float radius = max(max(scale.x, scale.y), scale.z) * cam.focalY / max(-view4.z, 0.05) * 3.0;
        radius = min(radius, 64.0);
        float2 d = pixel - screen;
        float dist2 = dot(d, d);
        if (dist2 > radius * radius) continue;

        float sigma = max(radius / 3.0, 0.5);
        float gauss = exp(-0.5 * dist2 / (sigma * sigma));
        float alpha = sigmoid(s.positionOpacity.w) * gauss;
        alpha = min(0.99, alpha);
        color += T * alpha * clamp(s.colorPad.xyz, 0.0, 1.0);
        T *= (1.0 - alpha);
    }

    outRGB.write(float4(color, 1.0), gid);
    outAlpha.write(float4(1.0 - T, 0, 0, 1), gid);
}

/// L1 loss + color/opacity gradient scatter (simplified SH0 step).
/// Each thread owns one splat; writes per-splat loss into lossPerSplat[id] (no atomics).
kernel void train_backward_adam(
    device TrainSplat *splats [[buffer(0)]],
    constant TrainCamera &cam [[buffer(1)]],
    constant TrainUniforms &u [[buffer(2)]],
    texture2d<float, access::read> predRGB [[texture(0)]],
    texture2d<float, access::read> gtRGB [[texture(1)]],
    device float *lossPerSplat [[buffer(3)]],
    uint id [[thread_position_in_grid]]
) {
    if (id >= u.splatCount) return;
    TrainSplat s = splats[id];
    lossPerSplat[id] = 0;

    float3 mean = s.positionOpacity.xyz;
    if (!all(isfinite(mean))) return;

    float4 view4 = cam.viewMatrix * float4(mean, 1.0);
    if (view4.z > -0.05 || !isfinite(view4.z)) return;

    float4 clip = cam.projectionMatrix * view4;
    if (abs(clip.w) < 1e-6) return;
    float2 ndc = clip.xy / clip.w;
    float2 screen = (ndc * 0.5 + 0.5) * cam.screenSize;
    screen.y = cam.screenSize.y - screen.y;

    float3 scale = exp(clamp(s.scalePad.xyz, float3(-8.0), float3(1.0)));
    float radius = max(max(scale.x, scale.y), scale.z) * cam.focalY / max(-view4.z, 0.05) * 3.0;
    radius = min(radius, 64.0);
    float sigma = max(radius / 3.0, 0.5);
    float opacity = sigmoid(s.positionOpacity.w);
    float3 splatColor = clamp(s.colorPad.xyz, 0.0, 1.0);

    float3 gradColor = float3(0);
    float gradOpacity = 0;
    float3 gradPos = float3(0);
    float localLoss = 0;
    int samples = 0;

    int r = int(min(radius, 24.0));
    int cx = int(screen.x);
    int cy = int(screen.y);
    for (int dy = -r; dy <= r; dy += 2) {
        for (int dx = -r; dx <= r; dx += 2) {
            int x = cx + dx;
            int y = cy + dy;
            if (x < 0 || y < 0 || x >= int(cam.imageWidth) || y >= int(cam.imageHeight)) continue;
            float2 d = float2(float(dx), float(dy));
            float dist2 = dot(d, d);
            if (dist2 > radius * radius) continue;

            float gauss = exp(-0.5 * dist2 / (sigma * sigma));
            float alpha = opacity * gauss;
            if (alpha < 1e-4) continue;

            float3 pred = predRGB.read(uint2(x, y)).rgb;
            float3 gt = gtRGB.read(uint2(x, y)).rgb;
            float3 diff = pred - gt;
            localLoss += abs(diff.x) + abs(diff.y) + abs(diff.z);
            samples += 1;

            float3 signDiff = sign(diff);
            gradColor += signDiff * alpha;
            float dAlpha = dot(signDiff, splatColor);
            gradOpacity += dAlpha * gauss * opacity * (1.0 - opacity);
            gradPos.x += signDiff.x * alpha * float(dx) * 0.001;
            gradPos.y += signDiff.y * alpha * float(dy) * 0.001;
        }
    }

    if (samples > 0) {
        float inv = 1.0 / float(samples);
        gradColor *= inv;
        gradOpacity *= inv;
        gradPos *= inv;
        lossPerSplat[id] = localLoss * inv;

        float3 newColor = clamp(splatColor - u.colorLR * gradColor, 0.0, 1.0);
        float newOpacity = clamp(s.positionOpacity.w - u.opacityLR * gradOpacity, -6.0, 6.0);
        float3 newPos = mean - u.positionLR * gradPos;
        float residual = length(gradColor);
        float3 newScale = clamp(s.scalePad.xyz - u.scaleLR * residual, float3(-8.0), float3(1.0));

        if (all(isfinite(newPos)) && all(isfinite(newColor)) && all(isfinite(newScale)) && isfinite(newOpacity)) {
            s.positionOpacity = float4(newPos, newOpacity);
            s.scalePad = float4(newScale, 0);
            s.colorPad = float4(newColor, 0);
            splats[id] = s;
        }
    }
}

kernel void train_init_from_seeds(
    device const float4 *positions [[buffer(0)]],
    device const float4 *colors [[buffer(1)]],
    device TrainSplat *splats [[buffer(2)]],
    constant float &initScale [[buffer(3)]],
    uint id [[thread_position_in_grid]],
    uint count [[threads_per_grid]]
) {
    if (id >= count) return;
    TrainSplat s;
    s.positionOpacity = float4(positions[id].xyz, 0.0);
    s.scalePad = float4(float3(log(initScale)), 0);
    s.rotation = float4(0, 0, 0, 1);
    s.colorPad = float4(colors[id].xyz, 0);
    splats[id] = s;
}
