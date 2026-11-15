import type { NpcState, ZoneId } from '../core/types';
import { ZONES } from '../world/layout';
import type { Sim } from './Sim';

/** Контроль доступа: может ли человек находиться в зоне по своим документам. */
export class AccessControlSystem {
  state = { restricted: {} as Record<string, boolean> };
  private costCache = new Map<string, Float32Array>();

  constructor(private sim: Sim) {}

  reset(): void {
    this.state = { restricted: {} };
    this.costCache.clear();
  }

  invalidate(): void {
    this.costCache.clear();
  }

  /** Ограничить допуск конкретного человека общими зонами. */
  restrict(id: string, on: boolean): void {
    this.state.restricted[id] = on;
    this.invalidate();
  }

  isRestricted(id: string): boolean {
    return !!this.state.restricted[id];
  }

  canEnter(npc: NpcState, zone: ZoneId): boolean {
    if (zone === 'solid') return false;
    const def = ZONES[zone];
    const need = this.sim.zones.level(zone);
    if (need === 0) return true;
    let have = npc.doc.clearance;
    if (this.state.restricted[npc.id]) have = Math.min(have, 1) as typeof have;
    if (have < need) return false;
    if (def.group === 'general' && need <= 1) return true;
    if (def.group === 'general') return true;
    return npc.doc.zones.includes(def.group);
  }

  /** Множители стоимости зон для поиска пути: в запретные зоны NPC без нужды не идут. */
  zoneCost(npc: NpcState): Float32Array | null {
    if (npc.hostile) return null;
    const key = `${npc.doc.clearance}|${npc.doc.zones.join(',')}|${this.state.restricted[npc.id] ? 1 : 0}`;
    let arr = this.costCache.get(key);
    if (!arr) {
      const ids = this.sim.grid.zoneIds;
      arr = new Float32Array(ids.length);
      for (let i = 0; i < ids.length; i++) {
        const z = ids[i];
        arr[i] = z === 'outside' ? 5 : this.canEnter(npc, z) ? 1 : 28;
      }
      this.costCache.set(key, arr);
    }
    return arr;
  }

  save(): unknown {
    return this.state;
  }

  load(d: any): void {
    this.state = d;
    this.costCache.clear();
  }
}
