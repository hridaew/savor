import { useEffect, useState } from 'react';
import type { Health } from './types';
import { getHealth } from './api';

/**
 * Server tool health, polled while anything is missing (e.g. Brush is still
 * downloading, COLMAP not installed yet) so setup UI updates live. Polling
 * stops for good once everything is ready.
 */
export function useHealth(): Health | null {
  const [health, setHealth] = useState<Health | null>(null);
  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    const tick = async () => {
      try {
        const h = await getHealth();
        if (stopped) return;
        setHealth(h);
        if (h.ok) return;
      } catch {
        /* server still starting — keep trying */
      }
      timer = window.setTimeout(tick, 4000);
    };
    void tick();
    return () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, []);
  return health;
}
