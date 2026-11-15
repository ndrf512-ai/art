import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/Sim';

function run(sim: Sim, gameMinutes: number, dt = 0.1): void {
  const steps = Math.round((gameMinutes * 2) / dt);
  for (let i = 0; i < steps; i++) sim.update(dt);
}

describe('симуляция мира', () => {
  it('гарнизон живёт двое суток без сбоев', () => {
    const sim = new Sim(7);
    sim.newGame({ seed: 7 });
    const notes: string[] = [];
    sim.bus.on('notify', (n) => notes.push(`${sim.time.stamp()} ${n.text}`));
    sim.bus.on('radio:message', ({ msg }) => notes.push(`${sim.time.stamp()} [радио] ${msg.from}: ${msg.subject}${msg.kind === 'detain' ? ' — ' + msg.body : ''}`));
    expect(sim.npcs.list.length).toBe(50);

    // 05:50 — построение
    run(sim, 15);
    const inFormation = sim.npcs.list.filter((n) => n.goal === 'formation').length;
    console.log('05:55 в строю:', inFormation);
    expect(inFormation).toBeGreaterThan(20);

    // 06:30 — завтрак
    run(sim, 35);
    const eating = sim.npcs.list.filter((n) => n.goal === 'meal').length;
    console.log('06:30 в столовой:', eating);
    expect(eating).toBeGreaterThan(15);

    // 10:00 — служба
    run(sim, 210);
    const goals: Record<string, number> = {};
    for (const n of sim.npcs.list) {
      const k = n.goal.split(':')[0] || '(нет)';
      goals[k] = (goals[k] ?? 0) + 1;
    }
    console.log('10:00 цели:', JSON.stringify(goals));
    const posts = sim.npcs.list.filter((n) => n.goal.startsWith('post:')).map((n) => n.goal);
    console.log('посты:', posts.join(', '));
    expect(posts.length).toBeGreaterThanOrEqual(3);
    expect(sim.npcs.list.filter((n) => n.goal.startsWith('patrol:')).length).toBe(2);

    // до 03:00 следующих суток — ночь
    run(sim, 17 * 60);
    const asleep = sim.npcs.list.filter((n) => n.anim === 'sleep').length;
    console.log(sim.time.stamp(), 'спят:', asleep, 'посты:', sim.npcs.list.filter((n) => n.goal.startsWith('post:')).length);
    expect(asleep).toBeGreaterThan(20);

    run(sim, 27 * 60);
    console.log(sim.time.stamp(), 'поисков пути:', sim.path.searches);
    console.log(notes.slice(0, 40).join('\n'));
    const spy = sim.npcs.byId(sim.spy.state.agents[0]?.id ?? '');
    console.log('агент:', spy?.role, spy?.last, 'актов:', sim.spy.state.agents[0]?.count, 'улик по нему:', sim.ci.evidenceFor(spy?.id ?? '').length, 'intel противника:', Math.round(sim.enemy.state.intel), 'фронт:', JSON.stringify(sim.enemy.state.front));
    const stuck = sim.npcs.list.filter((n) => n.status === 'active' && !n.goal);
    expect(stuck.length).toBeLessThan(3);
    for (const n of sim.npcs.list) {
      expect(Number.isFinite(n.x) && Number.isFinite(n.z), n.id).toBe(true);
      if (n.status === 'active') expect(sim.grid.open(Math.floor(n.x), Math.floor(n.z)), `${n.id} ${n.role} в стене (${n.x.toFixed(1)}, ${n.z.toFixed(1)})`).toBe(true);
    }
  }, 120000);
});
