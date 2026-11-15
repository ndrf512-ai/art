/**
 * NPCSystem — личный состав как автономные агенты.
 * У каждого NPC есть текущая цель; цель выбирается по полезности (utility AI) из
 * вариантов, которые предлагают системы-провайдеры (расписание, приказы, караул,
 * расчёт орудия, ремонт…), и исполняется как план из простых шагов.
 */
import { RUN_SPEED, WALK_SPEED } from '../core/constants';
import { approachAngle, dist, lerp, yawTo } from '../core/math';
import type { AnimId, MemoryEntry, NpcState, Spot, Step } from '../core/types';
import { BARKS } from '../data/names';
import type { Sim } from './Sim';

export interface GoalOption {
  key: string;
  score: number;
  /** Человекочитаемое описание текущей задачи. */
  task: string;
  plan: () => Step[];
  data?: any;
  /** Вызов при прерывании цели (например, вернуть взятую работу). */
  abort?: { fn: string; a?: any };
}

export type GoalProvider = (npc: NpcState) => GoalOption | null;
export type PerceptionHook = (npc: NpcState, other: NpcState, d: number) => void;

const CALM_ANIMS = new Set<AnimId>(['idle', 'guard', 'attention', 'talk', 'smoke', 'inspect', 'write', 'point']);
const TALK_ANIMS = new Set<AnimId>(['talk', 'sit_talk', 'smoke', 'sit_eat', 'sit']);

export class NPCSystem {
  state = { list: [] as NpcState[], spotOwner: {} as Record<string, string>, seq: 0, logT: 0 };
  private index = new Map<string, NpcState>();
  providers: GoalProvider[] = [];
  hooks: PerceptionHook[] = [];

  constructor(private sim: Sim) {}

  reset(): void {
    this.state = { list: [], spotOwner: {}, seq: 0, logT: 0 };
    this.index.clear();
  }

  get list(): NpcState[] {
    return this.state.list;
  }

  byId(id: string): NpcState | undefined {
    return this.index.get(id);
  }

  add(npc: NpcState): void {
    this.state.list.push(npc);
    this.index.set(npc.id, npc);
    this.sim.bus.emit('npc:spawned', { id: npc.id });
  }

  remove(id: string): void {
    const i = this.state.list.findIndex((n) => n.id === id);
    if (i >= 0) {
      this.releaseSpot(this.state.list[i]);
      this.state.list.splice(i, 1);
    }
    this.index.delete(id);
    this.sim.bus.emit('npc:removed', { id });
  }

  nextId(prefix: string): string {
    return `${prefix}${++this.state.seq}`;
  }

  /** Все, кто в строю (не убит, не арестован, не в отъезде). */
  active(): NpcState[] {
    return this.state.list.filter((n) => n.status === 'active');
  }

  byRole(role: NpcState['role']): NpcState[] {
    return this.state.list.filter((n) => n.role === role && n.status !== 'dead');
  }

  first(role: NpcState['role']): NpcState | undefined {
    return this.state.list.find((n) => n.role === role && n.status === 'active');
  }

  // ------------------------------------------------------------------ точки

  spot(id: string): Spot | undefined {
    return this.sim.layout.spotById[id];
  }

  spotFree(id: string, forNpc?: string): boolean {
    const o = this.state.spotOwner[id];
    return !o || o === forNpc;
  }

