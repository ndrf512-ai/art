/**
 * CombatSystem — обстрелы, ранения и потери, диверсионные группы.
 * Потери необратимы: погибшего специалиста заменяет менее опытный, подразделение
 * помнит утрату. Жестокость не изображается: раненые лежат, убитых уносят санитары.
 */
import { MAP_H, MAP_W, FACADE_Z } from '../core/constants';
import { clamp, dist, yawTo } from '../core/math';
import type { NpcState, Step } from '../core/types';
import { FIRST_NAMES, LAST_NAMES, UNIT_NAMES } from '../data/names';
import { fullName } from './DocumentSystem';
import { blankNpc } from './npc/roster';
import type { GoalOption } from './NPCSystem';
import type { Sim } from './Sim';

const POS_CENTER = { main: { x: 90.5, z: 84.5 }, alt: { x: 30.5, z: 103.5 }, rail: { x: 124.5, z: 84.5 } };
/** Орудийные дворики, обложенные мешками с песком. */
const PITS = [
  { x: 80.5, z: 84.5 },
  { x: 100.5, z: 84.5 },
  { x: 22.5, z: 102.5 },
  { x: 38.5, z: 104.5 },
];

export class CombatSystem {
  state = {
    impacts: [] as { at: number; x: number; z: number; size: number }[],
    shellingUntil: 0,
    intruders: [] as string[],
    infiltration: null as null | { since: number; objective: { x: number; z: number; name: string }; exit: string; spotted: boolean; charged: boolean },
    losses: [] as { id: string; name: string; t: number; cause: string }[],
    removeAt: {} as Record<string, number>,
    repelled: 0,
    playerSafe: 0,
    knockouts: 0,
  };

  constructor(private sim: Sim) {
    sim.calls['med.treat'] = (n, id) => this.treat(n, id);
    sim.calls['combat.charge'] = (n) => this.charge(n);
    sim.calls['combat.escape'] = (n) => this.escape(n);
    sim.npcs.hooks.push((n, o, d) => this.onSeen(n, o, d));
  }

  reset(): void {
    this.state = { impacts: [], shellingUntil: 0, intruders: [], infiltration: null, losses: [], removeAt: {}, repelled: 0, playerSafe: 0, knockouts: 0 };
  }

  get underFire(): boolean {
    return this.sim.now < this.state.shellingUntil || this.sim.alert.state.airRaid;
  }

  // ------------------------------------------------------------------ обстрел

  /** Огневой налёт противника по засечённой позиции. acc — точность 0..100. */
  shelling(key: 'main' | 'alt' | 'rail', rounds: number, acc: number): void {
    const sim = this.sim;
    const c = POS_CENTER[key];
    const sigma = 75 - acc * 0.62;
    for (let i = 0; i < rounds; i++) {
      this.state.impacts.push({ at: sim.now + 1.5 + i * sim.rng.range(0.5, 1.4), x: c.x + sim.rng.gauss(0, sigma), z: c.z + sim.rng.gauss(0, sigma), size: 1 });
    }
    this.state.shellingUntil = sim.now + 4 + rounds * 1.2;
    sim.bus.emit('enemy:shelling', { rounds });
    sim.notify('Артиллерийский обстрел! Всем в укрытие!', 'alarm');
    sim.alert.raise(2, 'Объект под артиллерийским огнём.');
    sim.missions.flag('shelled', true);
  }

  /** Бомбовый удар (воздушный налёт). */
  bombs(n: number, cx: number, cz: number): void {
    const sim = this.sim;
    for (let i = 0; i < n; i++) this.state.impacts.push({ at: sim.now + 0.6 + i * 0.25, x: cx + sim.rng.gauss(0, 22), z: cz + sim.rng.gauss(0, 22), size: 1.5 });
    this.state.shellingUntil = sim.now + 6;
  }

