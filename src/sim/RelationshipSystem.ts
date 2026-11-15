/**
 * RelationshipSystem — отношения командира с личным составом: мораль, дисциплина,
 * доверие. Справедливые решения укрепляют авторитет, несправедливые — подрывают.
 */
import { clamp } from '../core/math';
import type { NpcState, UnitId } from '../core/types';
import { RANKS } from '../data/names';
import { fullName, rankName } from './DocumentSystem';
import type { Sim } from './Sim';

export type Punishment = 'reprimand' | 'duty' | 'arrest';

export class RelationshipSystem {
  state = { lastCommend: {} as Record<string, number>, promoted: {} as Record<string, boolean>, confined: {} as Record<string, number>, leave: {} as Record<string, number>, tick: 0, log: [] as string[] };

  constructor(private sim: Sim) {}

  reset(): void {
    this.state = { lastCommend: {}, promoted: {}, confined: {}, leave: {}, tick: 0, log: [] };
  }

  private note(text: string): void {
    this.state.log.push(`${this.sim.time.stamp()}: ${text}`);
    if (this.state.log.length > 60) this.state.log.shift();
  }

  private members(unit: UnitId): NpcState[] {
    return this.sim.npcs.list.filter((n) => n.unit === unit && n.status !== 'dead');
  }

  /** Изменить настроение подразделения. */
  unitMood(unit: UnitId, delta: number, reason: string): void {
    for (const n of this.members(unit)) {
      n.morale = clamp(n.morale + delta, 0, 100);
      n.attitude = clamp(n.attitude + delta * 0.5, 0, 100);
      if (Math.abs(delta) >= 3) this.sim.npcs.remember(n, delta > 0 ? 'praise' : 'incident', reason, Math.abs(delta) / 3);
    }
  }

  /** Проступок: фиксируется, чтобы наказание было «по делу». */
  offence(n: NpcState, what: string, by?: NpcState): void {
    n.flags.offence = what;
    n.flags.offenceT = this.sim.now;
    this.sim.npcs.remember(n, 'incident', `Проступок: ${what}`, 1.5);
    this.sim.guard.log(`Нарушение дисциплины: ${fullName(n)} — ${what}.`);
    if (by) this.sim.radio.send(fullName(by), `Нарушение: ${fullName(n)}`, `${fullName(n)}: ${what}. Жду вашего решения о взыскании.`, 'routine', 'offence', { id: n.id }, false);
  }

  hasOffence(n: NpcState): string | null {
    const o = n.flags.offence;
    return typeof o === 'string' && this.sim.now - Number(n.flags.offenceT ?? 0) < 2880 ? o : null;
  }

  commend(n: NpcState): string {
    const sim = this.sim;
    const last = this.state.lastCommend[n.id];
    const fresh = last === undefined || sim.now - last > 2880;
    const merit = n.memory.some((m) => (m.kind === 'event' || m.kind === 'combat') && sim.now - m.t < 1440);
    const gain = fresh ? (merit ? 12 : 6) : 2;
    n.attitude = clamp(n.attitude + gain, 0, 100);
    n.morale = clamp(n.morale + gain * 1.1, 0, 100);
    this.state.lastCommend[n.id] = sim.now;
    sim.npcs.remember(n, 'praise', 'Командир объявил благодарность', 2);
    this.unitMood(n.unit, fresh && merit ? 2 : 0.5, 'Сослуживцу объявлена благодарность');
    this.note(`${fullName(n)} — объявлена благодарность.`);
    return fresh ? 'Служу отечеству!' : 'Благодарю… снова.';
  }

