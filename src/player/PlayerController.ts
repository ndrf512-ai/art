/**
 * PlayerController — командир от первого лица: движение, обзор, столкновения,
 * поиск объекта взаимодействия. Источники ввода — клавиатура с мышью и сенсорный
 * экран (виртуальный джойстик и обзор пальцем подключаются через setMove/addLook).
 */
import * as THREE from 'three';
import { EYE_HEIGHT, PLAYER_RADIUS, PLAYER_RUN, PLAYER_WALK } from '../core/constants';
import { clamp, damp, dist } from '../core/math';
import type { Interactable } from '../core/types';
import { fullName } from '../sim/DocumentSystem';
import type { Sim } from '../sim/Sim';

export interface InteractTarget {
  kind: 'npc' | 'object';
  id: string;
  label: string;
  hint: string;
  obj?: Interactable;
}

export class PlayerController {
  private keys = new Set<string>();
  private move = { x: 0, y: 0 };
  private touchRun = false;
  private bob = 0;
  private speed = 0;
  private dragging = false;
  private stepAcc = 0;
  locked = false;
  sensitivity = 1;
  invertY = false;
  target: InteractTarget | null = null;
  /** Обратные вызовы для интерфейса и звука. */
  onInteract: (t: InteractTarget) => void = () => {};
  onStep: (indoor: boolean, run: boolean) => void = () => {};
  onKey: (code: string) => boolean = () => false;
  private fwd = new THREE.Vector3();