  private explode(x: number, z: number, size: number): void {
    const sim = this.sim;
    const inMap = x > 1 && x < MAP_W - 1 && z > FACADE_Z && z < MAP_H - 1;
    sim.bus.emit('world:explosion', { x, z, size, kind: size > 1.2 ? 'bomb' : 'shell' });
    if (!inMap) return; // снаряд ушёл в холм или в лес
    const rng = sim.rng;
    const R = 14 * size;
    for (const n of sim.npcs.list) {
      if (n.status !== 'active' && n.status !== 'wounded') continue;
      if (sim.grid.indoorAt(n.x, n.z)) continue;
      const d = dist(n.x, n.z, x, z);
      if (d > R) continue;
      // лёжа и в обвалованном орудийном дворике от осколков защищены куда лучше
      const inPit = PITS.some((p) => dist(n.x, n.z, p.x, p.z) < 5.4) && dist(x, z, n.x, n.z) > 2;
      const cover = (n.anim === 'cover' || n.anim === 'kneel_aim' ? 0.45 : 1) * (inPit ? 0.35 : 1);
      if (d < 3.5 * size) {
        if (rng.chance(0.5 * cover)) this.kill(n, 'погиб при обстреле');
        else if (rng.chance(0.8)) this.wound(n, rng.range(40, 70), 'тяжело ранен при обстреле');
      } else if (d < 8 * size) {
        if (rng.chance(0.3 * cover)) this.wound(n, rng.range(30, 58), 'ранен осколком');
      } else if (rng.chance(0.1 * cover)) this.wound(n, rng.range(15, 35), 'легко ранен осколком');
    }
    for (const g of sim.artillery.guns()) {
      const d = dist(g.x, g.z, x, z);
      if (g.id === 'gun1' && g.deploy < 0.5) continue;
      if (d < 5 * size) sim.repair.breakDown(g.id, 'damage');
      else if (d < 11 * size) sim.repair.wear(g.id, rng.range(8, 20));
    }
    for (const v of sim.supply.vehicles) {
      if (v.kind === 'truck' && v.state !== 'away' && dist(v.x, v.z, x, z) < 7 * size) sim.repair.breakDown(v.id as 'truck1', 'damage');
    }
    const fuel = sim.layout.byTag('fuel_pump')[0];
    if (dist(fuel.x, fuel.z, x, z) < 9 * size) {
      const loss = Math.round(sim.resources.get('fuel') * 0.4);
      sim.resources.add('fuel', -loss);
      sim.bus.emit('world:fire', { x: fuel.x, z: fuel.z - 2, on: true, id: 'fuelfire' });
      sim.sabotage.state.fires.push({ id: 'fuelfire', x: fuel.x, z: fuel.z - 2, until: sim.now + 40 });
      sim.notify(`Попадание в склад топлива: потеряно около ${loss} л.`, 'alarm');
    }
    const p = sim.player;
    if (!p.indoor) {
      const d = dist(p.x, p.z, x, z);
      const dmg = d < 4 * size ? 65 : d < 9 * size ? 30 : d < R ? 10 : 0;
      if (dmg) this.hurtPlayer(dmg);
    }
  }

  hurtPlayer(dmg: number): void {
    const sim = this.sim;
    const p = sim.player;
    p.health = Math.max(0, p.health - dmg);
    this.state.playerSafe = sim.clock + 8;
    sim.bus.emit('player:hurt', { amount: dmg });
    if (p.health > 0) return;
    // командира без сознания уносят в медпункт; на несколько часов объект остаётся на начальнике штаба
    this.state.knockouts = (this.state.knockouts ?? 0) + 1;
    if (this.state.knockouts >= 3) return sim.missions.end('wounded');
    const bed = sim.layout.byTag('med_bed')[0];
    p.x = bed.x;
    p.z = bed.z;
    p.zone = sim.grid.zoneAt(p.x, p.z);
    p.indoor = true;
    p.health = 45;
    sim.relations.event('casualty');
    sim.bus.emit('player:knockout', { hours: 5 });
    sim.radio.send('Медпункт', 'Командир ранен', `Командир получил ранение и без сознания доставлен в медпункт. Обязанности временно исполнял начальник штаба. ${this.state.knockouts === 2 ? 'Врач предупреждает: следующее ранение — эвакуация в тыл.' : ''}`, 'routine', 'knockout', undefined, false);
  }

  // ------------------------------------------------------------------ ранения и потери

  wound(n: NpcState, dmg: number, cause: string): void {
    const sim = this.sim;
    if (n.status === 'dead') return;
    n.health = Math.max(0, n.health - dmg);
    if (n.health <= 0) return this.kill(n, cause.replace('ранен', 'смертельно ранен'));
    if (n.hostile) {
      if (n.health < 45) n.flags.fleeing = true;
      return;
    }
    if (n.health < 62 && n.status === 'active') {
      n.flags.treated = false;
      n.carry = null;
      n.weaponOut = false;
      sim.npcs.setStatus(n, 'wounded');
      n.anim = 'lie';
      sim.bus.emit('npc:wounded', { id: n.id, cause });
      sim.notify(`${fullName(n)} ${cause}.`, 'warn');
      for (const o of sim.npcs.list) if (o.unit === n.unit && o !== n && o.status === 'active') sim.npcs.remember(o, 'incident', `${fullName(n)} ${cause}`, 1.5);
    }
  }

