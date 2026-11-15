/**
 * EnemySystem — армия противника на карте района. Подразделения действуют сами:
 * наступают по дорогам, окапываются и маскируются под огнём, меняют маршруты,
 * ведут огонь артиллерией, строят ложные позиции, ищут и обстреливают комплекс.
 * Игрок этого не видит — только донесения разведки.
 */
import { COMPLEX_POS } from '../core/constants';
import { clamp } from '../core/math';
import type { EnemyType, EnemyUnit, ShellId } from '../core/types';
import { SHELLS } from './BallisticsSystem';
import { BRIDGE_NODES, EDGES, FRONT_NODES, NODES } from './Region';
import type { Sim } from './Sim';

export const ENEMY_TYPE_NAMES: Record<EnemyType | 'unknown', string> = {
  infantry: 'пехота',
  armor: 'танки',
  artillery: 'артиллерийская батарея',
  hq: 'штаб',
  depot: 'склад',
  column: 'колонна',
  recon: 'разведгруппа',
  decoy: 'ложная позиция',
  bridge: 'мост',
  unknown: 'неустановленная цель',
};

export interface ImpactResult {
  hits: { id: string; type: EnemyType; name: string; dmg: number; destroyed: boolean; d: number }[];
  nearest: { id: string; d: number } | null;
}

export class EnemySystem {
  state = {
    units: [] as EnemyUnit[],
    seq: 0,
    /** Насколько точно противник знает расположение комплекса (0..100). */
    intel: 4,
    /** Общая активность противника 0..1. */
    pressure: 0.15,
    /** Фаза кампании: 0 — затишье … 3 — наступление. */
    phase: 0,
    front: { 4: 100, 5: 100, 6: 100, 7: 100 } as Record<number, number>,
    owner: {} as Record<number, 'us' | 'enemy'>,
    bridgeDown: {} as Record<number, number>,
    nextColumn: 300,
    nextRecon: 99999,
    nextShelling: 0,
    assault: 0,
  };

  constructor(private sim: Sim) {}

  reset(): void {
    const s = this.state;
    s.units = [];
    s.seq = 0;
    s.intel = 4;
    s.pressure = 0.15;
    s.phase = 0;
    s.front = { 4: 100, 5: 100, 6: 100, 7: 100 };
    s.owner = {};
    for (const n of NODES) s.owner[n.id] = n.tier <= 2 ? 'us' : 'enemy';
    s.bridgeDown = {};
    s.nextColumn = this.sim.now + 240;
    s.nextRecon = 99999;
    s.nextShelling = 0;
    s.assault = 0;
    this.spawn('infantry', '1-й пехотный батальон', NODES[11].x + 300, NODES[11].y + 200, 4);
    this.spawn('infantry', '2-й пехотный батальон', NODES[12].x - 200, NODES[12].y + 400, 5);
    this.spawn('armor', 'Танковая рота', NODES[13].x + 200, NODES[13].y - 300, 6);
    this.spawn('artillery', 'Батарея «А»', 12900, 9900, 5);
    this.spawn('artillery', 'Батарея «Б»', 20600, 10300, 6);
    this.spawn('hq', 'Штаб дивизии', NODES[15].x + 250, NODES[15].y + 150, 15);
    this.spawn('depot', 'Армейский склад', NODES[14].x - 300, NODES[14].y + 250, 14);
    this.spawn('decoy', 'Ложная батарея', 16600, 10800, 0, 'artillery');
    this.spawn('decoy', 'Макеты танков', 8900, 10100, 0, 'armor');
    for (const b of BRIDGE_NODES) this.spawn('bridge', NODES[b].name, NODES[b].x, NODES[b].y, b);
  }

