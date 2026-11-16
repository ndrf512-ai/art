/**
 * ReconSystem — разведка. Противник на карте не показывается сам по себе:
 * командир видит только донесения наблюдателей, разведчиков, радиоперехвата,
 * аэрофотосъёмки и соседей. Сведения бывают точными, устаревшими, неполными и ложными.
 */
import { COMPLEX_POS } from '../core/constants';
import type { EnemyType, EnemyUnit, FireMission, GunId, IntelReport, IntelSource } from '../core/types';
import { ENEMY_TYPE_NAMES, type ImpactResult } from './EnemySystem';
import { describePlace, NODES, OPS, square } from './Region';
import type { Sim } from './Sim';

interface PendingSpot {
  at: number;
  missionId: string;
  gun: GunId;
  ix: number;
  iy: number;
  result: ImpactResult;
}

const SOURCE_NAMES: Record<IntelSource, string> = {
  observer: 'Наблюдательный пункт',
  scouts: 'Разведгруппа',
  intercept: 'Радиоперехват',
  photo: 'Аэрофотоснимок',
  allied: 'Сосед',
  sound: 'Звукометрическая разведка',
  hq: 'Штаб корпуса',
};

export class ReconSystem {
  state = {
    reports: [] as IntelReport[],
    seq: 0,
    pending: [] as PendingSpot[],
    nextScouts: 200,
    nextIntercept: 150,
    nextAllied: 400,
    nextPhoto: 0,
    tick: 0,
    lastSeen: {} as Record<string, number>,
    opLost: {} as Record<string, boolean>,
  };

  constructor(private sim: Sim) {}

  reset(): void {
    const now = this.sim.now;
    this.state = { reports: [], seq: 0, pending: [], nextScouts: now + 150, nextIntercept: now + 100, nextAllied: now + 380, nextPhoto: now + 260, tick: 0, lastSeen: {}, opLost: {} };
  }

  get reports(): IntelReport[] {
    return this.state.reports;
  }

  /** Донесения, ещё не сданные в архив (свежие первыми). */
  current(): IntelReport[] {
    return this.state.reports.filter((r) => !r.archived).sort((a, b) => b.t - a.t);
  }

  byId(id: string | null): IntelReport | undefined {
    return id ? this.state.reports.find((r) => r.id === id) : undefined;
  }

  /** Работает ли связь с наблюдательным пунктом. */
  opOnline(opId: string): boolean {
    if (this.state.opLost[opId]) return false;
    const r = this.sim.resources.state;
    return r.wire || r.radio;
  }

  add(source: IntelSource, sourceName: string, grade: IntelReport['grade'], type: IntelReport['type'], x: number, y: number, err: number, text: string, unitId: string | null, ageMin = 0): IntelReport {
    const sim = this.sim;
    const rep: IntelReport = {
      id: 'i' + ++this.state.seq,
      t: sim.now,
      seenT: sim.now - ageMin,
      source,
      sourceName,
      grade,
      type,
      x: Math.round(x / 10) * 10,
      y: Math.round(y / 10) * 10,
      err,
      text,
      unitId,
      struck: false,
      archived: false,
    };
    // новое донесение того же источника о той же цели заменяет старое
    if (unitId) for (const r of this.state.reports) if (r.unitId === unitId && r.source === source && !r.archived) r.archived = true;
    this.state.reports.push(rep);
    if (this.state.reports.length > 90) this.state.reports.shift();
    sim.bus.emit('intel:new', { report: rep });
    return rep;
  }

  private noisy(u: EnemyUnit, err: number): { x: number; y: number } {
    const rng = this.sim.rng;
    return { x: u.x + rng.gauss(0, err * 0.6), y: u.y + rng.gauss(0, err * 0.6) };
  }

  private shownType(u: EnemyUnit): EnemyType {
    return u.type === 'decoy' ? (u.fakeType ?? 'artillery') : u.type;
  }

