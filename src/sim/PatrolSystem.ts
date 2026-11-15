/**
 * PatrolSystem — вооружённые патрули: состав, маршрут, сектор, смены, допуск.
 * Патруль сам ходит по маршруту, останавливает людей, проверяет документы,
 * докладывает и реагирует на приказы командира.
 */
import { dist } from '../core/math';
import type { Clearance, NpcState, Patrol, Step, Vec2 } from '../core/types';
import { ZONES } from '../world/layout';
import { fullName } from './DocumentSystem';
import type { GoalOption } from './NPCSystem';
import type { Sim } from './Sim';

export interface PatrolOpts {
  name: string;
  leader: string;
  members: string[];
  route: string;
  points?: Vec2[];
  shiftStart: number;
  shiftEnd: number;
  clearance: Clearance;
  checkAll: boolean;
  temporary?: boolean;
}

export class PatrolSystem {
  state = { patrols: [] as Patrol[], seq: 0 };

  constructor(private sim: Sim) {
    sim.calls['patrol.next'] = (_n, id) => this.advance(id);
    sim.npcs.hooks.push((n, o, d) => this.onSeen(n, o, d));
  }

  reset(): void {
    this.state = { patrols: [], seq: 0 };
  }

  /** Штатные патрули дневной и ночной смены. */
  createDefaults(): void {
    const npcs = this.sim.npcs;
    for (const shift of ['day', 'night'] as const) {
      const leader = npcs.list.find((n) => n.role === 'patrol_leader' && n.shift === shift);
      const member = npcs.list.find((n) => n.role === 'guard' && n.shift === shift);
      if (!leader || !member) continue;
      this.create({
        name: shift === 'day' ? 'Дневной патруль' : 'Ночной патруль',
        leader: leader.id,
        members: [member.id],
        route: shift === 'day' ? 'inner' : 'perimeter',
        shiftStart: shift === 'day' ? 360 : 1080,
        shiftEnd: shift === 'day' ? 1080 : 360,
        clearance: 3,
        checkAll: false,
      });
    }
  }

  get patrols(): Patrol[] {
    return this.state.patrols;
  }

  byId(id: string): Patrol | undefined {
    return this.state.patrols.find((p) => p.id === id);
  }

  create(o: PatrolOpts): Patrol {
    const p: Patrol = {
      id: 'p' + ++this.state.seq,
      name: o.name,
      leader: o.leader,
      members: o.members,
      route: o.route,
      points: o.points ?? [],
      mode: 'route',
      shiftStart: o.shiftStart,
      shiftEnd: o.shiftEnd,
      clearance: o.clearance,
      checkAll: o.checkAll,
      wp: 0,
      waitUntil: 0,
      hold: null,
      active: true,
      temporary: !!o.temporary,
      lastReport: 'Происшествий нет.',
      checking: null,
      checkUntil: 0,
    };
    this.state.patrols.push(p);
    this.replan(p);
    return p;
  }

  disband(id: string): void {
    const p = this.byId(id);
    if (!p) return;
    this.state.patrols = this.state.patrols.filter((x) => x.id !== id);
    this.replan(p);
  }

  /** Действует ли патруль в данный момент (по времени смены). */
  activeNow(p: Patrol): boolean {
    if (!p.active) return false;
    if (p.temporary) return this.sim.now < p.shiftEnd;
    if (this.sim.alert.level >= 2) return true;
    const m = this.sim.time.minuteOfDay;
    return p.shiftStart <= p.shiftEnd ? m >= p.shiftStart && m < p.shiftEnd : m >= p.shiftStart || m < p.shiftEnd;
  }

  memberOf(id: string): Patrol | null {
    for (const p of this.state.patrols) {
      if ((p.leader === id || p.members.includes(id)) && this.activeNow(p)) return p;
    }
    return null;
  }

  routePoints(p: Patrol): Vec2[] {
    if (p.route === 'custom' && p.points.length) return p.points;
    return this.sim.layout.routes[p.route] ?? this.sim.layout.routes.inner;
  }

  routeName(p: Patrol): string {
    return p.route === 'custom' ? 'особый маршрут' : (this.sim.layout.routeNames[p.route] ?? p.route);
  }

  private replan(p: Patrol): void {
    for (const id of [p.leader, ...p.members]) {
      const n = this.sim.npcs.byId(id);
      if (n && n.goal.startsWith('patrol:')) this.sim.npcs.clearGoal(n);
    }
  }

