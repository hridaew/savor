import { useState } from 'react';
import { motion } from 'framer-motion';
import type { Health, ToolStatus } from '../types';
import { Icon } from './Icon';
import { installColmap } from '../api';

const LABEL: Record<string, string> = {
  ffmpeg: 'FFmpeg',
  ffprobe: 'FFmpeg (ffprobe)',
  colmap: 'COLMAP',
  brush: 'Brush',
};

const mono: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: '0.85em',
  background: 'var(--fill-2)',
  borderRadius: 6,
  padding: '2px 7px',
  whiteSpace: 'nowrap',
};

/** One row per missing tool, rendered by how it can be installed. */
function ToolRow({ name, t }: { name: string; t: ToolStatus }) {
  const [starting, setStarting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const installing = t.installing || starting;

  const onInstall = async () => {
    setErr(null);
    setStarting(true);
    try {
      await installColmap();
    } catch (e: any) {
      setErr(String(e?.message ?? e));
      setStarting(false);
    }
    // Leave `starting` on: health polling now reports installing → ok and the
    // row (or the whole card) updates itself. If it failed, health surfaces it.
  };

  return (
    <div style={{ padding: '10px 0 0', display: 'flex', gap: 10, alignItems: 'baseline' }}>
      <div
        className="tool-dot"
        style={{
          background: installing ? 'var(--amber)' : 'var(--red)',
          flex: '0 0 auto',
          alignSelf: 'center',
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <span className="t-callout" style={{ fontWeight: 600 }}>
          {LABEL[name] ?? name}
        </span>{' '}
        {installing ? (
          <span className="t-foot dim">
            {t.action === 'button'
              ? 'installing — this can take a few minutes…'
              : 'downloading automatically — nothing to do'}
          </span>
        ) : t.action === 'auto' ? (
          <span className="t-foot dim">downloading automatically — nothing to do</span>
        ) : t.action === 'button' ? (
          <span className="t-foot dim">not installed</span>
        ) : (
          <span className="t-foot dim">
            missing — install with <code style={mono}>{t.hint ?? 'npm run setup'}</code>
          </span>
        )}
        {err && (
          <div className="t-foot" style={{ color: 'var(--red)', marginTop: 4 }}>
            {err}
          </div>
        )}
      </div>

      {t.action === 'button' && !installing && (
        <button
          className="btn btn-primary btn-sm"
          style={{ flex: '0 0 auto', alignSelf: 'center' }}
          onClick={onInstall}
        >
          <Icon name="wand" size={14} />
          Install
        </button>
      )}
    </div>
  );
}

/**
 * First-run guidance: shown while any pipeline tool is missing. Each tool is
 * offered the least-effort install path the server supports — a one-click
 * button (macOS COLMAP), an automatic download (Brush, Windows COLMAP), or a
 * copy-paste command. Disappears on its own once everything is ready.
 */
export function SetupCard({ health }: { health: Health | null }) {
  if (!health || health.ok) return null;

  let keys = (['ffmpeg', 'ffprobe', 'colmap', 'brush'] as const).filter(
    (k) => !health.tools[k].ok,
  );
  // ffmpeg and ffprobe install together — one row is enough.
  if (keys.includes('ffmpeg') && keys.includes('ffprobe')) {
    keys = keys.filter((k) => k !== 'ffprobe');
  }

  return (
    <motion.div
      className="card"
      style={{ padding: 'var(--space-4)', marginBottom: 'var(--space-4)' }}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: [0.215, 0.61, 0.355, 1] }}
    >
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <span style={{ color: 'var(--amber)', display: 'grid', placeItems: 'center' }}>
          <Icon name="warning" size={19} weight={1.9} />
        </span>
        <div className="t-headline">Almost ready — finish setup</div>
      </div>
      <p className="t-foot dim" style={{ margin: '8px 0 4px', lineHeight: 1.45 }}>
        Savor runs entirely on this machine and needs a few local tools before it can process
        videos. This is a one-time step.
      </p>

      {keys.map((k) => (
        <ToolRow key={k} name={k} t={health.tools[k]} />
      ))}

      <p className="t-foot dim3" style={{ margin: '10px 0 0', lineHeight: 1.4 }}>
        This card disappears on its own once everything is in place.
      </p>
    </motion.div>
  );
}