  private text(type: IntelReport['type'], u: { x: number; y: number }, extra = ''): string {
    return `${ENEMY_TYPE_NAMES[type][0].toUpperCase()}${ENEMY_TYPE_NAMES[type].slice(1)}, ${square(u.x, u.y)} (${describePlace(u.x, u.y)}).${extra ? ' ' + extra : ''}`;
  }

  update(_dt: number, gdt: number): void {
    const sim = this.sim;
    const s = this.state;
    const now = sim.now;
    const rng = sim.rng;
    const enemy = sim.enemy;

    // наблюдательные пункты теряются вместе с пунктом, который их прикрывает
    for (const op of OPS) {
      if (!s.opLost[op.id] && enemy.state.owner[op.node] === 'enemy') {
        s.opLost[op.id] = true;
        sim.radio.send('Штаб батареи', `${op.name} оставлен`, `Наблюдатели ${op.name} отошли. Наблюдения в этом секторе больше нет.`, 'urgent', 'recon');
      }
    }

    s.tick += gdt;
    if (s.tick >= 10) {
      s.tick = 0;
      const vis = sim.weather.visibility() * (1 - sim.time.darkness() * 0.55);
      for (const op of OPS) {
        if (!this.opOnline(op.id)) continue;
        for (const u of enemy.units) {
          if (!u.alive || u.type === 'bridge') continue;
          const d = Math.hypot(u.x - op.x, u.y - op.y);
          if (d > op.range * (0.35 + 0.65 * vis)) continue;
          const moving = u.state === 'move' || u.state === 'advance' || u.state === 'retreat';
          const p = (1 - u.camo) * (moving ? 0.9 : 0.4) * (0.4 + 0.6 * vis) * (now < u.smokeUntil ? 0.2 : 1);
          const key = op.id + u.id;
          const last = s.lastSeen[key];
          const prev = this.state.reports.find((r) => r.unitId === u.id && r.source === 'observer' && !r.archived);
          const movedFar = prev ? Math.hypot(prev.x - u.x, prev.y - u.y) > 350 : true;
          if ((last === undefined || now - last > 45 || movedFar) && rng.chance(p)) {
            s.lastSeen[key] = now;
            const err = 60 + d / 120;
            const pos = this.noisy(u, err);
            const type = this.shownType(u);
            const act = moving ? 'В движении.' : u.state === 'dugin' ? 'Окопались.' : 'На месте.';
            this.add('observer', op.name, d < op.range * 0.6 ? 'A' : 'B', type, pos.x, pos.y, Math.round(err), this.text(type, pos, act), u.id);
          }
        }
      }
    }

    if (now >= s.nextScouts) {
      s.nextScouts = now + rng.range(200, 330);
      const pool = enemy.units.filter((u) => u.alive && u.type !== 'bridge' && u.y > 5500 && u.type !== 'recon');
      for (let i = 0; i < 2 && pool.length; i++) {
        const u = pool.splice(rng.int(0, pool.length - 1), 1)[0];
        if (rng.chance(u.camo * 0.7)) continue;
        const age = rng.range(60, 190);
        const pos = this.noisy(u, 260);
        const type = this.shownType(u);
        this.add('scouts', SOURCE_NAMES.scouts, rng.chance(0.6) ? 'B' : 'C', type, pos.x, pos.y, 250, this.text(type, pos, `Сведения ${Math.round(age / 10) * 10}-минутной давности.`), u.id, age);
      }
    }

    if (now >= s.nextIntercept && sim.resources.state.radio) {
      s.nextIntercept = now + rng.range(150, 280);
      const pool = enemy.units.filter((u) => u.alive && (u.type === 'hq' || u.type === 'artillery' || u.type === 'armor' || u.type === 'infantry'));
      if (pool.length) {
        const u = rng.pick(pool);
        const pos = this.noisy(u, 1100);
        const known = rng.chance(0.45);
        const type: IntelReport['type'] = known ? u.type : 'unknown';
        const extra = u.type === 'hq' ? 'Интенсивный радиообмен, вероятно узел управления.' : enemy.state.phase >= 2 ? 'Радиообмен нарастает — возможна подготовка к наступлению.' : 'Обычный радиообмен.';
        this.add('intercept', SOURCE_NAMES.intercept, 'C', type, pos.x, pos.y, 1000, this.text(type, pos, extra), u.id);
      }
      // перехват чужой передачи с самого объекта
      if (sim.spy.state.lastTransmit > 0 && now - sim.spy.state.lastTransmit < 200 && !sim.spy.state.transmitReported) sim.spy.reportTransmission();
    }

    if (now >= s.nextAllied) {
      s.nextAllied = now + rng.range(280, 520);
      if (rng.chance(0.35)) {
        // ложная тревога соседей
        const n = rng.pick(NODES.filter((nd) => nd.tier === 3));
        const x = n.x + rng.range(-2500, 2500);
        const y = n.y + rng.range(-1500, 1800);
        const type = rng.pick<EnemyType>(['armor', 'infantry', 'artillery']);
        this.add('allied', 'Сосед (пехотный полк)', 'D', type, x, y, 500, this.text(type, { x, y }, 'По докладу передовых постов, не проверено.'), null);
      } else {
        const pool = enemy.units.filter((u) => u.alive && u.y > 9000 && u.type !== 'bridge' && u.type !== 'recon');
        if (pool.length) {
          const u = rng.pick(pool);
          const pos = this.noisy(u, 450);
          const type = this.shownType(u);
          this.add('allied', 'Сосед (пехотный полк)', 'C', type, pos.x, pos.y, 450, this.text(type, pos, 'Наблюдалось с переднего края.'), u.id, rng.range(20, 90));
        }
      }
    }

    // аэрофотосъёмка: раз в сутки в лётную погоду, снимки приходят с задержкой
    if (now >= s.nextPhoto) {
      s.nextPhoto = now + 1440;
      if (sim.weather.state.fog < 0.4 && sim.weather.state.rain < 0.4) {
        const pool = enemy.units.filter((u) => u.alive && u.type !== 'bridge' && u.type !== 'recon' && u.type !== 'column');
        rng.shuffle(pool);
        let n = 0;
        for (const u of pool.slice(0, 5)) {
          if (rng.chance(u.camo * 0.5) && u.type !== 'decoy') continue;
          const age = rng.range(280, 460);
          const pos = this.noisy(u, 70);
          const type = this.shownType(u);
          this.add('photo', SOURCE_NAMES.photo, 'B', type, pos.x, pos.y, 70, this.text(type, pos, `Снимок сделан около ${Math.round(age / 60)} ч назад.`), u.id, age);
          n++;
        }
        if (n) sim.radio.send('Штаб корпуса', 'Результаты аэрофотосъёмки', `Дешифрованы снимки района: нанесено целей — ${n}. Учтите давность сведений.`, 'routine', 'recon');
      }
    }

    // доклады наблюдателей о разрывах
    for (let i = s.pending.length - 1; i >= 0; i--) {
      if (now >= s.pending[i].at) {
        const p = s.pending.splice(i, 1)[0];
        this.reportImpact(p);
      }
    }
    // старые донесения уходят в архив
    for (const r of s.reports) if (!r.archived && now - r.t > 900) r.archived = true;
  }

