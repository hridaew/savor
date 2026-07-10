import { useEffect, useRef, type MutableRefObject } from 'react';
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d';

export interface SplatViewerProps {
  url: string;
  autoRotate?: boolean;
  resetKey?: number;
  /** Rendering SH degree (0 for speed, 1-3 for richer view-dependent shading). */
  sphericalHarmonicsDegree?: number;
  /**
   * Initial camera distance from the origin (normalized splat units).
   * Scene mode passes the capture orbit radius so the background is seen
   * from where the video was actually shot.
   */
  cameraDistance?: number;
  /**
   * Initial camera height (normalized y, negative = above). Scene mode
   * passes the capture orbit height — the background only exists at the
   * elevations the video covered. Also clamps the polar range around it.
   */
  cameraHeight?: number;
  /** Orbit-controls zoom clamp (keeps the camera where the splat looks right). */
  minDistance?: number;
  maxDistance?: number;
  /**
   * Environment captures: exact camera start position (normalized units).
   * Wins over cameraDistance/cameraHeight when given.
   */
  cameraPosition?: [number, number, number];
  /** Environment captures: point to look at (defaults to the origin). */
  cameraTarget?: [number, number, number];
  /**
   * Look around from inside the scene instead of orbiting an object:
   * tight zoom clamps, full polar freedom, gentle auto-pan.
   */
  lookAround?: boolean;
  /** Set to a fn returning a PNG dataURL of the current frame. */
  captureRef?: MutableRefObject<(() => string) | null>;
  onProgress?: (percent: number) => void;
  onLoaded?: () => void;
  onError?: (message: string) => void;
}

/** Default camera direction (3/4 view); length is the default distance. */
const CAM_DIR: [number, number, number] = [1.7, -1.05, -3.0];
const CAM_LEN = Math.hypot(...CAM_DIR);