  /** Свободная точка с тегом, ближайшая к NPC (или случайная). */
  freeSpot(tag: string, npc: NpcState, random = false): Spot | null {
    const list = this.sim.layout.byTag(tag).filter((s) => this.spotFree(s.id, npc.id));
    if (!list.length) return null;
    if (random) return this.sim.rng.pick(list);
    let best = list[0];
    let bd = Infinity;
    for (const s of list) {
      const d = dist(npc.x, npc.z, s.x, s.z);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }

  reserve(npc: NpcState, spotId: string): boolean {
    if (!this.spotFree(spotId, npc.id)) return false;
    this.releaseSpot(npc);
    this.state.spotOwner[spotId] = npc.id;
    npc.spot = spotId;
    return true;
  }

  releaseSpot(npc: NpcState): void {
    if (npc.spot && this.state.spotOwner[npc.spot] === npc.id) delete this.state.spotOwner[npc.spot];
    npc.spot = null;
  }

  // ------------------------------------------------------------------ речь, память

  speak(npc: NpcState, text: string, quiet = false): void {
    npc.speech = { text, until: this.sim.clock + Math.min(7, 2.2 + text.length * 0.055) };
    this.sim.bus.emit('npc:speech', { id: npc.id, text, quiet });
  }

  remember(npc: NpcState, kind: MemoryEntry['kind'], text: string, w = 1): void {
    npc.memory.push({ t: this.sim.now, kind, text, w });
    if (npc.memory.length > 24) npc.memory.shift();
  }

  gesture(npc: NpcState, anim: AnimId, seconds: number, face?: string): void {
    npc.gesture = { anim, until: this.sim.clock + seconds, face };
    npc.moving = false;
  }

  setStatus(npc: NpcState, status: NpcState['status']): void {
    npc.status = status;
    this.clearGoal(npc);
    this.sim.bus.emit('npc:status', { id: npc.id });
  }

  // ------------------------------------------------------------------ цикл

  update(dt: number, gdt: number): void {
    const sim = this.sim;
    const clock = sim.clock;
    for (const n of this.state.list) {
      if (n.status === 'dead' || n.status === 'away' || n.status === 'leave') continue;
      this.needs(n, gdt);
      n.brainT -= dt;
      if (n.brainT <= 0) {
        n.brainT = 0.55 + sim.rng.next() * 0.35;
        this.perceive(n);
        this.think(n);
        this.bark(n);
      }
      if (n.speech && clock > n.speech.until) n.speech = null;
      if (n.gesture) {
        if (clock > n.gesture.until) n.gesture = null;
        else {
          n.moving = false;
          this.faceTarget(n, n.gesture.face, dt);
          continue;
        }
      }
      this.runStep(n, dt, gdt);
    }
    this.state.logT += gdt;
    if (this.state.logT >= 15) {
      this.state.logT = 0;
      for (const n of this.state.list) {
        if (n.status === 'dead' || n.status === 'away') continue;
        n.log.push({ t: sim.now, zone: n.zone, act: n.task });
        if (n.log.length > 110) n.log.shift();
      }
    }
  }

  private needs(n: NpcState, gdt: number): void {
    if (n.anim === 'sleep') {
      n.fatigue = Math.max(0, n.fatigue - 0.21 * gdt);
    } else {
      const hard = n.goal.startsWith('crew') || n.goal.startsWith('haul') || n.goal.startsWith('repair') ? 1.5 : 1;
      const alert = this.sim.alert.level >= 2 ? 1.25 : 1;
      n.fatigue = Math.min(100, n.fatigue + 0.085 * gdt * hard * alert);
    }
    n.hunger = Math.min(100, n.hunger + 0.2 * gdt);
    if (n.status === 'wounded' && n.flags.treated && n.anim === 'lie') n.health = Math.min(100, n.health + 0.035 * gdt);
  }

  private faceTarget(n: NpcState, target: string | undefined, dt: number): void {
    if (!target) return;
    let tx: number;
    let tz: number;
    if (target === 'player') {
      tx = this.sim.player.x;
      tz = this.sim.player.z;
    } else {
      const o = this.byId(target);
      if (!o) return;
      tx = o.x;
      tz = o.z;
    }
    n.yaw = approachAngle(n.yaw, yawTo(tx - n.x, tz - n.z), 9 * dt);
  }

  /** Дальность, на которой NPC сейчас различает людей. */
  sightRange(n: NpcState): number {
    const sim = this.sim;
    if (sim.grid.indoorAt(n.x, n.z)) return sim.resources.state.power > 0 ? 16 : 4.5;
    const dark = sim.time.darkness();
    const lit = sim.resources.state.power > 0 && !sim.alert.state.blackout;
    const night = lit ? 11 : 6;
    return lerp(24, night, dark) * (0.35 + 0.65 * sim.weather.visibility());
  }

  private perceive(n: NpcState): void {
    const sim = this.sim;
    n.seen.length = 0;
    if (n.status !== 'active' || n.anim === 'sleep' || n.anim === 'sit_doze' || n.anim === 'doze') {
      n.flags.seesPlayer = false;
      return;
    }
    const R = this.sightRange(n);
    const fx = Math.sin(n.yaw);
    const fz = Math.cos(n.yaw);
    for (const o of this.state.list) {
      if (o === n || o.status === 'away' || o.status === 'leave') continue;
      const dx = o.x - n.x;
      const dz = o.z - n.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > R * R) continue;
      const d = Math.sqrt(d2);
      if (d > 3 && (dx * fx + dz * fz) / d < -0.25) continue;
      if (!sim.grid.los(n.x, n.z, o.x, o.z)) continue;
      n.seen.push(o.id);
      for (const h of this.hooks) h(n, o, d);
    }
    // командир
    const p = sim.player;
    const dp = dist(n.x, n.z, p.x, p.z);
    const sees = dp < R && sim.grid.los(n.x, n.z, p.x, p.z);
    n.flags.seesPlayer = sees;
    if (sees && dp < 5 && !n.hostile && sim.clock - n.lastSalute > 95 && !n.gesture && !n.carry && !n.run) {
      const calm = n.moving ? true : CALM_ANIMS.has(n.anim);
      const busyGoal = n.goal.startsWith('crew') || n.goal.startsWith('combat') || n.goal.startsWith('detained') || n.goal.startsWith('check');
      if (calm && !busyGoal && !p.busy) {
        n.lastSalute = sim.clock;
        this.gesture(n, 'salute', 1.7, 'player');
        if (sim.rng.chance(0.3)) this.speak(n, `${sim.address(true)}!`, true);
        sim.bus.emit('npc:salute', { id: n.id });
      }
    }
  }

