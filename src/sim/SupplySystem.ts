/**
 * SupplySystem — снабжение: заявки, колонны грузовиков, разгрузка и переноска
 * грузов людьми (в том числе подноска снарядов к орудиям).
 */
import { dist, yawTo } from '../core/math';
import type { GunId, HaulJob, NpcState, RoleId, ShellId, SupplyItem, SupplyRequest, Vehicle } from '../core/types';
import { SHELLS } from './BallisticsSystem';
import { fullName } from './DocumentSystem';
import type { GoalOption } from './NPCSystem';
import { ITEM_NAMES } from './ResourceSystem';
import type { Sim } from './Sim';

/** Масса единицы груза, кг. */
export const ITEM_WEIGHT: Record<SupplyItem, number> = { he21: 150, cp21: 160, smoke21: 140, he38: 900, sp38: 950, fuel: 0.85, food: 1.6, medicine: 2, parts: 22 };
/** Сколько штаб готов выделить за один рейс. */
export const ITEM_LIMIT: Record<SupplyItem, number> = { he21: 60, cp21: 16, smoke21: 16, he38: 6, sp38: 1, fuel: 2500, food: 600, medicine: 40, parts: 30 };
const CHUNK: Record<SupplyItem, number> = { he21: 6, cp21: 4, smoke21: 4, he38: 2, sp38: 1, fuel: 300, food: 120, medicine: 10, parts: 6 };
export const TRUCK_CAPACITY = 3000;

const SUPPLY_ROLES: RoleId[] = ['driver', 'bearer', 'assistant', 'cook_helper', 'mechanic', 'loader'];

export class SupplySystem {
  state = { requests: [] as SupplyRequest[], jobs: [] as HaulJob[], vehicles: [] as Vehicle[], seq: 0, shortage: 1 };

  constructor(private sim: Sim) {
    sim.calls['haul.pick'] = (n, id) => this.pick(n, id);
    sim.calls['haul.drop'] = (n, id) => this.drop(n, id);
    sim.calls['haul.release'] = (n, id) => this.release(n, id);
    sim.calls['drive.board'] = (n, id) => this.board(n, id);
  }

  reset(): void {
    const P = this.sim.layout.points;
    const mk = (id: string, kind: Vehicle['kind'], p: { x: number; z: number }): Vehicle => ({ id, kind, x: p.x, z: p.z, yaw: 0, path: [], pathI: 0, state: 'parked', speed: 0, home: { ...p }, homeYaw: 0, onArrive: '' });
    this.state = { requests: [], jobs: [], vehicles: [mk('truck1', 'truck', P.truck1), mk('truck2', 'truck', P.truck2), mk('car', 'car', P.car)], seq: 0, shortage: 1 };
    for (const v of this.state.vehicles) this.blockVehicle(v, true);
  }

  vehicle(id: string): Vehicle | undefined {
    return this.state.vehicles.find((v) => v.id === id);
  }

  get vehicles(): Vehicle[] {
    return this.state.vehicles;
  }

  private blockVehicle(v: Vehicle, on: boolean): void {
    const hw = v.kind === 'truck' ? 1 : 1;
    const hl = v.kind === 'truck' ? 3 : 2;
    const alongZ = Math.abs(Math.cos(v.yaw)) > 0.5;
    const x0 = Math.floor(v.x - (alongZ ? hw : hl));
    const x1 = Math.floor(v.x + (alongZ ? hw : hl) - 0.01);
    const z0 = Math.floor(v.z - (alongZ ? hl : hw));
    const z1 = Math.floor(v.z + (alongZ ? hl : hw) - 0.01);
    this.sim.grid.setBlockedRect(x0, z0, x1, z1, on);
  }

  // ------------------------------------------------------------------ заявки

  activeRequest(): SupplyRequest | null {
    return this.state.requests.find((r) => r.status === 'requested' || r.status === 'enroute' || r.status === 'unloading') ?? null;
  }

  limit(item: SupplyItem): number {
    let l = ITEM_LIMIT[item] * this.state.shortage;
    if (item === 'sp38') l = this.sim.time.day >= 3 ? 1 : 0;
    return Math.floor(l);
  }

