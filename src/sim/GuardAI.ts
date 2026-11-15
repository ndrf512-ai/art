/**
 * GuardAI — караульная служба: посты, смена караула, пропускной режим на КПП и
 * у секретного сектора. Постовой проверяет документы и пропускает, не пропускает
 * или задерживает — но не нападает на «подозрительных» без подтверждённой угрозы.
 */
import { dist } from '../core/math';
import type { GateDef, NpcState, Step } from '../core/types';
import { fullName } from './DocumentSystem';
import type { GoalOption } from './NPCSystem';
import type { Sim } from './Sim';

type Gate = GateDef & { kind: 'post' | 'lock' };

export class GuardAI {
  state = {
    holder: {} as Record<string, string>,
    assign: {} as Record<string, string>,
    assignT: -1,
    journal: [] as { t: number; text: string }[],
    gateBusy: {} as Record<string, { npc: string; until: number } | null>,
  };

  constructor(private sim: Sim) {
    sim.calls['guard.arrive'] = (n, post) => this.arrive(n, post);
    sim.calls['guard.inspectPost'] = (n, post) => this.inspectPost(n, post);
  }

  reset(): void {
    this.state = { holder: {}, assign: {}, assignT: -1, journal: [], gateBusy: {} };
  }

  log(text: string): void {
    this.state.journal.push({ t: this.sim.now, text });
    if (this.state.journal.length > 90) this.state.journal.shift();
  }

  isDay(): boolean {
    const m = this.sim.time.minuteOfDay;
    return m >= 360 && m < 1080;
  }

  /** Перечень постов, которые должны быть заняты сейчас. */
  requiredPosts(): string[] {
    const alert = this.sim.alert.level;
    const posts = this.isDay() ? ['post_kpp_1', 'post_secret_1', 'post_tower_1'] : ['post_kpp_1', 'post_secret_1', 'post_kpp_2', 'post_tower_1', 'post_hangar_1'];
    const g1 = this.sim.artillery.gun('gun1');
    if (g1 && g1.deploy > 0.05 && !posts.includes('post_hangar_1')) posts.push('post_hangar_1');
    if (alert >= 1) posts.push('post_portal_1');
    if (alert >= 2) posts.push('post_ammo_1', 'post_cc_1', 'post_tower_2', 'post_tower_3');
    return posts;
  }

  /** Караульные, свободные от постов и патрулей (резерв). */
  reserve(): NpcState[] {
    this.refresh();
    return this.sim.npcs.list.filter((n) => n.unit === 'guard' && n.role !== 'guard_sgt' && n.status === 'active' && this.state.assign[n.id] === 'reserve');
  }

  private available(n: NpcState): boolean {
    if (n.status !== 'active' || n.role !== 'guard') return false;
    if (this.sim.patrols.memberOf(n.id)) return false;
    if (n.goal.startsWith('order') || n.goal.startsWith('detain') || n.goal.startsWith('escort')) return false;
    if (this.sim.alert.level >= 2) return n.fatigue < 96;
    return n.shift === (this.isDay() ? 'day' : 'night');
  }

  private refresh(): void {
    const sim = this.sim;
    if (sim.clock - this.state.assignT < 3 && this.state.assignT >= 0) return;
    this.state.assignT = sim.clock;
    const posts = this.requiredPosts();
    const pool = sim.npcs.list.filter((n) => this.available(n));
    const assign: Record<string, string> = {};
    const taken = new Set<string>();
    // тот, кто уже стоит на посту, на нём и остаётся
    for (const p of posts) {
      const h = this.state.holder[p];
      const g = h ? pool.find((n) => n.id === h) : undefined;
      if (g && !taken.has(g.id)) {
        assign[g.id] = 'post:' + p;
        taken.add(g.id);
      }
    }
    for (const p of posts) {
      if (Object.values(assign).includes('post:' + p)) continue;
      const g = pool.find((n) => !taken.has(n.id));
      if (!g) break;
      assign[g.id] = 'post:' + p;
      taken.add(g.id);
    }
    for (const n of pool) if (!taken.has(n.id)) assign[n.id] = 'reserve';
    this.state.assign = assign;
  }