  kill(n: NpcState, cause: string, away = false): void {
    const sim = this.sim;
    if (n.status === 'dead') return;
    const wasHostile = n.hostile;
    sim.npcs.clearGoal(n);
    n.status = 'dead';
    n.health = 0;
    n.anim = 'lie';
    n.moving = false;
    n.carry = null;
    n.anchor = null;
    n.gesture = null;
    this.state.removeAt[n.id] = sim.now + (away ? 0 : 40);
    if (wasHostile) {
      sim.bus.emit('npc:status', { id: n.id });
      return;
    }
    this.state.losses.push({ id: n.id, name: `${fullName(n)}, ${n.position.toLowerCase()}`, t: sim.now, cause });
    sim.bus.emit('npc:died', { id: n.id, cause });
    sim.notify(`${fullName(n)} ${cause}.`, 'alarm');
    for (const o of sim.npcs.list) {
      if (o === n || o.status === 'dead' || o.unit === 'enemy') continue;
      const close = o.unit === n.unit;
      o.morale = clamp(o.morale - (close ? 9 : 2), 0, 100);
      if (close) sim.npcs.remember(o, 'loss', `Погиб ${fullName(n)}`, 3);
    }
    sim.radio.send('Штаб объекта', `Потери: ${fullName(n)}`, `${fullName(n)}, ${n.position.toLowerCase()} (${UNIT_NAMES[n.unit]}), ${cause}. Опыт: ${n.serviceYears} лет службы. Заменить его равноценно некем — обязанности примет менее опытный.`, 'urgent', 'loss', { id: n.id }, false);
  }

  private treat(medic: NpcState, id: string): void {
    const sim = this.sim;
    const w = sim.npcs.byId(id);
    if (!w || w.status !== 'wounded') return;
    const hasMed = sim.resources.take('medicine', 1);
    w.flags.treated = true;
    w.health = Math.min(100, w.health + (hasMed ? 8 : 2));
    if (!hasMed) sim.npcs.speak(medic, 'Перевязал чем было. Медикаментов нет.', true);
    sim.npcs.clearGoal(w);
    sim.npcs.remember(medic, 'event', `Оказал помощь: ${fullName(w)}`, 1);
  }

