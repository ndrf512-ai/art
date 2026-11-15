/**
 * RepairSystem — износ и ремонт оборудования. Механики сами диагностируют
 * неисправности, носят запчасти и чинят; командир задаёт только приоритет.
 */
import type { Equipment, EquipmentId, NpcState, Step } from '../core/types';
import type { GoalOption } from './NPCSystem';
import type { Sim } from './Sim';

const DEFS: [EquipmentId, string, number, number, number][] = [
  ['generator', 'Главный генератор', 16.5, 51.5, 86],
  ['generator2', 'Резервный генератор', 21.5, 48.5, 74],
  ['radio', 'Радиостанция', 79.5, 31.5, 82],
  ['switchboard', 'Телефонный коммутатор', 61.5, 30.5, 80],
  ['truck1', 'Грузовик №1', 32.5, 66.5, 70],
  ['truck2', 'Грузовик №2', 37.5, 66.5, 64],
  ['gun1', 'Установка №1 «Конрад»', 122.5, 40.5, 88],
  ['gun2', 'Орудие №2', 78.5, 81.5, 80],
  ['gun3', 'Орудие №3', 98.5, 81.5, 68],
  ['hoist', 'Снарядный подъёмник установки', 126.5, 44.5, 78],
  ['searchlight', 'Прожекторы периметра', 114.5, 110.5, 75],
  ['ventilation', 'Вентиляция бункера', 22.5, 53.5, 77],
];

const WEAR_PARTS: Partial<Record<EquipmentId, string[]>> = {
  generator: ['изношены вкладыши коленвала', 'прогорела прокладка головки', 'засорён топливный насос'],
  generator2: ['залегли поршневые кольца', 'неисправен регулятор оборотов'],
  radio: ['вышла из строя генераторная лампа', 'пробит конденсатор блока питания'],
  switchboard: ['окислились контакты гнёзд', 'перегорела вызывная обмотка'],
  truck1: ['течь тормозного цилиндра', 'износ сцепления'],
  truck2: ['пробит радиатор', 'люфт рулевых тяг'],
  gun1: ['течь в накатнике', 'износ направляющих люльки'],
  gun2: ['ослаб тормоз отката', 'износ подъёмного механизма'],
  gun3: ['течь в накатнике', 'выработка поворотного механизма'],
  hoist: ['перетёрся трос подъёмника', 'сгорела обмотка электромотора'],
  searchlight: ['перегорели угли дуговых ламп'],
  ventilation: ['заклинил подшипник вентилятора'],
};

const TECH_ROLES = new Set(['mech_chief', 'mechanic', 'electrician']);

export class RepairSystem {
  state = { eq: {} as Record<EquipmentId, Equipment>, prioritySeq: 0 };

  constructor(private sim: Sim) {
    sim.calls['repair.diagnose'] = (n, id) => this.diagnose(n, id);
    sim.calls['repair.work'] = (n, id) => this.work(n, id);
    sim.calls['repair.release'] = (n, id) => {
      const e = this.state.eq[id as EquipmentId];
      if (e && e.mechanic === n.id) e.mechanic = null;
    };
  }

  reset(): void {
    const eq = {} as Record<EquipmentId, Equipment>;
    for (const [id, name, x, z, cond] of DEFS) {
      eq[id] = { id, name, x, z, condition: cond + this.sim.rng.range(-4, 4), broken: false, cause: null, diagnosed: false, finding: '', priority: 0, mechanic: null, progress: 0, running: id !== 'generator2' };
    }
    this.state = { eq, prioritySeq: 0 };
  }

  get(id: EquipmentId): Equipment {
    return this.state.eq[id];
  }

  all(): Equipment[] {
    return Object.values(this.state.eq);
  }

  /** Приказ командира: чинить это в первую очередь. */
  prioritize(id: EquipmentId): void {
    this.state.eq[id].priority = ++this.state.prioritySeq;
  }

  wear(id: EquipmentId, amount: number): void {
    const e = this.state.eq[id];
    e.condition = Math.max(0, e.condition - amount);
  }

  /** Поломка. cause: 'wear' | 'sabotage' | 'damage'. */
  breakDown(id: EquipmentId, cause: Equipment['cause'], silent = false): void {
    const e = this.state.eq[id];
    if (e.broken) return;
    e.broken = true;
    e.cause = cause;
    e.diagnosed = false;
    e.finding = '';
    e.progress = 0;
    e.condition = Math.min(e.condition, cause === 'damage' ? 20 : 30);
    this.sim.bus.emit('equipment:broken', { id, cause: cause ?? 'wear' });
    if (!silent) this.sim.notify(`${e.name}: неисправность.`, 'alarm');
    if (id === 'generator' && !this.state.eq.generator2.broken) this.state.eq.generator2.running = true;
  }

  update(_dt: number, gdt: number): void {
    const h = gdt / 60;
    const rng = this.sim.rng;
    for (const e of this.all()) {
      if (e.broken) continue;
      const active = e.running && (e.id === 'generator' || e.id === 'generator2' || e.id === 'radio' || e.id === 'switchboard' || e.id === 'ventilation');
      if (active) e.condition = Math.max(0, e.condition - 0.22 * h);
      if (e.condition < 34 && e.running && rng.chance(((36 - e.condition) / 60) * h)) this.breakDown(e.id, 'wear');
    }
    // резервный генератор включается сам при отказе главного
    const g = this.state.eq.generator;
    const g2 = this.state.eq.generator2;
    g2.running = g.broken || !g.running;
  }

