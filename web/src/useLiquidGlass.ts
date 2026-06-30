import { useEffect } from 'react';

declare global {
  interface Window {
    liquidGL?: any;
    html2canvas?: any;
  }
}

let started = false;

/**
 * Initialize liquidGL once, turning every `.lg-glass` element (the floating top
 * bar + tab bar) into a real-time liquid-glass lens that refracts the library
 * content scrolling behind it. Falls back silently to the CSS glass if the
 * library or its html2canvas dependency aren't available.
 *
 * liquidGL has no public teardown, so we guard with a module flag and only ever
 * start it a single time, after first paint + thumbnails have had a moment.
 */
export function useLiquidGlass(ready: boolean) {
  useEffect(() => {
    if (!ready || started) return;
    const t = setTimeout(() => {
      if (started) return;
      const lg = window.liquidGL;
      if (!lg || !window.html2canvas) return;
      if (!document.querySelector('.lg-glass')) return;
      try {
        lg({
          target: '.lg-glass',
          snapshot: 'body',
          resolution: 2,
          refraction: 0.014,
          bevelDepth: 0.06,
          bevelWidth: 0.05,
          frost: 1,
          shadow: false,
          specular: true,
          reveal: 'fade',
        });
        started = true;
      } catch (e) {
        // CSS glass already covers us; just note it.
        console.warn('[liquidGL] init skipped:', e);
      }
    }, 900);
    return () => clearTimeout(t);
  }, [ready]);
}
