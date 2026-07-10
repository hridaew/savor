import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Trajectory-based intent prefetching (prefetch-trajectory-over-hover).
 *
 * Projects the cursor's current velocity ~150ms ahead; when the projected
 * point (or the cursor itself) lands inside the element's bounds inflated by
 * `hitSlop`, the callback fires once. This reclaims the 100–200ms a plain
 * hover listener would waste. Touch devices have no cursor, so we fall back
 * to firing on first touchstart (prefetch-touch-fallback); keyboard users get
 * a prefetch when focus reaches the element (prefetch-keyboard-tab).
 */
export function useForesight<T extends HTMLElement = HTMLElement>(
  callback: () => void,
  { hitSlop = 20, enabled = true }: { hitSlop?: number; enabled?: boolean } = {},
): (node: T | null) => void {
  const [element, setElement] = useState<T | null>(null);
  const ref = useCallback((node: T | null) => setElement(node), []);
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  const fired = useRef(false);

  useEffect(() => {
    if (!element || !enabled || fired.current) return;

    const fire = () => {
      if (fired.current) return;
      fired.current = true;
      cleanup();
      callbackRef.current();
    };

    const onFocusIn = () => fire();
    const onTouchStart = () => fire();

    let last: { x: number; y: number; t: number } | null = null;
    let raf = 0;
    const onPointerMove = (e: PointerEvent) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const now = performance.now();
        const rect = element.getBoundingClientRect();
        const left = rect.left - hitSlop;
        const right = rect.right + hitSlop;
        const top = rect.top - hitSlop;
        const bottom = rect.bottom + hitSlop;

        let px = e.clientX;
        let py = e.clientY;
        if (last && now > last.t) {
          const dt = now - last.t;
          // Project the cursor 150ms along its current velocity vector.
          px += ((e.clientX - last.x) / dt) * 150;
          py += ((e.clientY - last.y) / dt) * 150;
        }
        last = { x: e.clientX, y: e.clientY, t: now };

        const inside = (x: number, y: number) =>
          x >= left && x <= right && y >= top && y <= bottom;
        if (inside(e.clientX, e.clientY) || inside(px, py)) fire();
      });
    };

    const finePointer = window.matchMedia('(pointer: fine)').matches;
    if (finePointer) window.addEventListener('pointermove', onPointerMove, { passive: true });
    element.addEventListener('touchstart', onTouchStart, { passive: true });
    element.addEventListener('focusin', onFocusIn);

    function cleanup() {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onPointerMove);
      element?.removeEventListener('touchstart', onTouchStart);
      element?.removeEventListener('focusin', onFocusIn);
    }
    return cleanup;
  }, [element, enabled, hitSlop]);

  return ref;
}

/**
 * Warm the code-split splat viewer chunk (three.js + the gaussian-splat
 * engine, ~700KB) before the user commits to opening a capture. Prefetched by
 * intent, not viewport (prefetch-not-everything) — and only the module: splat
 * .ply payloads are tens of MB, so speculative fetches of those would waste
 * real bandwidth.
 */
let viewerWarm = false;
export function prefetchViewer() {
  if (viewerWarm) return;
  viewerWarm = true;
  import('../splat/SplatViewer').catch(() => {
    viewerWarm = false;
  });
}
