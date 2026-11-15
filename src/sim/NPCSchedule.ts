/**
 * NPCSchedule — распорядок дня и повседневные занятия по должности.
 * Утро: подъём, построение, завтрак. День: служба. Вечер: смена, ужин, личное время.
 * Ночь: отбой дневной смены, служба ночной.
 */
import { dist } from '../core/math';
import type { AnimId, NpcState, Spot, Step } from '../core/types';
import type { GoalOption } from './NPCSystem';
import type { Sim } from './Sim';

export type Block = 'sleep' | 'formation' | 'meal' | 'duty' | 'free';

const NO_FORMATION = new Set(['cook', 'cook_helper', 'radio_op', 'electrician', 'medic']);

export class NPCSchedule {
  constructor(private sim: Sim) {
    sim.calls['meal.done'] = (n) => this.mealDone(n);
    sim.calls['formation.report'] = (n) => this.formationReport(n);
    sim.calls['carry.set'] = (n, a) => {
      n.carry = a;
    };
    sim.calls['carry.clear'] = (n) => {
      n.carry = null;
    };
  }

  /** Блок распорядка для человека в данную минуту суток. */
  block(n: NpcState, m = this.sim.time.minuteOfDay): Block {
    if (n.shift === 'night') {
      if (m >= 1050 && m < 1080) return 'meal';
      if (m >= 1080 || m < 372) return 'duty';
      if (m >= 372 && m < 410) return 'meal';
      if (m >= 410 && m < 540) return 'free';
      if (m >= 1035 && m < 1050) return 'free';
      return 'sleep';
    }
    if (n.shift === 'flex') {
      if (m >= 345 && m < 370) return 'formation';
      if ((m >= 370 && m < 405) || (m >= 750 && m < 790) || (m >= 1110 && m < 1150)) return 'meal';
      if (m >= 405 && m < 1260) return 'duty';
      if (m >= 1260 && m < 1320) return 'free';
      if (m >= 330 && m < 345) return 'free';
      return 'sleep';
    }
    const guard = n.unit === 'guard';
    if (m >= 345 && m < (guard ? 358 : 370)) return 'formation';
    if (guard && m >= 358 && m < 1085) {
      if ((m >= 380 && m < 400 && false) || (m >= 720 && m < 745)) return 'meal';
      return 'duty';
    }
    if ((m >= 370 && m < 405) || (m >= 720 && m < 760) || (m >= 1095 && m < 1140)) return 'meal';
    if (m >= 405 && m < 1085) return 'duty';
    if (m >= 1085 && m < 1095) return 'duty';
    if (m >= 1140 && m < 1290) return 'free';
    if (m >= 330 && m < 345) return 'free';
    return 'sleep';
  }

  /** На службе ли человек сейчас по распорядку. */
  onDuty(n: NpcState): boolean {
    return this.block(n) === 'duty';
  }

  private step(sp: Spot, anim: AnimId, dur: number, run = false): Step[] {
    return [
      { k: 'go', x: sp.x, z: sp.z, spot: sp.id, run },
      { k: 'do', anim, dur, spot: sp.id },
    ];
  }

  /** Пойти к свободной точке с тегом и выполнить там действие. */
  at(n: NpcState, tag: string, anim: AnimId, dur: number, random = false): Step[] {
    const sp = this.sim.npcs.freeSpot(tag, n, random);
    if (!sp) return [{ k: 'do', anim: 'idle', dur: 3 }];
    return this.step(sp, anim, dur);
  }

  private point(x: number, z: number, anim: AnimId, dur: number, yaw?: number): Step[] {
    return [
      { k: 'go', x, z, tol: 0.5 },
      { k: 'do', anim, dur, yaw },
    ];
  }

