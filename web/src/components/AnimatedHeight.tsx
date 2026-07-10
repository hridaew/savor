import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { useMeasure } from '../lib/useMeasure';

/**
 * Animates a container's height to follow its content — the two-div pattern:
 * the outer div animates, the inner div is measured (never the same element).
 * Falls back to "auto" until the first measurement, clips overflow during the
 * transition, and lags slightly so it feels like it's catching up to the
 * content. Reserved for interactive content that actually changes size
 * (container-no-excessive-use).
 */
export function AnimatedHeight({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const [ref, bounds] = useMeasure();
  return (
    <motion.div
      className={className}
      animate={{ height: bounds.height > 0 ? bounds.height : 'auto' }}
      transition={{ duration: 0.2, delay: 0.05, ease: 'easeOut' }}
      style={{ overflow: 'hidden' }}
    >
      <div ref={ref}>{children}</div>
    </motion.div>
  );
}
