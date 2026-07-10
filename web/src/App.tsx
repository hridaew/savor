import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { AnimatePresence, motion, useIsPresent } from 'framer-motion';
import type { Capture } from './types';
import { useStore } from './useStore';
import { retryCapture } from './api';
import { play } from './lib/sound';

import { Icon } from './components/Icon';
import { MorphIcon } from './components/MorphIcon';
import { Sheet } from './components/Sheet';
import { LibraryScreen } from './screens/LibraryScreen';
import { AboutScreen } from './screens/AboutScreen';
import { CreateSheet } from './screens/CreateSheet';
import { ProcessingScreen } from './screens/ProcessingScreen';
import { ViewerScreen } from './screens/ViewerScreen';

type Tab = 'library' | 'about';
type Overlay =
  | { kind: 'processing'; id: string }
  | { kind: 'viewer'; id: string }
  | { kind: 'sample' };

/** Full-screen overlay: entrance ease-out, exit mirrors it with ease-in, and
 *  interactions are disabled the moment the exit starts. */
function OverlayShell({ children }: { children: React.ReactNode }) {
  const isPresent = useIsPresent();
  return (
    <motion.div
      style={{ position: 'fixed', inset: 0, zIndex: 85, pointerEvents: isPresent ? undefined : 'none' }}
      initial={{ opacity: 0, scale: 1.015 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.015, transition: { duration: 0.18, ease: 'easeIn' } }}
      transition={{ duration: 0.24, ease: [0.215, 0.61, 0.355, 1] }}
    >
      {children}
    </motion.div>
  );
}

