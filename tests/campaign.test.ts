import { describe, expect, it } from 'vitest';
import { COMPLEX_POS } from '../src/core/constants';
import { Sim } from '../src/sim/Sim';

/** Шаг мира на N игровых минут. */
function run(sim: Sim, minutes: number, dt = 0.1): void {
  const steps = Math.round((minutes * 2) / dt);
  for (let i = 0; i < steps; i++) sim.update(dt);
}

function snapshot(sim: Sim): string {
  return JSON.stringify({
    t: sim.now,
    npcs: sim.npcs.list.map((n) => [n.id, Math.round(n.x * 100), Math.round(n.z * 100), n.goal, n.status]),
    ammo: sim.resources.res.ammo,
    alert: sim.alert.level,
    rng: sim.rng.s,
  });
}

describe('сохранение', () => {
  it('после загрузки мир продолжается точно так же', () => {
    const sim = new Sim(11);
    sim.newGame({ seed: 11, gender: 'f' });
    run(sim, 200);
    const save = sim.serialize();
    run(sim, 90);
    const a = snapshot(sim);
    const sim2 = new Sim(1);
    sim2.deserialize(save);
    expect(sim2.player.gender).toBe('f');
    run(sim2, 90);
    expect(snapshot(sim2)).toBe(a);
  }, 120000);
});

