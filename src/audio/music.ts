// Background music, synthesised with WebAudio like the sound effects: no
// audio files, all original. Two themes: a calm one for the menus and a tense
// one that plays during each round's buy phase and fades out when it ends.

export type Track = 'menu' | 'buy';

type Note = [step: number, midi: number, len: number];

interface Song {
  bpm: number;
  bars: number;
  /** Pad chord per bar (MIDI notes), or null for none. */
  pads: (number[] | null)[];
  /** Bass notes per bar. */
  bass: Note[][];
  /** Lead line per bar (plucky, with echo). */
  lead: Note[][];
  /** 16-step drum patterns per bar: k = kick, s = snare, h = closed hat, o = open hat. */
  drums: string[];
  /** Overall level of this song. */
  level: number;
}

const freq = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);
const repeat = <T>(bars: T[], times: number): T[] => Array.from({ length: times }, () => bars).flat();

/** "Sandstone Drift": A minor, relaxed, for the main menu and the lobby. */
const MENU: Song = (() => {
  const chords = [[57, 60, 64, 67], [53, 57, 60, 64], [55, 59, 60, 64], [55, 59, 62, 64], [57, 60, 64, 67], [53, 57, 60, 64], [53, 57, 60, 62], [52, 56, 59, 64]];
  const roots = [45, 41, 48, 43, 45, 41, 38, 40];
  const lead: Note[][] = [
    [[0, 76, 3], [4, 74, 2], [6, 72, 2], [8, 69, 6]],
    [[0, 72, 2], [2, 69, 2], [4, 72, 2], [6, 76, 4], [12, 74, 4]],
    [[0, 76, 6], [8, 79, 4], [12, 76, 4]],
    [[0, 74, 8], [10, 71, 2], [12, 74, 4]],
    [[0, 81, 4], [4, 79, 2], [6, 76, 2], [8, 74, 4], [12, 76, 4]],
    [[0, 72, 6], [8, 69, 4], [12, 72, 4]],
    [[0, 74, 4], [4, 77, 4], [8, 76, 4], [12, 74, 4]],
    [[0, 71, 8], [8, 68, 4], [12, 71, 4]],
  ];
  return {
    bpm: 96,
    bars: 16,
    pads: repeat(chords, 2),
    bass: repeat(roots.map((r) => [[0, r, 5], [6, r, 2], [10, r + 7, 2], [12, r + 12, 3]] as Note[]), 2),
    // First time round the lead rests, so the loop builds up.
    lead: [...chords.map(() => [] as Note[]), ...lead],
    // Two bars of kick only, then a laid-back beat with an open hat every other bar.
    drums: ['k.......k.k.....', 'k.......k.......', ...repeat(['k.h.s.h.k.k.s.h.', 'k.h.s.h.k.h.s.ho'], 7)],
    level: 0.9,
  };
})();

/** "Countdown": E minor, driving, for the buy phase at the start of a round. */
const BUY: Song = (() => {
  const chords = [[64, 67, 71, 76], [60, 64, 67, 72], [57, 60, 64, 69], [59, 63, 66, 71]];
  const roots = [40, 36, 33, 35];
  const order = [0, 1, 2, 1, 0, 1, 2, 3, 0, 1, 2, 1, 3, 2, 1, 0];
  return {
    bpm: 124,
    bars: 4,
    pads: chords.map((c) => c.map((n) => n - 12)),
    bass: roots.map((r) => Array.from({ length: 8 }, (_, i) => [i * 2, r + (i % 2 ? 12 : 0), 1] as Note)),
    lead: chords.map((c) => order.map((k, i) => [i, c[k] + 12, 1] as Note)),
    // Busy sixteenth hats, and a snare roll into the next loop.
    drums: ['khhhshhhkhhhshhh', 'khhhshhkkhhhshhh', 'khhhshhhkhhhshhh', 'khhhshhkkhhsssss'],
    level: 0.75,
  };
})();