  promote(n: NpcState): string | null {
    if (this.state.promoted[n.id]) return 'Уже повышен в этой кампании.';
    if (n.rank >= 11 || n.rank === 7) return 'Повышение в этом звании вне вашей власти.';
    const merit = n.skill > 55 || n.memory.some((m) => m.kind === 'praise');
    n.rank++;
    n.doc.rank = rankName(n);
    const reg = this.sim.docs.registry(n.id);
    if (reg) reg.rank = n.doc.rank;
    this.state.promoted[n.id] = true;
    n.attitude = clamp(n.attitude + 15, 0, 100);
    n.morale = clamp(n.morale + 12, 0, 100);
    n.discipline = clamp(n.discipline + 4, 0, 100);
    this.sim.npcs.remember(n, 'praise', `Повышен в звании: ${RANKS[n.rank].n}`, 3);
    this.unitMood(n.unit, merit ? 1.5 : -2.5, merit ? 'Заслуженное повышение сослуживца' : 'Сослуживца повысили не по заслугам');
    this.note(`${fullName(n)} — повышен в звании.`);
    return null;
  }

  punish(n: NpcState, kind: Punishment): string {
    const sim = this.sim;
    const offence = this.hasOffence(n);
    const sev = kind === 'reprimand' ? 1 : kind === 'duty' ? 2 : 3;
    if (offence) {
      n.discipline = clamp(n.discipline + 6 + sev * 4, 0, 100);
      n.attitude = clamp(n.attitude - sev * 2, 0, 100);
      this.unitMood(n.unit, 0, '');
      for (const o of this.members(n.unit)) o.discipline = clamp(o.discipline + sev, 0, 100);
      delete n.flags.offence;
    } else {
      n.discipline = clamp(n.discipline + 2, 0, 100);
      n.attitude = clamp(n.attitude - 6 - sev * 5, 0, 100);
      n.morale = clamp(n.morale - 4 - sev * 3, 0, 100);
      this.unitMood(n.unit, -sev * 1.5, `Несправедливое взыскание: ${fullName(n)}`);
    }
    sim.npcs.remember(n, 'punish', kind === 'reprimand' ? 'Получил выговор от командира' : kind === 'duty' ? 'Получил наряд вне очереди' : 'Арестован на гауптвахту', sev);
    if (kind === 'duty') n.fatigue = clamp(n.fatigue + 18, 0, 100);
    if (kind === 'arrest') {
      this.state.confined[n.id] = sim.now + 1440;
      n.flags.escorted = true;
      sim.npcs.setStatus(n, 'arrested');
    }
    this.note(`${fullName(n)} — ${kind === 'reprimand' ? 'выговор' : kind === 'duty' ? 'наряд вне очереди' : 'сутки ареста'}${offence ? ` (${offence})` : ' (без видимой причины)'}.`);
    return offence ? 'Виноват. Больше не повторится.' : 'Слушаюсь… Но за что?';
  }

  grantLeave(n: NpcState): string | null {
    if (this.sim.alert.level >= 2) return 'При тревоге отпуска запрещены.';
    this.state.leave[n.id] = this.sim.now + 2880;
    n.attitude = clamp(n.attitude + 10, 0, 100);
    this.sim.npcs.setStatus(n, 'leave');
    this.note(`${fullName(n)} — отпуск на двое суток.`);
    return null;
  }

  /** Перевод в другое подразделение. Навыки на новом месте сначала хуже. */
  transfer(n: NpcState, unit: UnitId): string | null {
    const sim = this.sim;
    if (n.rank >= 8) return 'Офицеров переводит штаб.';
    if (n.unit === unit) return 'Уже служит в этом подразделении.';
    const art = sim.artillery;
    for (const g of art.guns()) g.crew = g.crew.map((c) => (c === n.id ? '' : c)).filter((c, i) => c !== '' || i === 0);
    const old = n.unit;
    n.unit = unit;
    if (unit === 'gun1' || unit === 'gun2' || unit === 'gun3') {
      n.role = 'bearer';
      n.position = `Номер расчёта (${sim.artillery.gunName(unit)})`;
      n.workSpot = unit === 'gun1' ? 'hangar_work' : 'gun';
      n.armed = false;
      art.gun(unit).crew.push(n.id);
    } else if (unit === 'guard') {
      n.role = 'guard';
      n.position = 'Караульный';
      n.workSpot = 'guard_bench';
      n.armed = true;
    } else {
      return 'В это подразделение перевод невозможен.';
    }
    n.skill = Math.round(n.skill * 0.7);
    sim.docs.issue(n);
    sim.access.invalidate();
    sim.npcs.clearGoal(n);
    n.attitude = clamp(n.attitude - 3, 0, 100);
    this.unitMood(old, -1, 'Из подразделения забрали человека');
    this.note(`${fullName(n)} — переведён: ${n.position}.`);
    return null;
  }