  weight(items: Partial<Record<SupplyItem, number>>): number {
    let w = 0;
    for (const [k, n] of Object.entries(items)) w += ITEM_WEIGHT[k as SupplyItem] * (n ?? 0);
    return w;
  }

  /** Исправные грузовики на стоянке с водителями в строю. */
  availableTrucks(): Vehicle[] {
    const drivers = this.sim.npcs.list.filter((n) => n.role === 'driver' && n.status === 'active');
    return this.state.vehicles.filter((v) => v.kind === 'truck' && v.state === 'parked' && !this.sim.repair.get(v.id as 'truck1').broken).slice(0, drivers.length);
  }

  /** Оценка опасности рейса словами (точных цифр командир не знает). */
  riskText(escort: boolean, night: boolean): string {
    const r = this.risk(escort, night);
    return r < 0.08 ? 'дорога считается спокойной' : r < 0.18 ? 'на дороге возможны налёты авиации' : r < 0.3 ? 'дорога под наблюдением противника' : 'рейс крайне опасен';
  }

  private risk(escort: boolean, night: boolean): number {
    const sim = this.sim;
    let r = 0.04 + sim.enemy.state.pressure * 0.22 + sim.enemy.state.intel / 450;
    if (sim.weather.state.kind === 'clear' && !night) r += 0.07;
    if (sim.weather.state.fog > 0.4 || sim.weather.state.rain > 0.4) r -= 0.04;
    if (escort) r -= 0.07;
    if (night) r -= 0.06;
    return Math.max(0.01, r);
  }

  /** Отправить заявку и колонну. Возвращает текст отказа либо null. */
  request(items: Partial<Record<SupplyItem, number>>, escort: boolean, night: boolean): string | null {
    const sim = this.sim;
    if (this.activeRequest()) return 'Предыдущая колонна ещё не вернулась.';
    if (!sim.resources.state.radio && !sim.resources.state.wire) return 'Связи со штабом нет — заявку передать невозможно.';
    const trucks = this.availableTrucks();
    if (!trucks.length) return 'Нет исправных грузовиков или водителей.';
    const clean: Partial<Record<SupplyItem, number>> = {};
    for (const [k, n] of Object.entries(items)) {
      const v = Math.min(Math.floor(n ?? 0), this.limit(k as SupplyItem));
      if (v > 0) clean[k as SupplyItem] = v;
    }
    const w = this.weight(clean);
    if (w <= 0) return 'Заявка пуста.';
    if (w > trucks.length * TRUCK_CAPACITY) return `Груз (${Math.round(w)} кг) превышает грузоподъёмность колонны (${trucks.length * TRUCK_CAPACITY} кг).`;
    const drivers = sim.npcs.list.filter((n) => n.role === 'driver' && n.status === 'active').slice(0, trucks.length);
    let escorts: NpcState[] = [];
    if (escort) {
      escorts = sim.guard.reserve().slice(0, 2);
      if (escorts.length < 2) return 'Нет свободных караульных для охраны колонны.';
    }
    const need = Math.ceil(w / TRUCK_CAPACITY);
    const used = trucks.slice(0, Math.max(1, need));
    const req: SupplyRequest = {
      id: 's' + ++this.state.seq,
      t: sim.now,
      items: clean,
      escort,
      night,
      eta: sim.now + sim.rng.range(300, 420) + (night ? 150 : 0),
      status: 'requested',
      trucks: used.map((t) => t.id),
      drivers: drivers.slice(0, used.length).map((d) => d.id),
      escorts: escorts.map((e) => e.id),
      note: '',
    };
    this.state.requests.push(req);
    sim.resources.take('fuel', 60 * used.length);
    for (const e of escorts) {
      e.flags.convoy = req.id;
      sim.npcs.setStatus(e, 'away');
    }
    sim.bus.emit('supply:update', { request: req });
    sim.notify('Заявка на снабжение принята штабом. Колонна выходит.', 'info');
    return null;
  }

