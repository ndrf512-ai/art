/**
 * CommandSystem — приказы командира. Приказ отдаётся конкретному человеку
 * (лично или по телефону); исполнитель сам решает, как его выполнить, а сержанты
 * сами подбирают бойцов. Активные приказы видны в интерфейсе.
 */
import type { NpcState, Order, OrderStatus, Step } from '../core/types';
import { fullName } from './DocumentSystem';
import type { GoalOption } from './NPCSystem';
import type { Sim } from './Sim';

export class CommandSystem {
  state = { orders: [] as Order[], seq: 0 };

  constructor(private sim: Sim) {
    sim.calls['order.done'] = (_n, id) => this.set(id, 'done');
    sim.bus.on('arty:mission', ({ mission }) => {
      for (const o of this.state.orders) {
        if (o.type === 'fire' && o.data?.mission === mission.id && o.status === 'active' && mission.status !== 'active') this.set(o.id, mission.status === 'done' ? 'done' : 'cancelled');
      }
    });
  }

  reset(): void {
    this.state = { orders: [], seq: 0 };
  }

  get orders(): Order[] {
    return this.state.orders;
  }

  active(): Order[] {
    return this.state.orders.filter((o) => o.status === 'active' || o.status === 'issued');
  }

  issue(type: string, to: NpcState | null, text: string, data: any = {}, hours = 0): Order {
    const sim = this.sim;
    const o: Order = { id: 'o' + ++this.state.seq, t: sim.now, type, text, to: to?.id ?? '', executors: to ? [to.id] : [], status: 'active', data, expires: hours ? sim.now + hours * 60 : 0 };
    this.state.orders.push(o);
    if (this.state.orders.length > 60) this.state.orders.shift();
    if (to) {
      sim.npcs.remember(to, 'order', text, 1);
      sim.npcs.clearGoal(to);
    }
    sim.bus.emit('order:issued', { order: o });
    return o;
  }

  set(id: string, status: OrderStatus, note?: string): void {
    const o = this.state.orders.find((x) => x.id === id);
    if (!o || o.status === status) return;
    o.status = status;
    if (note) o.note = note;
    this.sim.bus.emit('order:updated', { order: o });
    for (const e of o.executors) {
      const n = this.sim.npcs.byId(e);
      if (n && n.goal.startsWith('order:')) this.sim.npcs.clearGoal(n);
    }
  }

  /** Отменить личные приказы человеку («Свободны»). */
  dismiss(n: NpcState): void {
    for (const o of this.active()) if (o.executors.includes(n.id) && (o.type === 'follow' || o.type === 'hold' || o.type === 'goto')) this.set(o.id, 'cancelled');
  }

  following(n: NpcState): boolean {
    return this.active().some((o) => o.type === 'follow' && o.executors.includes(n.id));
  }

  option(n: NpcState): GoalOption | null {
    if (n.status !== 'active') return null;
    const sim = this.sim;
    for (const o of this.state.orders) {
      if (o.status !== 'active' || !o.executors.includes(n.id)) continue;
      if (o.type === 'follow') {
        return { key: `order:${o.id}`, score: 78, task: 'Сопровождает командира', plan: () => [{ k: 'follow', target: 'player', dist: 2.4, until: sim.now + 30 }] };
      }
      if (o.type === 'hold') {
        return { key: `order:${o.id}`, score: 78, task: 'Ждёт на месте по приказу', plan: () => [{ k: 'go', x: o.data.x, z: o.data.z, tol: 0.8 }, { k: 'do', anim: n.armed ? 'guard' : 'attention', dur: 10 }] };
      }
      if (o.type === 'goto') {
        return {
          key: `order:${o.id}`,
          score: 78,
          task: o.text,
          plan: () => {
            const steps: Step[] = [{ k: 'go', x: o.data.x, z: o.data.z, tol: 0.9, run: !!o.data.run }, { k: 'do', anim: 'attention', dur: o.data.wait ?? 3 }, { k: 'call', fn: 'order.done', a: o.id }];
            return steps;
          },
        };
      }
    }
    return null;
  }

  update(): void {
    const now = this.sim.now;
    for (const o of this.state.orders) {
      if (o.status === 'active' && o.expires && now > o.expires) this.set(o.id, 'done');
    }
  }

  /** Короткое описание для HUD. */
  summary(o: Order): string {
    const to = o.to ? this.sim.npcs.byId(o.to) : null;
    return `${o.text}${to ? ` — ${fullName(to)}` : ''}`;
  }

  save(): unknown {
    return this.state;
  }

  load(d: any): void {
    this.state = d;
  }
}
