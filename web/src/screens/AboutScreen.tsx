import { useEffect, useState } from 'react';
import type { Health } from '../types';
import { getHealth } from '../api';
import { NavScreen } from '../components/NavScreen';
import { Icon, type IconName } from '../components/Icon';

const FLOW: { icon: IconName; color: string; title: string; body: string }[] = [
  { icon: 'film', color: 'var(--teal)', title: 'Film a clip', body: 'Slowly walk around your subject for 20–40 seconds, keeping it centered.' },
  { icon: 'photo', color: 'var(--blue)', title: 'Extract frames', body: 'ffmpeg pulls ~150 evenly-spaced stills from your video.' },
  { icon: 'viewfinder', color: 'var(--cyan)', title: 'Solve geometry', body: 'COLMAP figures out where each photo was taken and builds a sparse 3D point cloud.' },
  { icon: 'sparkles', color: 'var(--orange)', title: 'Train the splat', body: 'Brush optimizes tens of thousands of gaussians on your GPU into a photoreal model — watch it sharpen live.' },
  { icon: 'orbit', color: 'var(--green)', title: 'Isolate, orbit & export', body: 'Savor separates the subject from its surroundings automatically. Orbit either view, save a photo, or export a .ply.' },
];

const TOOL_LABEL: Record<string, string> = {
  ffmpeg: 'ffmpeg',
  ffprobe: 'ffprobe',
  colmap: 'COLMAP',
  brush: 'Brush',
};

export function AboutScreen({ onSample }: { onSample: () => void }) {
  const [health, setHealth] = useState<Health | null>(null);
  useEffect(() => {
    getHealth().then(setHealth).catch(() => {});
  }, []);

  return (
    <NavScreen title="About" subtitle="How Savor works">
      <button className="btn btn-primary full" onClick={onSample}>
        <Icon name="orbit" size={19} />
        Explore the sample sculpture
      </button>

      <div className="section-head">The pipeline</div>
      <div className="card" style={{ padding: '18px 18px 0' }}>
        <div className="flow">
          {FLOW.map((s, i) => (
            <div className="flow-step" key={s.title}>
              <div className="flow-rail">
                <div className="flow-ic" style={{ background: s.color }}>
                  <Icon name={s.icon} size={22} />
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
          return (
            <div className="row" key={k}>
              <div
                className="tool-dot"
                style={{ background: !health ? 'var(--label-3)' : ok ? 'var(--green)' : 'var(--red)' }}
              />
              <div className="row-main">
                <div className="t-callout" style={{ fontWeight: 600 }}>
                  {TOOL_LABEL[k]}
                </div>
                <div className="t-foot dim">
                  {!health ? 'checking…' : ok ? t?.version ?? 'ready' : t?.detail ?? 'not found'}
                </div>
              </div>
              {health && (
                <Icon
                  name={ok ? 'check' : 'xmark'}
                  size={18}
                  style={{ color: ok ? 'var(--green)' : 'var(--red)' }}
                />
              )}
            </div>
          );
        })}
      </div>
      <p className="t-foot dim3" style={{ padding: '10px 6px 0', lineHeight: 1.4 }}>
        Everything runs locally — your videos never leave your machine.
      </p>

      <div className="section-head">Capture tips</div>
      <div className="inset-group">
        {[
          'Move slowly and steadily — avoid motion blur.',
          'Keep the subject filling most of the frame.',
          'Even, diffuse lighting. Avoid harsh glare and reflections.',
          'Textured, matte objects work best; glass and mirrors are hard.',
          'Get full coverage — high, low, and all the way around.',
        ].map((tip) => (
          <div className="row" key={tip}>
            <Icon name="check" size={18} style={{ color: 'var(--blue)', flex: '0 0 auto' }} />
            <div className="row-main t-subhead">{tip}</div>
          </div>
        ))}
      </div>

      <p className="t-cap dim3" style={{ textAlign: 'center', padding: '24px 10px 0', lineHeight: 1.6 }}>
        Built on ffmpeg, COLMAP &amp; Brush.<br />
        Rendering by @mkkellogg/gaussian-splats-3d · glass by liquidGL.<br />
        Savor · a starting point for an iOS app.
      </p>
    </NavScreen>
  );
}