  /** Звукометристы засекают стреляющую батарею противника. */
  soundRanging(u: EnemyUnit): void {
    if (!this.sim.resources.state.wire && !this.sim.resources.state.radio) return;
    if (!this.sim.rng.chance(0.7)) return;
    const pos = this.noisy(u, 280);
    this.add('sound', SOURCE_NAMES.sound, 'B', 'artillery', pos.x, pos.y, 280, this.text('artillery', pos, 'Засечена по звуку выстрелов, ведёт огонь.'), u.id);
  }

  /** Цель от штаба с точными координатами. */
  hqTarget(u: EnemyUnit, note: string): IntelReport {
    return this.add('hq', SOURCE_NAMES.hq, 'A', this.shownType(u), u.x, u.y, 30, this.text(this.shownType(u), u, note), u.id);
  }

  spotImpact(m: FireMission, gun: GunId, ix: number, iy: number, tof: number, result: ImpactResult): void {
    this.state.pending.push({ at: this.sim.now + tof / 60 + 1.2, missionId: m.id, gun, ix, iy, result });
    const rep = this.byId(m.intelId);
    if (rep) rep.struck = true;
  }

  private reportImpact(p: PendingSpot): void {
    const sim = this.sim;
    const m = sim.artillery.mission(p.missionId);
    if (!m) return;
    // вспышки разрывов видны и ночью; мешают только туман, дождь и снег
    const vis = sim.weather.visibility();
    const op = OPS.find((o) => this.opOnline(o.id) && Math.hypot(o.x - p.ix, o.y - p.iy) < o.range * (0.55 + 0.45 * vis));
    let text: string;
    if (!op) {
      const why = !sim.resources.state.wire && !sim.resources.state.radio ? 'нет связи с наблюдателями' : 'район вне видимости наблюдательных пунктов';
      text = `Разрыв не наблюдается: ${why}.`;
    } else {
      const rep = sim.recon.byId(m.intelId);
      const unit = sim.enemy.byId(rep?.unitId ?? null);
      // наблюдатель отсчитывает отклонение от того, что видит: от реальной цели, если она там есть
      let rx = m.tx;
      let ry = m.ty;
      let targetSeen = false;
      const hit = unit ? p.result.hits.find((h) => h.id === unit.id) : undefined;
      if (unit && (unit.alive || hit) && Math.hypot(unit.x - m.tx, unit.y - m.ty) < 1400) {
        rx = unit.x;
        ry = unit.y;
        targetSeen = true;
      }
      const gx = rx - COMPLEX_POS.x;
      const gy = ry - COMPLEX_POS.y;
      const gl = Math.hypot(gx, gy) || 1;
      const ux = gx / gl;
      const uy = gy / gl;
      const ex = p.ix - rx;
      const ey = p.iy - ry;
      const rng = sim.rng;
      const along = (ex * ux + ey * uy) * (1 + rng.gauss(0, 0.08)) + rng.gauss(0, 15);
      const cross = (ex * uy - ey * ux) * (1 + rng.gauss(0, 0.08)) + rng.gauss(0, 10);
      const r10 = (v: number) => Math.round(Math.abs(v) / 10) * 10;
      const parts: string[] = [];
      if (Math.abs(along) >= 30) parts.push(`${along > 0 ? 'перелёт' : 'недолёт'} ${r10(along)}`);
      if (Math.abs(cross) >= 20) parts.push(`${cross > 0 ? 'вправо' : 'влево'} ${r10(cross)}`);
      const dev = parts.length ? parts.join(', ') : 'по цели';
      let effect = '';
      if (hit?.destroyed) effect = ' Цель уничтожена.';
      else if (hit && hit.dmg > 12) effect = ' Цель накрыта, наблюдаю попадания.';
      else if (hit && hit.dmg > 0) effect = ' Осколками задело цель.';
      else if (!targetSeen && unit && unit.alive) effect = ' Цели в указанном районе не наблюдаю — вероятно, ушла.';
      else if (!targetSeen && !unit) effect = ' Противника в районе разрывов не наблюдаю.';
      const others = p.result.hits.filter((h) => h.id !== unit?.id && h.dmg > 8);
      if (others.length) effect += ` Поражена также цель: ${ENEMY_TYPE_NAMES[others[0].type]}.`;
      if (hit?.destroyed && unit?.type === 'decoy') effect = ' Цель разбита. Обломки похожи на макеты — позиция, по-видимому, была ложной.';
      text = `${op.name}: разрыв — ${dev}.${effect}`;
      if (hit?.destroyed && rep) rep.archived = true;
    }
    m.reports.push(`${sim.time.clockString()} ${text}`);
    sim.bus.emit('arty:report', { gun: p.gun, text });
  }

  save(): unknown {
    return this.state;
  }

  load(d: any): void {
    this.state = d;
  }
}
