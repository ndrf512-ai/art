/**
 * SpySystem — скрытые агенты противника. Агент выглядит и живёт как обычный
 * военнослужащий: несёт службу, ест, спит. По ночам, если его никто не видит,
 * наблюдает, роется в архиве, выходит на связь и готовит диверсии.
 */
import { dist } from '../core/math';
import type { NpcState, Step } from '../core/types';
import { ZONES } from '../world/layout';
import type { GoalOption } from './NPCSystem';
import type { Sim } from './Sim';

type ActKind = 'sabotage' | 'transmit' | 'steal' | 'observe';

interface Agent {
  id: string;
  dormantUntil: number;
  nextActAt: number;
  act: { kind: ActKind; target: string; x: number; z: number } | null;
  /** Тайные действия: когда и где агент был на самом деле. */
  acts: { t: number; kind: ActKind; zone: string }[];
  count: number;
}

const CANDIDATE_ROLES = ['clerk', 'mechanic', 'electrician', 'radio_op', 'driver', 'cook_helper', 'technician', 'bearer', 'guard', 'assistant'];

export class SpySystem {
  state = { agents: [] as Agent[], lastTransmit: -1, transmitReported: true, txPoint: 'tx_1', stolen: 0 };

  constructor(private sim: Sim) {
    sim.calls['spy.begin'] = (n) => this.begin(n);
    sim.calls['spy.act'] = (n) => this.perform(n);
    sim.calls['spy.abort'] = (n) => this.abort(n);
  }

  reset(): void {
    this.state = { agents: [], lastTransmit: -1, transmitReported: true, txPoint: this.sim.rng.pick(['tx_1', 'tx_2', 'tx_3']), stolen: 0 };
  }

  /** В начале кампании агентом оказывается случайный человек из гарнизона. */
  plant(): void {
    const sim = this.sim;
    const pool = sim.npcs.list.filter((n) => CANDIDATE_ROLES.includes(n.role) && n.rank < 6);
    const n = sim.rng.pick(pool);
    this.addAgent(n, sim.now + 1440 - sim.time.minuteOfDay + sim.rng.range(60, 170));
  }

  addAgent(n: NpcState, firstAct: number): void {
    this.sim.docs.forge(n, 2);
    this.sim.access.invalidate();
    this.state.agents.push({ id: n.id, dormantUntil: 0, nextActAt: firstAct, act: null, acts: [], count: 0 });
  }

  isSpy(id: string): boolean {
    return this.state.agents.some((a) => a.id === id);
  }

  agent(id: string): Agent | undefined {
    return this.state.agents.find((a) => a.id === id);
  }

  caught(id: string): void {
    this.state.agents = this.state.agents.filter((a) => a.id !== id);
    this.sim.enemy.state.intel = Math.max(0, this.sim.enemy.state.intel - 12);
  }

  /** Агента спугнули: надолго затаится. */
  scare(id: string): void {
    const a = this.agent(id);
    if (a) {
      a.dormantUntil = this.sim.now + this.sim.rng.range(1300, 2000);
      a.act = null;
    }
  }

  /** Чем агент на самом деле занимался в указанное время (для проверки алиби). */
  secretAct(id: string, t: number): { kind: ActKind; zone: string } | null {
    const a = this.agent(id);
    if (!a) return null;
    return a.acts.find((x) => Math.abs(x.t - t) < 35) ?? null;
  }

  private chooseAct(a: Agent, n: NpcState): Agent['act'] {
    const sim = this.sim;
    const L = sim.layout;
    const rng = sim.rng;
    const kinds: [ActKind, number][] = a.count === 0 ? [['sabotage', 1]] : [['sabotage', 3], ['transmit', 3], ['steal', sim.spy.state.stolen < 2 ? 2 : 0.3], ['observe', 1.5]];
    const kind = rng.weighted(kinds, (k) => k[1])![0];
    if (kind === 'sabotage') {
      const target = a.count === 0 ? 'generator' : sim.sabotage.pickTarget(n);
      const p = sim.sabotage.targetPos(target);
      return { kind, target, x: p.x, z: p.z };
    }
    if (kind === 'transmit') {
      const p = L.points[this.state.txPoint];
      return { kind, target: this.state.txPoint, x: p.x, z: p.z };
    }
    if (kind === 'steal') {
      const sp = rng.pick(L.byTag('archive_shelf'));
      return { kind, target: 'archive', x: sp.x, z: sp.z };
    }
    const sp = L.byTag('post_hangar')[0];
    return { kind, target: 'hangar', x: sp.x - 6, z: sp.z + 5 };
  }