function inferExt(url: string): string {
  const clean = url.split(/[?#]/, 1)[0] ?? url;
  const m = clean.match(/\.([a-z0-9]+)$/i);
  return (m?.[1] ?? 'ply').toLowerCase();
}

function inferFormat(url: string): any {
  const ext = inferExt(url);
  if (ext === 'ksplat') return GaussianSplats3D.SceneFormat.KSplat;
  if (ext === 'splat') return GaussianSplats3D.SceneFormat.Splat;
  // SPZ-compressed PLY is loaded by the PLY loader in gaussian-splats-3d.
  return GaussianSplats3D.SceneFormat.Ply;
}

function shouldProgressivelyLoad(url: string): boolean {
  const ext = inferExt(url);
  return ext === 'ply' || ext === 'splat' || ext === 'ksplat' || ext === 'spz';
}

/**
 * React wrapper around @mkkellogg/gaussian-splats-3d.
 *
 * The engine appends its own <canvas> imperatively. To avoid React trying to
 * reconcile (and double-remove) those nodes, we hand the engine a child div we
 * create ourselves — React only ever owns the empty outer wrapper.
 */
export function SplatViewer({
  url,
  autoRotate = true,
  resetKey = 0,
  sphericalHarmonicsDegree = 0,
  cameraDistance,
  cameraHeight,
  minDistance,
  maxDistance,
  cameraPosition,
  cameraTarget,
  lookAround = false,
  captureRef,
  onProgress,
  onLoaded,
  onError,
}: SplatViewerProps) {
  const outerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<any>(null);
  // Latest requested auto-rotate, readable from control event handlers.
  const wantRotate = useRef(autoRotate);
  wantRotate.current = autoRotate;

  useEffect(() => {
    const outer = outerRef.current;
    if (!outer) return;
    let disposed = false;
    const format = inferFormat(url);
    const progressiveLoad = shouldProgressivelyLoad(url);

    const inner = document.createElement('div');
    inner.style.width = '100%';
    inner.style.height = '100%';
    inner.style.position = 'relative';
    outer.appendChild(inner);

    // Same 3/4 azimuth always; distance and height are per-mode (the scene
    // camera orbits at the capture-camera radius/height so the background
    // reads correctly — it only exists from where the video was shot).
    // An explicit cameraPosition (environment captures) wins over both.
    const dist = cameraDistance ?? CAM_LEN;
    let camPos: [number, number, number];
    if (cameraPosition) {
      camPos = cameraPosition;
    } else if (cameraHeight != null) {
      const h = Math.max(-0.9 * dist, Math.min(0.9 * dist, cameraHeight));
      const rH = Math.sqrt(dist * dist - h * h);
      const hx = CAM_DIR[0], hz = CAM_DIR[2];
      const hLen = Math.hypot(hx, hz) || 1;
      camPos = [(hx / hLen) * rH, h, (hz / hLen) * rH];
    } else {
      camPos = CAM_DIR.map((v) => (v / CAM_LEN) * dist) as [number, number, number];
    }
    const camTarget: [number, number, number] = cameraTarget ?? [0, 0, 0];

    let viewer: any;
    try {
      viewer = new GaussianSplats3D.Viewer({
        rootElement: inner,
        sharedMemoryForWorkers: false, // no COOP/COEP headers required
        selfDrivenMode: true,
        useBuiltInControls: true,
        dynamicScene: false,
        antialiased: true,
        halfPrecisionCovariancesOnGPU: true,
        // Splats are cleaned to −Y up, centered at the origin, and normalized to
        // ~unit radius, so a fixed 3/4 framing works for every capture.
        cameraUp: [0, -1, 0],
        initialCameraPosition: camPos,
        initialCameraLookAt: camTarget,
        sphericalHarmonicsDegree,
      });
    } catch (e: any) {
      onError?.(String(e?.message ?? e));
      inner.remove();
      return;
    }
    viewerRef.current = viewer;

    let idleTimer: ReturnType<typeof setTimeout> | undefined;

    viewer
      .addSplatScene(url, {
        format,
        // Faster time-to-first-view for larger consumer captures.
        progressiveLoad,
        showLoadingUI: false,
        // Cleanup happens offline in the pipeline — render everything in the
        // file. Culling faint splats here thins surfaces into translucency.
        splatAlphaRemovalThreshold: 1,
        onProgress: (pct: number) => onProgress?.(pct),
      })
      .then(() => {
        if (disposed) return;
        viewer.start();
        // Light "studio" backdrop to match the app's light mode.
        try {
          viewer.renderer?.setClearColor?.(0xeef1f6, 1);
        } catch {
          /* ignore */
        }
        const c = viewer.controls;
        if (c) {
          c.autoRotate = autoRotate;
          c.autoRotateSpeed = lookAround ? 0.6 : 1.3;
          c.enableDamping = true;
          c.dampingFactor = 0.08;
          c.zoomSpeed = 0.8;
          c.rotateSpeed = 0.7;
          if (lookAround) {
            // Stand near the capture path and look around; the space only
            // exists as seen from near where it was filmed.
            c.minDistance = 0.1;
            c.maxDistance = 2;
          }
          if (minDistance != null) c.minDistance = minDistance;
          if (maxDistance != null) c.maxDistance = maxDistance;
          if (!lookAround && cameraHeight != null) {
            // Keep the elevation near the capture orbit's: the background was
            // only ever seen (and trained) from that band. Up is (0,−1,0), so
            // polar = π/2 − asin(−y/d).
            const h = Math.max(-0.9 * dist, Math.min(0.9 * dist, cameraHeight));
            const polar = Math.PI / 2 - Math.asin(-h / dist);
            c.minPolarAngle = Math.max(0.05, polar - 0.35); // up to ~20° higher
            c.maxPolarAngle = Math.min(Math.PI - 0.05, polar + 0.2); // ~11° lower
          }
          // Pause auto-rotate while the user is orbiting; resume after idle.
          c.addEventListener?.('start', () => {
            clearTimeout(idleTimer);
            c.autoRotate = false;
          });
          c.addEventListener?.('end', () => {
            clearTimeout(idleTimer);
            idleTimer = setTimeout(() => {
              c.autoRotate = wantRotate.current;
            }, 2600);
          });
        }
        if (captureRef) {
          captureRef.current = () => {
            try {
              viewer.update?.();
              viewer.render?.();
            } catch {
              /* still capture whatever is in the buffer */
            }
            return viewer.renderer.domElement.toDataURL('image/png');
          };
        }
        onLoaded?.();
      })
      .catch((e: any) => {
        if (!disposed) onError?.(String(e?.message ?? e));
      });

    return () => {
      disposed = true;
      clearTimeout(idleTimer);
      if (captureRef) captureRef.current = null;
      viewerRef.current = null;
      const drop = () => {
        try {
          inner.remove();
        } catch {
          /* ignore */
        }
      };
      try {
        const r = viewer?.dispose?.();
        if (r && typeof r.then === 'function') r.then(drop, drop);
        else drop();
      } catch {
        drop();
      }
    };
    // re-init when source asset or SH quality target changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, sphericalHarmonicsDegree]);

  useEffect(() => {
    const v = viewerRef.current;
    if (v?.controls) v.controls.autoRotate = autoRotate;
  }, [autoRotate]);

  useEffect(() => {
    const v = viewerRef.current;
    if (resetKey && v?.controls?.reset) {
      try {
        v.controls.reset();
      } catch {
        /* ignore */
      }
    }
  }, [resetKey]);

  return (
    <div
      ref={outerRef}
      style={{
        position: 'absolute',
        inset: 0,
        background: 'linear-gradient(180deg, #f4f7fb 0%, #e6ebf2 100%)',
      }}
    />
  );
}