  /** Цели: раненые, санитары, укрытие, бой. */
  option(n: NpcState): GoalOption | null {
    const sim = this.sim;
    const s = this.state;
    if (n.hostile) return this.intruderOption(n);
    if (n.status === 'wounded') {
      if (!n.flags.treated) return { key: 'wounded:lie', score: 97, task: 'Ранен, ждёт помощи', plan: () => [{ k: 'do', anim: 'lie', dur: 10 }] };
      if (n.health >= 76) {
        sim.npcs.setStatus(n, 'active');
        return null;
      }
      const bed = sim.npcs.freeSpot('med_bed', n) ?? sim.layout.byTag('med_bed')[0];
      return { key: 'wounded:bed', score: 97, task: 'Ранен, на излечении в медпункте', plan: () => [{ k: 'go', x: bed.x, z: bed.z }, { k: 'do', anim: 'lie', dur: 40, spot: bed.id }] };
    }
    if (n.status !== 'active') return null;
    // санитар и врач идут к раненым
    if (n.role === 'medic' || n.role === 'doctor') {
      const w = sim.npcs.list.filter((o) => o.status === 'wounded' && !o.flags.treated && !o.hostile).sort((a, b) => dist(n.x, n.z, a.x, a.z) - dist(n.x, n.z, b.x, b.z))[0];
      if (w && (n.role === 'medic' || !sim.npcs.first('medic'))) {
        return {
          key: `treat:${w.id}`,
          score: 88,
          task: `Оказывает помощь: ${fullName(w)}`,
          plan: () => [
            { k: 'go', x: w.x, z: w.z, run: true, tol: 1.2 },
            { k: 'do', anim: 'repair_low', dur: 3 },
            { k: 'call', fn: 'med.treat', a: w.id },
          ],
        };
      }
    }
    // бой с проникшим противником
    if (s.intruders.length && s.infiltration?.spotted && (n.armed || n.rank >= 8)) {
      const target = this.nearestIntruder(n);
      if (target && (n.unit === 'guard' || n.rank >= 8 || dist(n.x, n.z, target.x, target.z) < 40)) {
        const d = dist(n.x, n.z, target.x, target.z);
        const see = d < 60 && sim.grid.los(n.x, n.z, target.x, target.z);
        return {
          key: `combat:${target.id}`,
          score: 90,
          task: 'Ведёт бой с диверсантами',
          plan: () => {
            if (see && d < 30) return [{ k: 'do', anim: n.traits.brave > 0.5 ? 'aim' : 'kneel_aim', dur: 1.2, yaw: yawTo(target.x - n.x, target.z - n.z) }];
            return [{ k: 'go', x: target.x, z: target.z, run: true, tol: 22 }, { k: 'do', anim: 'aim', dur: 0.6 }];
          },
        };
      }
    }
    // укрытие от обстрела и при налёте
    if (this.underFire && !sim.grid.indoorAt(n.x, n.z) && !n.goal.startsWith('crew:') && !n.goal.startsWith('treat')) {
      const pts = ['shelter1', 'shelter2', 'shelter3'].map((k) => sim.layout.points[k]);
      pts.sort((a, b) => dist(n.x, n.z, a.x, a.z) - dist(n.x, n.z, b.x, b.z));
      const p = pts[0];
      return {
        key: 'shelter',
        score: 80,
        task: 'В укрытии',
        plan: () => [
          { k: 'go', x: p.x + sim.rng.range(-0.8, 0.8), z: p.z + sim.rng.range(-3, 3), run: true, tol: 1.2 },
          { k: 'do', anim: 'cover', dur: 4 },
        ],
      };
    }
    if (this.underFire && sim.grid.indoorAt(n.x, n.z) && sim.schedule.block(n) !== 'sleep' && (n.zone === 'portal' || n.zone === 'tunnel_ammo')) {
      return { key: 'shelter', score: 80, task: 'В укрытии', plan: () => [{ k: 'do', anim: 'cover', dur: 3 }] };
    }
    return null;
  }

  // ------------------------------------------------------------------ диверсионная группа