  /** Водители идут к машинам и выезжают. */
  driverOption(n: NpcState): GoalOption | null {
    if (n.role !== 'driver' || n.status !== 'active') return null;
    const req = this.state.requests.find((r) => r.status === 'requested' && r.drivers.includes(n.id));
    if (!req) return null;
    const truck = this.vehicle(req.trucks[req.drivers.indexOf(n.id)]);
    if (!truck || truck.state !== 'parked') return null;
    return {
      key: `drive:${req.id}`,
      score: 75,
      task: 'Выезд колонны снабжения',
      plan: () => [
        { k: 'go', x: truck.x + 1.7, z: truck.z - 1.5, run: true, tol: 1.2 },
        { k: 'call', fn: 'drive.board', a: truck.id },
      ],
    };
  }

  private board(n: NpcState, truckId: string): void {
    const sim = this.sim;
    const v = this.vehicle(truckId);
    if (!v) return;
    n.flags.truck = truckId;
    sim.npcs.setStatus(n, 'away');
    this.blockVehicle(v, false);
    const P = sim.layout.points;
    this.drive(v, [v.x, 78, 50, 84, P.gate_in.x, 100, P.gate_in.x, P.gate_out.z, P.road_far.x, P.road_far.z + 4], 'depart');
    const req = this.state.requests.find((r) => r.trucks.includes(truckId) && r.status === 'requested');
    if (req && req.trucks.every((t) => this.vehicle(t)?.state !== 'parked')) req.status = 'enroute';
  }

  drive(v: Vehicle, path: number[], onArrive: string): void {
    v.path = path;
    v.pathI = 0;
    v.state = 'driving';
    v.onArrive = onArrive;
  }

  /** Создаёт работы по разгрузке прибывшей машины. */
  private unloadJobs(req: SupplyRequest, items: Partial<Record<SupplyItem, number>>): void {
    const L = this.sim.layout;
    const from = L.points.unload;
    for (const [k, total] of Object.entries(items)) {
      const item = k as SupplyItem;
      let left = total ?? 0;
      const is38 = item === 'he38' || item === 'sp38';
      const isShell = item in SHELLS;
      const tag = is38 ? 'ammo2_pick' : isShell ? 'ammo_pick' : item === 'fuel' ? 'fuel_stack' : item === 'food' ? 'food_stack' : item === 'medicine' ? 'med_cab' : 'ws_parts';
      const to = L.byTag(tag)[0];
      while (left > 0) {
        const amount = Math.min(left, CHUNK[item]);
        left -= amount;
        this.state.jobs.push({
          id: 'h' + ++this.state.seq,
          from: { x: from.x + this.sim.rng.range(-1.5, 1.5), z: from.z + this.sim.rng.range(-0.5, 2.5) },
          to: { x: to.x, z: to.z },
          item,
          amount,
          carry: isShell ? 'shell' : item === 'fuel' ? 'canister' : 'crate',
          state: 'open',
          carrier: null,
          roles: SUPPLY_ROLES,
          gun: is38 ? 'gun1' : undefined,
          requestId: req.id,
          priority: 1,
        });
      }
    }
  }

  // ------------------------------------------------------------------ подноска к орудиям

  hasNicheJob(gun: GunId): boolean {
    return this.state.jobs.some((j) => j.item === 'niche' && j.gun === gun && j.state !== 'done');
  }

  /** Подносчики пополняют запас снарядов у орудия со склада. */
  requestNiche(gun: GunId, shell: ShellId): void {
    const sim = this.sim;
    if (this.hasNicheJob(gun) || sim.resources.ammo(shell) <= 0) return;
    const site = sim.layout.guns[gun];
    const g = sim.artillery.gun(gun);
    const niche = g.atAlt && site.kind === 'howitzer' ? site.nicheAlt : site.niche;
    const pick = sim.layout.byTag(site.kind === 'rail' ? 'ammo2_pick' : 'ammo_pick')[0];
    this.state.jobs.push({
      id: 'h' + ++this.state.seq,
      from: { x: pick.x, z: pick.z },
      to: { x: niche.x, z: niche.z },
      item: 'niche',
      amount: site.kind === 'rail' ? 1 : 2,
      carry: 'shell',
      state: 'open',
      carrier: null,
      roles: ['bearer', 'assistant', 'loader'],
      gun,
      priority: 3,
      requestId: shell,
    });
  }

