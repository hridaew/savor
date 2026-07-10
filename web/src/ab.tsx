// Dev-only side-by-side splat A/B: /ab.html?a=<url>&b=<url>&r=<orbitRadius>&h=<orbitHeight>
// Used to judge training-step budgets and cleaning changes against the real renderer.
// window.__cap[i]() returns a PNG dataURL of pane i; window.__loaded[i] flags load state.
import { createRoot } from 'react-dom/client';
import { SplatViewer } from './splat/SplatViewer';

(window as any).__cap = [null, null];
(window as any).__loaded = [false, false];

const q = new URLSearchParams(location.search);
const a = q.get('a') ?? '/samples/sample-scene.ply';
const b = q.get('b');
const r = Number(q.get('r') || 0);
const h = Number(q.get('h') || 0);
const vec = (s: string | null): [number, number, number] | undefined => {
  const v = s?.split(',').map(Number);
  return v && v.length === 3 && v.every(Number.isFinite) ? (v as [number, number, number]) : undefined;
};
const pos = vec(q.get('pos')); // environment captures: pos=x,y,z&dir=x,y,z
const dir = vec(q.get('dir')) ?? [0, 0, -1];
const dist = r > 1.2 ? Math.min(r, 8) : undefined;
const cam = pos
  ? {
      cameraPosition: pos,
      cameraTarget: [pos[0] + 0.6 * dir[0], pos[1] + 0.6 * dir[1], pos[2] + 0.6 * dir[2]] as [number, number, number],
      lookAround: true,
    }
  : dist
    ? { cameraDistance: dist, cameraHeight: h, minDistance: 0.45 * dist, maxDistance: 1.2 * dist }
    : {};

function Pane({ url, label, slot }: { url: string; label: string; slot: number }) {
  return (
    <div className="pane">
      <div className="tag">{label}</div>
      <SplatViewer
        url={url}
        autoRotate={false}
        sphericalHarmonicsDegree={0}
        {...cam}
        captureRef={{
          get current() {
            return (window as any).__cap[slot];
          },
          set current(fn) {
            (window as any).__cap[slot] = fn;
          },
        }}
        onLoaded={() => ((window as any).__loaded[slot] = true)}
      />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <>
    <Pane url={a} label={q.get('la') ?? 'A'} slot={0} />
    {b && <Pane url={b} label={q.get('lb') ?? 'B'} slot={1} />}
  </>,
);
