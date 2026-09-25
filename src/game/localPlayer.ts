import * as THREE from 'three';
import type { VoxelWorld } from '../engine/world';
import type { Input } from './input';
import { eyeHeight, newBody, stepMove, type Body, type MoveInput } from './physics';

const STEP = 1 / 120;

/** The player you control: reads input, runs movement physics, drives the camera. */
export class LocalPlayer {
  body: Body = newBody();
  yaw = 0;
  pitch = 0;
  /** Camera kick from recoil, added on top of yaw/pitch. */
  punchPitch = 0;
  punchYaw = 0;
  sensitivity = 1;
  /** Mouse sensitivity multiplier while scoped. */
  zoomSens = 1;
  frozen = false;
  lastMove: MoveInput = { forward: 0, right: 0, jump: false, crouch: false, walk: false, yaw: 0 };
  private acc = 0;
  private jumpBuffer = 0;
  private eyeOffset = 0;
  private lastEyeBase = 0;
  private bobPhase = 0;
  private landDip = 0;
  /** Total distance walked, for footstep sounds. */
  stride = 0;

  constructor(private world: VoxelWorld) {}

  setWorld(world: VoxelWorld): void {
    this.world = world;
  }

  spawn(x: number, y: number, z: number, yaw: number): void {
    this.body = newBody(x, y, z);
    this.body.onGround = true;
    this.yaw = yaw;
    this.pitch = 0;
    this.punchPitch = this.punchYaw = 0;
    this.acc = 0;
    this.eyeOffset = 0;
    this.lastEyeBase = y;
  }

  look(input: Input): void {
    const [dx, dy] = input.takeMouse();
    const k = this.sensitivity * 0.0022 * this.zoomSens;
    this.yaw -= dx * k;
    this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch - dy * k));
    this.yaw = ((this.yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  }

  /** Advance movement by a frame; physics runs in fixed 1/120 s steps. */
  update(dt: number, input: Input | null, speedMul: number, onStep?: (b: Body) => void): void {
    const move: MoveInput = { forward: 0, right: 0, jump: false, crouch: false, walk: false, yaw: this.yaw };
    if (input && !this.frozen) {
      move.forward = (input.down('forward') ? 1 : 0) - (input.down('back') ? 1 : 0);
      move.right = (input.down('right') ? 1 : 0) - (input.down('left') ? 1 : 0);
      move.crouch = input.down('crouch');
      move.walk = input.down('walk');
      if (input.pressed('jump')) this.jumpBuffer = 0.12;
    }
    this.lastMove = move;
    this.acc = Math.min(this.acc + dt, 0.1);
    while (this.acc >= STEP) {
      this.acc -= STEP;
      move.jump = this.jumpBuffer > 0;
      const before = this.body.onGround;
      stepMove(this.world, this.body, move, STEP, speedMul);
      if (this.body.jumped) this.jumpBuffer = 0;
      else this.jumpBuffer = Math.max(0, this.jumpBuffer - STEP);
      if (this.body.landed > 0) this.landDip = Math.min(0.12, this.body.landed * 0.012);
      if (before && this.body.onGround) this.stride += Math.hypot(this.body.vx, this.body.vz) * STEP;
      onStep?.(this.body);
    }
  }

  get speed(): number {
    return Math.hypot(this.body.vx, this.body.vz);
  }

  eyePosition(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(this.body.x, this.body.y + eyeHeight(this.body), this.body.z);
  }

  /** Aim direction including recoil punch. */
  aimDirection(out = new THREE.Vector3()): THREE.Vector3 {
    const yaw = this.yaw + this.punchYaw, pitch = this.pitch + this.punchPitch;
    return out.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
  }

  /** Place the camera at the eye with step smoothing, landing dip and a gentle bob. */
  applyCamera(cam: THREE.PerspectiveCamera, dt: number, bob = true): void {
    const b = this.body;
    // Smooth out sudden vertical changes from stepping onto slabs.
    const base = b.y;
    const jump = base - this.lastEyeBase;
    if (b.onGround && Math.abs(jump) > 0.05 && Math.abs(jump) < 0.6) this.eyeOffset -= jump;
    this.lastEyeBase = base;
    this.eyeOffset *= Math.exp(-dt * 14);
    this.landDip *= Math.exp(-dt * 10);

    const sp = this.speed;
    if (b.onGround && sp > 0.5) this.bobPhase += dt * sp * 2.1;
    const bobAmt = bob && b.onGround ? Math.min(1, sp / 5) * 0.028 : 0;
    const bobY = Math.abs(Math.sin(this.bobPhase)) * bobAmt;

    cam.position.set(b.x, base + eyeHeight(b) + this.eyeOffset - this.landDip + bobY, b.z);
    cam.rotation.set(this.pitch + this.punchPitch, this.yaw + this.punchYaw, 0, 'YXZ');
  }

  /** Recoil recovers towards zero while not firing. */
  recoverPunch(dt: number, rate: number): void {
    const k = Math.exp(-dt * rate);
    this.punchPitch *= k;
    this.punchYaw *= k;
  }

  get bobPhaseValue(): number {
    return this.bobPhase;
  }
}