  /** Случайные реплики между сослуживцами. */
  private bark(n: NpcState): void {
    if (!TALK_ANIMS.has(n.anim) || n.speech || !this.sim.rng.chance(0.035 * (0.5 + n.traits.talkative))) return;
    const near = n.seen.some((id) => {
      const o = this.byId(id);
      return o && dist(n.x, n.z, o.x, o.z) < 3.2 && TALK_ANIMS.has(o.anim);
    });
    if (!near) return;
    const sim = this.sim;
    const moods = new Set<string>(['any']);
    if (n.morale < 40) moods.add('low');
    if (n.morale > 70) moods.add('high');
    if (sim.weather.state.rain > 0.3) moods.add('rain');
    if (sim.time.isNight()) moods.add('night');
    if (sim.alert.level >= 1) moods.add('alert');
    if (n.memory.some((m) => m.kind === 'loss' && sim.now - m.t < 2880)) moods.add('loss');
    if (sim.artillery.state.lastFireT > 0 && sim.now - sim.artillery.state.lastFireT < 240) moods.add('fire');
    const pool = BARKS.filter((b) => moods.has(b.mood));
    const pick = sim.rng.weighted(pool, (b) => (b.mood === 'any' ? 1 : 2.5));
    if (pick) this.speak(n, pick.text, true);
  }

  // ------------------------------------------------------------------ выбор цели

  private think(n: NpcState): void {
    if (n.status === 'dead') return;
    const now = this.sim.clock;
    let best: GoalOption | null = null;
    let cur: GoalOption | null = null;
    for (const p of this.providers) {
      const o = p(n);
      if (!o) continue;
      const cd = n.cooldowns[o.key];
      if (cd !== undefined && cd > now) continue;
      if (o.key === n.goal) cur = o;
      if (!best || o.score > best.score) best = o;
    }
    if (!best) return;
    const unfinished = n.stepI < n.plan.length;
    if (cur && unfinished) {
      // гистерезис: текущую цель бросаем только ради заметно более важной
      if (best.key === cur.key || best.score < cur.score + 9) {
        n.goalScore = cur.score;
        return;
      }
    }
    this.setGoal(n, best);
  }

