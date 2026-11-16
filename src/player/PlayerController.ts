/**
 * PlayerController — командир от первого лица: движение, обзор, столкновения,
 * поиск объекта взаимодействия. Источники ввода — клавиатура с мышью и сенсорный
 * экран (виртуальный джойстик и обзор пальцем подключаются через setMove/addLook).
 */
import * as THREE from 'three';
import { EYE_HEIGHT, PLAYER_RADIUS, PLAYER_RUN, PLAYER_WALK, STEP_RUN, STEP_WALK } from '../core/constants';
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
  private vel = { x: 0, z: 0 };
  private bobAmp = 0;
  private impact = 0;
  /** Фаза шага (π на шаг): по ней же шагает тело командира. */
  stepPhase = Math.PI / 2;
  speed = 0;
  private dragging = false;
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
    // желаемая скорость; настоящая набирается и гасится с инерцией тела
    const tx = (fx * my - fz * mx) * sp;
    const tz = (fz * my + fx * mx) * sp;
    const want = Math.hypot(tx, tz);
    const accel = want > Math.hypot(this.vel.x, this.vel.z) ? (run ? 5.5 : 4) : 7;
    const dvx = tx - this.vel.x;
    const dvz = tz - this.vel.z;
    const dl = Math.hypot(dvx, dvz);
    const stepV = Math.min(dl, accel * dt);
    if (dl > 1e-6) {
      this.vel.x += (dvx / dl) * stepV;
      this.vel.z += (dvz / dl) * stepV;
    }
    const vx = this.vel.x;
    const vz = this.vel.z;
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
    // упёрлись в стену — скорость гаснет
    if (moved < Math.hypot(vx, vz) * dt * 0.5) {
      this.vel.x *= 0.5;
      this.vel.z *= 0.5;
    }
    this.speed = damp(this.speed, moved / Math.max(dt, 1e-4), 14, dt);
    p.x = nx;
    p.z = nz;
    p.zone = sim.grid.zoneAt(p.x, p.z);
    p.indoor = sim.grid.indoorAt(p.x, p.z);

    // ---- шаги: фаза растёт на π за каждый шаг; касание ногой — при |sin| = 1
    const running = this.speed > 3.0;
    const stepLen = running ? STEP_RUN : STEP_WALK;
    const prev = this.stepPhase;
    if (this.speed > 0.15) this.stepPhase += (moved / stepLen) * Math.PI;
    else {
      // остановились: тело доводит шаг до опоры
      const target = Math.round((this.stepPhase - Math.PI / 2) / Math.PI) * Math.PI + Math.PI / 2;
      this.stepPhase += (target - this.stepPhase) * Math.min(1, dt * 6);
    }
    const crossed = Math.floor((this.stepPhase - Math.PI / 2) / Math.PI) !== Math.floor((prev - Math.PI / 2) / Math.PI);
    if (crossed && this.speed > 0.3) {
      this.onStep(p.indoor, running);
      this.impact = running ? 0.022 : 0.012;
    }
    this.impact = Math.max(0, this.impact - dt * 0.12);
    const amp = damp(this.bobAmp, this.speed > 0.2 ? (running ? 0.05 : 0.026) * Math.min(1, this.speed / (running ? 3.5 : 1.3)) : 0, 6, dt);
    this.bobAmp = amp;
    const s = Math.sin(this.stepPhase);
    const c = Math.cos(this.stepPhase);
    // голова ниже всего в момент постановки ноги, выше всего — над опорной ногой
    const vert = -amp * s * s - this.impact * 0.6;
    // перенос веса с ноги на ногу — раз за два шага
    const side = amp * 0.55 * c;
    const roll = c * amp * 0.12;
    const nod = -s * s * amp * 0.08;
    const rx = -fz;
    const rz = fx;
    const eye = (p.gender === 'f' ? EYE_HEIGHT - 0.06 : EYE_HEIGHT) + vert + amp * 0.5;
    this.camera.position.set(p.x + fx * 0.04 + rx * side, eye, p.z + fz * 0.04 + rz * side);
    this.camera.rotation.set(p.pitch + nod, p.yaw + Math.PI, roll, 'YXZ');
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