  option(n: NpcState): GoalOption | null {
    if (n.status !== 'active' || n.unit === 'external' || n.unit === 'enemy') return null;
    const sim = this.sim;
    const m = sim.time.minuteOfDay;
    const alert = sim.alert.level;
    let b = this.block(n, m);
    const rng = sim.rng;

    if (b === 'formation' && (alert >= 2 || NO_FORMATION.has(n.role))) b = NO_FORMATION.has(n.role) ? 'duty' : 'duty';
    if (b === 'meal' && n.hunger < 22) b = n.shift === 'night' && m > 372 && m < 410 ? 'free' : 'duty';
    // при тревоге свободные от службы остаются в казарме
    if (alert >= 2 && b === 'free') {
      const bed = sim.npcs.spot(n.bedSpot)!;
      return { key: 'standby', score: 45, task: 'По тревоге: находится в расположении', plan: () => this.point(bed.x, bed.z, 'idle', 12) };
    }

    if (b === 'sleep' || (n.fatigue > 94 && b !== 'formation' && !n.armed)) {
      const bed = sim.npcs.spot(n.bedSpot)!;
      const rouse = alert >= 2 && (n.armed || n.unit.startsWith('gun') || n.rank >= 8);
      if (!rouse) {
        return {
          key: 'sleep',
          score: 50 + Math.max(0, n.fatigue - 40) * 0.25,
          task: 'Отдыхает (сон)',
          plan: () => [
            { k: 'go', x: bed.x, z: bed.z },
            { k: 'do', anim: 'sleep', dur: 30, spot: bed.id },
          ],
        };
      }
      b = 'duty';
    }

    if (b === 'formation') {
      const spot = this.formationSpot(n);
      const end = n.unit === 'guard' ? 358 : 370;
      const adj = n.role === 'adjutant';
      return {
        key: 'formation',
        score: 62,
        task: 'Утреннее построение',
        plan: () => {
          const steps: Step[] = [{ k: 'go', x: spot.x, z: spot.z, tol: 0.35 }];
          if (adj && m < 360) {
            steps.push({ k: 'do', anim: 'attention', dur: Math.max(1, 360 - m), yaw: spot.yaw });
            steps.push({ k: 'call', fn: 'formation.report' });
            steps.push({ k: 'do', anim: 'attention', dur: 9, yaw: spot.yaw });
          } else {
            steps.push({ k: 'do', anim: 'attention', dur: Math.max(1, end - m), yaw: spot.yaw });
          }
          return steps;
        },
      };
    }

    if (b === 'meal') {
      if (n.role === 'cook' || n.role === 'cook_helper') {
        return { key: 'duty', score: 56, task: 'Раздаёт пищу', plan: () => this.at(n, n.role === 'cook' ? 'kitchen_serve' : 'kitchen_prep', n.role === 'cook' ? 'cook' : 'work', 12) };
      }
      return {
        key: 'meal',
        score: 58,
        task: 'Приём пищи',
        plan: () => {
          const seat = sim.npcs.freeSpot('mess', n, true);
          if (!seat) return [{ k: 'do', anim: 'idle', dur: 3 }];
          return [...this.step(seat, 'sit_eat', 14), { k: 'call', fn: 'meal.done' }, { k: 'do', anim: 'sit_talk', dur: rng.range(2, 7), spot: seat.id }];
        },
      };
    }

    if (b === 'duty') {
      const d = this.duty(n);
      return { key: 'duty', score: n.unit === 'guard' ? 40 : 54, task: d.task, plan: () => d.steps() };
    }

    // свободное время
    return { key: 'free', score: 30, task: 'Личное время', plan: () => this.leisure(n) };
  }

  private formationSpot(n: NpcState): { x: number; z: number; yaw: number } {
    const L = this.sim.layout;
    if (n.role === 'adjutant') return L.byTag('form_adj')[0];
    if (n.rank >= 8) {
      const officers = this.sim.npcs.list.filter((o) => o.rank >= 8 && o.role !== 'adjutant' && o.unit !== 'external');
      const spots = L.byTag('form_officers');
      return spots[Math.max(0, officers.indexOf(n)) % spots.length];
    }
    const troops = this.sim.npcs.list.filter((o) => o.rank < 8 && o.shift !== 'night' && !NO_FORMATION.has(o.role) && o.unit !== 'external' && o.unit !== 'enemy');
    const spots = L.byTag('form');
    return spots[Math.max(0, troops.indexOf(n)) % spots.length];
  }