const SONGS: Record<Track, Song> = { menu: MENU, buy: BUY };

/** One playing song: schedules notes a little ahead of time into its own bus. */
class Voice {
  readonly bus: GainNode;
  private step = 0;
  private next: number;
  private readonly stepLen: number;
  private echo: DelayNode;

  constructor(private ctx: BaseAudioContext, dest: AudioNode, private song: Song, start: number, private noise: AudioBuffer) {
    this.bus = ctx.createGain();
    this.bus.connect(dest);
    this.next = start;
    this.stepLen = 60 / song.bpm / 4;
    // A dotted-eighth echo gives the lead some space.
    this.echo = ctx.createDelay(1);
    this.echo.delayTime.value = this.stepLen * 3;
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    this.echo.connect(fb).connect(this.echo);
    this.echo.connect(wet).connect(this.bus);
  }

  /** Schedule every step that starts before `until` (seconds, context time). */
  schedule(until: number): void {
    const s = this.song, total = s.bars * 16;
    while (this.next < until) {
      const bar = Math.floor(this.step / 16) % s.bars, st = this.step % 16, t = this.next;
      const pad = s.pads[bar];
      if (st === 0 && pad) this.pad(t, pad, this.stepLen * 16);
      for (const [at, n, len] of s.bass[bar]) if (at === st) this.bass(t, n, len * this.stepLen);
      for (const [at, n, len] of s.lead[bar]) if (at === st) this.lead(t, n, len * this.stepLen);
      const d = s.drums[bar][st];
      if (d === 'k') this.kick(t);
      if (d === 's') this.snare(t);
      if (d === 'h') this.hat(t, false);
      if (d === 'o') this.hat(t, true);
      this.step = (this.step + 1) % total;
      this.next += this.stepLen;
    }
  }

  private env(t: number, peak: number, attack: number, hold: number, release: number): GainNode {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak * this.song.level, t + attack);
    g.gain.setValueAtTime(peak * this.song.level, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
    return g;
  }

  private osc(type: OscillatorType, f: number, t: number, end: number, out: AudioNode, detune = 0): void {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    o.detune.value = detune;
    o.connect(out);
    o.start(t);
    o.stop(end);
  }

  private pad(t: number, notes: number[], dur: number): void {
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1100;
    const g = this.env(t, 0.035, dur * 0.25, dur * 0.45, dur * 0.4);
    lp.connect(g).connect(this.bus);
    for (const n of notes) for (const det of [-7, 7]) this.osc('sawtooth', freq(n), t, t + dur * 1.15, lp, det);
  }

  private bass(t: number, n: number, dur: number): void {
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(250, t + dur);
    const g = this.env(t, 0.16, 0.008, dur * 0.5, dur * 0.6);
    lp.connect(g).connect(this.bus);
    this.osc('triangle', freq(n), t, t + dur * 1.2, lp);
    this.osc('sine', freq(n - 12), t, t + dur * 1.2, lp);
  }

  private lead(t: number, n: number, dur: number): void {
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(3200, t);
    lp.frequency.exponentialRampToValueAtTime(900, t + Math.max(0.08, dur));
    const g = this.env(t, 0.055, 0.005, dur * 0.3, Math.max(0.12, dur * 0.8));
    lp.connect(g);
    g.connect(this.bus);
    g.connect(this.echo);
    this.osc('square', freq(n), t, t + dur * 1.2 + 0.15, lp);
  }

  private kick(t: number): void {
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = this.env(t, 0.5, 0.002, 0.02, 0.22);
    o.connect(g).connect(this.bus);
    o.start(t);
    o.stop(t + 0.3);
  }

