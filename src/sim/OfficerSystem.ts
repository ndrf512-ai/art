/**
 * OfficerSystem — иерархия: командир → старшие офицеры → командиры групп →
 * сержанты → солдаты. Следит за вакансиями: при гибели командира группы его
 * временно замещает старший по званию, пока командир не назначит замену.
 */
import type { NpcState, RoleId, UnitId } from '../core/types';
import { UNIT_NAMES } from '../data/names';
import { fullName } from './DocumentSystem';
import type { Sim } from './Sim';

const LEADER_ROLE: Partial<Record<UnitId, RoleId>> = {
  staff: 'adjutant',
  gun1: 'gun_cmd',
  gun2: 'gun_cmd',
  gun3: 'gun_cmd',
  guard: 'guard_sgt',
  tech: 'mech_chief',
  supply: 'quartermaster',
  medical: 'doctor',
  secret: 'engineer',
};

/** Кому подчинено подразделение. */
const SUPERIOR: Partial<Record<UnitId, RoleId>> = {
  gun1: 'battery_cmd',
  gun2: 'battery_cmd',
  gun3: 'battery_cmd',
  guard: 'security_chief',
  tech: 'engineer',
  signals: 'adjutant',
  supply: 'quartermaster',
  medical: 'doctor',
  secret: 'engineer',
};

export class OfficerSystem {
  state = { leader: {} as Partial<Record<UnitId, string>>, vacant: {} as Partial<Record<UnitId, { since: number; acting: string | null }>> };

  constructor(private sim: Sim) {
    sim.bus.on('npc:died', ({ id }) => this.onLoss(id, 'погиб'));
    sim.bus.on('npc:status', ({ id }) => {
      const n = sim.npcs.byId(id);
      if (n && n.status === 'arrested' && sim.ci.case(id)?.status === 'handed') this.onLoss(id, 'арестован');
    });
  }

  reset(): void {
    this.state = { leader: {}, vacant: {} };
  }

  init(): void {
    for (const [unit, role] of Object.entries(LEADER_ROLE) as [UnitId, RoleId][]) {
      const n = this.sim.npcs.list.find((x) => x.unit === unit && x.role === role);
      if (n) this.state.leader[unit] = n.id;
    }
  }

  leader(unit: UnitId): NpcState | null {
    const id = this.state.leader[unit];
    const n = id ? this.sim.npcs.byId(id) : undefined;
    return n && n.status === 'active' ? n : null;
  }

  /** Командир подразделения либо исполняющий обязанности. */
  inCharge(unit: UnitId): NpcState | null {
    const l = this.leader(unit);
    if (l) return l;
    const v = this.state.vacant[unit];
    const a = v?.acting ? this.sim.npcs.byId(v.acting) : undefined;
    if (a && a.status === 'active') return a;
    return this.senior(unit);
  }

  superior(unit: UnitId): NpcState | null {
    const role = SUPERIOR[unit];
    return role ? (this.sim.npcs.first(role) ?? null) : null;
  }

  isLeader(n: NpcState): boolean {
    return this.state.leader[n.unit] === n.id;
  }

  vacancy(unit: UnitId): boolean {
    return !!this.state.vacant[unit];
  }

  private senior(unit: UnitId): NpcState | null {
    const pool = this.sim.npcs.list.filter((n) => n.unit === unit && n.status === 'active');
    pool.sort((a, b) => b.rank - a.rank || b.skill - a.skill);
    return pool[0] ?? null;
  }

  /** Слаженность подразделения: без утверждённого командира работает хуже. */
  efficiency(unit: UnitId): number {
    return this.state.vacant[unit] ? 0.8 : 1;
  }

  private onLoss(id: string, what: string): void {
    const sim = this.sim;
    const n = sim.npcs.byId(id);
    if (!n) return;
    // убитый номер расчёта освобождает пост — остальные смыкаются
    if (n.unit === 'gun1' || n.unit === 'gun2' || n.unit === 'gun3') {
      const g = sim.artillery.gun(n.unit);
      const i = g.crew.indexOf(id);
      if (i === 0) g.crew[0] = '';
      else if (i > 0) g.crew.splice(i, 1);
    }
    const unit = (Object.keys(this.state.leader) as UnitId[]).find((u) => this.state.leader[u] === id);
    if (!unit || this.state.vacant[unit]) return;
    delete this.state.leader[unit];
    const acting = this.senior(unit);
    this.state.vacant[unit] = { since: sim.now, acting: acting?.id ?? null };
    const sup = this.superior(unit);
    sim.radio.send(
      sup ? fullName(sup) : 'Штаб объекта',
      `${UNIT_NAMES[unit]}: нужен командир`,
      `${fullName(n)} ${what}. ${acting ? `Обязанности временно исполняет ${fullName(acting)}, но подразделение работает хуже.` : 'Заменить его некем.'} Прошу назначить командира лично.`,
      'urgent',
      'vacancy',
      { unit },
      false,
    );
    sim.missions.flag('vacancy_' + unit, true);
  }

  /** Назначить человека командиром подразделения. */
  appoint(unit: UnitId, n: NpcState): string | null {
    const sim = this.sim;
    const role = LEADER_ROLE[unit];
    if (!role) return 'У этого подразделения нет штатного командира.';
    if (n.status !== 'active') return 'Он не в строю.';
    if (n.unit !== unit) {
      const err = sim.relations.transfer(n, unit);
      if (err && n.unit !== unit) return err;
    }
    this.state.leader[unit] = n.id;
    delete this.state.vacant[unit];
    n.role = role;
    n.position = unit.startsWith('gun') ? `Командир: ${sim.artillery.gunName(unit as 'gun1')}` : `Командир: ${UNIT_NAMES[unit]}`;
    if (unit === 'gun1' || unit === 'gun2' || unit === 'gun3') {
      const g = sim.artillery.gun(unit);
      g.crew = g.crew.filter((c) => c !== n.id && c !== '');
      g.crew.unshift(n.id);
    }
    sim.docs.issue(n);
    sim.access.invalidate();
    n.attitude = Math.min(100, n.attitude + 8);
    sim.npcs.remember(n, 'praise', `Назначен командиром: ${UNIT_NAMES[unit]}`, 3);
    sim.npcs.clearGoal(n);
    sim.relations.unitMood(unit, n.skill > 50 ? 2 : -1, 'Назначен новый командир');
    return null;
  }

  vacancies(): UnitId[] {
    return Object.keys(this.state.vacant) as UnitId[];
  }

  save(): unknown {
    return this.state;
  }

  load(d: any): void {
    this.state = d;
  }
}
