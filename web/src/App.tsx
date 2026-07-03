import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { Capture } from './types';
import { useStore } from './useStore';
import { useLiquidGlass } from './useLiquidGlass';
import { retryCapture } from './api';

import { Icon } from './components/Icon';
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

export default function App() {
  const { captures, upsert, remove } = useStore();
  const [tab, setTab] = useState<Tab>('library');
  const [sheet, setSheet] = useState(false);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [dropFile, setDropFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);

  useLiquidGlass(true);

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

  return (
    <>
      <header className="topbar lg-glass glass" data-liquid-ignore>
        <div className="brand">
          <span className="brand-orb" />
          Savor
        </div>
        <button className="btn btn-tinted btn-sm" onClick={() => setSheet(true)}>
          <Icon name="plus" size={17} weight={2.3} />
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

      <nav className="tabbar lg-glass glass" data-liquid-ignore>
        <button className={`tab ${tab === 'library' ? 'active' : ''}`} onClick={() => setTab('library')}>
          <Icon name="cube" size={22} weight={tab === 'library' ? 2 : 1.7} />
          <span className="tab-label">Library</span>
        </button>
        <button className="tab cta" onClick={() => setSheet(true)}>
          <Icon name="plus" size={20} weight={2.4} />
          <span className="tab-label">New</span>
        </button>
        <button className={`tab ${tab === 'about' ? 'active' : ''}`} onClick={() => setTab('about')}>
          <Icon name="info" size={22} weight={tab === 'about' ? 2 : 1.7} />
          <span className="tab-label">About</span>
        </button>
      </nav>

      <AnimatePresence>
        {overlay && (
          <motion.div
            key={overlay.kind + ('id' in overlay ? overlay.id : 'sample')}
            style={{ position: 'fixed', inset: 0, zIndex: 85 }}
            data-liquid-ignore
            initial={{ opacity: 0, scale: 1.02 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.02 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
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
          </motion.div>
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
            initial={{ opacity: 0, scale: 0.985 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.985 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
          >
            <div style={{ textAlign: 'center' }}>
              <Icon name="film" size={40} weight={1.6} style={{ color: 'var(--blue)' }} />
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
