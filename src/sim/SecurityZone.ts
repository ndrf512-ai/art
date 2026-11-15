import type { Clearance, ZoneDef, ZoneId } from '../core/types';
import { ZONES } from '../world/layout';
import type { Sim } from './Sim';

/** Зоны безопасности: уровень допуска зоны (с учётом решений командира) и принадлежность точки зоне. */
export class SecurityZone {
  state = { levelOverride: {} as Partial<Record<ZoneId, Clearance>> };

  constructor(private sim: Sim) {}

  reset(): void {
    this.state = { levelOverride: {} };
  }

  def(id: ZoneId): ZoneDef {
    return ZONES[id];
  }

  name(id: ZoneId): string {
    return ZONES[id]?.name ?? id;
  }

  at(x: number, z: number): ZoneId {
    return this.sim.grid.zoneAt(x, z);
  }

  /** Требуемый уровень допуска; при оранжевой и красной тревоге служебные зоны закрываются строже. */
  level(id: ZoneId): Clearance {
    const base = this.state.levelOverride[id] ?? ZONES[id].level;
    return base;
  }

  setLevel(id: ZoneId, level: Clearance): void {
    this.state.levelOverride[id] = level;
    this.sim.access.invalidate();
  }

  /** Зоны, которые командир может дополнительно ограничить. */
  list(): ZoneDef[] {
    return Object.values(ZONES).filter((z) => z.id !== 'solid' && z.id !== 'outside');
  }

  save(): unknown {
    return this.state;
  }

  load(d: any): void {
    this.state = d;
  }
}