  option(n: NpcState): GoalOption | null {
    if (n.status !== 'active') return null;
    const sim = this.sim;
    let best: HaulJob | null = null;
    let bs = -Infinity;
    for (const j of this.state.jobs) {
      if (j.state === 'done') continue;
      if (j.state === 'taken' && j.carrier !== n.id) continue;
      if (!j.roles.includes(n.role)) continue;
      if (j.gun && n.unit !== j.gun) continue;
      if (j.item === 'niche') {
        // подносят свободные номера; заряжающий — только если подносчика нет
        const g = sim.artillery.gun(j.gun!);
        const slot = g.crew.indexOf(n.id);
        const bearerFit = sim.npcs.byId(g.crew[g.crew.length - 1])?.status === 'active';
        if (slot !== g.crew.length - 1 && bearerFit) continue;
        if (slot <= 1) continue;
      } else {
        if (sim.schedule.block(n) !== 'duty') continue;
        if (n.goal.startsWith('crew:')) continue;
      }
      const s = j.priority * 100 - dist(n.x, n.z, j.from.x, j.from.z) + (j.carrier === n.id ? 500 : 0);
      if (s > bs) {
        bs = s;
        best = j;
      }
    }
    if (!best) return null;
    const j = best;
    return {
      key: `haul:${j.id}`,
      score: j.item === 'niche' ? 84 : 58,
      task: j.item === 'niche' ? 'Подноска снарядов к орудию' : `Разгрузка: ${ITEM_NAMES[j.item as SupplyItem] ?? 'груз'}`,
      abort: { fn: 'haul.release', a: j.id },
      plan: () => {
        j.state = 'taken';
        j.carrier = n.id;
        const run = j.item === 'niche';
        if (n.carry && j.carrier === n.id && n.flags.haul === j.id) {
          return [
            { k: 'go', x: j.to.x, z: j.to.z, tol: 0.8, run },
            { k: 'do', anim: 'pickup', dur: 0.8 },
            { k: 'call', fn: 'haul.drop', a: j.id },
          ];
        }
        return [
          { k: 'go', x: j.from.x, z: j.from.z, tol: 0.9, run },
          { k: 'do', anim: 'pickup', dur: 0.8 },
          { k: 'call', fn: 'haul.pick', a: j.id },
          { k: 'go', x: j.to.x, z: j.to.z, tol: 0.8, run },
          { k: 'do', anim: 'pickup', dur: 0.8 },
          { k: 'call', fn: 'haul.drop', a: j.id },
        ];
      },
    };
  }

  private job(id: string): HaulJob | undefined {
    return this.state.jobs.find((j) => j.id === id);
  }

  private pick(n: NpcState, id: string): void {
    const j = this.job(id);
    if (!j) return this.sim.npcs.clearGoal(n);
    if (j.item === 'niche') {
      const shell = j.requestId as ShellId;
      const have = Math.min(j.amount, this.sim.resources.ammo(shell));
      if (have <= 0) {
        j.state = 'done';
        return this.sim.npcs.clearGoal(n);
      }
      this.sim.resources.add(shell, -have);
      j.amount = have;
    }
    n.carry = j.carry;
    n.flags.haul = j.id;
  }

  private drop(n: NpcState, id: string): void {
    const sim = this.sim;
    const j = this.job(id);
    n.carry = null;
    delete n.flags.haul;
    if (!j) return;
    j.state = 'done';
    j.carrier = null;
    if (j.item === 'niche') {
      const g = sim.artillery.gun(j.gun!);
      const shell = j.requestId as ShellId;
      g.niche[shell] = (g.niche[shell] ?? 0) + j.amount;
    } else {
      sim.resources.add(j.item, j.amount);
    }
    n.fatigue = Math.min(100, n.fatigue + 0.8);
  }

