// Som das notificacoes do Studio (Web Audio, sem arquivos de audio): toques sinteticos + volume, guardados neste navegador.
// Navegadores so liberam som depois de um clique/tecla na pagina: unlockAudio() e ligado no primeiro gesto.

export type Tone = "sino" | "gota" | "digital" | "alerta";
export const TONES: Array<{ id: Tone; label: string }> = [
  { id: "sino", label: "Sino" },
  { id: "gota", label: "Gota" },
  { id: "digital", label: "Digital" },
  { id: "alerta", label: "Alerta" },
];

export interface SoundPrefs {
  tone: Tone;
  /** 0 a 1 */
  volume: number;
}

const KEY = "agent-canvas.notify-sound";
const DEFAULTS: SoundPrefs = { tone: "sino", volume: 0.6 };

export function loadSoundPrefs(): SoundPrefs {
  try {
    const v = JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Partial<SoundPrefs>;
    return { tone: TONES.some((t) => t.id === v.tone) ? (v.tone as Tone) : DEFAULTS.tone, volume: typeof v.volume === "number" && v.volume >= 0 && v.volume <= 1 ? v.volume : DEFAULTS.volume };
  } catch {
    return DEFAULTS;
  }
}

export function saveSoundPrefs(p: SoundPrefs): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // navegador sem storage: vale so nesta sessao
  }
}

let ctx: AudioContext | null = null;

/** Cria/retoma o AudioContext (precisa rodar dentro de um gesto do usuario na primeira vez). Devolve se o som esta liberado. */
export function unlockAudio(): boolean {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx.state === "running";
  } catch {
    return false;
  }
}

export const audioReady = (): boolean => ctx?.state === "running";

interface Note {
  at: number;
  freq: number;
  dur: number;
  type: OscillatorType;
  /** frequencia final (glissando) */
  to?: number;
  gain?: number;
}

const PATTERNS: Record<Tone, Note[]> = {
  sino: [
    { at: 0, freq: 880, dur: 0.45, type: "sine" },
    { at: 0.16, freq: 1320, dur: 0.6, type: "sine", gain: 0.8 },
  ],
  gota: [{ at: 0, freq: 720, to: 320, dur: 0.28, type: "sine" }],
  digital: [0, 0.12, 0.24].map((at) => ({ at, freq: 1000, dur: 0.08, type: "square" as const, gain: 0.35 })),
  alerta: [
    { at: 0, freq: 520, dur: 0.18, type: "triangle" },
    { at: 0.22, freq: 390, dur: 0.18, type: "triangle" },
    { at: 0.44, freq: 520, dur: 0.18, type: "triangle" },
    { at: 0.66, freq: 390, dur: 0.22, type: "triangle" },
  ],
};

/** Toca o toque; avisos "warn"/"error" tocam duas vezes. Devolve false se o navegador ainda nao liberou o som. */
export function playTone(tone: Tone, volume: number, level: string = "info"): boolean {
  if (!unlockAudio() || !ctx) return false;
  const c = ctx;
  const repeat = level === "warn" || level === "error" ? 2 : 1;
  const span = Math.max(...PATTERNS[tone].map((n) => n.at + n.dur)) + 0.25;
  for (let r = 0; r < repeat; r++) {
    for (const n of PATTERNS[tone]) {
      const t0 = c.currentTime + 0.02 + r * span + n.at;
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = n.type;
      osc.frequency.setValueAtTime(n.freq, t0);
      if (n.to) osc.frequency.exponentialRampToValueAtTime(n.to, t0 + n.dur);
      const peak = Math.max(0.0001, volume * (n.gain ?? 1) * 0.5);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + n.dur);
      osc.connect(g).connect(c.destination);
      osc.start(t0);
      osc.stop(t0 + n.dur + 0.05);
    }
  }
  return true;
}