  /** Приказ патрулю (от командира лично либо через начальника караула). */
  setMode(p: Patrol, mode: Patrol['mode'], hold?: Vec2 | null, route?: string): void {
    p.mode = mode;
    p.hold = hold ?? null;
    if (route) {
      p.route = route;
      p.wp = 0;
    }
    this.replan(p);
  }

  private advance(id: string): void {
    const p = this.byId(id);
    if (!p) return;
    const pts = this.routePoints(p);
    p.wp = (p.wp + 1) % pts.length;
  }

  option(n: NpcState): GoalOption | null {
    if (n.status !== 'active') return null;
    const p = this.memberOf(n.id);
    if (!p) return null;
    const sim = this.sim;
    const leader = sim.npcs.byId(p.leader);
    // старший выбыл — его заменяет первый из состава
    if (!leader || leader.status !== 'active') {
      const next = p.members.map((id) => sim.npcs.byId(id)).find((m) => m && m.status === 'active');
      if (!next) return null;
      p.members = p.members.filter((id) => id !== next.id);
      p.leader = next.id;
      return null;
    }
    const key = `patrol:${p.id}`;
    if (n.id !== p.leader) {
      return { key, score: 61, task: `Патруль: ${p.name}`, plan: () => [{ k: 'follow', target: p.leader, dist: 1.8, until: sim.now + 25 }] };
    }
    return {
      key,
      score: 61,
      task: `Патруль: ${p.name} (${this.routeName(p)})`,
      plan: () => {
        if (p.mode === 'follow') return [{ k: 'follow', target: 'player', dist: 2.6, until: sim.now + 20 }];
        if ((p.mode === 'post' || p.mode === 'reinforce' || p.mode === 'respond') && p.hold) {
          return [
            { k: 'go', x: p.hold.x, z: p.hold.z, run: p.mode === 'respond', tol: 0.8 },
            { k: 'do', anim: 'guard', dur: 8 },
          ];
        }
        const pts = this.routePoints(p);
        const wp = pts[p.wp % pts.length];
        const steps: Step[] = [
          { k: 'go', x: wp.x, z: wp.z, tol: 0.8 },
          { k: 'do', anim: 'guard', dur: sim.rng.range(1.2, 2.6) },
          { k: 'call', fn: 'patrol.next', a: p.id },
        ];
        return steps;
      },
    };
  }

  // ------------------------------------------------------------------ проверка документов

  private onSeen(n: NpcState, o: NpcState, d: number): void {
    if (d > 9 || o.status !== 'active' || o.hostile || n.gesture || o.gesture) return;
    const p = this.memberOf(n.id);
    if (!p || p.leader !== n.id || p.checking || p.mode === 'follow') return;
    if (!n.goal.startsWith('patrol:')) return;
    if (p.members.includes(o.id) || o.flags.escorted || o.goal.startsWith('detained') || o.anim === 'sleep') return;
    const sim = this.sim;
    if (o.unit === 'guard' && sim.schedule.onDuty(o)) return;
    if (o.goal.startsWith('crew') || o.goal.startsWith('haul')) return;
    const since = sim.now - o.lastCheck;
    const zoneOk = sim.access.canEnter(o, o.zone);
    const alert = sim.alert.level;
    let want = false;
    if (!zoneOk && since > 15) want = true;
    else if (o.unit === 'external' && since > 90) want = true;
    else if (since > 200) {
      if (p.checkAll || alert >= 1) want = true;
      else if (sim.time.isNight() && sim.schedule.block(o) === 'sleep' && o.zone !== 'barracks' && o.zone !== 'officers') want = true;
      else if (sim.rng.chance(0.03)) want = true;
    }
    if (o.rank >= 8 && o.unit !== 'external' && alert < 2 && !p.checkAll && zoneOk) want = false;
    if (!want) return;
    p.checking = o.id;
    p.checkUntil = sim.clock + 4.2;
    sim.npcs.gesture(n, 'check_docs', 4.2, o.id);
    sim.npcs.gesture(o, 'show_papers', 4.2, n.id);
    sim.npcs.speak(n, 'Стой! Документы.', true);
  }

  update(): void {
    const sim = this.sim;
    for (const p of this.state.patrols) {
      if (p.checking && sim.clock >= p.checkUntil) this.resolveCheck(p);
    }
    const expired = this.state.patrols.filter((p) => p.temporary && sim.now >= p.shiftEnd);
    for (const p of expired) {
      this.disband(p.id);
      sim.guard.log(`${p.name}: задача выполнена, патруль снят.`);
    }
  }