  setGoal(n: NpcState, o: GoalOption): void {
    this.abortGoal(n);
    n.goal = o.key;
    n.goalData = { ...(o.data ?? {}), abort: o.abort };
    n.goalScore = o.score;
    n.task = o.task;
    n.plan = o.plan();
    n.stepI = 0;
    n.stepT = 0;
    n.stepInit = false;
    if (!n.plan.length) n.plan = [{ k: 'do', anim: 'idle', dur: 1 }];
  }

  private abortGoal(n: NpcState): void {
    const ab = n.goalData?.abort;
    if (ab && n.stepI < n.plan.length) this.sim.calls[ab.fn]?.(n, ab.a);
    this.releaseSpot(n);
    n.anchor = null;
    n.path = null;
    n.moving = false;
    n.run = false;
    if (n.carry && !n.goal.startsWith('haul')) n.carry = null;
  }

  clearGoal(n: NpcState): void {
    this.abortGoal(n);
    n.goal = '';
    n.goalData = null;
    n.plan = [];
    n.stepI = 0;
    n.stepInit = false;
    n.brainT = 0;
  }

  /** План сорвался: цель на время исключается из выбора. */
  failPlan(n: NpcState, cooldown = 14): void {
    if (n.goal) n.cooldowns[n.goal] = this.sim.clock + cooldown;
    this.clearGoal(n);
    n.anim = 'idle';
  }

  // ------------------------------------------------------------------ исполнение шагов

  private nextStep(n: NpcState): void {
    n.stepI++;
    n.stepT = 0;
    n.stepInit = false;
    if (n.stepI >= n.plan.length) {
      n.brainT = 0;
      n.moving = false;
    }
  }

  private startPath(n: NpcState, x: number, z: number): boolean {
    const path = this.sim.path.find(n.x, n.z, x, z, this.sim.access.zoneCost(n));
    if (!path) return false;
    n.path = path;
    n.pathI = 0;
    return true;
  }

  /** Продвижение по пути. Возвращает true по прибытии. */
  private moveAlong(n: NpcState, dt: number, run: boolean): boolean | 'blocked' {
    const path = n.path;
    if (!path || n.pathI >= path.length) return true;
    let speed = run ? RUN_SPEED : WALK_SPEED;
    if (n.carry) speed *= run ? 0.6 : 0.85;
    if (n.status === 'wounded') speed *= 0.55;
    if (n.fatigue > 85) speed *= 0.88;
    let left = speed * dt;
    n.run = run;
    while (left > 0 && n.pathI < path.length) {
      const tx = path[n.pathI];
      const tz = path[n.pathI + 1];
      const dx = tx - n.x;
      const dz = tz - n.z;
      const d = Math.hypot(dx, dz);
      if (d < 1e-4) {
        n.pathI += 2;
        continue;
      }
      const step = Math.min(d, left);
      const nx = n.x + (dx / d) * step;
      const nz = n.z + (dz / d) * step;
      const gate = this.sim.guard.gate(n, nx, nz, dx, dz);
      if (gate === 'wait') {
        n.moving = false;
        n.anim = 'show_papers';
        return false;
      }
      if (gate === 'deny') return 'blocked';
      n.x = nx;
      n.z = nz;
      n.yaw = approachAngle(n.yaw, yawTo(dx, dz), 10 * dt);
      left -= step;
      if (step >= d - 1e-6) n.pathI += 2;
    }
    n.moving = true;
    n.zone = this.sim.grid.zoneAt(n.x, n.z);
    return n.pathI >= path.length;
  }

