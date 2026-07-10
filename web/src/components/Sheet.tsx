import { AnimatePresence, motion, useIsPresent, type PanInfo } from 'framer-motion';
import type { ReactNode } from 'react';

/** Child of AnimatePresence so useIsPresent reflects this sheet's own
 *  lifecycle; interactions are disabled the moment it starts exiting. */
function SheetPanel({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const isPresent = useIsPresent();

  const onDragEnd = (_e: unknown, info: PanInfo) => {
    if (info.offset.y > 120 || info.velocity.y > 600) onClose();
  };

  return (
    <div className="sheet-wrap">
      <motion.div
        className="sheet"
        style={isPresent ? undefined : { pointerEvents: 'none' }}
        initial={{ y: '100%', opacity: 0.6 }}
        // Gesture-driven + interruptible → spring (preserves flick velocity).
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: '100%', opacity: 0.6 }}
        transition={{ type: 'spring', stiffness: 500, damping: 44 }}
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.6 }}
        onDragEnd={onDragEnd}
      >
        <div className="grabber" />
        <div className="sheet-body">{children}</div>
      </motion.div>
    </div>
  );
}

export function Sheet({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="sheet"
          // Scrim entrance ease-out / exit ease-in, coordinated with the panel.
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.16, ease: 'easeIn' } }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
        >
          <div className="scrim" onClick={onClose} />
          <SheetPanel onClose={onClose}>{children}</SheetPanel>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