  private nearestIntruder(n: NpcState): NpcState | null {
    let best: NpcState | null = null;
    let bd = Infinity;
    for (const id of this.state.intruders) {
      const o = this.sim.npcs.byId(id);
      if (!o || o.status === 'dead') continue;
      const d = dist(n.x, n.z, o.x, o.z);
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    return best;
  }

  /** Разведывательно-диверсионная группа проникает на объект. */
  infiltrate(_unitId: string): void {
    const sim = this.sim;
    if (this.state.infiltration) return;
    const rng = sim.rng;
    const L = sim.layout;
    const side = rng.pick(['e', 'w', 's'] as const);
    const out = L.points['out_' + side];
    const g1 = sim.artillery.gun('gun1');
    const objectives = [
      { ...L.byTag('post_ammo')[0], name: 'снарядный портал' },
      { x: 80.5, z: 79.5, name: 'орудие №2' },
      { x: 100.5, z: 79.5, name: 'орудие №3' },
      { x: 17.5, z: 67.5, name: 'склад топлива' },
    ];
    if (g1.deploy > 0.9) objectives.push({ x: 121.5, z: 80.5, name: 'установка «Конрад»' });
    const obj = rng.pick(objectives);
    this.state.infiltration = { since: sim.now, objective: { x: obj.x, z: obj.z, name: obj.name }, exit: 'out_' + side, spotted: false, charged: false };
    this.state.intruders = [];
    const count = 3 + (sim.enemy.state.phase >= 2 ? 1 : 0);
    for (let i = 0; i < count; i++) {
      const n = blankNpc(sim.npcs.nextId('x'));
      n.first = rng.pick(FIRST_NAMES);
      n.last = rng.pick(LAST_NAMES);
      n.role = 'intruder';
      n.unit = 'enemy';
      n.position = 'Диверсант';
      n.hostile = true;
      n.armed = true;
      n.skill = rng.range(55, 80);
      n.x = out.x + rng.range(-1.5, 1.5);
      n.z = out.z + rng.range(-1.5, 1.5);
      n.zone = sim.grid.zoneAt(n.x, n.z);
      n.flags.leader = i === 0;
      sim.npcs.add(n);
      this.state.intruders.push(n.id);
    }
    // в ограждении проделан проход
    const br = L.points['breach_' + side];
    sim.grid.setBlockedRect(Math.floor(br.x) - 2, Math.floor(br.z) - 2, Math.floor(br.x) + 2, Math.floor(br.z) + 2, false);
  }

  private intruderOption(n: NpcState): GoalOption | null {
    const sim = this.sim;
    const inf = this.state.infiltration;
    if (!inf || n.status === 'dead') return null;
    const P = sim.layout.points;
    const exit = P[inf.exit];
    if (n.flags.fleeing || inf.charged || sim.now - inf.since > 150) {
      return { key: 'intr:flee', score: 95, task: 'Отход', plan: () => [{ k: 'go', x: exit.x, z: exit.z, run: true, tol: 2 }, { k: 'call', fn: 'combat.escape' }] };
    }
    // под огнём — отвечают
    if (inf.spotted) {
      const foe = sim.npcs.list.filter((o) => !o.hostile && o.status === 'active' && o.armed && dist(o.x, o.z, n.x, n.z) < 32 && sim.grid.los(n.x, n.z, o.x, o.z)).sort((a, b) => dist(n.x, n.z, a.x, a.z) - dist(n.x, n.z, b.x, b.z))[0];
      if (foe && !n.flags.leader) {
        return { key: `intr:fight:${foe.id}`, score: 92, task: 'Бой', plan: () => [{ k: 'do', anim: 'kneel_aim', dur: 1.3, yaw: yawTo(foe.x - n.x, foe.z - n.z) }] };
      }
    }
    const o = inf.objective;
    const lead = n.flags.leader;
    return {
      key: 'intr:advance',
      score: 85,
      task: 'Скрытное выдвижение',
      plan: () => {
        const steps: Step[] = [{ k: 'go', x: o.x + (lead ? 0 : sim.rng.range(-4, 4)), z: o.z + (lead ? 0 : sim.rng.range(2, 6)), tol: 1.6, run: inf.spotted }];
        if (lead) steps.push({ k: 'do', anim: 'repair_low', dur: 3 }, { k: 'call', fn: 'combat.charge' });
        else steps.push({ k: 'do', anim: 'kneel_aim', dur: 4 });
        return steps;
      },
    };
  }

  /** Подрывной заряд установлен. */
  private charge(n: NpcState): void {
    const sim = this.sim;
    const inf = this.state.infiltration;
    if (!inf || inf.charged) return;
    inf.charged = true;
    this.state.impacts.push({ at: sim.now + 2.5, x: n.x, z: n.z, size: 1.3 });
    this.spot(n, null);
  }

  private escape(n: NpcState): void {
    const sim = this.sim;
    this.state.intruders = this.state.intruders.filter((id) => id !== n.id);
    sim.enemy.state.intel = Math.min(100, sim.enemy.state.intel + 6);
    sim.npcs.remove(n.id);
    this.checkInfiltrationEnd(false);
  }

  /** Диверсанты обнаружены: подтверждённая угроза → красная тревога. */
  private spot(intruder: NpcState, by: NpcState | null): void {
    const sim = this.sim;
    const inf = this.state.infiltration;
    if (!inf || inf.spotted) return;
    inf.spotted = true;
    sim.alert.raise(3, 'Проникновение на объект! Диверсионная группа противника.');
    if (by) {
      sim.npcs.speak(by, 'Стой! Тревога! Противник на объекте!');
      sim.guard.log(`${fullName(by)}: обнаружены вооружённые неизвестные — ${sim.zones.name(intruder.zone)}.`);
    }
    sim.radio.send(by ? fullName(by) : 'Дежурный по объекту', 'Нападение на объект', `Диверсионная группа противника на территории: ${sim.zones.name(intruder.zone).toLowerCase()}. Караул поднят в ружьё.`, 'urgent', 'attack', undefined, false);
    sim.missions.flag('infiltration', true);
  }

  private onSeen(n: NpcState, o: NpcState, d: number): void {
    if (!o.hostile || n.hostile || o.status === 'dead') return;
    if (n.status !== 'active') return;
    if (d < 26) this.spot(o, n);
  }

  private checkInfiltrationEnd(killed: boolean): void {
    const sim = this.sim;
    const inf = this.state.infiltration;
    if (!inf) return;
    const alive = this.state.intruders.filter((id) => sim.npcs.byId(id)?.status !== 'dead' && sim.npcs.byId(id));
    if (alive.length) return;
    this.state.infiltration = null;
    this.state.intruders = [];
    if (killed) {
      this.state.repelled++;
      sim.relations.event('repelled');
      sim.enemy.state.intel = Math.max(0, sim.enemy.state.intel - 5);
    }
    sim.radio.send('Начальник охраны', killed ? 'Диверсионная группа уничтожена' : 'Диверсанты ушли', killed ? `Нападение отбито. Цель группы — ${inf.objective.name}. Прошу разрешения снизить уровень тревоги после прочёсывания.` : `Группа противника отошла за периметр${inf.charged ? ', заряд сработал' : ''}. Цель — ${inf.objective.name}. Противник теперь знает о нас больше.`, 'urgent', 'attack_end', undefined, false);
    sim.missions.flag('infiltration_over', true);
  }

  // ------------------------------------------------------------------ цикл

  update(dt: number, gdt: number): void {
    const sim = this.sim;
    const s = this.state;
    const now = sim.now;
    for (let i = s.impacts.length - 1; i >= 0; i--) {
      if (now >= s.impacts[i].at) {
        const p = s.impacts.splice(i, 1)[0];
        this.explode(p.x, p.z, p.size);
      }
    }
    // перестрелка
    if (s.intruders.length && s.infiltration?.spotted) {
      for (const n of sim.npcs.list) {
        if (n.status !== 'active') continue;
        const fighting = n.goal.startsWith('combat:') || n.goal.startsWith('intr:fight');
        n.weaponOut = fighting || (n.hostile && n.status === 'active');
        if (!fighting || n.moving) continue;
        const next = Number(n.flags.nextShot ?? 0);
        if (sim.clock < next) continue;
        n.flags.nextShot = sim.clock + sim.rng.range(1.4, 2.8);
        const targetId = n.goal.split(':').pop()!;
        const t = sim.npcs.byId(targetId);
        if (!t || t.status === 'dead' || !sim.grid.los(n.x, n.z, t.x, t.z)) continue;
        const d = dist(n.x, n.z, t.x, t.z);
        if (d > 45) continue;
        sim.bus.emit('world:gunshot', { x: n.x, z: n.z, tx: t.x, tz: t.z });
        const dark = sim.time.darkness() * (sim.resources.state.power > 0 ? 0.5 : 0.8);
        const p = clamp((0.34 * n.skill) / 60 - d * 0.006 - dark * 0.12, 0.03, 0.5) * (t.anim === 'kneel_aim' ? 0.7 : 1);
        if (sim.rng.chance(p)) {
          this.wound(t, sim.rng.range(32, 78), 'ранен в перестрелке');
          if ((t.status as string) === 'dead' && t.hostile) this.checkInfiltrationEnd(true);
        }
      }
      // диверсанты могут зацепить и командира
      const p = sim.player;
      for (const id of s.intruders) {
        const n = sim.npcs.byId(id);
        if (!n || n.status !== 'active' || n.moving) continue;
        const d = dist(n.x, n.z, p.x, p.z);
        if (d < 22 && sim.grid.los(n.x, n.z, p.x, p.z) && sim.rng.chance(0.06 * dt)) {
          sim.bus.emit('world:gunshot', { x: n.x, z: n.z, tx: p.x, tz: p.z });
          if (sim.rng.chance(0.25)) this.hurtPlayer(sim.rng.range(15, 30));
        }
      }
    } else {
      for (const n of sim.npcs.list) if (n.weaponOut && !n.hostile) n.weaponOut = false;
    }
    // убитых уносят
    for (const [id, at] of Object.entries(s.removeAt)) {
      if (now < at) continue;
      delete s.removeAt[id];
      const n = sim.npcs.byId(id);
      if (!n) continue;
      if (n.hostile) {
        s.intruders = s.intruders.filter((x) => x !== id);
        sim.npcs.remove(id);
        this.checkInfiltrationEnd(true);
      } else {
        n.status = 'dead';
        n.flags.buried = true;
        sim.bus.emit('npc:status', { id });
      }
    }
    // командир понемногу восстанавливается в безопасности
    const pl = sim.player;
    if (pl.health > 0 && pl.health < 100 && sim.clock > s.playerSafe) pl.health = Math.min(100, pl.health + gdt * 0.8);
  }

  save(): unknown {
    return this.state;
  }

  load(d: any): void {
    this.state = d;
  }
}