describe('кампания целиком', () => {
  it('пять глав проходятся без сбоев, кампания завершается', () => {
    const sim = new Sim(5);
    sim.newGame({ seed: 5, gender: 'm' });
    const log: string[] = [];
    const chapters: string[] = [];
    let ending: { outcome: string; title: string; text: string[] } | null = null;
    sim.bus.on('mission:chapter', ({ title }) => chapters.push(`${sim.time.stamp()} ${title}`));
    sim.bus.on('campaign:ended', (e) => (ending = e));
    sim.bus.on('radio:message', ({ msg }) => log.push(`${sim.time.stamp()} [${msg.priority}] ${msg.from}: ${msg.subject}`));
    sim.bus.on('arty:report', ({ text }) => log.push(`${sim.time.stamp()}   ${text}`));
    const p = sim.player;
    const goTo = (x: number, z: number) => {
      p.x = x;
      p.z = z;
      p.zone = sim.grid.zoneAt(x, z);
      p.indoor = sim.grid.indoorAt(x, z);
    };

    // ---- Глава I: командир проходит КПП, знакомится с офицерами, осматривает установку
    goTo(57.5, 64.5);
    run(sim, 30);
    goTo(67.5, 31.5);
    for (const role of ['adjutant', 'battery_cmd', 'security_chief', 'ci_officer'] as const) {
      const n = sim.npcs.first(role)!;
      const v = sim.dialogue.open(n.id)!;
      expect(v.options.length).toBeGreaterThan(2);
      sim.dialogue.choose('report');
      sim.dialogue.close();
    }
    goTo(124.5, 48);
    run(sim, 2);
    const sentry = sim.npcs.list.find((n) => n.goal.startsWith('post:'))!;
    sim.dialogue.open(sentry.id);
    sim.dialogue.choose('report');
    sim.dialogue.close();
    goTo(66, 35);
    run(sim, 3);
    expect(sim.missions.state.chapterId).toBe('first_fire');

    // ---- Глава II: пристрелка по понтонному парку с поправками по докладам наблюдателя
    run(sim, 15);
    const intelId = sim.missions.state.flags.pontoon_intel as string;
    const rep = sim.recon.byId(intelId)!;
    expect(rep).toBeTruthy();
    let m = sim.artillery.order({ kind: 'single', guns: ['gun2'], tx: rep.x, ty: rep.y, targetName: 'понтонный парк', intelId, shell: 'he21', rounds: 1 });
    expect(typeof m).not.toBe('string');
    const unit = sim.enemy.byId(sim.missions.state.flags.pontoon_unit as string)!;
    for (let attempt = 0; attempt < 10 && !sim.missions.state.flags.pontoon_destroyed; attempt++) {
      run(sim, 12);
      if (typeof m === 'string') break;
      // командир читает доклад: недолёт/перелёт и отклонение — и вводит поправку
      const last = [...m.reports].reverse().find((r) => r.includes('разрыв'));
      const along = last?.match(/(недолёт|перелёт) (\d+)/);
      const cross = last?.match(/(вправо|влево) (\d+)/);
      const range = Math.hypot(m.tx - COMPLEX_POS.x, m.ty - COMPLEX_POS.y);
      const dR = along ? (along[1] === 'недолёт' ? 1 : -1) * Number(along[2]) : 0;
      const dAz = cross ? Math.round(((cross[1] === 'вправо' ? -1 : 1) * Number(cross[2])) / ((range * 2 * Math.PI) / 6000)) : 0;
      sim.artillery.correct(m.id, dR, dAz);
      sim.artillery.repeat(m.id, attempt >= 2 ? 4 : 1);
    }
    run(sim, 40);
    // тест не должен зависеть от удачи: если парк уцелел — добиваем по истинному положению
    for (let k = 0; k < 8 && !sim.missions.state.flags.pontoon_destroyed; k++) {
      sim.artillery.order({ kind: 'series', guns: ['gun2', 'gun3'], tx: unit.x, ty: unit.y, targetName: 'понтонный парк', intelId, shell: 'he21', rounds: 8 });
      run(sim, 45);
    }
    console.log('понтонный парк:', unit.alive ? `цел (${Math.round(unit.strength)}%)` : 'уничтожен', 'выпущено:', sim.artillery.state.totalShots);
    run(sim, 30);

    // ---- Глава III: агент на объекте. Ночной патруль, ожидание диверсии, улики, арест
    expect(sim.missions.state.chapterId === 'shadows' || sim.missions.state.chapter >= 2).toBe(true);
    const sgt = sim.npcs.first('guard_sgt')!;
    sim.dialogue.open(sgt.id);
    sim.dialogue.choose('m:orders');
    sim.dialogue.choose('m:sector');
    const view = sim.dialogue.choose('sector:east')!;
    console.log('сержант:', view?.text);
    sim.dialogue.close();
    // ждём, пока агент себя проявит (до двух суток)
    for (let i = 0; i < 48 && !sim.missions.state.flags.sabotage_discovered; i++) run(sim, 60);
    const agent = sim.spy.state.agents[0];
    console.log('диверсия обнаружена:', !!sim.missions.state.flags.sabotage_discovered, 'агент действовал раз:', agent?.count);
    // командир осматривает место и собирает материал на подозреваемого
    for (const s of sim.sabotage.state.list) sim.sabotage.inspect(s.target);
    const spyId = agent?.id;
    if (spyId) {
      const spy = sim.npcs.byId(spyId)!;
      sim.dialogue.open(spyId);
      sim.dialogue.choose('doc');
      sim.dialogue.close();
      for (const w of sim.npcs.list.filter((n) => n.sightings.length).slice(0, 6)) sim.ci.testimony(w);
      sim.ci.surveillance(spyId, true);
      run(sim, 600);
      console.log('улик против агента:', sim.ci.evidenceFor(spyId).length, 'оценка:', sim.ci.score(spyId).toFixed(1), sim.ci.opinion(spyId));
      if (!sim.missions.state.flags.spy_caught && spy.status !== 'arrested') sim.ci.handOver(spyId);
      run(sim, 260);
    }
    // если глава всё ещё идёт — дотягиваем время до её завершения
    for (let i = 0; i < 40 && sim.missions.state.chapter < 3 && !sim.missions.state.ended; i++) run(sim, 60);

    // ---- Глава IV: воздушная тревога, секретный пакет, удар спецснарядом
    if (!sim.missions.state.ended) {
      expect(sim.missions.state.chapter).toBeGreaterThanOrEqual(3);
      sim.alert.state.blackout = true;
      for (let i = 0; i < 20; i++) {
        run(sim, 30);
        const v = sim.events.waitingVisitor();
        if (v) sim.events.decideVisitor(v.id, true);
        const courier = sim.npcs.list.find((n) => n.role === 'courier' && n.status === 'active');
        if (courier) goTo(courier.x, courier.z - 1.5);
        if (sim.missions.state.flags.secret_order) break;
      }
      console.log('секретный приказ получен:', !!sim.missions.state.flags.secret_order);
      sim.artillery.setDeploy(true);
      run(sim, 60);
      const hq = sim.enemy.alive('hq')[0];
      if (hq && sim.artillery.gun('gun1').deploy >= 1) {
        const r = sim.artillery.order({ kind: 'series', guns: ['gun1'], tx: hq.x, ty: hq.y, targetName: 'штаб дивизии', intelId: (sim.missions.state.flags.hq_intel as string) ?? null, shell: 'sp38', rounds: 3 });
        console.log('удар «Конрада»:', typeof r === 'string' ? r : 'приказ принят');
        run(sim, 120);
        if (hq.alive) {
          sim.artillery.order({ kind: 'series', guns: ['gun1'], tx: hq.x, ty: hq.y, targetName: 'штаб дивизии', intelId: null, shell: 'he38', rounds: 4 });
          run(sim, 150);
        }
      }
      console.log('штаб противника:', hq?.alive ? 'уцелел' : 'уничтожен');
      sim.artillery.setDeploy(false);
      for (let i = 0; i < 50 && sim.missions.state.chapter < 4 && !sim.missions.state.ended; i++) run(sim, 60);
    }

    // ---- Глава V: сутки обороны — батарея поддерживает пехоту по донесениям
    for (let i = 0; i < 36 && !sim.missions.state.ended; i++) {
      const urgent = sim.events.state.urgent;
      if (urgent) {
        const r = sim.recon.byId(urgent.intel);
        if (r) sim.artillery.order({ kind: 'raid', guns: ['gun2', 'gun3'], tx: r.x, ty: r.y, targetName: 'по заявке пехоты', intelId: r.id, shell: 'he21', rounds: 6 });
      }
      if (sim.resources.ammo('he21') < 30 && !sim.supply.activeRequest()) sim.supply.request({ he21: 40, food: 300, fuel: 800 }, true, true);
      run(sim, 60);
    }

    console.log('ГЛАВЫ:\n' + chapters.join('\n'));
    console.log('ЖУРНАЛ (выборка):\n' + log.filter((l) => !l.includes('Освобождён')).slice(0, 70).join('\n'));
    const e = ending as { outcome: string; title: string; text: string[] } | null;
    console.log('ИТОГ:', e ? `${e.title}\n${e.text.join('\n')}` : 'кампания не закончилась', 'день', sim.time.day, sim.time.clockString());
    console.log('потери:', sim.combat.state.losses.map((l) => l.name + ' — ' + l.cause).join('; '));

    expect(chapters.length).toBeGreaterThanOrEqual(4);
    expect(e).not.toBeNull();
    for (const n of sim.npcs.list) {
      expect(Number.isFinite(n.x) && Number.isFinite(n.z)).toBe(true);
      expect(n.health).toBeGreaterThanOrEqual(0);
    }
    // сохранение в конце кампании тоже работает
    const s = sim.serialize();
    expect(JSON.stringify(s).length).toBeGreaterThan(1000);
  }, 600000);
});