  private resolveCheck(p: Patrol): void {
    const sim = this.sim;
    const o = sim.npcs.byId(p.checking!);
    const leader = sim.npcs.byId(p.leader);
    p.checking = null;
    if (!o || !leader) return;
    const zoneOk = sim.access.canEnter(o, o.zone);
    const thorough = sim.alert.level >= 1 || !zoneOk || p.checkAll;
    const v = sim.docs.verify(o, leader, thorough);
    o.lastCheck = sim.now;
    sim.bus.emit('doc:checked', { checker: leader.id, target: o.id, ok: v.ok && zoneOk, issues: v.issues, zone: o.zone });
    const zoneName = ZONES[o.zone]?.name ?? o.zone;
    if (!v.ok) {
      p.lastReport = `Задержан ${fullName(o)}: ${v.issues.join('; ')}.`;
      sim.ci.detain(o, leader, v.issues, p.name);
    } else if (!zoneOk) {
      const text = `${p.name}: ${fullName(o)} обнаружен в зоне «${zoneName}» без допуска.`;
      sim.guard.log(text);
      p.lastReport = text;
      sim.ci.addEvidence(o.id, 'offzone', `Обнаружен патрулём в зоне «${zoneName}» без допуска`, fullName(leader), 1.2);
      if (sim.zones.level(o.zone) >= 3) sim.ci.detain(o, leader, ['находился в закрытой зоне без допуска'], p.name);
      else {
        sim.npcs.speak(leader, 'Вам здесь находиться не положено. Возвращайтесь.', true);
        sim.npcs.failPlan(o, 45);
      }
    } else {
      if (sim.rng.chance(0.5)) sim.npcs.speak(leader, 'Порядок. Проходите.', true);
      if (sim.alert.level >= 1) sim.guard.log(`${p.name}: проверен ${fullName(o)}, документы в порядке.`);
    }
  }

  /** Доклад старшего патруля командиру. */
  report(p: Patrol): string {
    const n = [p.leader, ...p.members].filter((id) => this.sim.npcs.byId(id)?.status === 'active').length;
    const mode = p.mode === 'follow' ? 'сопровождаем вас' : p.mode === 'route' ? `маршрут — ${this.routeName(p)}` : 'занимаем указанную позицию';
    return `${p.name}, в составе ${n} чел., ${mode}. ${p.lastReport}${p.checkAll ? ' Проверяем всех встречных.' : ''}`;
  }

  /**
   * Сержант сам выбирает бойцов и организует временный патруль в указанный сектор.
   * Возвращает null, если людей нет.
   */
  reinforce(route: string, hours: number, by: NpcState): Patrol | null {
    const sim = this.sim;
    let pool = sim.guard.reserve();
    if (pool.length < 2) {
      const extra = sim.npcs.list
        .filter((n) => n.role === 'guard' && n.status === 'active' && !this.memberOf(n.id) && !pool.includes(n) && !n.goal.startsWith('post:'))
        .sort((a, b) => a.fatigue - b.fatigue);
      pool = pool.concat(extra);
    }
    if (pool.length < 2) return null;
    pool.sort((a, b) => b.rank - a.rank || b.skill - a.skill);
    const [leader, second] = pool;
    const p = this.create({
      name: `Усиление: ${sim.layout.routeNames[route] ?? route}`,
      leader: leader.id,
      members: [second.id],
      route,
      shiftStart: sim.now,
      shiftEnd: sim.now + hours * 60,
      clearance: leader.doc.clearance,
      checkAll: sim.alert.level >= 1,
      temporary: true,
    });
    sim.guard.log(`${fullName(by)} выделил патруль в составе: ${fullName(leader)}, ${fullName(second)} — ${p.name}.`);
    return p;
  }

  /** Расстояние от точки до ближайшего действующего патруля. */
  nearest(x: number, z: number): { patrol: Patrol; d: number } | null {
    let best: { patrol: Patrol; d: number } | null = null;
    for (const p of this.state.patrols) {
      if (!this.activeNow(p)) continue;
      const l = this.sim.npcs.byId(p.leader);
      if (!l || l.status !== 'active') continue;
      const d = dist(x, z, l.x, l.z);
      if (!best || d < best.d) best = { patrol: p, d };
    }
    return best;
  }

  save(): unknown {
    return this.state;
  }

  load(d: any): void {
    this.state = d;
  }
}