  spawn(type: EnemyType, name: string, x: number, y: number, objective: number, fakeType?: EnemyType): EnemyUnit {
    const u: EnemyUnit = {
      id: 'e' + ++this.state.seq,
      type,
      name,
      x,
      y,
      strength: 100,
      suppress: 0,
      state: 'hold',
      camo: type === 'hq' || type === 'depot' ? 0.6 : type === 'artillery' ? 0.5 : type === 'decoy' ? 0.15 : type === 'bridge' ? 0 : 0.35,
      route: [],
      routeI: 0,
      speed: type === 'armor' ? 190 : type === 'column' ? 260 : type === 'recon' ? 90 : 60,
      fakeType,
      lastShelled: -9999,
      nextThink: this.sim.now + this.sim.rng.range(5, 30),
      fireCooldown: this.sim.now + this.sim.rng.range(40, 160),
      smokeUntil: 0,
      objective,
      alive: true,
    };
    this.state.units.push(u);
    return u;
  }

  get units(): EnemyUnit[] {
    return this.state.units;
  }

  byId(id: string | null): EnemyUnit | undefined {
    return id ? this.state.units.find((u) => u.id === id) : undefined;
  }

  alive(type?: EnemyType): EnemyUnit[] {
    return this.state.units.filter((u) => u.alive && (!type || u.type === type));
  }

  private edgeOpen(a: number, b: number): boolean {
    for (const br of BRIDGE_NODES) {
      if ((a === br || b === br) && (this.state.bridgeDown[br] ?? 0) > this.sim.now) return false;
    }
    return true;
  }

  /** Кратчайший маршрут по дорогам (поиск в ширину), с учётом разрушенных мостов. */
  route(from: number, to: number, avoid = -1): number[] {
    const prev = new Map<number, number>();
    const q = [from];
    prev.set(from, -1);
    while (q.length) {
      const c = q.shift()!;
      if (c === to) break;
      for (const [a, b] of EDGES) {
        const n = a === c ? b : b === c ? a : -1;
        if (n < 0 || prev.has(n) || n === avoid || !this.edgeOpen(a, b)) continue;
        prev.set(n, c);
        q.push(n);
      }
    }
    if (!prev.has(to)) return [];
    const out: number[] = [];
    for (let c = to; c !== -1; c = prev.get(c)!) out.push(c);
    return out.reverse();
  }

  private nearestNodeId(u: EnemyUnit): number {
    let best = 0;
    let bd = Infinity;
    for (const n of NODES) {
      const d = Math.hypot(n.x - u.x, n.y - u.y);
      if (d < bd) {
        bd = d;
        best = n.id;
      }
    }
    return best;
  }