  private release(n: NpcState, id: string): void {
    const j = this.job(id);
    if (!j || j.state === 'done') return;
    // брошенный груз: снаряд возвращается на склад, работа снова свободна
    if (n.carry && n.flags.haul === j.id && j.item === 'niche') this.sim.resources.add(j.requestId as ShellId, j.amount);
    n.carry = null;
    delete n.flags.haul;
    j.state = 'open';
    j.carrier = null;
  }

  // ------------------------------------------------------------------ цикл

  update(dt: number): void {
    const sim = this.sim;
    for (const v of this.state.vehicles) this.moveVehicle(v, dt);
    for (const r of this.state.requests) {
      if (r.status === 'enroute' && sim.now >= r.eta) this.arrive(r);
      if (r.status === 'unloading') {
        const left = this.state.jobs.some((j) => j.requestId === r.id && j.state !== 'done');
        if (!left) this.finishUnload(r);
      }
    }
    if (this.state.jobs.length > 60) this.state.jobs = this.state.jobs.filter((j) => j.state !== 'done');
    // расчёты держат у орудий дежурный запас снарядов
    if (Math.floor(sim.clock) % 7 === 0) {
      for (const g of sim.artillery.guns()) {
        const rail = sim.layout.guns[g.id].kind === 'rail';
        const shell: ShellId = rail ? 'he38' : 'he21';
        if ((g.niche[shell] ?? 0) < (rail ? 2 : 4) && g.phase === 'idle' && sim.guard.isDay()) this.requestNiche(g.id, shell);
      }
    }
  }

  private moveVehicle(v: Vehicle, dt: number): void {
    if (v.state !== 'driving') return;
    const tx = v.path[v.pathI];
    const tz = v.path[v.pathI + 1];
    if (tx === undefined) return this.arrived(v);
    const dx = tx - v.x;
    const dz = tz - v.z;
    const d = Math.hypot(dx, dz);
    const inYard = v.z < 122;
    v.speed = inYard ? 4.2 : 8;
    const step = v.speed * dt;
    if (d <= step) {
      v.x = tx;
      v.z = tz;
      v.pathI += 2;
      if (v.pathI >= v.path.length) this.arrived(v);
    } else {
      v.x += (dx / d) * step;
      v.z += (dz / d) * step;
      const want = yawTo(dx, dz);
      let diff = want - v.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      v.yaw += Math.max(-2.2 * dt, Math.min(2.2 * dt, diff));
    }
  }

  private arrived(v: Vehicle): void {
    const sim = this.sim;
    v.speed = 0;
    if (v.onArrive === 'depart') {
      v.state = 'away';
    } else if (v.onArrive === 'unload') {
      v.state = 'unloading';
      this.blockVehicle(v, true);
      const driver = sim.npcs.list.find((n) => n.flags.truck === v.id && n.status === 'away');
      if (driver) {
        driver.x = v.x + 2;
        driver.z = v.z + 1;
        delete driver.flags.truck;
        sim.npcs.setStatus(driver, 'active');
      }
    } else if (v.onArrive === 'park') {
      v.state = 'parked';
      v.yaw = v.homeYaw;
      this.blockVehicle(v, true);
    } else {
      v.state = 'parked';
    }
    v.onArrive = '';
    sim.bus.emit('vehicle:moved', { id: v.id });
  }

