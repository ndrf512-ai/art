import { pad2 } from '../core/math';
import type { AccessGroup, Clearance, NpcState, PersonalDocument, RoleId, UnitId } from '../core/types';
import { RANKS, UNIT_NAMES } from '../data/names';
import type { Sim } from './Sim';

const SERIES: Record<UnitId, string> = {
  staff: 'St', gun1: 'Ar', gun2: 'Ar', gun3: 'Ar', guard: 'Wa', tech: 'Te', signals: 'Fu', supply: 'Vw', medical: 'Sa', secret: 'So', external: 'Kd', enemy: 'XX',
};

const ALL: AccessGroup[] = ['general', 'tech', 'supply', 'arty', 'guard', 'staff', 'ci', 'secret', 'medical'];

/** Допуск по должности: [уровень, группы зон]. */
export const ROLE_ACCESS: Record<RoleId, [Clearance, AccessGroup[]]> = {
  adjutant: [4, ALL],
  battery_cmd: [4, ['general', 'staff', 'arty', 'secret', 'tech']],
  security_chief: [4, ALL],
  ci_officer: [4, ALL],
  quartermaster: [3, ['general', 'staff', 'supply', 'tech', 'arty']],
  engineer: [4, ['general', 'staff', 'tech', 'secret', 'arty']],
  doctor: [3, ['general', 'staff', 'medical', 'supply']],
  gun_cmd: [2, ['general', 'arty']],
  gunner: [2, ['general', 'arty']],
  loader: [2, ['general', 'arty']],
  assistant: [2, ['general', 'arty']],
  bearer: [2, ['general', 'arty']],
  guard_sgt: [3, ['general', 'guard', 'staff', 'arty', 'tech', 'supply']],
  patrol_leader: [3, ['general', 'guard', 'staff', 'arty', 'tech', 'supply']],
  guard: [2, ['general', 'guard', 'arty', 'tech', 'supply']],
  mech_chief: [4, ['general', 'tech', 'arty', 'secret']],
  mechanic: [2, ['general', 'tech', 'arty']],
  electrician: [2, ['general', 'tech']],
  radio_op: [3, ['general', 'staff']],
  clerk: [3, ['general', 'staff']],
  medic: [2, ['general', 'medical', 'arty', 'tech', 'guard', 'supply']],
  cook: [2, ['general', 'supply']],
  cook_helper: [2, ['general', 'supply']],
  driver: [2, ['general', 'tech', 'supply']],
  technician: [4, ['general', 'tech', 'secret']],
  inspector: [4, ALL],
  courier: [1, ['general']],
  new_officer: [3, ['general', 'staff', 'arty']],
  visitor: [1, ['general']],
  intruder: [0, []],
};

export const FLAW_TEXT: Record<string, string> = {
  serial: 'серия документа не соответствует подразделению',
  clearance: 'уровень допуска в документе выше учётного',
  age: 'возраст не совпадает с учётной карточкой',
  stamp: 'печать выдана не комендатурой объекта',
  date: 'дата выдачи вызывает сомнения',
  expired: 'пропуск просрочен',
  name: 'расхождение в написании фамилии',
  missing: 'нет в списках личного состава объекта',
};

export function rankName(npc: { rank: number; unit: UnitId }): string {
  const r = RANKS[npc.rank] ?? RANKS[0];
  const arty = npc.unit === 'gun1' || npc.unit === 'gun2' || npc.unit === 'gun3';
  return arty && r.a ? r.a : r.n;
}

export function fullName(npc: { first: string; last: string; rank: number; unit: UnitId }): string {
  return `${rankName(npc)} ${npc.last}`;
}

/** Документы личного состава, реестр (картотека архива) и проверка подлинности. */
export class DocumentSystem {
  state = { registry: {} as Record<string, PersonalDocument>, flaws: {} as Record<string, string[]>, seq: 1000, checked: {} as Record<string, number>, seen: {} as Record<string, PersonalDocument> };

  constructor(private sim: Sim) {}

  reset(): void {
    this.state = { registry: {}, flaws: {}, seq: 1000 + this.sim.rng.int(0, 400), checked: {}, seen: {} };
  }

  /** Выписать документы и внести человека в картотеку. */
  issue(npc: NpcState, register = true): PersonalDocument {
    const rng = this.sim.rng;
    let [clearance, zones] = ROLE_ACCESS[npc.role];
    // расчёт установки «Конрад» работает в секретном секторе
    if (npc.unit === 'gun1') {
      clearance = 4;
      zones = [...zones, 'secret'];
    }
    const month = rng.int(3, 9);
    const doc: PersonalDocument = {
      holder: `${npc.last} ${npc.first}`,
      rank: rankName(npc),
      unit: UNIT_NAMES[npc.unit],
      position: npc.position,
      clearance,
      zones: [...zones],
      serial: `${SERIES[npc.unit]}-771/${++this.state.seq}`,
      issued: `${pad2(rng.int(1, 27))}.${pad2(month)}.1944`,
      issuedBy: 'Комендатура объекта «Гранит»',
      age: npc.age,
      validUntilDay: 0,
    };
    npc.doc = doc;
    if (register) this.state.registry[npc.id] = JSON.parse(JSON.stringify(doc));
    return doc;
  }