  update(_dt: number, gdt: number): void {
    const sim = this.sim;
    const s = this.state;
    const now = sim.now;
    for (const u of s.units) {
      if (!u.alive) continue;
      // движение по маршруту
      if ((u.state === 'move' || u.state === 'advance' || u.state === 'retreat') && u.route.length && now > u.smokeUntil) {
        const node = NODES[u.route[u.routeI]];
        if (node) {
          const dx = node.x - u.x;
          const dy = node.y - u.y;
          const d = Math.hypot(dx, dy);
          const step = u.speed * gdt * (u.suppress > 50 ? 0.3 : 1) * (sim.weather.state.rain > 0.5 ? 0.75 : 1);
          if (d <= step) {
            u.x = node.x;
            u.y = node.y;
            u.routeI++;
            if (u.routeI >= u.route.length) this.arrived(u);
          } else {
            u.x += (dx / d) * step;
            u.y += (dy / d) * step;
          }
        }
      }
      if (now >= u.nextThink) {
        u.nextThink = now + 10;
        this.think(u);
      }
    }
    // восстановленные мосты
    for (const b of BRIDGE_NODES) {
      if (s.bridgeDown[b] && s.bridgeDown[b] <= now) {
        delete s.bridgeDown[b];
        const br = s.units.find((u) => u.type === 'bridge' && u.objective === b);
        if (br) {
          br.alive = true;
          br.strength = 70;
        }
      }
    }
    // колонны снабжения
    if (now >= s.nextColumn) {
      s.nextColumn = now + sim.rng.range(260, 520) / (0.6 + s.phase * 0.3);
      const from = sim.rng.pick([14, 15]);
      const to = sim.rng.pick([11, 12, 13]);
      const r = this.route(from, to);
      if (r.length > 1) {
        const c = this.spawn('column', 'Колонна снабжения', NODES[from].x, NODES[from].y, to);
        c.route = r;
        c.routeI = 1;
        c.state = 'move';
        c.camo = 0.05;
      }
    }
    // разведгруппы ищут комплекс
    if (now >= s.nextRecon && s.phase >= 1) {
      s.nextRecon = now + sim.rng.range(500, 900) / (0.5 + s.phase * 0.4);
      if (!this.alive('recon').length) {
        const side = sim.rng.pick([4, 5, 6]);
        const r = this.spawn('recon', 'Разведывательно-диверсионная группа', NODES[side].x + sim.rng.range(-1500, 1500), NODES[side].y + 1500, 0);
        r.state = 'move';
        r.camo = 0.8;
        r.route = this.route(side, 0);
        r.routeI = 1;
      }
    }
    // пехота на переднем крае пополняется, если её не атакуют
    for (const n of FRONT_NODES) if (s.owner[n] === 'us') s.front[n] = Math.min(100, (s.front[n] ?? 0) + gdt * 0.012);
    s.pressure = clamp(0.1 + s.phase * 0.2 + (400 - (s.front[4] + s.front[5] + s.front[6] + s.front[7])) / 900, 0, 1);
  }

  private arrived(u: EnemyUnit): void {
    const s = this.state;
    const node = this.nearestNodeId(u);
    if (u.type === 'column') {
      // колонна доставила грузы — ближайшие части пополнены
      for (const o of s.units) if (o.alive && o !== u && o.type !== 'bridge' && Math.hypot(o.x - u.x, o.y - u.y) < 5000) o.strength = Math.min(100, o.strength + 12);
      u.alive = false;
      return;
    }
    if (u.type === 'recon') {
      u.state = 'hold';
      return;
    }
    if (u.state === 'retreat') {
      u.state = 'hold';
      return;
    }
    if (s.owner[node] === 'us' && FRONT_NODES.includes(node)) u.state = 'advance';
    else if (s.owner[node] === 'us') u.state = 'advance';
    else u.state = 'hold';
    u.route = [];
  }