  /** Часовой, реально находящийся на посту и бодрствующий. */
  sentryAt(postSpot: string): NpcState | null {
    const id = this.state.holder[postSpot];
    const n = id ? this.sim.npcs.byId(id) : undefined;
    const sp = this.sim.layout.spotById[postSpot];
    if (!n || !sp || n.status !== 'active' || n.flags.dozing) return null;
    if (!n.goal.startsWith('post:') || dist(n.x, n.z, sp.x, sp.z) > 3) return null;
    return n;
  }

  option(n: NpcState): GoalOption | null {
    if (n.unit !== 'guard' || n.role !== 'guard' || n.status !== 'active') return null;
    this.refresh();
    const sim = this.sim;
    let a = this.state.assign[n.id];
    // сменяемый часовой не уходит, пока не подошла смена
    if (!a || a === 'reserve') {
      for (const [post, holder] of Object.entries(this.state.holder)) {
        if (holder !== n.id) continue;
        const reliefId = Object.keys(this.state.assign).find((id) => this.state.assign[id] === 'post:' + post);
        const relief = reliefId ? sim.npcs.byId(reliefId) : undefined;
        const sp = sim.layout.spotById[post];
        if (relief && sp && dist(relief.x, relief.z, sp.x, sp.z) > 3 && this.requiredPosts().includes(post)) a = 'post:' + post;
        else if (!relief || !this.requiredPosts().includes(post)) delete this.state.holder[post];
      }
    }
    if (!a || !a.startsWith('post:')) return null;
    const post = a.slice(5);
    const sp = sim.layout.spotById[post];
    if (!sp) return null;
    return {
      key: a,
      score: 60,
      task: `На посту: ${this.postName(post)}`,
      plan: () => {
        const steps: Step[] = [
          { k: 'go', x: sp.x, z: sp.z, tol: 0.4 },
          { k: 'call', fn: 'guard.arrive', a: post },
        ];
        const tired = sim.time.isNight() && n.discipline < 58 && n.fatigue > 55 && sim.alert.level === 0;
        if (tired && sim.rng.chance(0.14)) {
          n.flags.dozing = true;
          steps.push({ k: 'do', anim: 'doze', dur: 14, spot: post });
        } else {
          n.flags.dozing = false;
          steps.push({ k: 'do', anim: post.includes('tower') ? 'binoculars' : 'guard', dur: sim.rng.range(8, 14), spot: post });
        }
        return steps;
      },
    };
  }

  postName(post: string): string {
    if (post.startsWith('post_kpp')) return 'КПП';
    if (post.startsWith('post_secret')) return 'вход в секретный сектор';
    if (post.startsWith('post_tower')) return 'наблюдательная вышка';
    if (post.startsWith('post_hangar')) return 'ворота ангара';
    if (post.startsWith('post_portal')) return 'главный портал';
    if (post.startsWith('post_ammo')) return 'снарядный портал';
    if (post.startsWith('post_cc')) return 'командный центр';
    return post;
  }

  private arrive(n: NpcState, post: string): void {
    const sim = this.sim;
    const prevId = this.state.holder[post];
    if (prevId && prevId !== n.id) {
      const prev = sim.npcs.byId(prevId);
      if (prev && prev.status === 'active' && dist(prev.x, prev.z, n.x, n.z) < 5) {
        // смена караула
        sim.npcs.gesture(prev, 'salute', 1.8, n.id);
        sim.npcs.gesture(n, 'salute', 1.8, prev.id);
        sim.npcs.speak(prev, 'Пост сдал.', true);
        sim.npcs.speak(n, 'Пост принял.', true);
        prev.flags.dozing = false;
        sim.npcs.clearGoal(prev);
      }
    }
    this.state.holder[post] = n.id;
  }

  private inspectPost(inspector: NpcState, post: string): void {
    const sim = this.sim;
    const id = this.state.holder[post];
    const h = id ? sim.npcs.byId(id) : undefined;
    if (!h || dist(h.x, h.z, inspector.x, inspector.z) > 6) return;
    if (h.flags.dozing) {
      h.flags.dozing = false;
      sim.npcs.speak(inspector, 'Спать на посту?! Доложу командиру.', true);
      sim.npcs.clearGoal(h);
      sim.relations.offence(h, 'сон на посту', inspector);
    }
  }

