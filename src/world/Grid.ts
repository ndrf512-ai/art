import type { ZoneId } from '../core/types';

export const SOLID = 0;
export const INDOOR = 1;
export const OUTDOOR = 2;

/**
 * Клеточная карта комплекса (клетка 1×1 м). Единый источник правды для геометрии,
 * столкновений, навигации и зон допуска.
 */
export class Grid {
  readonly w: number;
  readonly h: number;
  readonly type: Uint8Array;
  readonly zone: Uint8Array;
  readonly ceil: Float32Array;
  /** Высота наружной стены для массива (фасад холма либо отдельное здание). */
  readonly roof: Float32Array;
  /** 1 — отдельно стоящее здание с плоской крышей (не холм). */
  readonly building: Uint8Array;
  readonly blocked: Uint8Array;
  readonly zoneIds: ZoneId[] = ['solid'];

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    const n = w * h;
    this.type = new Uint8Array(n);
    this.zone = new Uint8Array(n);
    this.ceil = new Float32Array(n);
    this.roof = new Float32Array(n);
    this.building = new Uint8Array(n);
    this.blocked = new Uint8Array(n);
  }

  idx(cx: number, cz: number): number {
    return cz * this.w + cx;
  }

  inBounds(cx: number, cz: number): boolean {
    return cx >= 0 && cz >= 0 && cx < this.w && cz < this.h;
  }

  zoneIndex(id: ZoneId): number {
    let i = this.zoneIds.indexOf(id);
    if (i < 0) {
      i = this.zoneIds.length;
      this.zoneIds.push(id);
    }
    return i;
  }

  typeAt(cx: number, cz: number): number {
    if (!this.inBounds(cx, cz)) return SOLID;
    return this.type[cz * this.w + cx];
  }

  /** Проходима ли клетка (не стена и не занята мебелью). */
  walkable(cx: number, cz: number): boolean {
    if (cx < 0 || cz < 0 || cx >= this.w || cz >= this.h) return false;
    const i = cz * this.w + cx;
    return this.type[i] !== SOLID && this.blocked[i] === 0;
  }

  walkableAt(x: number, z: number): boolean {
    return this.walkable(Math.floor(x), Math.floor(z));
  }

  /** Прозрачна ли клетка для взгляда (мебель не мешает, стены мешают). */
  open(cx: number, cz: number): boolean {
    if (cx < 0 || cz < 0 || cx >= this.w || cz >= this.h) return false;
    return this.type[cz * this.w + cx] !== SOLID;
  }

  zoneAt(x: number, z: number): ZoneId {
    const cx = Math.floor(x);
    const cz = Math.floor(z);
    if (!this.inBounds(cx, cz)) return 'outside';
    return this.zoneIds[this.zone[cz * this.w + cx]];
  }

  indoorAt(x: number, z: number): boolean {
    return this.typeAt(Math.floor(x), Math.floor(z)) === INDOOR;
  }

  setBlockedRect(x0: number, z0: number, x1: number, z1: number, v: boolean): void {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        if (this.inBounds(x, z)) this.blocked[z * this.w + x] = v ? 1 : 0;
      }
    }
  }

  /** Прямая видимость между двумя точками (стены закрывают обзор). */
  los(x0: number, z0: number, x1: number, z1: number): boolean {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) return true;
    const steps = Math.ceil(len / 0.45);
    const sx = dx / steps;
    const sz = dz / steps;
    let x = x0;
    let z = z0;
    for (let i = 1; i < steps; i++) {
      x += sx;
      z += sz;
      if (!this.open(Math.floor(x), Math.floor(z))) return false;
    }
    return true;
  }

  /** Можно ли пройти по прямой телом радиуса r. */
  walkLine(x0: number, z0: number, x1: number, z1: number, r = 0.28): boolean {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) return this.walkableAt(x0, z0);
    const steps = Math.ceil(len / 0.3);
    const nx = (-dz / len) * r;
    const nz = (dx / len) * r;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = x0 + dx * t;
      const z = z0 + dz * t;
      if (!this.walkableAt(x, z)) return false;
      if (!this.walkableAt(x + nx, z + nz)) return false;
      if (!this.walkableAt(x - nx, z - nz)) return false;
    }
    return true;
  }

  /** Ближайшая проходимая клетка (центр) к точке. */
  nearestWalkable(x: number, z: number, maxR = 6): { x: number; z: number } | null {
    const cx = Math.floor(x);
    const cz = Math.floor(z);
    if (this.walkable(cx, cz)) return { x, z };
    for (let r = 1; r <= maxR; r++) {
      let best: { x: number; z: number } | null = null;
      let bd = Infinity;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          if (this.walkable(cx + dx, cz + dz)) {
            const px = cx + dx + 0.5;
            const pz = cz + dz + 0.5;
            const d = (px - x) * (px - x) + (pz - z) * (pz - z);
            if (d < bd) {
              bd = d;
              best = { x: px, z: pz };
            }
          }
        }
      }
      if (best) return best;
    }
    return null;
  }
}