  private think(u: EnemyUnit): void {
    const sim = this.sim;
    const s = this.state;
    const now = sim.now;
    const rng = sim.rng;
    u.suppress = Math.max(0, u.suppress - 5);
    const shelled = now - u.lastShelled < 40;
    const node = this.nearestNodeId(u);
    const atNode = Math.hypot(NODES[node].x - u.x, NODES[node].y - u.y) < 400;
    switch (u.type) {
      case 'infantry':
      case 'armor': {
        if (u.state === 'hold' || u.state === 'dugin') {
          u.camo = Math.min(0.75, u.camo + 0.03);
          if (u.camo > 0.55) u.state = 'dugin';
          const eager = s.phase >= 3 ? 0.14 : s.phase === 2 ? 0.03 : s.phase === 1 ? 0.004 : 0;
          if (!shelled && u.strength > 45 && u.suppress < 30 && rng.chance(eager)) {
            const r = this.route(node, u.objective);
            if (r.length > 1) {
              u.route = r;
              u.routeI = 1;
              u.state = 'move';
              u.camo = 0.12;
            }
          }
        } else if (u.state === 'move' && shelled) {
          if (u.strength < 38) {
            const back = NODES.filter((n) => n.tier === 4).sort((a, b) => Math.hypot(a.x - u.x, a.y - u.y) - Math.hypot(b.x - u.x, b.y - u.y))[0];
            u.route = this.route(node, back.id);
            u.routeI = Math.min(1, Math.max(0, u.route.length - 1));
            u.state = 'retreat';
          } else if (rng.chance(0.5)) {
            // рассредоточиться и переждать, затем — другой дорогой
            u.state = 'hold';
            u.camo = 0.45;
            const next = u.route[u.routeI];
            const alt = this.route(node, u.objective, next);
            if (alt.length > 1 && rng.chance(0.6)) u.route = alt;
          }
        } else if (u.state === 'advance' && atNode && s.owner[node] === 'us') {
          // бой за пункт
          const k = (u.type === 'armor' ? 0.9 : 0.55) * (u.strength / 100) * (now < u.smokeUntil ? 0.2 : 1) * (u.suppress > 40 ? 0.4 : 1);
          s.front[node] = (s.front[node] ?? 60) - k;
          u.strength -= rng.range(0.3, 1.1);
          if ((s.front[node] ?? 0) <= 0) this.capture(node);
          if (u.strength < 30) {
            u.state = 'retreat';
            u.route = this.route(node, sim.rng.pick([11, 12, 13]));
            u.routeI = 1;
          }
        } else if (u.state === 'advance' && s.owner[node] === 'enemy') {
          // пункт взят — следующая цель глубже в нашем тылу
          const next = FRONT_NODES.includes(node) ? 1 : 0;
          u.objective = next;
          const r = this.route(node, next);
          if (r.length > 1 && s.phase >= 2) {
            u.route = r;
            u.routeI = 1;
            u.state = 'move';
          } else u.state = 'hold';
        }
        if (u.strength <= 0) this.destroy(u);
        break;
      }
      case 'artillery': {
        if (now < u.fireCooldown || now < u.smokeUntil || u.suppress > 45) break;
        const key = this.targetPosition();
        const wantCounter = key !== null && (s.phase >= 1 || s.intel > 55);
        if (wantCounter && now >= s.nextShelling && Math.hypot(u.x - COMPLEX_POS.x, u.y - COMPLEX_POS.y) < 21000) {
          const acc = clamp((sim.artillery.state.located[key!] + s.intel) / 2, 20, 95);
          const rounds = rng.int(3, 5 + s.phase * 2);
          s.nextShelling = now + rng.range(90, 200) / (0.6 + s.phase * 0.3);
          u.fireCooldown = now + rng.range(70, 140);
          sim.combat.shelling(key!, rounds, acc);
          sim.recon.soundRanging(u);
        } else {
          // огонь по нашему переднему краю
          const tgt = FRONT_NODES.filter((n) => s.owner[n] === 'us').sort((a, b) => Math.hypot(NODES[a].x - u.x, NODES[a].y - u.y) - Math.hypot(NODES[b].x - u.x, NODES[b].y - u.y))[0];
          if (tgt !== undefined) {
            s.front[tgt] = Math.max(0, (s.front[tgt] ?? 0) - 0.35 * (u.strength / 100) * s.phase);
            u.fireCooldown = now + rng.range(50, 130);
            if (rng.chance(0.55)) sim.recon.soundRanging(u);
          }
        }
        break;
      }
      case 'recon': {
        const d = Math.hypot(u.x - COMPLEX_POS.x, u.y - COMPLEX_POS.y);
        if (u.state === 'hold' || d < 2600) {
          u.state = 'hold';
          // наблюдают за объектом; огни и стрельба выдают его
          const lit = sim.resources.state.power > 0 && sim.time.darkness() > 0.6 && !sim.alert.state.blackout ? 1.5 : 1;
          s.intel = Math.min(100, s.intel + rng.range(0.6, 1.6) * lit);
          if (rng.chance(0.07 + s.phase * 0.03)) {
            sim.combat.infiltrate(u.id);
            u.alive = false;
          }
        }
        break;
      }
      case 'bridge':
      case 'hq':
      case 'depot':
      case 'decoy':
        break;
      case 'column':
        if (shelled && rng.chance(0.4)) {
          u.state = 'hold';
          u.nextThink = now + 30;
        } else if (u.state === 'hold') u.state = 'move';
        break;
    }
  }