  private formationReport(n: NpcState): void {
    const sim = this.sim;
    const mp = sim.resources.manpower();
    const inRanks = sim.npcs.list.filter((o) => o.goal === 'formation').length;
    const p = sim.player;
    const near = dist(n.x, n.z, p.x, p.z) < 16;
    if (near) {
      sim.npcs.gesture(n, 'salute', 2.2, 'player');
      sim.npcs.speak(n, `${sim.address(true)}! Личный состав объекта построен. По списку ${mp.total}, в строю ${inRanks}, остальные на постах и в наряде.`);
      sim.missions.flag('formation_seen', true);
    } else {
      sim.npcs.speak(n, 'Смирно! Слушай распорядок на сутки.', true);
    }
    const bc = sim.npcs.first('battery_cmd');
    if (bc) sim.npcs.remember(bc, 'event', 'Утреннее построение проведено', 0.5);
  }

  private mealDone(n: NpcState): void {
    const sim = this.sim;
    if (sim.resources.take('food', 1)) {
      n.hunger = 0;
      n.morale = Math.min(100, n.morale + 0.4);
    } else {
      n.hunger = Math.max(40, n.hunger - 20);
      n.morale = Math.max(0, n.morale - 4);
      sim.resources.state.hungryMeals++;
      sim.npcs.remember(n, 'incident', 'Остался без пайка — склад пуст', 2);
    }
  }

