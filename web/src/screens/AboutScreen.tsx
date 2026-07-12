import { useSyncExternalStore } from 'react';
import type { Health } from '../types';
import { NavScreen } from '../components/NavScreen';
import { Icon, type IconName } from '../components/Icon';
import { MorphIcon } from '../components/MorphIcon';
import { Switch } from '../components/Primitives';
import { prefetchViewer, useForesight } from '../lib/foresight';
import {
  getSoundPrefs,
  play,
  setSoundEnabled,
  setSoundVolume,
  subscribeSoundPrefs,
} from '../lib/sound';

const FLOW: { icon: IconName; color: string; title: string; body: string }[] = [
  { icon: 'film', color: 'var(--teal)', title: 'Film a clip', body: 'Slowly walk around your subject for 20–40 seconds, keeping it centered.' },
  { icon: 'photo', color: 'var(--accent)', title: 'Extract frames', body: 'ffmpeg pulls ~150 evenly-spaced stills from your video.' },
  { icon: 'viewfinder', color: 'var(--ink)', title: 'Solve geometry', body: 'COLMAP figures out where each photo was taken and builds a sparse 3D point cloud.' },
  { icon: 'sparkles', color: 'var(--amber)', title: 'Train the splat', body: 'Brush optimizes tens of thousands of gaussians on your GPU into a photoreal model — watch it sharpen live.' },
  { icon: 'orbit', color: 'var(--green)', title: 'Isolate, orbit & export', body: 'Savor separates the subject from its surroundings automatically. Orbit either view, save a photo, or export a .ply.' },
];

const TOOL_LABEL: Record<string, string> = {
  ffmpeg: 'ffmpeg',
  ffprobe: 'ffprobe',
  colmap: 'COLMAP',
  brush: 'Brush',
};

function SoundPrefs() {
  const prefs = useSyncExternalStore(subscribeSoundPrefs, getSoundPrefs, getSoundPrefs);
  return (
    <div className="inset-group">
      <div className="row">
        <span style={{ color: 'var(--ink-2)', display: 'grid', placeItems: 'center', width: 24 }}>
          <MorphIcon name={prefs.enabled ? 'sound-on' : 'sound-off'} size={18} strokeWidth={1.7} />
        </span>
        <div className="row-main">
          <div className="t-callout" style={{ fontWeight: 600 }}>
            Interface sounds
          </div>
          <div className="t-foot dim">Soft cues when captures finish or fail</div>
        </div>
        <Switch
          on={prefs.enabled}
          label="Interface sounds"
          onChange={(on) => {
            setSoundEnabled(on);
            if (on) play('confirm'); // audible preview of what was just enabled
          }}
        />
      </div>
      {prefs.enabled && (
        <div className="row">
          <span style={{ width: 24 }} />
          <div className="row-main" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="t-foot dim" style={{ flex: '0 0 auto' }}>
              Volume
            </span>
            <input
              className="slider"
              type="range"
              min={0}
              max={100}
              value={Math.round(prefs.volume * 100)}
              aria-label="Sound volume"
              onChange={(e) => setSoundVolume(Number(e.target.value) / 100)}
              onPointerUp={() => play('tap')}
              onKeyUp={(e) => {
                if (e.key.startsWith('Arrow')) play('tap');
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export function AboutScreen({
  onSample,
  health,
}: {
  onSample: () => void;
  health: Health | null;
}) {
  const sampleRef = useForesight<HTMLButtonElement>(prefetchViewer, { hitSlop: 24 });

  return (
    <NavScreen title="About" subtitle="How Savor works">
      <button ref={sampleRef} className="btn btn-primary full" onClick={onSample}>
        <Icon name="orbit" size={17} />
        Explore the sample sculpture
      </button>

      <div className="section-head">The pipeline</div>
      <div className="card" style={{ padding: 'var(--space-4) var(--space-4) 0' }}>
        <div className="flow">
          {FLOW.map((s, i) => (
            <div className="flow-step" key={s.title}>
              <div className="flow-rail">
                <div className="flow-ic" style={{ background: s.color }}>
                  <Icon name={s.icon} size={20} />
                </div>
                {i < FLOW.length - 1 && <div className="flow-conn" />}
              </div>
              <div className="flow-body">
                <div className="t-headline">{s.title}</div>
                <div className="t-foot dim" style={{ marginTop: 3, lineHeight: 1.45 }}>
                  {s.body}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="section-head">On your Mac</div>
      <div className="inset-group">
        {(['ffmpeg', 'ffprobe', 'colmap', 'brush'] as const).map((k) => {
          const t = health?.tools[k];
          const ok = t?.ok;
          const installing = !ok && t?.installing;
          return (
            <div className="row" key={k}>
              {!health ? (
                <div className="shimmer" style={{ width: 8, height: 8, borderRadius: '50%' }} />
              ) : (
                <div
                  className="tool-dot"
                  style={{
                    background: ok ? 'var(--green)' : installing ? 'var(--amber)' : 'var(--red)',
                  }}
                />
              )}
              <div className="row-main">
                <div className="t-callout" style={{ fontWeight: 600 }}>
                  {TOOL_LABEL[k]}
                </div>
                <div className="t-foot dim">
                  {!health ? 'checking…' : ok ? t?.version ?? 'ready' : t?.detail ?? 'not found'}
                  {!ok && !installing && t?.hint ? ` · install: ${t.hint}` : ''}
                </div>
              </div>
              {health && (
                <Icon
                  name={ok ? 'check' : installing ? 'reset' : 'xmark'}
                  size={17}
                  weight={2.1}
                  style={{ color: ok ? 'var(--green)' : installing ? 'var(--amber)' : 'var(--red)' }}
                />
              )}
            </div>
          );
        })}
      </div>
      <p className="t-foot dim3" style={{ padding: '10px 6px 0', lineHeight: 1.4 }}>
        Everything runs locally — your videos never leave your machine.
      </p>

      <div className="section-head">Preferences</div>
      <SoundPrefs />

      <div className="section-head">Capture tips</div>
      {/* Progressive disclosure: the tips expand on demand. */}
      <details className="tips inset-group">
        <summary className="row">
          <Icon name="sparkles" size={18} style={{ color: 'var(--ink-2)', flex: '0 0 auto' }} />
          <div className="row-main t-callout" style={{ fontWeight: 600 }}>
            Five tips for a great capture
          </div>
          <span className="chev-wrap">
            <MorphIcon name="chevron-right" size={16} strokeWidth={1.7} />
          </span>
        </summary>
        {[
          'Move slowly and steadily — avoid motion blur.',
          'Keep the subject filling most of the frame.',
          'Even, diffuse lighting. Avoid harsh glare and reflections.',
          'Textured, matte objects work best; glass and mirrors are hard.',
          'Get full coverage — high, low, and all the way around.',
        ].map((tip) => (
          <div className="row" key={tip}>
            <Icon name="check" size={17} weight={2.1} style={{ color: 'var(--green)', flex: '0 0 auto' }} />
            <div className="row-main t-subhead">{tip}</div>
          </div>
        ))}
      </details>

      <p className="t-cap dim3" style={{ textAlign: 'center', padding: 'var(--space-5) var(--space-2) 0', lineHeight: 1.6 }}>
        Built on ffmpeg, COLMAP &amp; Brush.<br />
        Rendering by @mkkellogg/gaussian-splats-3d.<br />
        Savor · a starting point for an iOS app.
      </p>
    </NavScreen>
  );
}
