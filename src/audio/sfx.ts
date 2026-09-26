import * as THREE from 'three';
import type { BlockDef } from '../engine/blocks';
import type { WeaponId } from '../game/weapons';
import type { V3 } from '../net/protocol';

type Surface = BlockDef['sound'];

// Per-weapon gunshot character: band-pass centre, body thump pitch, length and loudness.
const GUN: Partial<Record<WeaponId, { band: number; thump: number; len: number; gain: number; crack: number }>> = {
  pistol: { band: 2100, thump: 140, len: 0.1, gain: 0.55, crack: 0.5 },
  deagle: { band: 1300, thump: 90, len: 0.22, gain: 0.85, crack: 0.8 },
  smg: { band: 2400, thump: 150, len: 0.08, gain: 0.5, crack: 0.4 },
  shotgun: { band: 900, thump: 70, len: 0.3, gain: 0.95, crack: 0.6 },
  rifle: { band: 1250, thump: 95, len: 0.16, gain: 0.8, crack: 0.8 },
  carbine: { band: 1600, thump: 110, len: 0.13, gain: 0.7, crack: 0.7 },
  marksman: { band: 1100, thump: 85, len: 0.26, gain: 0.85, crack: 0.9 },
  sniper: { band: 700, thump: 60, len: 0.45, gain: 1.0, crack: 1.0 },
};

