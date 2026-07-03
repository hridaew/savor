import { lazy } from 'react';

/**
 * Code-split entry for the splat viewer: three.js + the gaussian-splat engine
 * (~1 MB) load on demand, keeping the library's first paint light.
 */
export const SplatViewerLazy = lazy(() =>
  import('./SplatViewer').then((m) => ({ default: m.SplatViewer })),
);