  /** Самая важная работа для механика. */
  private pickJob(n: NpcState): Equipment | null {
    let best: Equipment | null = null;
    let bs = -1;
    for (const e of this.all()) {
      if (e.mechanic && e.mechanic !== n.id) continue;
      if (!e.broken && e.condition >= 62) continue;
      if (n.role === 'electrician' && !['generator', 'generator2', 'radio', 'switchboard', 'searchlight', 'ventilation', 'hoist'].includes(e.id)) continue;
      if ((e.id === 'gun1' || e.id === 'hoist') && n.doc.clearance < 4) continue;
      let s = e.broken ? 100 : 62 - e.condition;
      if (e.priority) s += 200 + e.priority;
      if (e.id === 'generator' && e.broken) s += 60;
      if (e.id === 'radio' && e.broken) s += 40;
      if (s > bs) {
        bs = s;
        best = e;
      }
    }
    return best;
  }

  option(n: NpcState): GoalOption | null {
    if (!TECH_ROLES.has(n.role) || n.status !== 'active') return null;
    const sim = this.sim;
    const block = sim.schedule.block(n);
    const job = this.pickJob(n);
    if (!job) return null;
    // вне смены поднимают только ради серьёзной поломки
    if (block !== 'duty' && !(job.broken && (job.priority > 0 || job.id === 'generator' || job.id === 'radio'))) return null;
    const key = `repair:${job.id}`;
    return {
      key,
      score: job.broken ? 68 + (job.priority ? 8 : 0) : 57,
      task: `${job.broken ? 'Ремонт' : 'Обслуживание'}: ${job.name}`,
      abort: { fn: 'repair.release', a: job.id },
      plan: () => {
        job.mechanic = n.id;
        const pos = this.workPos(job);
        const steps: Step[] = [];
        if (job.broken && !job.diagnosed) {
          steps.push({ k: 'go', x: pos.x, z: pos.z, run: true, tol: 0.6 }, { k: 'do', anim: 'inspect', dur: 6 + (100 - n.skill) / 12 }, { k: 'call', fn: 'repair.diagnose', a: job.id });
        }
        if (job.broken && sim.resources.get('parts') > 0) {
          const parts = sim.layout.byTag('ws_parts')[0];
          steps.push({ k: 'go', x: parts.x, z: parts.z, tol: 0.6 }, { k: 'do', anim: 'pickup', dur: 1.5 }, { k: 'call', fn: 'carry.set', a: 'box' });
        }
        steps.push({ k: 'go', x: pos.x, z: pos.z, tol: 0.6 }, { k: 'call', fn: 'carry.clear' }, { k: 'do', anim: 'repair_low', dur: 12 }, { k: 'call', fn: 'repair.work', a: job.id });
        return steps;
      },
    };
  }

  private workPos(e: Equipment): { x: number; z: number } {
    if (e.id === 'gun1' || e.id === 'gun2' || e.id === 'gun3') {
      const g = this.sim.artillery.gun(e.id);
      if (g) {
        const p = this.sim.grid.nearestWalkable(g.x + 2.2, g.z - 2.4, 5);
        if (p) return p;
      }
    }
    if (e.id === 'truck1' || e.id === 'truck2') {
      const v = this.sim.supply.vehicle(e.id);
      if (v && v.state === 'parked') {
        const p = this.sim.grid.nearestWalkable(v.x + 2, v.z, 4);
        if (p) return p;
      }
    }
    return { x: e.x, z: e.z };
  }

  private diagnose(n: NpcState, id: EquipmentId): void {
    const e = this.state.eq[id];
    if (!e) return;
    e.diagnosed = true;
    const sim = this.sim;
    if (e.cause === 'sabotage') {
      const found = sim.rng.chance(0.45 + n.skill / 180);
      if (found) {
        e.finding = sim.sabotage.describe(id);
        sim.sabotage.discovered(id, n);
      } else {
        e.finding = 'Причина отказа не установлена. Нужен повторный осмотр.';
      }
    } else if (e.cause === 'damage') {
      e.finding = 'Повреждение осколками и взрывной волной.';
    } else {
      e.finding = 'Естественный износ: ' + sim.rng.pick(WEAR_PARTS[id] ?? ['износ узлов']) + '.';
    }
    sim.radio.send(`Мастерская (${n.last})`, `Диагностика: ${e.name}`, e.finding, e.cause === 'sabotage' && e.finding.includes('умышлен') ? 'urgent' : 'routine', 'repair', { id }, false);
  }

  private work(n: NpcState, id: EquipmentId): void {
    const e = this.state.eq[id];
    if (!e) return;
    const sim = this.sim;
    const helpers = sim.npcs.list.filter((o) => o !== n && o.goal === n.goal).length;
    const gain = (14 + n.skill * 0.22) * (1 - n.fatigue / 260) * (1 + helpers * 0.5);
    if (e.broken) {
      e.progress += gain;
      if (e.progress >= 100) {
        const hadParts = sim.resources.take('parts', e.cause === 'damage' ? 3 : 2);
        e.broken = false;
        e.cause = null;
        e.progress = 0;
        e.priority = 0;
        e.mechanic = null;
        e.condition = hadParts ? Math.min(100, 62 + n.skill * 0.3) : 44;
        e.running = e.id !== 'generator2';
        sim.bus.emit('equipment:repaired', { id });
        sim.notify(`${e.name}: исправно${hadParts ? '' : ' (временный ремонт — нет запчастей)'}.`, 'good');
        sim.npcs.remember(n, 'event', `Отремонтировал: ${e.name}`, 1);
        if (id === 'gun1' || id === 'gun2' || id === 'gun3') {
          const g = sim.artillery.gun(id);
          if (g) g.sightBias = 0;
        }
      }
    } else {
      e.condition = Math.min(100, e.condition + gain * 0.35);
      if (e.condition >= 80) e.mechanic = null;
    }
  }

  save(): unknown {
    return this.state;
  }

  load(d: any): void {
    this.state = d;
  }
}