  /** Подделка: документ расходится с картотекой в одной-двух деталях. */
  forge(npc: NpcState, count = 2): void {
    const rng = this.sim.rng;
    const kinds = rng.shuffle(['serial', 'clearance', 'age', 'stamp', 'date']).slice(0, count);
    const d = npc.doc;
    for (const k of kinds) {
      if (k === 'serial') d.serial = d.serial.replace('771', rng.pick(['717', '711', '774']));
      else if (k === 'clearance') d.clearance = Math.min(4, d.clearance + 1) as Clearance;
      else if (k === 'age') d.age += rng.pick([-5, -4, 4, 6]);
      else if (k === 'stamp') d.issuedBy = 'Комендатура гарнизона Вальдхоф';
      else if (k === 'date') d.issued = `31.${rng.pick(['04', '06', '09'])}.1944`;
    }
    if (kinds.includes('clearance') && !d.zones.includes('staff')) d.zones.push('staff');
    this.state.flaws[npc.id] = kinds;
  }

  /** Безобидная канцелярская ошибка у честного человека — ложный след. */
  clericalError(npc: NpcState): void {
    const rng = this.sim.rng;
    const k = rng.pick(['expired', 'age1', 'name']);
    const reg = this.state.registry[npc.id];
    if (!reg) return;
    if (k === 'expired') npc.doc.validUntilDay = 1;
    else if (k === 'age1') reg.age += rng.pick([-1, 1]);
    else reg.holder = reg.holder.replace(/[её]/, 'e').replace('й', 'и') + (reg.holder === npc.doc.holder ? 'н' : '');
  }

  /** Командир лично посмотрел документ: копия остаётся в его записях для сверки с картотекой. */
  markSeen(npc: NpcState): void {
    this.state.seen[npc.id] = JSON.parse(JSON.stringify(npc.doc));
  }

  seenDoc(id: string): PersonalDocument | null {
    return this.state.seen[id] ?? null;
  }

  registry(id: string): PersonalDocument | null {
    return this.state.registry[id] ?? null;
  }

  /** Полный перечень расхождений документа с картотекой (истина). */
  discrepancies(npc: NpcState): string[] {
    const reg = this.state.registry[npc.id];
    const d = npc.doc;
    if (!reg) return ['missing'];
    const out: string[] = [];
    if (reg.serial !== d.serial) out.push('serial');
    if (d.clearance > reg.clearance) out.push('clearance');
    if (reg.age !== d.age) out.push('age');
    if (reg.issuedBy !== d.issuedBy) out.push('stamp');
    if (reg.issued !== d.issued) out.push('date');
    if (reg.holder !== d.holder) out.push('name');
    if (d.validUntilDay > 0 && this.sim.time.day > d.validUntilDay) out.push('expired');
    return out;
  }

  /**
   * Проверка документов постовым или патрулём. Замеченные расхождения зависят от
   * опыта и дисциплины проверяющего и от тщательности проверки.
   */
  verify(npc: NpcState, checker: NpcState | null, thorough: boolean): { ok: boolean; issues: string[] } {
    const all = this.discrepancies(npc);
    const rng = this.sim.rng;
    if (!all.length) return { ok: true, issues: [] };
    // один и тот же проверяющий дважды в день в бумаги знакомого человека не вчитывается
    const day = this.sim.time.day;
    if (checker) {
      const key = `${npc.id}|${checker.id}|${thorough ? 1 : 0}`;
      if (this.state.checked[key] === day) return { ok: true, issues: [] };
      this.state.checked[key] = day;
    }
    const forged = new Set(this.state.flaws[npc.id] ?? []);
    const p = checker ? 0.3 + checker.skill / 220 + checker.discipline / 400 + (thorough ? 0.3 : 0) - checker.fatigue / 500 : 1;
    // хорошую подделку на посту распознают редко: её выдаёт сверка с картотекой
    const pForged = checker ? (thorough ? 0.05 : 0.015) * (0.6 + checker.skill / 100) : 1;
    const found = all.filter((k) => k === 'missing' || k === 'expired' || rng.chance(forged.has(k) ? pForged : p));
    return { ok: found.length === 0, issues: found.map((k) => FLAW_TEXT[k]) };
  }

  save(): unknown {
    return this.state;
  }

  load(d: any): void {
    this.state = d;
    this.state.seen ??= {};
    this.state.checked ??= {};
  }
}