  /** Общие события, влияющие на настроение гарнизона. */
  event(kind: 'spy_caught' | 'fire_success' | 'casualty' | 'inspection_good' | 'inspection_bad' | 'hunger' | 'repelled'): void {
    const d = { spy_caught: 4, fire_success: 2, casualty: -3, inspection_good: 3, inspection_bad: -3, hunger: -3, repelled: 5 }[kind];
    for (const n of this.sim.npcs.list) {
      if (n.unit === 'external' || n.unit === 'enemy' || n.status === 'dead') continue;
      n.morale = clamp(n.morale + d, 0, 100);
      if (kind === 'spy_caught' || kind === 'repelled' || kind === 'fire_success') n.attitude = clamp(n.attitude + d * 0.6, 0, 100);
    }
  }

  update(_dt: number, gdt: number): void {
    const sim = this.sim;
    const s = this.state;
    s.tick += gdt;
    for (const [id, until] of Object.entries(s.confined)) {
      if (sim.now >= until) {
        delete s.confined[id];
        const n = sim.npcs.byId(id);
        if (n && n.status === 'arrested' && sim.ci.case(id)?.status !== 'handed') {
          delete n.flags.escorted;
          sim.npcs.setStatus(n, 'active');
        }
      }
    }
    for (const [id, until] of Object.entries(s.leave)) {
      if (sim.now >= until) {
        delete s.leave[id];
        const n = sim.npcs.byId(id);
        if (n && n.status === 'leave') {
          const p = sim.layout.points.gate_in;
          n.x = p.x;
          n.z = p.z;
          n.morale = clamp(n.morale + 22, 0, 100);
          n.fatigue = 5;
          sim.npcs.setStatus(n, 'active');
        }
      }
    }
    if (s.tick < 60) return;
    s.tick = 0;
    // раз в час настроение тянется к уровню, который задают условия службы
    const hungry = sim.resources.state.hungryMeals > 0;
    sim.resources.state.hungryMeals = 0;
    if (hungry) this.event('hunger');
    const bad = sim.weather.state.rain > 0.4 || sim.weather.state.snow > 0.3 ? -3 : 0;
    const alertFat = sim.alert.level >= 2 && sim.now - sim.alert.state.since > 360 ? -6 : 0;
    const dark = sim.resources.state.power === 0 ? -5 : 0;
    for (const n of sim.npcs.list) {
      if (n.status === 'dead' || n.unit === 'external' || n.unit === 'enemy') continue;
      const losses = n.memory.filter((m) => m.kind === 'loss' && sim.now - m.t < 2880).length;
      const base = 58 + (n.attitude - 50) * 0.3 - Math.max(0, n.fatigue - 60) * 0.3 - losses * 5 + bad + alertFat + dark;
      n.morale = clamp(n.morale + (base - n.morale) * 0.06, 0, 100);
      n.attitude = clamp(n.attitude + (50 - n.attitude) * 0.004, 0, 100);
      const dBase = 62 + (n.morale - 50) * 0.25 + n.rank * 1.2;
      n.discipline = clamp(n.discipline + (dBase - n.discipline) * 0.03, 0, 100);
    }
  }

  /** Средние показатели гарнизона. */
  averages(): { morale: number; discipline: number; attitude: number } {
    let m = 0;
    let d = 0;
    let a = 0;
    let c = 0;
    for (const n of this.sim.npcs.list) {
      if (n.status === 'dead' || n.unit === 'external' || n.unit === 'enemy') continue;
      m += n.morale;
      d += n.discipline;
      a += n.attitude;
      c++;
    }
    c = Math.max(1, c);
    return { morale: m / c, discipline: d / c, attitude: a / c };
  }

  save(): unknown {
    return this.state;
  }

  load(d: any): void {
    this.state = d;
  }
}
