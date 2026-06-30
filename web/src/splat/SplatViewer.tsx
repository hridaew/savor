import { useEffect, useRef } from 'react';
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d';

export interface SplatViewerProps {
  url: string;
  autoRotate?: boolean;
  resetKey?: number;
  onProgress?: (percent: number) => void;
  onLoaded?: () => void;
  onError?: (message: string) => void;
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
  onProgress,
  onLoaded,
  onError,
}: SplatViewerProps) {
  const outerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<any>(null);

  useEffect(() => {
    const outer = outerRef.current;
    if (!outer) return;
    let disposed = false;

    const inner = document.createElement('div');
    inner.style.width = '100%';
    inner.style.height = '100%';
    inner.style.position = 'relative';
    outer.appendChild(inner);

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
        initialCameraPosition: [1.7, -1.05, -3.0],
        initialCameraLookAt: [0, 0, 0],
        sphericalHarmonicsDegree: 0,
      });
    } catch (e: any) {
      onError?.(String(e?.message ?? e));
      inner.remove();
      return;
    }
    viewerRef.current = viewer;

    viewer
      .addSplatScene(url, {
        format: GaussianSplats3D.SceneFormat.Ply,
        progressiveLoad: false,
        showLoadingUI: false,
        // Cull faint floaters (captured room/environment) for a cleaner subject.
        splatAlphaRemovalThreshold: 20,
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
          c.autoRotateSpeed = 1.3;
          c.enableDamping = true;
          c.dampingFactor = 0.08;
          c.zoomSpeed = 0.8;
          c.rotateSpeed = 0.7;
        }
        onLoaded?.();
      })
      .catch((e: any) => {
        if (!disposed) onError?.(String(e?.message ?? e));
      });

    return () => {
      disposed = true;
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
    // re-init only when the splat URL changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

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