  option(n: NpcState): GoalOption | null {
    const a = this.agent(n.id);
    if (!a || n.status !== 'active') return null;
    const sim = this.sim;
    const now = sim.now;
    if (now < a.dormantUntil || now < a.nextActAt || sim.alert.level >= 3 || sim.ci.isDetained(n.id)) return null;
    const m = sim.time.minuteOfDay;
    const dark = m >= 1320 || m < 300;
    if (!dark) return null;
    // на службе агент не отлучается — это сразу заметят
    const block = sim.schedule.block(n);
    if (block === 'duty' && n.shift !== 'night') return null;
    if (block === 'duty' && n.goal.startsWith('post:')) return null;
    if (!a.act) a.act = this.chooseAct(a, n);
    const act = a.act!;
    return {
      key: 'spy:act',
      score: 66,
      // для посторонних глаз — обычное «личное время»
      task: 'Личное время',
      abort: { fn: 'spy.abort' },
      plan: () => {
        const steps: Step[] = [
          { k: 'go', x: act.x, z: act.z, tol: 0.9 },
          { k: 'call', fn: 'spy.begin' },
          { k: 'do', anim: act.kind === 'transmit' ? 'sit_radio' : act.kind === 'observe' ? 'smoke' : act.kind === 'steal' ? 'inspect' : 'repair_low', dur: sim.rng.range(4, 7) },
          { k: 'call', fn: 'spy.act' },
        ];
        const bed = sim.npcs.spot(n.bedSpot);
        if (bed) steps.push({ k: 'go', x: bed.x, z: bed.z });
        return steps;
      },
    };
  }

  /** Перед делом агент осматривается: если рядом свидетели — откладывает. */
  private begin(n: NpcState): void {
    const sim = this.sim;
    const a = this.agent(n.id);
    if (!a || !a.act) return sim.npcs.clearGoal(n);
    const watchers = sim.npcs.list.filter((o) => o !== n && o.status === 'active' && o.anim !== 'sleep' && dist(o.x, o.z, n.x, n.z) < 9 && sim.grid.los(o.x, o.z, n.x, n.z));
    const c = sim.ci.case(n.id);
    if (c?.surveillance && sim.rng.chance(0.75)) {
      // наружное наблюдение берёт агента с поличным
      const ci = sim.npcs.first('ci_officer') ?? sim.npcs.first('security_chief');
      const what = a.act.kind === 'transmit' ? 'готовил к работе радиопередатчик' : a.act.kind === 'steal' ? 'вскрывал шкафы архива' : a.act.kind === 'sabotage' ? 'пытался вывести из строя оборудование' : 'вёл наблюдение за ангаром и делал записи';
      sim.ci.addEvidence(n.id, 'surveillance', `Наружное наблюдение: ночью в зоне «${ZONES[n.zone].name}» ${what}`, 'Контрразведка', 6.5);
      if (ci) sim.ci.detain(n, ci, [`взят с поличным: ${what}`], 'Наружное наблюдение', true);
      sim.alert.raise(1, 'Контрразведка задержала подозреваемого.');
      a.act = null;
      a.nextActAt = sim.now + 600;
      return;
    }
    if (watchers.length) {
      a.nextActAt = sim.now + sim.rng.range(25, 60);
      sim.npcs.failPlan(n, 30);
      return;
    }
    if (a.act.kind === 'sabotage' || a.act.kind === 'steal') n.flags.tampering = true;
    if (a.act.kind === 'transmit') n.flags.transmitting = true;
  }

  private abort(n: NpcState): void {
    delete n.flags.tampering;
    delete n.flags.transmitting;
  }

  private perform(n: NpcState): void {
    const sim = this.sim;
    const a = this.agent(n.id);
    this.abort(n);
    if (!a || !a.act) return;
    const act = a.act;
    a.acts.push({ t: sim.now, kind: act.kind, zone: n.zone });
    if (a.acts.length > 12) a.acts.shift();
    a.count++;
    const e = sim.enemy.state;
    switch (act.kind) {
      case 'sabotage':
        sim.sabotage.plant(act.target as any, n);
        break;
      case 'transmit':
        e.intel = Math.min(100, e.intel + 7 + this.state.stolen * 2);
        this.state.lastTransmit = sim.now;
        this.state.transmitReported = false;
        break;
      case 'steal':
        this.state.stolen++;
        e.intel = Math.min(100, e.intel + 4);
        sim.ci.addClue('archive', 'Папки с документацией стоят не на своих местах; на одной — свежий отпечаток пальца в графите.', 'role', 'archive');
        sim.sabotage.leaveTraces('archive', n);
        sim.events.schedule('archive_disturbed', sim.now + 300 + sim.rng.range(0, 200));
        break;
      case 'observe':
        e.intel = Math.min(100, e.intel + 2);
        break;
    }
    a.act = null;
    const phase = e.phase;
    a.nextActAt = sim.now + sim.rng.range(560, 980) / (1 + phase * 0.25);
  }

  /** Радисты засекли чужую передачу из района объекта. */
  reportTransmission(): void {
    const sim = this.sim;
    this.state.transmitReported = true;
    const p = sim.layout.points[this.state.txPoint];
    const sector = p.x > 100 ? 'юго-восточная часть объекта' : p.z > 60 ? 'западная часть двора' : 'северная часть бункера';
    sim.radio.send('Радиостанция (служба перехвата)', 'Неизвестная передача', `Ночью засечена работа неизвестного коротковолнового передатчика в расположении объекта. Пеленг грубый: ${sector}. Передача шифрованная, длилась около трёх минут.`, 'urgent', 'transmit');
    sim.ci.addClue('transmit', `Передатчик работал из района: ${sector}.`, 'time', this.state.lastTransmit);
    sim.missions.flag('transmission_reported', true);
  }

  save(): unknown {
    return this.state;
  }

  load(d: any): void {
    this.state = d;
  }
}