/** Procedural sound effects through WebAudio, positioned in 3D. */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noiseBuf!: AudioBuffer;
  private listenerPos = new THREE.Vector3();
  volume = 0.7;

  /** Must be called from a user gesture (click) before sounds can play. */
  unlock(): void {
    if (!this.ctx) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      // Gentle compression keeps many overlapping shots from clipping.
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.master.connect(comp).connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.ctx) this.master.gain.value = v;
  }

  /** The audio context, once sound has been unlocked (null before). */
  get context(): AudioContext | null {
    return this.ctx;
  }

  /** Keep the listener on the camera. */
  setListener(cam: THREE.Camera): void {
    if (!this.ctx) return;
    this.listenerPos.copy(cam.position);
    const l = this.ctx.listener;
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const u = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    const t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setValueAtTime(cam.position.x, t); l.positionY.setValueAtTime(cam.position.y, t); l.positionZ.setValueAtTime(cam.position.z, t);
      l.forwardX.setValueAtTime(f.x, t); l.forwardY.setValueAtTime(f.y, t); l.forwardZ.setValueAtTime(f.z, t);
      l.upX.setValueAtTime(u.x, t); l.upY.setValueAtTime(u.y, t); l.upZ.setValueAtTime(u.z, t);
    } else {
      l.setPosition(cam.position.x, cam.position.y, cam.position.z);
      l.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z);
    }
  }

  private get ok(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** Output node for a sound: 3D-panned when given a position, otherwise plain. */
  private out(pos: V3 | null, gain: number, refDistance = 5): { node: AudioNode; dist: number } {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.value = gain;
    if (!pos) { g.connect(this.master); return { node: g, dist: 0 }; }
    const p = ctx.createPanner();
    p.panningModel = 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = refDistance;
    p.rolloffFactor = 1.1;
    p.maxDistance = 200;
    p.positionX.value = pos[0]; p.positionY.value = pos[1]; p.positionZ.value = pos[2];
    g.connect(p).connect(this.master);
    const dist = this.listenerPos.distanceTo(new THREE.Vector3(pos[0], pos[1], pos[2]));
    return { node: g, dist };
  }

  private noise(dest: AudioNode, t0: number, dur: number, type: BiquadFilterType, freq: number, q: number, attack: number, peak: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + dur + 0.05);
  }

  private tone(dest: AudioNode, t0: number, dur: number, type: OscillatorType, f0: number, f1: number, peak: number, attack = 0.002) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    o.connect(g).connect(dest);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  /** A far-away shot sounds duller: run it through a distance low-pass. */
  private distanceFilter(node: AudioNode, dist: number): AudioNode {
    if (dist < 12) return node;
    const f = this.ctx!.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = Math.max(700, 9000 - dist * 90);
    f.connect(node);
    return f;
  }

  gunshot(w: WeaponId, pos: V3 | null): void {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    if (w === 'knife') { this.knifeSwing(pos); return; }
    const g = GUN[w] ?? GUN.pistol!;
    const { node, dist } = this.out(pos, g.gain, 7);
    const dest = this.distanceFilter(node, dist);
    this.noise(dest, t, g.len, 'bandpass', g.band, 0.7, 0.001, 1.0);
    this.noise(dest, t, 0.03, 'highpass', 3500, 0.5, 0.0005, g.crack);
    this.tone(dest, t, g.len * 0.9, 'sine', g.thump * 1.6, g.thump * 0.5, 0.9);
    // Tail echo, stronger for big guns.
    this.noise(dest, t + 0.02, g.len * 2.4, 'lowpass', 700, 0.3, 0.02, 0.18 * g.gain);
  }

  footstep(surface: Surface, pos: V3 | null, loud = 1): void {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    const { node } = this.out(pos, 0.22 * loud, 3);
    const f: Record<Surface, [number, BiquadFilterType, number]> = {
      stone: [2600, 'bandpass', 0.06], wood: [850, 'bandpass', 0.07], sand: [900, 'lowpass', 0.09],
      grass: [1300, 'bandpass', 0.08], metal: [3200, 'bandpass', 0.07], glass: [4200, 'bandpass', 0.05], snow: [700, 'lowpass', 0.1],
    };
    const [freq, type, dur] = f[surface] ?? f.stone;
    this.noise(node, t, dur, type, freq * (0.85 + Math.random() * 0.3), 1.2, 0.004, 1);
    if (surface === 'metal') this.tone(node, t, 0.12, 'triangle', 1700, 1500, 0.08);
    if (surface === 'wood') this.tone(node, t, 0.06, 'sine', 180, 120, 0.4);
  }

  land(surface: Surface, pos: V3 | null): void {
    this.footstep(surface, pos, 1.6);
  }

  reload(w: WeaponId, stage: 0 | 1): void {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    const { node } = this.out(null, 0.3);
    if (stage === 0) {
      this.tone(node, t, 0.05, 'square', 900, 700, 0.15);
      this.noise(node, t + 0.08, 0.06, 'bandpass', 2500, 2, 0.002, 0.6);
    } else {
      this.noise(node, t, 0.05, 'bandpass', 3000, 3, 0.001, 0.8);
      this.tone(node, t + 0.09, 0.05, 'square', w === 'sniper' ? 500 : 750, 600, 0.2);
    }
  }

  dryFire(): void {
    if (!this.ok) return;
    const { node } = this.out(null, 0.25);
    this.tone(node, this.ctx!.currentTime, 0.03, 'square', 1500, 1200, 0.2);
  }

  knifeSwing(pos: V3 | null): void {
    if (!this.ok) return;
    const { node } = this.out(pos, 0.3, 3);
    const t = this.ctx!.currentTime;
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = 3;
    f.frequency.setValueAtTime(900, t);
    f.frequency.exponentialRampToValueAtTime(3500, t + 0.14);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.7, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    src.connect(f).connect(g).connect(node);
    src.start(t); src.stop(t + 0.2);
  }

  /** Feedback for the shooter when a bullet lands. */
  hit(head: boolean, kill: boolean): void {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    const { node } = this.out(null, 0.32);
    if (head) {
      this.tone(node, t, 0.35, 'triangle', 2400, 2300, 0.35);
      this.tone(node, t, 0.3, 'sine', 3600, 3500, 0.12);
    } else this.tone(node, t, 0.06, 'square', 1150, 900, 0.2);
    if (kill) this.tone(node, t + 0.06, 0.22, 'triangle', 700, 1400, 0.28);
  }

  /** You got hit. */
  hurt(): void {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    const { node } = this.out(null, 0.35);
    this.noise(node, t, 0.12, 'lowpass', 500, 1, 0.002, 1);
    this.tone(node, t, 0.12, 'sine', 160, 70, 0.6);
  }

  death(pos: V3 | null): void {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    const { node } = this.out(pos, 0.35, 4);
    this.tone(node, t, 0.35, 'square', 300, 90, 0.18, 0.01);
    this.noise(node, t, 0.2, 'lowpass', 800, 1, 0.005, 0.5);
  }

  bounce(pos: V3): void {
    if (!this.ok) return;
    const { node } = this.out(pos, 0.25, 3);
    this.tone(node, this.ctx!.currentTime, 0.06, 'triangle', 1400, 900, 0.3);
  }

  explosion(pos: V3): void {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    const { node, dist } = this.out(pos, 1.2, 10);
    const dest = this.distanceFilter(node, dist);
    this.noise(dest, t, 1.2, 'lowpass', 900, 0.5, 0.004, 1);
    this.noise(dest, t, 0.15, 'bandpass', 1800, 0.6, 0.001, 0.8);
    this.tone(dest, t, 0.6, 'sine', 90, 30, 1);
  }

  flashPop(pos: V3): void {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    const { node } = this.out(pos, 0.9, 8);
    this.noise(node, t, 0.25, 'highpass', 1800, 0.5, 0.001, 1);
    this.tone(node, t, 0.1, 'sine', 200, 60, 0.8);
  }

  smokePop(pos: V3): void {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    const { node } = this.out(pos, 0.5, 6);
    this.noise(node, t, 1.8, 'bandpass', 1500, 0.4, 0.3, 0.6);
  }

  /** Ear ringing after a flash, lasting as long as the blindness. */
  ringing(duration: number, amount: number): void {
    if (!this.ok || duration < 0.3) return;
    const t = this.ctx!.currentTime;
    const { node } = this.out(null, 0.12 * amount);
    this.tone(node, t, duration, 'sine', 3900, 3800, 1, 0.01);
  }

  ui(kind: 'click' | 'buy' | 'deny' | 'roundStart' | 'win' | 'lose' | 'tick' | 'chat'): void {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    const { node } = this.out(null, 0.25);
    switch (kind) {
      case 'click': this.tone(node, t, 0.04, 'square', 900, 900, 0.15); break;
      case 'buy': this.tone(node, t, 0.08, 'triangle', 880, 880, 0.3); this.tone(node, t + 0.07, 0.12, 'triangle', 1320, 1320, 0.3); break;
      case 'deny': this.tone(node, t, 0.15, 'square', 220, 180, 0.2); break;
      case 'tick': this.tone(node, t, 0.03, 'square', 1800, 1800, 0.1); break;
      case 'chat': this.tone(node, t, 0.06, 'sine', 1500, 1700, 0.2); break;
      case 'roundStart':
        [523, 659, 784].forEach((f, i) => this.tone(node, t + i * 0.09, 0.14, 'square', f, f, 0.18));
        break;
      case 'win':
        [523, 659, 784, 1047].forEach((f, i) => this.tone(node, t + i * 0.12, 0.25, 'triangle', f, f, 0.3));
        break;
      case 'lose':
        [392, 330, 262].forEach((f, i) => this.tone(node, t + i * 0.16, 0.3, 'triangle', f, f, 0.3));
        break;
    }
  }
}

export const sfx = new Sfx();