  private runStep(n: NpcState, dt: number, gdt: number): void {
    const step = n.plan[n.stepI];
    if (!step) {
      n.moving = false;
      return;
    }
    const sim = this.sim;
    switch (step.k) {
      case 'go': {
        if (!n.stepInit) {
          n.stepInit = true;
          n.anchor = null;
          if (step.spot && !this.reserve(n, step.spot)) {
            this.failPlan(n, 6);
            return;
          }
          if (dist(n.x, n.z, step.x, step.z) <= (step.tol ?? 0.3)) {
            this.nextStep(n);
            return;
          }
          if (!this.startPath(n, step.x, step.z)) {
            this.failPlan(n);
            return;
          }
        }
        const r = this.moveAlong(n, dt, !!step.run);
        if (r === 'blocked') {
          this.remember(n, 'check', 'Не пропустили через пост', 1);
          this.failPlan(n, 60);
        } else if (r || dist(n.x, n.z, step.x, step.z) <= (step.tol ?? 0.3)) {
          n.moving = false;
          this.nextStep(n);
        }
        break;
      }
      case 'do': {
        if (!n.stepInit) {
          n.stepInit = true;
          n.moving = false;
          n.anim = step.anim;
          const sp = step.spot ? this.spot(step.spot) : undefined;
          if (sp) {
            n.yaw = sp.yaw;
            if (sp.ax !== undefined) n.anchor = { x: sp.ax, z: sp.az!, y: sp.ay ?? 0, yaw: sp.yaw };
          }
          if (step.yaw !== undefined) n.yaw = step.yaw;
        }
        n.stepT += gdt;
        if (n.stepT >= step.dur) this.nextStep(n);
        break;
      }
      case 'follow': {
        const tgt = step.target === 'player' ? sim.player : this.byId(step.target);
        if (!tgt || (step.until !== undefined && sim.now > step.until)) {
          this.nextStep(n);
          return;
        }
        const d = dist(n.x, n.z, tgt.x, tgt.z);
        n.stepT += dt;
        if (d > step.dist) {
          if (!n.path || n.stepT > 0.6 || n.pathI >= n.path.length) {
            n.stepT = 0;
            if (!this.startPath(n, tgt.x, tgt.z)) {
              n.moving = false;
              return;
            }
          }
          const r = this.moveAlong(n, dt, !!step.run || d > 9);
          if (r === 'blocked') this.failPlan(n, 30);
        } else {
          n.moving = false;
          n.path = null;
          n.anim = 'attention';
          n.yaw = approachAngle(n.yaw, yawTo(tgt.x - n.x, tgt.z - n.z), 6 * dt);
        }
        break;
      }
      case 'station': {
        const pos = sim.crewAI.stationPos(step.gun, step.slot);
        const d = dist(n.x, n.z, pos.x, pos.z);
        if (d > 0.45) {
          n.stepT += dt;
          const direct = d < 7 && sim.grid.los(n.x, n.z, pos.x, pos.z);
          if (direct) {
            n.path = [pos.x, pos.z];
            n.pathI = 0;
          } else if (!n.path || n.stepT > 1.2 || n.pathI >= n.path.length) {
            n.stepT = 0;
            if (!this.startPath(n, pos.x, pos.z)) {
              this.failPlan(n, 8);
              return;
            }
          }
          this.moveAlong(n, dt, d > 3);
        } else {
          n.moving = false;
          n.path = null;
          n.anim = sim.crewAI.animFor(n, step.gun, step.slot);
          n.yaw = approachAngle(n.yaw, pos.yaw, 6 * dt);
        }
        break;
      }
      case 'say':
        this.speak(n, step.text, !!step.quiet);
        this.nextStep(n);
        break;
      case 'call': {
        const fn = sim.calls[step.fn];
        const goalBefore = n.goal;
        const idx = n.stepI;
        if (fn) fn(n, step.a);
        // вызов мог сменить цель или план
        if (n.goal === goalBefore && n.stepI === idx) this.nextStep(n);
        break;
      }
      case 'wait': {
        if (!n.stepInit) {
          n.stepInit = true;
          n.moving = false;
          if (step.anim) n.anim = step.anim;
        }
        n.stepT += gdt;
        const cond = sim.conds[step.cond];
        if ((cond && cond(n, step.a)) || n.stepT >= step.max) this.nextStep(n);
        break;
      }
    }
  }

  // ------------------------------------------------------------------ сохранение

  save(): unknown {
    return this.state;
  }

  load(d: any): void {
    this.state = d;
    this.index.clear();
    for (const n of this.state.list) this.index.set(n.id, n);
  }
}
