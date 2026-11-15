import type { Resources, ShellId, SupplyItem } from '../core/types';
import type { Sim } from './Sim';

export const SHELL_NAMES: Record<ShellId, string> = {
  he21: '21-см осколочно-фугасный',
  cp21: '21-см бетонобойный',
  smoke21: '21-см дымовой',
  he38: '38-см фугасный',
  sp38: '38-см спецснаряд особой мощности',
};

export const ITEM_NAMES: Record<SupplyItem, string> = {
  ...SHELL_NAMES,
  fuel: 'Топливо, л',
  food: 'Продовольствие, рационов',
  medicine: 'Медикаменты, компл.',
  parts: 'Запчасти, компл.',
};

/** Ограниченные ресурсы комплекса, электропитание и связь. */
export class ResourceSystem {
  state = this.initial();
  private lowFlags: Record<string, boolean> = {};

  constructor(private sim: Sim) {}

  private initial() {
    return {
      res: { ammo: { he21: 96, cp21: 20, smoke21: 16, he38: 12, sp38: 4 }, fuel: 2100, food: 520, medicine: 34, parts: 26 } as Resources,
      power: 1,
      radio: true,
      wire: true,
      lineCut: false,
      radioBattery: 180,
      hungryMeals: 0,
    };
  }

  reset(): void {
    this.state = this.initial();
    this.lowFlags = {};
  }

  get res(): Resources {
    return this.state.res;
  }

  ammo(shell: ShellId): number {
    return this.state.res.ammo[shell];
  }

  get(item: SupplyItem): number {
    const r = this.state.res;
    return item in r.ammo ? r.ammo[item as ShellId] : (r as any)[item];
  }

  add(item: SupplyItem, n: number): void {
    const r = this.state.res;
    if (item in r.ammo) r.ammo[item as ShellId] = Math.max(0, r.ammo[item as ShellId] + n);
    else (r as any)[item] = Math.max(0, (r as any)[item] + n);
  }

  take(item: SupplyItem, n: number): boolean {
    if (this.get(item) < n) return false;
    this.add(item, -n);
    return true;
  }

  manpower(): { fit: number; total: number } {
    let fit = 0;
    let total = 0;
    for (const n of this.sim.npcs.list) {
      if (n.unit === 'external' || n.unit === 'enemy') continue;
      if (n.status === 'dead') continue;
      total++;
      if (n.status === 'active') fit++;
    }
    return { fit, total };
  }

  update(_dt: number, gdt: number): void {
    const s = this.state;
    const eq = this.sim.repair;
    const gen = eq.get('generator');
    const gen2 = eq.get('generator2');
    const hasFuel = s.res.fuel > 0;
    let power = 0;
    if (gen.running && !gen.broken && hasFuel) power = 1;
    else if (gen2.running && !gen2.broken && hasFuel) power = 0.35;
    if (power > 0) s.res.fuel = Math.max(0, s.res.fuel - (power === 1 ? 15 : 6) * (gdt / 60));
    if (power !== s.power) {
      s.power = power;
      this.sim.bus.emit('power:changed', { on: power > 0, backup: power > 0 && power < 1 });
      if (power === 0) this.sim.notify('Электропитание комплекса отключено.', 'alarm');
      else if (power < 1) this.sim.notify('Питание от резервного генератора: только основные потребители.', 'warn');
      else this.sim.notify('Электропитание восстановлено.', 'good');
    }
    // радиостанция держится на аккумуляторах около трёх часов
    if (power > 0) s.radioBattery = Math.min(180, s.radioBattery + gdt * 0.5);
    else s.radioBattery = Math.max(0, s.radioBattery - gdt);
    const radio = !eq.get('radio').broken && (power > 0 || s.radioBattery > 0);
    const wire = !eq.get('switchboard').broken && !s.lineCut;
    if (radio !== s.radio || wire !== s.wire) {
      s.radio = radio;
      s.wire = wire;
      this.sim.bus.emit('comms:changed', { radio, wire });
      if (!radio) this.sim.notify('Радиосвязь потеряна.', 'alarm');
      if (!wire) this.sim.notify('Телефонная связь не работает.', 'alarm');
      if (radio && wire) this.sim.notify('Связь восстановлена.', 'good');
    }
    this.checkLow('fuel', s.res.fuel < 500, 'Топливо на исходе');
    this.checkLow('food', s.res.food < 160, 'Продовольствия осталось менее чем на сутки');
    this.checkLow('he21', s.res.ammo.he21 < 24, 'Мало 21-см фугасных снарядов');
    this.checkLow('parts', s.res.parts < 6, 'Запчасти на исходе');
    this.checkLow('medicine', s.res.medicine < 8, 'Медикаменты на исходе');
  }

  private checkLow(kind: string, low: boolean, text: string): void {
    if (low && !this.lowFlags[kind]) {
      this.sim.bus.emit('resource:low', { kind });
      this.sim.notify(text + '.', 'warn');
    }
    this.lowFlags[kind] = low;
  }

  save(): unknown {
    return this.state;
  }

  load(d: any): void {
    this.state = d;
    this.lowFlags = {};
  }
}