  /** Повседневная работа по должности: небольшой цикл действий на рабочих местах. */
  private duty(n: NpcState): { task: string; steps: () => Step[] } {
    const sim = this.sim;
    const rng = sim.rng;
    const pick = <T>(...a: T[]) => rng.pick(a);
    const A = (tag: string, anim: AnimId, dur: number, random = false) => this.at(n, tag, anim, dur, random);
    switch (n.role) {
      case 'adjutant':
        return { task: 'Работа в штабе', steps: () => pick(() => A('adjutant_desk', 'sit_write', rng.range(18, 30)), () => A('cc_map', 'inspect', rng.range(8, 14), true), () => A('radio_desk', 'sit_write', 8))() };
      case 'battery_cmd':
        return { task: 'Управление батареей', steps: () => pick(() => A('cc_fire', 'write', rng.range(14, 24)), () => A('bcp', 'binoculars', rng.range(10, 18)), () => this.gunVisit(n))() };
      case 'security_chief':
        return { task: 'Контроль охраны объекта', steps: () => pick(() => A('duty_desk', 'sit_write', rng.range(14, 22)), () => this.postRound(n), () => A('armory_rack', 'inspect', 6))() };
      case 'ci_officer':
        return { task: 'Работа с делами', steps: () => pick(() => A('ci_desk', 'sit_write', rng.range(20, 32)), () => A('archive_shelf', 'inspect', rng.range(8, 14), true), () => A('cc_map', 'inspect', 6, true))() };
      case 'quartermaster':
        return { task: 'Учёт запасов', steps: () => pick(() => A('qm_desk', 'sit_write', rng.range(16, 26)), () => A('food_shelf', 'write', 9), () => A('ammo_pick', 'write', 9, true), () => A('fuel_pump', 'write', 7))() };
      case 'engineer':
        return { task: 'Техническое руководство установкой', steps: () => pick(() => A('tech_desk', 'sit_write', rng.range(16, 26)), () => A('tech_draft', 'work', rng.range(12, 18), true), () => A('hangar_work', 'inspect', rng.range(10, 16), true), () => A('lab', 'inspect', 9, true))() };
      case 'doctor':
        return { task: 'Приём в медпункте', steps: () => pick(() => A('med_desk', 'sit_write', rng.range(20, 32)), () => A('med_cab', 'work', 7), () => A('med_treat', 'inspect', 6))() };
      case 'gun_cmd':
      case 'gunner':
      case 'loader':
      case 'assistant':
      case 'bearer':
        return { task: 'Обслуживание материальной части', steps: () => this.gunMaintenance(n) };
      case 'guard_sgt':
        return { task: 'Руководство караулом', steps: () => pick(() => A('armory_desk', 'sit_write', rng.range(14, 22)), () => this.postRound(n), () => A('armory_rack', 'inspect', 6))() };
      case 'patrol_leader':
      case 'guard':
        return { task: 'Караульная смена в резерве', steps: () => pick(() => A('guard_bench', 'sit', rng.range(10, 18), true), () => A('armory_rack', 'work', 6))() };
      case 'mech_chief':
      case 'mechanic':
        return { task: 'Работы в мастерской', steps: () => pick(() => A('ws_bench', 'work', rng.range(14, 22), true), () => A('ws_lathe', 'work', rng.range(10, 16)), () => A('rep', 'repair_low', rng.range(14, 22), true), () => A('ws_parts', 'inspect', 5), () => A('motor', 'repair_low', 12, true))() };
      case 'electrician':
        return {
          task: 'Дежурство у генератора',
          steps: () =>
            pick(
              () => A('gen_panel', 'inspect', rng.range(10, 16)),
              () => A('gen_engine', 'repair_low', rng.range(8, 14)),
              () => A('gen2', 'inspect', 6),
              () => [...A('fuel_pump', 'work', 4), { k: 'call', fn: 'carry.set', a: 'canister' } as Step, ...A('gen_fuel', 'work', 3), { k: 'call', fn: 'carry.clear' } as Step],
            )(),
        };
      case 'radio_op':
        return { task: 'Дежурство на радиостанции', steps: () => pick(() => A('radio_seat', 'sit_radio', rng.range(25, 40)), () => A('radio_seat', 'sit_radio', rng.range(20, 30)), () => A('radio_desk', 'sit_write', 8))() };
      case 'clerk':
        return { task: 'Канцелярская работа в архиве', steps: () => pick(() => A('archive_desk', 'sit_write', rng.range(20, 32)), () => A('archive_shelf', 'work', rng.range(8, 12), true))() };
      case 'medic':
        return { task: 'Дежурство в медпункте', steps: () => pick(() => A('med_cab', 'work', rng.range(8, 14)), () => A('med_treat', 'inspect', rng.range(8, 12)))() };
      case 'cook':
        return { task: 'Приготовление пищи', steps: () => pick(() => A('kitchen_stove', 'cook', rng.range(18, 28)), () => A('kitchen_prep', 'work', rng.range(10, 16)))() };
      case 'cook_helper':
        return {
          task: 'Работы по кухне',
          steps: () => pick(() => A('kitchen_prep', 'work', rng.range(12, 18)), () => A('food_shelf', 'work', 8), () => [...A('food_stack', 'pickup', 1.5), { k: 'call', fn: 'carry.set', a: 'box' } as Step, ...A('kitchen_prep', 'work', 4), { k: 'call', fn: 'carry.clear' } as Step])(),
        };
      case 'driver':
        return { task: 'Обслуживание автотранспорта', steps: () => pick(() => A('motor', 'repair_low', rng.range(12, 20), true), () => A('motor', 'inspect', 8, true), () => A('ws_parts', 'inspect', 5))() };
      case 'technician':
        return { task: 'Работа с документацией установки', steps: () => pick(() => A('tech_draft', 'work', rng.range(18, 28), true), () => A('tech_cabinet', 'inspect', 7), () => A('hangar_work', 'inspect', 9, true))() };
      default:
        return { task: 'Служебные обязанности', steps: () => [{ k: 'do', anim: 'idle', dur: 5 }] };
    }
  }