export default function App() {
  const { captures, upsert, remove } = useStore();
  const [tab, setTab] = useState<Tab>('library');
  const [sheet, setSheet] = useState(false);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [dropFile, setDropFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);

  // Tab switches ride the native View Transitions API where available.
  const switchTab = (next: Tab) => {
    if (next === tab) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduce && 'startViewTransition' in document) {
      (document as any).startViewTransition(() => {
        flushSync(() => setTab(next));
      });
    } else {
      setTab(next);
    }
  };

  // Sound cues for pipeline outcomes — the moment a capture finishes or fails
  // the user may not be looking at the screen. Visuals carry the same state.
  const prevStatus = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    const seen = new Set<string>();
    for (const c of captures) {
      seen.add(c.id);
      const prev = prevStatus.current.get(c.id);
      if (prev && prev !== c.status) {
        if (c.status === 'ready') play('success');
        else if (c.status === 'failed') play('error');
      }
      prevStatus.current.set(c.id, c.status);
    }
    for (const id of prevStatus.current.keys()) {
      if (!seen.has(id)) prevStatus.current.delete(id);
    }
  }, [captures]);

  // Drop a video anywhere → jump straight into New Capture with it selected.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types?.includes('Files');
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setDragging(true);
    };
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      depth = 0;
      setDragging(false);
      if (!hasFiles(e)) return;
      e.preventDefault();
      const f = e.dataTransfer?.files?.[0];
      if (f && f.type.startsWith('video/')) {
        setDropFile(f);
        setSheet(true);
      }
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, []);

  const cap: Capture | undefined =
    overlay && 'id' in overlay ? captures.find((c) => c.id === overlay.id) : undefined;

  useEffect(() => {
    if (overlay && 'id' in overlay && !cap) setOverlay(null);
  }, [overlay, cap]);

  // lock background scroll while a modal/overlay is up
  useEffect(() => {
    document.body.style.overflow = overlay || sheet ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [overlay, sheet]);

  const open = (c: Capture) =>
    setOverlay(c.status === 'ready' ? { kind: 'viewer', id: c.id } : { kind: 'processing', id: c.id });

  const onCreated = (c: Capture) => {
    upsert(c);
    setSheet(false);
    setDropFile(null);
    setOverlay({ kind: 'processing', id: c.id });
  };

  const del = async (id: string) => {
    setOverlay(null);
    await remove(id);
  };

  const retry = async (id: string) => {
    try {
      upsert(await retryCapture(id));
    } catch {
      /* ignore */
    }
  };

  const toggleSheet = () => {
    if (sheet) {
      setSheet(false);
      setDropFile(null);
    } else {
      setSheet(true);
    }
  };

  return (
    <>
      <header className="topbar glass">
        <div className="brand">
          <span className="brand-mark">
            <Icon name="cube" size={16} weight={1.9} />
          </span>
          Savor
        </div>
        <button className="btn btn-primary btn-sm" onClick={toggleSheet}>
          <MorphIcon name={sheet ? 'xmark' : 'plus'} size={14} strokeWidth={1.9} />
          New
        </button>
      </header>

      {tab === 'library' ? (
        <LibraryScreen
          captures={captures}
          onOpen={open}
          onCreate={() => setSheet(true)}
          onSample={() => setOverlay({ kind: 'sample' })}
        />
      ) : (
        <AboutScreen onSample={() => setOverlay({ kind: 'sample' })} />
      )}

      <nav className="tabbar glass">
        <button
          className={`tab ${tab === 'library' ? 'active' : ''}`}
          aria-current={tab === 'library' ? 'page' : undefined}
          onClick={() => switchTab('library')}
        >
          <Icon name="cube" size={20} weight={tab === 'library' ? 2 : 1.7} />
          <span className="tab-label">Library</span>
        </button>
        <button className="tab cta" onClick={toggleSheet} aria-label={sheet ? 'Close' : 'New capture'}>
          <MorphIcon name={sheet ? 'xmark' : 'plus'} size={16} strokeWidth={1.9} />
          <span className="tab-label">New</span>
        </button>
        <button
          className={`tab ${tab === 'about' ? 'active' : ''}`}
          aria-current={tab === 'about' ? 'page' : undefined}
          onClick={() => switchTab('about')}
        >
          <Icon name="info" size={20} weight={tab === 'about' ? 2 : 1.7} />
          <span className="tab-label">About</span>
        </button>
      </nav>

      <AnimatePresence>
        {overlay && (
          <OverlayShell key={overlay.kind + ('id' in overlay ? overlay.id : 'sample')}>
            {overlay.kind === 'processing' && cap && (
              <ProcessingScreen
                cap={cap}
                onBack={() => setOverlay(null)}
                onView={() => setOverlay({ kind: 'viewer', id: cap.id })}
                onDelete={() => del(cap.id)}
                onRetry={() => retry(cap.id)}
              />
            )}
            {overlay.kind === 'viewer' && cap?.splatUrl && (
              <ViewerScreen
                name={cap.name}
                url={cap.splatUrl}
                sceneUrl={cap.fullSplatUrl}
                onBack={() => setOverlay(null)}
                onDelete={() => del(cap.id)}
              />
            )}
            {overlay.kind === 'sample' && (
              <ViewerScreen
                name="Sample · Sculpture"
                url="/samples/sample.ply"
                sceneUrl="/samples/sample-scene.ply"
                onBack={() => setOverlay(null)}
              />
            )}
          </OverlayShell>
        )}
      </AnimatePresence>

      <Sheet
        open={sheet}
        onClose={() => {
          setSheet(false);
          setDropFile(null);
        }}
      >
        <CreateSheet onCreated={onCreated} initialFile={dropFile} />
      </Sheet>

      <AnimatePresence>
        {dragging && (
          <motion.div
            className="drop-veil"
            initial={{ opacity: 0, scale: 0.99 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.99, transition: { duration: 0.14, ease: 'easeIn' } }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
          >
            <div style={{ textAlign: 'center' }}>
              <Icon name="film" size={38} weight={1.6} style={{ color: 'var(--accent)' }} />
              <div className="t-title3" style={{ marginTop: 10 }}>
                Drop video to create
              </div>
              <div className="t-subhead dim" style={{ marginTop: 4 }}>
                A 20–40s clip circling your subject
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