  /** Колонна возвращается (или не возвращается). */
  private arrive(r: SupplyRequest): void {
    const sim = this.sim;
    const rng = sim.rng;
    const risk = this.risk(r.escort, r.night);
    const roll = rng.next();
    const P = sim.layout.points;
    let items = r.items;
    let lostTrucks: string[] = [];
    if (roll < risk * 0.45 && r.trucks.length >= 1) {
      // колонна уничтожена
      lostTrucks = [...r.trucks];
      r.status = 'lost';
      r.note = 'Колонна уничтожена на марше.';
    } else if (roll < risk && r.trucks.length > 1) {
      lostTrucks = [r.trucks[1]];
      r.status = 'partial';
      r.note = 'Одна машина потеряна при налёте, доставлена часть груза.';
      const half: Partial<Record<SupplyItem, number>> = {};
      for (const [k, n] of Object.entries(items)) half[k as SupplyItem] = Math.ceil((n ?? 0) / 2);
      items = half;
    } else if (roll < risk) {
      r.status = 'partial';
      r.note = 'Колонна обстреляна, часть груза повреждена.';
      const part: Partial<Record<SupplyItem, number>> = {};
      for (const [k, n] of Object.entries(items)) part[k as SupplyItem] = Math.ceil((n ?? 0) * 0.6);
      items = part;
    }
    for (const id of lostTrucks) {
      const v = this.vehicle(id);
      if (v) v.state = 'wreck';
      const d = sim.npcs.list.find((n) => n.flags.truck === id);
      if (d) {
        delete d.flags.truck;
        if (rng.chance(0.5)) sim.combat.kill(d, 'погиб при налёте на колонну снабжения', true);
        else {
          d.x = P.gate_in.x;
          d.z = P.gate_in.z;
          sim.npcs.setStatus(d, 'active');
          sim.combat.wound(d, 45, 'ранен при налёте на колонну');
        }
      }
      sim.repair.get(id as 'truck1').broken = true;
    }
    for (const id of r.escorts) {
      const e = sim.npcs.byId(id);
      if (!e) continue;
      delete e.flags.convoy;
      e.x = P.gate_in.x + rng.range(-1, 1);
      e.z = P.gate_in.z + rng.range(0, 2);
      sim.npcs.setStatus(e, 'active');
      if (r.status === 'lost' && rng.chance(0.4)) sim.combat.wound(e, 40, 'ранен в бою за колонну');
    }
    if (r.status === 'lost') {
      sim.radio.send('Штаб снабжения', 'Колонна потеряна', `Колонна снабжения уничтожена на марше. Груз утрачен. ${r.escort ? '' : 'Рекомендуем выделять охрану.'}`, 'urgent', 'supply');
      sim.enemy.state.intel = Math.min(100, sim.enemy.state.intel + 6);
      sim.bus.emit('supply:update', { request: r });
      return;
    }
    const surviving = r.trucks.filter((t) => !lostTrucks.includes(t));
    surviving.forEach((id, i) => {
      const v = this.vehicle(id)!;
      v.x = P.road_far.x;
      v.z = P.road_far.z + 6 + i * 9;
      v.yaw = Math.PI;
      v.state = 'driving';
      this.drive(v, [P.gate_out.x, P.gate_out.z, P.gate_in.x, 100, 54, 80, P.truck_unload.x + i * 3.2 - (surviving.length - 1) * 1.6, P.truck_unload.z + 3], 'unload');
    });
    if (r.status !== 'partial') r.status = 'unloading';
    else {
      sim.radio.send('Штаб снабжения', 'Колонна прибыла с потерями', r.note, 'urgent', 'supply');
      r.status = 'unloading';
    }
    r.items = items;
    this.unloadJobs(r, items);
    sim.notify('Колонна снабжения прибыла. Идёт разгрузка.', 'good');
    sim.bus.emit('supply:update', { request: r });
  }

  private finishUnload(r: SupplyRequest): void {
    const sim = this.sim;
    r.status = 'done';
    for (const id of r.trucks) {
      const v = this.vehicle(id);
      if (!v || v.state !== 'unloading') continue;
      this.blockVehicle(v, false);
      this.drive(v, [v.x, v.z + 8, 46, 80, v.home.x, 78, v.home.x, v.home.z], 'park');
    }
    const list = Object.entries(r.items)
      .map(([k, n]) => `${ITEM_NAMES[k as SupplyItem]} — ${n}`)
      .join('; ');
    const qm = sim.npcs.first('quartermaster');
    sim.radio.send(qm ? `Интендант (${fullName(qm)})` : 'Интендант', 'Груз принят на склады', `Разгрузка завершена: ${list}.`, 'routine', 'supply', undefined, false);
    sim.bus.emit('supply:update', { request: r });
  }

  save(): unknown {
    return this.state;
  }

  load(d: any): void {
    this.state = d;
    for (const v of this.state.vehicles) if (v.state === 'parked' || v.state === 'unloading') this.blockVehicle(v, true);
  }
}
