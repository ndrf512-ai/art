/**
 * SaveSystem — слоты сохранений в локальном хранилище устройства.
 * Сохраняется весь мир: люди и их планы, патрули, улики, шпионы, орудия,
 * ресурсы, противник, миссии, время и погода.
 */
import { SAVE_PREFIX } from '../core/constants';
import type { SaveData, Sim } from './Sim';
import { WorldTimeSystem } from './WorldTimeSystem';

export interface SlotInfo {
  slot: string;
  label: string;
  when: number;
  chapter: string;
}

export const SLOTS = ['auto', 'quick', 'slot1', 'slot2', 'slot3'] as const;
export const SLOT_NAMES: Record<string, string> = { auto: 'Автосохранение', quick: 'Быстрое сохранение', slot1: 'Ячейка 1', slot2: 'Ячейка 2', slot3: 'Ячейка 3' };

export class SaveSystem {
  constructor(private sim: Sim) {}

  private storage(): Storage | null {
    try {
      return typeof localStorage !== 'undefined' ? localStorage : null;
    } catch {
      return null;
    }
  }

  save(slot: string): boolean {
    const st = this.storage();
    if (!st) return false;
    try {
      const data = this.sim.serialize();
      const meta: SlotInfo = { slot, label: `${WorldTimeSystem.date(this.sim.now)}, ${WorldTimeSystem.clock(this.sim.now)}`, when: Date.now(), chapter: this.sim.missions.state.title };
      st.setItem(SAVE_PREFIX + slot, JSON.stringify({ meta, data }));
      this.sim.bus.emit('save:done', { slot });
      return true;
    } catch (e) {
      console.warn('Не удалось сохранить', e);
      return false;
    }
  }

  info(slot: string): SlotInfo | null {
    const st = this.storage();
    if (!st) return null;
    try {
      const raw = st.getItem(SAVE_PREFIX + slot);
      if (!raw) return null;
      return JSON.parse(raw).meta as SlotInfo;
    } catch {
      return null;
    }
  }

  list(): SlotInfo[] {
    return SLOTS.map((s) => this.info(s)).filter((x): x is SlotInfo => !!x);
  }

  latest(): SlotInfo | null {
    return this.list().sort((a, b) => b.when - a.when)[0] ?? null;
  }

  load(slot: string): boolean {
    const st = this.storage();
    if (!st) return false;
    try {
      const raw = st.getItem(SAVE_PREFIX + slot);
      if (!raw) return false;
      const data = JSON.parse(raw).data as SaveData;
      this.sim.deserialize(data);
      this.sim.bus.emit('load:done', { slot });
      return true;
    } catch (e) {
      console.warn('Не удалось загрузить', e);
      return false;
    }
  }
}