  // ------------------------------------------------------------------ пропускной режим

  /** Вызывается при движении NPC: можно ли пройти через пост пропуска. */
  gate(npc: NpcState, nx: number, nz: number, dx: number, dz: number): 'pass' | 'wait' | 'deny' {
    const gates = this.sim.layout.gates as Gate[];
    for (const g of gates) {
      if (nx < g.x0 || nx >= g.x1 + 1 || nz < g.z0 || nz >= g.z1 + 1) continue;
      if ((g.inside.x - nx) * dx + (g.inside.z - nz) * dz <= 0) continue;
      const r = this.checkGate(npc, g);
      if (r !== 'pass') return r;
    }
    return 'pass';
  }

  private checkGate(npc: NpcState, g: Gate): 'pass' | 'wait' | 'deny' {
    const sim = this.sim;
    const now = sim.now;
    if (npc.hostile || npc.flags.escorted) return 'pass';
    const last = npc.passes[g.id];
    if (last !== undefined && now - last < 25) return 'pass';
    if (g.kind === 'lock') {
      if (sim.access.canEnter(npc, g.protects)) {
        npc.passes[g.id] = now;
        return 'pass';
      }
      return 'deny';
    }
    const sentry = this.sentryAt(g.postSpot);
    if (!sentry || sentry.id === npc.id) {
      npc.passes[g.id] = now;
      return 'pass';
    }
    if (npc.unit === 'guard' && sim.schedule.onDuty(npc)) {
      npc.passes[g.id] = now;
      return 'pass';
    }
    const busy = this.state.gateBusy[g.id];
    if (busy && busy.npc !== npc.id) {
      if (sim.clock > busy.until + 6) this.state.gateBusy[g.id] = null;
      return 'wait';
    }
    if (!busy) {
      const thorough = sim.alert.level >= 1 || g.id === 'secret' || npc.unit === 'external';
      const t = thorough ? 3.6 : 1.9;
      this.state.gateBusy[g.id] = { npc: npc.id, until: sim.clock + t };
      sim.npcs.gesture(sentry, 'check_docs', t, npc.id);
      if (sim.rng.chance(0.3)) sim.npcs.speak(sentry, 'Пропуск.', true);
      return 'wait';
    }
    if (sim.clock < busy.until) return 'wait';
    this.state.gateBusy[g.id] = null;
    return this.resolve(npc, g, sentry);
  }

  private resolve(npc: NpcState, g: Gate, sentry: NpcState): 'pass' | 'deny' {
    const sim = this.sim;
    const zoneOk = sim.access.canEnter(npc, g.protects);
    const thorough = sim.alert.level >= 1 || g.id === 'secret' || npc.unit === 'external';
    const v = sim.docs.verify(npc, sentry, thorough);
    npc.lastCheck = sim.now;
    sim.bus.emit('doc:checked', { checker: sentry.id, target: npc.id, ok: v.ok && zoneOk, issues: v.issues, zone: g.protects });
    if (!v.ok) {
      sim.ci.detain(npc, sentry, v.issues, g.name);
      return 'deny';
    }
    if (!zoneOk) {
      const text = `${g.name}: ${fullName(npc)} не пропущен — нет допуска.`;
      this.log(text);
      sim.ci.addEvidence(npc.id, 'access', `Пытался пройти через «${g.name}» без допуска`, fullName(sentry), 1);
      sim.npcs.speak(sentry, 'Допуска нет. Назад.', true);
      return 'deny';
    }
    npc.passes[g.id] = sim.now;
    if (sim.alert.level >= 1 || npc.unit === 'external') this.log(`${g.name}: ${fullName(npc)} пропущен.`);
    return 'pass';
  }

  save(): unknown {
    return this.state;
  }

  load(d: any): void {
    this.state = d;
    this.state.assignT = -1;
  }
}
