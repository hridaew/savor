import { useEffect, useRef, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';

export interface SplatViewerProps {
  url: string;
  autoRotate?: boolean;
  resetKey?: number;
  /**
   * Kept for API compatibility: Spark renders whatever SH bands the file
   * carries (fast files are SH-stripped, HQ files carry degree 2).
   */
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

/**
 * React wrapper around Spark (@sparkjsdev/spark) + three.js.
 *
 * We own the whole three scene: renderer, camera, OrbitControls, and a
 * SplatMesh. Splats are cleaned to −Y up, centered at the origin, and
 * normalized to ~unit radius, so a fixed 3/4 framing works for every capture
 * (the camera's up vector carries the flip; the mesh stays unrotated).
 */
export function SplatViewer({
  url,
  autoRotate = true,
  resetKey = 0,
  sphericalHarmonicsDegree: _sphericalHarmonicsDegree = 0,
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
  const controlsRef = useRef<OrbitControls | null>(null);
  // Latest requested auto-rotate, readable from control event handlers.
  const wantRotate = useRef(autoRotate);
  wantRotate.current = autoRotate;

  useEffect(() => {
    const outer = outerRef.current;
    if (!outer) return;
    let disposed = false;

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

    const width = outer.clientWidth || 1;
    const height = outer.clientHeight || 1;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: false });
    } catch (e: any) {
      onError?.(String(e?.message ?? e));
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    // Light "studio" backdrop to match the app's light mode.
    renderer.setClearColor(0xeef1f6, 1);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    outer.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, width / height, 0.02, 500);
    camera.up.set(0, -1, 0);
    camera.position.set(...camPos);
    camera.lookAt(...camTarget);

    const spark = new SparkRenderer({ renderer });
    scene.add(spark);

    const controls = new OrbitControls(camera, renderer.domElement);
    controlsRef.current = controls;
    controls.target.set(...camTarget);
    controls.autoRotate = autoRotate;
    controls.autoRotateSpeed = lookAround ? 0.6 : 1.3;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.zoomSpeed = 0.8;
    controls.rotateSpeed = 0.7;
    if (lookAround) {
      // Stand near the capture path and look around; the space only
      // exists as seen from near where it was filmed.
      controls.minDistance = 0.1;
      controls.maxDistance = 2;
    }
    if (minDistance != null) controls.minDistance = minDistance;
    if (maxDistance != null) controls.maxDistance = maxDistance;
    if (!lookAround && cameraHeight != null) {
      // Keep the elevation near the capture orbit's: the background was
      // only ever seen (and trained) from that band. Up is (0,−1,0), so
      // polar = π/2 − asin(−y/d).
      const h = Math.max(-0.9 * dist, Math.min(0.9 * dist, cameraHeight));
      const polar = Math.PI / 2 - Math.asin(-h / dist);
      controls.minPolarAngle = Math.max(0.05, polar - 0.35); // up to ~20° higher
      controls.maxPolarAngle = Math.min(Math.PI - 0.05, polar + 0.2); // ~11° lower
    }
    controls.update();
    controls.saveState(); // Recenter (resetKey) restores this pose

    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    // Pause auto-rotate while the user is orbiting; resume after idle.
    const onStart = () => {
      clearTimeout(idleTimer);
      controls.autoRotate = false;
    };
    const onEnd = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        controls.autoRotate = wantRotate.current;
      }, 2600);
    };
    controls.addEventListener('start', onStart);
    controls.addEventListener('end', onEnd);

    const splats = new SplatMesh({
      url,
      onProgress: (e: ProgressEvent) => {
        if (e.lengthComputable && e.total > 0) onProgress?.((100 * e.loaded) / e.total);
      },
      onLoad: () => {
        if (!disposed) onLoaded?.();
      },
    });
    splats.initialized.catch((e: any) => {
      if (!disposed) onError?.(String(e?.message ?? e));
    });
    scene.add(splats);

    renderer.setAnimationLoop(() => {
      controls.update();
      renderer.render(scene, camera);
    });

    const resize = new ResizeObserver(() => {
      const w = outer.clientWidth || 1;
      const h = outer.clientHeight || 1;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
    resize.observe(outer);

    if (captureRef) {
      captureRef.current = () => {
        try {
          renderer.render(scene, camera);
        } catch {
          /* still capture whatever is in the buffer */
        }
        return renderer.domElement.toDataURL('image/png');
      };
    }

    return () => {
      disposed = true;
      clearTimeout(idleTimer);
      if (captureRef) captureRef.current = null;
      controlsRef.current = null;
      resize.disconnect();
      renderer.setAnimationLoop(null);
      controls.removeEventListener('start', onStart);
      controls.removeEventListener('end', onEnd);
      controls.dispose();
      scene.remove(splats);
      try {
        splats.dispose();
      } catch {
        /* ignore */
      }
      try {
        spark.dispose();
      } catch {
        /* ignore */
      }
      renderer.dispose();
      renderer.domElement.remove();
    };
    // re-init when the source asset changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  useEffect(() => {
    const c = controlsRef.current;
    if (c) c.autoRotate = autoRotate;
  }, [autoRotate]);

  useEffect(() => {
    const c = controlsRef.current;
    if (resetKey && c) {
      try {
        c.reset();
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