  constructor(
    private sim: Sim,
    private camera: THREE.PerspectiveCamera,
    private canvas: HTMLCanvasElement,
  ) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (this.onKey(e.code)) {
        e.preventDefault();
        return;
      }
      this.keys.add(e.code);
      if (e.code === 'KeyE' && !this.sim.player.busy) this.interact();
      if (e.code === 'Tab' || e.code === 'F5' || e.code === 'F9') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || this.sim.player.busy) return;
      if (!this.locked) {
        this.dragging = true;
        canvas.requestPointerLock?.()?.catch?.(() => {});
      }
    });
    window.addEventListener('mouseup', () => (this.dragging = false));
    window.addEventListener('mousemove', (e) => {
      if (this.sim.player.busy) return;
      if (this.locked || this.dragging) this.addLook(e.movementX, e.movementY);
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
    });
  }

  releasePointer(): void {
    if (document.pointerLockElement) document.exitPointerLock?.();
    this.dragging = false;
  }

  /** Виртуальный джойстик: x — вправо, y — вперёд, −1..1. */
  setMove(x: number, y: number): void {
    this.move.x = x;
    this.move.y = y;
  }

  setRun(on: boolean): void {
    this.touchRun = on;
  }

  /** Поворот обзора на dx, dy пикселей. */
  addLook(dx: number, dy: number): void {
    const p = this.sim.player;
    const k = 0.0024 * this.sensitivity;
    p.yaw -= dx * k;
    p.pitch = clamp(p.pitch - dy * k * (this.invertY ? -1 : 1), -1.45, 1.35);
  }

  interact(): void {
    if (this.target) this.onInteract(this.target);
  }

  private free(x: number, z: number): boolean {
    const g = this.sim.grid;
    const r = PLAYER_RADIUS;
    return g.walkableAt(x - r, z - r) && g.walkableAt(x + r, z - r) && g.walkableAt(x - r, z + r) && g.walkableAt(x + r, z + r);
  }

  update(dt: number, obstacles: { x: number; z: number; r: number }[]): void {
    const sim = this.sim;
    const p = sim.player;
    let mx = this.move.x;
    let my = this.move.y;
    let run = this.touchRun || Math.hypot(mx, my) > 0.92;
    if (!p.busy) {
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) my += 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) my -= 1;
      if (this.keys.has('KeyD')) mx += 1;
      if (this.keys.has('KeyA')) mx -= 1;
      if (this.keys.has('ArrowLeft')) p.yaw += dt * 2.2;
      if (this.keys.has('ArrowRight')) p.yaw -= dt * 2.2;
      if (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) run = true;
    } else {
      mx = my = 0;
    }
    const len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }
    const sp = (run ? PLAYER_RUN : PLAYER_WALK) * (p.health < 40 ? 0.7 : 1);
    const fx = Math.sin(p.yaw);
    const fz = Math.cos(p.yaw);
    const vx = (fx * my - fz * mx) * sp;
    const vz = (fz * my + fx * mx) * sp;
    let nx = p.x + vx * dt;
    let nz = p.z + vz * dt;
    if (!this.free(nx, p.z)) nx = p.x;
    if (!this.free(nx, nz)) nz = p.z;
    if (!this.free(nx, nz)) {
      nx = p.x;
      nz = p.z;
    }
    // орудия и движущиеся машины выталкивают
    for (const o of obstacles) {
      const d = dist(nx, nz, o.x, o.z);
      const min = o.r + PLAYER_RADIUS;
      if (d < min && d > 1e-3) {
        const px = o.x + ((nx - o.x) / d) * min;
        const pz = o.z + ((nz - o.z) / d) * min;
        if (this.free(px, pz)) {
          nx = px;
          nz = pz;
        }
      }
    }
    const moved = Math.hypot(nx - p.x, nz - p.z);
    this.speed = damp(this.speed, moved / Math.max(dt, 1e-4), 12, dt);
    p.x = nx;
    p.z = nz;
    p.zone = sim.grid.zoneAt(p.x, p.z);
    p.indoor = sim.grid.indoorAt(p.x, p.z);

    if (this.speed > 0.5) {
      this.bob += dt * (run ? 11 : 8);
      this.stepAcc += moved;
      if (this.stepAcc > (run ? 1.5 : 0.95)) {
        this.stepAcc = 0;
        this.onStep(p.indoor, run);
      }
    }
    const eye = (p.gender === 'f' ? EYE_HEIGHT - 0.06 : EYE_HEIGHT) + Math.sin(this.bob) * 0.03 * Math.min(1, this.speed / 3);
    this.camera.position.set(p.x + fx * 0.04, eye, p.z + fz * 0.04);
    this.camera.rotation.set(p.pitch, p.yaw + Math.PI, 0, 'YXZ');
    this.findTarget();
  }

  private findTarget(): void {
    const sim = this.sim;
    const p = sim.player;
    this.target = null;
    if (p.busy) return;
    this.camera.getWorldDirection(this.fwd);
    const fx = this.fwd.x;
    const fz = this.fwd.z;
    const hl = Math.hypot(fx, fz) || 1;
    let best = -Infinity;
    for (const n of sim.npcs.list) {
      if (n.status === 'away' || n.status === 'leave' || n.flags.buried || n.hostile || n.status === 'dead') continue;
      const ax = n.anchor && !n.moving ? n.anchor.x : n.x;
      const az = n.anchor && !n.moving ? n.anchor.z : n.z;
      const dx = ax - p.x;
      const dz = az - p.z;
      const d = Math.hypot(dx, dz);
      if (d > 3.2 || d < 0.05) continue;
      const dot = (dx * fx + dz * fz) / (d * hl);
      if (dot < (d < 1.6 ? 0.35 : 0.8)) continue;
      if (!sim.grid.los(p.x, p.z, ax, az)) continue;
      const score = dot * 3 - d * 0.5;
      if (score > best) {
        best = score;
        this.target = { kind: 'npc', id: n.id, label: fullName(n), hint: n.anim === 'sleep' ? 'спит' : n.position };
      }
    }
    for (const it of sim.layout.interactables) {
      let ix = it.x;
      let iz = it.z;
      if (it.kind === 'gun' && it.ref) {
        const g = sim.artillery.gun(it.ref as 'gun1');
        ix = g.x;
        iz = g.z;
      }
      const dx = ix - p.x;
      const dz = iz - p.z;
      const d = Math.hypot(dx, dz);
      const reach = it.kind === 'gun' ? (it.ref === 'gun1' ? 5.5 : 4.2) : 2.5;
      if (d > reach || d < 0.05) continue;
      const dot = (dx * fx + dz * fz) / (d * hl);
      if (dot < 0.6) continue;
      const score = dot * 3 - d * 0.5 - 0.4;
      if (score > best) {
        best = score;
        this.target = { kind: 'object', id: it.id, label: it.label, hint: '', obj: it };
      }
    }
  }
}