  private noiseHit(t: number, type: BiquadFilterType, f: number, peak: number, len: number): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const flt = this.ctx.createBiquadFilter();
    flt.type = type;
    flt.frequency.value = f;
    const g = this.env(t, peak, 0.002, 0.005, len);
    src.connect(flt).connect(g).connect(this.bus);
    src.start(t, (t * 7.3) % 0.5);
    src.stop(t + len + 0.05);
  }

  private snare(t: number): void {
    this.noiseHit(t, 'bandpass', 1900, 0.22, 0.16);
    const g = this.env(t, 0.1, 0.002, 0.01, 0.08);
    g.connect(this.bus);
    this.osc('triangle', 190, t, t + 0.12, g);
  }

  private hat(t: number, open: boolean): void {
    this.noiseHit(t, 'highpass', 7500, open ? 0.06 : 0.035, open ? 0.25 : 0.035);
  }

  /** Fade to silence over `seconds`, then disconnect. */
  stop(seconds: number): void {
    const now = this.ctx.currentTime;
    const g = this.bus.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + seconds);
    setTimeout(() => { try { this.bus.disconnect(); this.echo.disconnect(); } catch { /* already gone */ } }, (seconds + 0.5) * 1000);
  }
}

function makeNoise(ctx: BaseAudioContext): AudioBuffer {
  const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = buf.getChannelData(0);
  // Fixed seed: the same hiss every time.
  let s = 12345;
  for (let i = 0; i < d.length; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; d[i] = (s / 0x7fffffff) * 2 - 1; }
  return buf;
}

/**
 * Plays the wanted track (or silence), crossfading between them. It only
 * starts once the browser allows sound (after the first click or key press).
 */
export class Music {
  private out: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private voice: Voice | null = null;
  private playing: Track | null = null;
  private wanted: Track | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private level = 0.5;

  constructor(private getCtx: () => AudioContext | null) {}

  /** The track that is playing now (null = silent or fading out). */
  get current(): Track | null {
    return this.playing;
  }

  /** Music level (0..1) times the master volume. */
  setVolume(music: number, master: number): void {
    this.level = music * master;
    const ctx = this.getCtx();
    if (this.out && ctx) this.out.gain.setTargetAtTime(this.level, ctx.currentTime, 0.05);
    this.sync(); // 0% stops the music; turning it back up starts it again
  }

  /** Ask for a track; call as often as you like, changes only when it differs. */
  want(track: Track | null): void {
    this.wanted = track;
    this.sync();
  }

  private sync(): void {
    const ctx = this.getCtx();
    if (!ctx || ctx.state !== 'running') return;
    if (!this.out) {
      this.out = ctx.createGain();
      this.out.gain.value = this.level;
      this.out.connect(ctx.destination);
      this.noise = makeNoise(ctx);
      this.timer = setInterval(() => this.tick(), 50);
    }
    const want = this.level > 0.001 ? this.wanted : null;
    if (want === this.playing) return;
    // Fade out what is playing: quickly when a new track takes over, gently to silence.
    this.voice?.stop(want ? 0.6 : 1.4);
    this.voice = null;
    this.playing = want;
    if (!want) return;
    const v = new Voice(ctx, this.out, SONGS[want], ctx.currentTime + 0.08, this.noise!);
    v.bus.gain.setValueAtTime(0, ctx.currentTime);
    v.bus.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.5);
    this.voice = v;
    this.tick();
  }

  private tick(): void {
    const ctx = this.getCtx();
    if (!ctx) return;
    // Background tabs run timers about once a second, so look further ahead there.
    this.voice?.schedule(ctx.currentTime + (document.hidden ? 1.6 : 0.3));
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.voice?.stop(0.1);
    this.voice = null;
  }
}

/** Render a few seconds of a track without playing it (for tests and tuning). */
export async function renderTrack(track: Track, seconds: number, sampleRate = 22050): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, Math.ceil(seconds * sampleRate), sampleRate);
  const v = new Voice(ctx, ctx.destination, SONGS[track], 0, makeNoise(ctx));
  v.schedule(seconds);
  const buf = await ctx.startRendering();
  return buf.getChannelData(0);
}
