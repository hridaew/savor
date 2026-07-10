/**
 * Procedural UI sound — synthesized with the Web Audio API, no assets.
 *
 * Follows the userinterface-wiki audio rules:
 * - one shared AudioContext, resumed if suspended, nodes disconnected on end
 * - exponential decay envelopes targeting 0.001 (never 0), initial value set
 * - filtered noise for percussive taps (bandpass 3–6kHz, Q 2–5, 5–15ms)
 * - oscillators with pitch sweeps for tonal confirmations
 * - sound only for meaningful moments (confirmations, completion, errors);
 *   never typing, hover, or navigation
 * - every sound has a visual equivalent in the UI; sound is reinforcement
 * - user toggle + independent volume (persisted); prefers-reduced-motion
 *   is respected as a proxy for sound sensitivity
 */

export type SoundName = 'tap' | 'confirm' | 'success' | 'error' | 'shutter';

const STORAGE_KEY = 'savor-sound';

interface SoundPrefs {
  enabled: boolean;
  volume: number; // 0..1, default subtle (impl-default-subtle)
}

function loadPrefs(): SoundPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return {
        enabled: typeof p.enabled === 'boolean' ? p.enabled : true,
        volume: typeof p.volume === 'number' ? Math.min(1, Math.max(0, p.volume)) : 0.3,
      };
    }
  } catch {
    /* fall through to defaults */
  }
  return { enabled: true, volume: 0.3 };
}

let prefs: SoundPrefs = loadPrefs();
const listeners = new Set<() => void>();

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* private mode etc. — sounds still work for the session */
  }
  listeners.forEach((l) => l());
}

export function getSoundPrefs(): SoundPrefs {
  return prefs;
}
export function setSoundEnabled(enabled: boolean) {
  prefs = { ...prefs, enabled };
  persist();
}
export function setSoundVolume(volume: number) {
  prefs = { ...prefs, volume: Math.min(1, Math.max(0, volume)) };
  persist();
}
export function subscribeSoundPrefs(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/* ── Engine ─────────────────────────────────────────────────────────────── */

let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

/** Percussive tap: 8ms noise burst through a bandpass filter. */
function tap(ac: AudioContext, t: number, gainScale: number, freq = 4200) {
  const length = Math.max(1, Math.floor(ac.sampleRate * 0.008)); // 8ms
  const buffer = ac.createBuffer(1, length, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.exp(-i / 50);
  }
  const source = ac.createBufferSource();
  source.buffer = buffer;

  const filter = ac.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = freq; // crisp 3000–6000Hz range
  filter.Q.value = 3; // focused but natural

  const gain = ac.createGain();
  gain.gain.setValueAtTime(0.5 * gainScale, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);

  source.connect(filter).connect(gain).connect(ac.destination);
  source.start(t);
  source.onended = () => {
    source.disconnect();
    filter.disconnect();
    gain.disconnect();
  };
}

/** Tonal note: oscillator with an upward pitch sweep and exponential decay. */
function note(
  ac: AudioContext,
  t: number,
  gainScale: number,
  from: number,
  to: number,
  dur: number,
  peak: number,
  type: OscillatorType = 'sine',
) {
  const osc = ac.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t);
  osc.frequency.exponentialRampToValueAtTime(to, t + dur * 0.4);

  const gain = ac.createGain();
  gain.gain.setValueAtTime(peak * gainScale, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

  osc.connect(gain).connect(ac.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
  osc.onended = () => {
    osc.disconnect();
    gain.disconnect();
  };
}

/**
 * Play a named UI sound. No-ops when disabled, when the user prefers reduced
 * motion, or when Web Audio is unavailable.
 */
export function play(name: SoundName) {
  if (!prefs.enabled) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const ac = getContext();
  if (!ac) return;
  if (ac.state === 'suspended') void ac.resume();

  const t = ac.currentTime;
  const v = prefs.volume; // master scale keeps every gain well under 1.0

  switch (name) {
    // Soft mechanical tick — significant button presses only.
    case 'tap':
      tap(ac, t, v);
      break;
    // Single modest pop — upload/submission accepted.
    case 'confirm':
      note(ac, t, v, 440, 590, 0.12, 0.22, 'triangle');
      break;
    // Two rising notes — capture finished (weight matches the moment).
    case 'success':
      note(ac, t, v, 523, 659, 0.16, 0.2, 'sine');
      note(ac, t + 0.09, v, 784, 880, 0.22, 0.18, 'sine');
      break;
    // Gentle descending tone — informs, never punishes.
    case 'error':
      note(ac, t, v, 330, 262, 0.2, 0.18, 'sine');
      break;
    // Camera shutter: two quick filtered clicks.
    case 'shutter':
      tap(ac, t, v, 4800);
      tap(ac, t + 0.045, v * 0.8, 3200);
      break;
  }
}