  /** Расчёт в свободное от стрельбы время обслуживает своё орудие. */
  private gunMaintenance(n: NpcState): Step[] {
    const sim = this.sim;
    const rng = sim.rng;
    const gunId = n.unit as 'gun1' | 'gun2' | 'gun3';
    const gun = sim.artillery.gun(gunId);
    if (!gun) return [{ k: 'do', anim: 'idle', dur: 5 }];
    if (gunId === 'gun1' && gun.deploy < 0.5) {
      return this.at(n, n.workSpot === 'hangar_stand' ? 'hangar_stand' : 'hangar_work', rng.pick<AnimId>(['repair_low', 'inspect', 'work']), rng.range(12, 22), true);
    }
    const slot = Math.max(0, gun.crew.indexOf(n.id));
    const pos = sim.crewAI.stationPos(gunId, slot);
    if (rng.chance(0.25)) {
      const site = sim.layout.guns[gunId];
      const niche = gun.atAlt && site.kind === 'howitzer' ? site.nicheAlt : site.niche;
      return this.point(niche.x, niche.z, 'inspect', rng.range(4, 8));
    }
    return this.point(pos.x, pos.z, rng.pick<AnimId>(['repair_low', 'inspect', 'work', 'crank']), rng.range(10, 20), pos.yaw);
  }

  private gunVisit(n: NpcState): Step[] {
    const sim = this.sim;
    const g = sim.artillery.gun(sim.rng.pick(['gun2', 'gun3'] as const));
    if (!g) return [{ k: 'do', anim: 'idle', dur: 4 }];
    void n;
    return this.point(g.x - 3.4, g.z - 3.6, 'inspect', sim.rng.range(6, 10));
  }

  /** Обход постов начальником охраны / караула. */
  private postRound(n: NpcState): Step[] {
    const sim = this.sim;
    const tags = sim.rng.shuffle(['post_portal', 'post_kpp', 'post_secret', 'post_ammo']).slice(0, 2);
    const steps: Step[] = [];
    for (const t of tags) {
      const sp = sim.layout.byTag(t)[0];
      if (!sp) continue;
      steps.push({ k: 'go', x: sp.x + 0.8, z: sp.z + 0.6, tol: 0.6 }, { k: 'do', anim: 'inspect', dur: sim.rng.range(3, 5) }, { k: 'call', fn: 'guard.inspectPost', a: sp.id });
    }
    void n;
    return steps;
  }

  private leisure(n: NpcState): Step[] {
    const sim = this.sim;
    const rng = sim.rng;
    const late = sim.time.minuteOfDay > 1230 || sim.time.minuteOfDay < 330;
    const bad = sim.weather.state.rain > 0.35 || sim.weather.state.snow > 0.3;
    const opts: (() => Step[])[] = [];
    if (n.rank >= 8) {
      opts.push(() => this.at(n, 'officer_table', 'sit_talk', rng.range(14, 24), true));
      opts.push(() => this.at(n, 'cc_map', 'inspect', 6, true));
    } else {
      opts.push(() => this.at(n, 'barracks_table', 'sit_talk', rng.range(14, 24), true));
      opts.push(() => this.at(n, 'mess', 'sit_talk', rng.range(10, 18), true));
    }
    if (!late && !bad) {
      if (n.traits.smokes) {
        opts.push(() => this.at(n, 'smoke', 'sit_talk', rng.range(8, 14), true));
        opts.push(() => this.at(n, 'smoke_stand', 'smoke', rng.range(6, 10), true));
        opts.push(() => this.at(n, 'smoke_stand', 'smoke', rng.range(6, 10), true));
      }
      opts.push(() => this.at(n, 'yard_idle', 'talk', rng.range(6, 10), true));
    }
    const bed = sim.npcs.spot(n.bedSpot)!;
    opts.push(() => this.point(bed.x, bed.z, 'idle', rng.range(6, 12)));
    return rng.pick(opts)();
  }
}
