import { useCallback, useEffect, useState } from 'react';

export interface Bounds {
  width: number;
  height: number;
}

/**
 * Measure an element with ResizeObserver (container-use-resize-observer).
 * Uses a callback ref so the observer attaches the moment the node exists
 * (container-callback-ref); bounds are {0,0} until the first observation —
 * consumers must guard that case (container-guard-initial-zero).
 */
export function useMeasure<T extends HTMLElement = HTMLDivElement>(): [
  (node: T | null) => void,
  Bounds,
] {
  const [element, setElement] = useState<T | null>(null);
  const [bounds, setBounds] = useState<Bounds>({ width: 0, height: 0 });
  const ref = useCallback((node: T | null) => setElement(node), []);

  useEffect(() => {
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setBounds({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  return [ref, bounds];
}