  /** Какую позицию батареи противник засёк лучше всего. */
  private targetPosition(): 'main' | 'alt' | 'rail' | null {
    const L = this.sim.artillery.state.located;
    const thr = 62 - this.state.intel * 0.45;
    let best: 'main' | 'alt' | 'rail' | null = null;
    let bv = thr;
    for (const k of ['main', 'alt', 'rail'] as const) {
      if (L[k] > bv) {
        bv = L[k];
        best = k;
      }
    }
    if (!best && this.state.intel > 78) best = 'main';
    return best;
  }

  private capture(node: number): void {
    const sim = this.sim;
    this.state.owner[node] = 'enemy';
    this.state.front[node] = 0;
    sim.radio.send('Штаб корпуса', `Оставлен ${NODES[node].name}`, `Противник овладел пунктом ${NODES[node].name}. Наши части отходят. Линия фронта приближается к объекту.`, 'urgent', 'front');
    this.state.intel = Math.min(100, this.state.intel + 5);
  }

  private destroy(u: EnemyUnit): void {
    if (!u.alive) return;
    u.alive = false;
    u.state = 'destroyed';
    if (u.type === 'bridge') this.state.bridgeDown[u.objective] = this.sim.now + this.sim.rng.range(1300, 2000);
    this.sim.bus.emit('enemy:destroyed', { id: u.id, type: u.type, name: u.name });
  }

  /** Разрыв снаряда на карте района: урон и подавление. */
  impact(ix: number, iy: number, shellId: ShellId): ImpactResult {
    const shell = SHELLS[shellId];
    const now = this.sim.now;
    const res: ImpactResult = { hits: [], nearest: null };
    for (const u of this.state.units) {
      if (!u.alive) continue;
      const d = Math.hypot(u.x - ix, u.y - iy);
      if (!res.nearest || d < res.nearest.d) res.nearest = { id: u.id, d };
      if (shell.smoke) {
        if (d < shell.radius && u.type !== 'bridge') {
          u.smokeUntil = now + 28;
          u.lastShelled = now;
          res.hits.push({ id: u.id, type: u.type, name: u.name, dmg: 0, destroyed: false, d });
        }
        continue;
      }
      if (d > shell.radius * 2) continue;
      u.lastShelled = now;
      if (d > shell.radius) {
        u.suppress = Math.min(100, u.suppress + 12);
        continue;
      }
      let vuln = 1;
      switch (u.type) {
        case 'infantry':
          vuln = u.state === 'dugin' ? 0.45 : u.state === 'hold' ? 0.8 : 1.3;
          break;
        case 'armor':
          vuln = 0.35 + shell.pierce * 0.4;
          break;
        case 'artillery':
          vuln = 0.9;
          break;
        case 'hq':
          vuln = 0.3 + shell.pierce * 0.6;
          break;
        case 'depot':
          vuln = 1.2;
          break;
        case 'column':
        case 'decoy':
          vuln = 1.5;
          break;
        case 'bridge':
          vuln = d < 45 ? 0.12 + shell.pierce * 0.9 : 0;
          break;
        case 'recon':
          vuln = 0.9;
          break;
      }
      const dmg = shell.power * Math.pow(1 - d / shell.radius, 1.3) * vuln;
      if (dmg <= 0.5) continue;
      u.strength -= dmg;
      u.suppress = Math.min(100, u.suppress + dmg * 1.5 + 15);
      u.camo = Math.max(0.05, u.camo - 0.1);
      const destroyed = u.strength <= 0;
      res.hits.push({ id: u.id, type: u.type, name: u.name, dmg, destroyed, d });
      if (destroyed) this.destroy(u);
    }
    return res;
  }

  save(): unknown {
    return this.state;
  }

  load(d: any): void {
    this.state = d;
  }
}
