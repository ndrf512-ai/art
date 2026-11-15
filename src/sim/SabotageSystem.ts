/**
 * SabotageSystem — диверсии. Заложенное срабатывает не сразу: командир нередко
 * сначала видит последствия (погас свет, снаряды ложатся с перелётом) и лишь потом
 * выясняет причину. На месте остаются следы, по которым можно сузить круг подозреваемых.
 */
import type { EquipmentId, NpcState, Sabotage } from '../core/types';
import { fullName } from './DocumentSystem';
import type { Sim } from './Sim';
import { WorldTimeSystem } from './WorldTimeSystem';

type Target = Sabotage['target'];

const DESCR: Partial<Record<Target, string>> = {
  generator: 'в масло подсыпан песок, топливопровод надрезан',
  generator2: 'перерезан привод регулятора, в топливо залита вода',
  radio: 'выведены из строя лампы передатчика, перебиты провода питания',
  switchboard: 'перерезаны кабели в коммутаторе',
  truck1: 'надпилены тормозные трубки',
  truck2: 'надпилены тормозные трубки',
  hoist: 'надпилен трос подъёмника',
  gun2: 'сбита выверка прицела',
  gun3: 'сбита выверка прицела',
  gun1: 'сбита выверка прицельных приспособлений',
};

export const TARGET_NAMES: Record<string, string> = {
  generator: 'генераторная',
  generator2: 'генераторная',
  radio: 'радиостанция',
  switchboard: 'командный центр',
  truck1: 'автопарк',
  truck2: 'автопарк',
  hoist: 'ангар',
  gun1: 'ангар',
  gun2: 'огневая позиция',
  gun3: 'огневая позиция',
  ammo: 'склад боеприпасов №1',
  food: 'склад продовольствия',
  fuel: 'склад топлива',
  archive: 'архив',
};

export class SabotageSystem {
  state = { list: [] as Sabotage[], seq: 0, fires: [] as { id: string; x: number; z: number; until: number }[] };

  constructor(private sim: Sim) {}

  reset(): void {
    this.state = { list: [], seq: 0, fires: [] };
  }

  targetPos(t: string): { x: number; z: number } {
    const L = this.sim.layout;
    if (t === 'ammo') return L.byTag('ammo_pick')[1];
    if (t === 'food') return L.byTag('food_stack')[0];
    if (t === 'fuel') return L.byTag('fuel_pump')[0];
    if (t === 'gun2' || t === 'gun3') {
      const g = this.sim.artillery.gun(t);
      return this.sim.grid.nearestWalkable(g.x - 1.4, g.z - 1.2, 4) ?? { x: g.x, z: g.z - 3 };
    }
    const e = this.sim.repair.get(t as EquipmentId);
    return e ? { x: e.x, z: e.z } : L.points.shelter1;
  }

  /** Выбор цели диверсии: что доступно агенту и чем ещё не занимались. */
  pickTarget(agent: NpcState): Target {
    const sim = this.sim;
    const busy = new Set(this.state.list.filter((s) => !s.triggered && !s.defused).map((s) => s.target));
    const opts: [Target, number][] = [
      ['radio', agent.doc.zones.includes('staff') ? 4 : 1.5],
      ['switchboard', agent.doc.zones.includes('staff') ? 2.5 : 0.8],
      ['generator', 2],
      ['gun2', 2],
      ['gun3', 2],
      ['hoist', agent.doc.zones.includes('secret') ? 3 : 0],
      ['ammo', agent.doc.zones.includes('arty') ? 2 : 0.6],
      ['food', agent.doc.zones.includes('supply') ? 2.5 : 0.8],
      ['fuel', 1.5],
      ['truck1', 1.2],
    ];
    const pick = sim.rng.weighted(
      opts.filter(([t]) => !busy.has(t) && !(sim.repair.state.eq[t as EquipmentId]?.broken ?? false)),
      (o) => o[1],
    );
    return pick ? pick[0] : 'fuel';
  }

  /** Следы на месте: по ним сужается круг подозреваемых. */
  leaveTraces(place: string, culprit: NpcState): string[] {
    const sim = this.sim;
    const ids: string[] = [];
    const rng = sim.rng;
    if (culprit.traits.smokes && rng.chance(0.55)) ids.push(sim.ci.addClue(place, `Раздавленный окурок сигареты ${culprit.traits.smokes}.`, 'smokes', culprit.traits.smokes).id);
    if (rng.chance(0.6)) ids.push(sim.ci.addClue(place, `Чёткий след сапога в пыли, размер ${culprit.traits.boot}.`, 'boot', culprit.traits.boot).id);
    if (culprit.traits.leftHanded && rng.chance(0.6)) ids.push(sim.ci.addClue(place, 'Судя по следам инструмента, работал левша.', 'leftHanded', true).id);
    if (!ids.length) ids.push(sim.ci.addClue(place, `Чёткий след сапога в пыли, размер ${culprit.traits.boot}.`, 'boot', culprit.traits.boot).id);
    return ids;
  }

  plant(target: Target, culprit: NpcState): void {
    const sim = this.sim;
    const s: Sabotage = {
      id: 'sb' + ++this.state.seq,
      target,
      culprit: culprit.id,
      plantedAt: sim.now,
      triggerAt: sim.now + sim.rng.range(70, 240),
      triggered: false,
      discovered: false,
      defused: false,
      clueIds: this.leaveTraces(target, culprit),
    };
    this.state.list.push(s);
  }

  /** Заключение механика при диагностике. */
  describe(id: EquipmentId): string {
    const s = this.state.list.find((x) => x.target === id && x.triggered && !x.discovered) ?? this.state.list.find((x) => x.target === id);
    const when = s ? ` Судя по состоянию, вмешательство было около ${WorldTimeSystem.clock(s.plantedAt)}.` : '';
    return `Следы умышленного повреждения: ${DESCR[id] ?? 'повреждены узлы'}.${when}`;
  }

  /** Диверсия раскрыта (механиком или командиром при осмотре). */
  discovered(target: Target, by?: NpcState): void {
    const sim = this.sim;
    for (const s of this.state.list) {
      if (s.target !== target || s.discovered) continue;
      s.discovered = true;
      sim.ci.addClue(target, `Вмешательство произошло около ${WorldTimeSystem.clock(s.plantedAt)} (${Math.floor(s.plantedAt / 1440) + 1}-й день).`, 'time', s.plantedAt);
      sim.alert.raise(1, 'Обнаружена диверсия.');
      sim.missions.flag('sabotage_discovered', true);
      const ci = sim.npcs.first('ci_officer');
      sim.radio.send(ci ? `Контрразведка (${fullName(ci)})` : 'Контрразведка', 'Диверсия на объекте', `Подтверждено умышленное повреждение: ${TARGET_NAMES[target] ?? target}${by ? ` (обнаружил ${fullName(by)})` : ''}. На объекте действует агент. Рекомендую осмотреть место лично, опросить людей и усилить охрану.`, 'urgent', 'sabotage', { target }, false);
    }
  }

  /**
   * Осмотр места командиром: находит следы и, если диверсия ещё не сработала, —
   * саму закладку.
   */
  inspect(target: string): string[] {
    const sim = this.sim;
    const out: string[] = [];
    for (const s of this.state.list) {
      if (s.target !== target) continue;
      if (!s.triggered && !s.defused) {
        s.defused = true;
        out.push(`Обнаружено вмешательство: ${DESCR[s.target as Target] ?? 'повреждены узлы'}. Сработать не успело — устранено.`);
        this.discovered(s.target);
      } else if (s.triggered && !s.discovered) {
        out.push(`Это не износ: ${DESCR[s.target as Target] ?? 'следы умышленного повреждения'}.`);
        this.discovered(s.target);
      }
    }
    for (const c of sim.ci.searchPlace(target)) out.push('Найдено: ' + c.text);
    return out;
  }

  /** Арестованный агент выдаёт заложенное. */
  defuseAll(culprit: string): number {
    let n = 0;
    for (const s of this.state.list) {
      if (s.culprit === culprit && !s.triggered && !s.defused) {
        s.defused = true;
        n++;
      }
    }
    return n;
  }

  update(): void {
    const sim = this.sim;
    const now = sim.now;
    for (const s of this.state.list) {
      if (s.triggered || s.defused || now < s.triggerAt) continue;
      s.triggered = true;
      this.trigger(s);
    }
    for (let i = this.state.fires.length - 1; i >= 0; i--) {
      const f = this.state.fires[i];
      if (now >= f.until) {
        sim.bus.emit('world:fire', { x: f.x, z: f.z, on: false, id: f.id });
        this.state.fires.splice(i, 1);
      }
    }
  }

  private trigger(s: Sabotage): void {
    const sim = this.sim;
    const rng = sim.rng;
    switch (s.target) {
      case 'gun1':
      case 'gun2':
      case 'gun3': {
        // прицел сбит: орудие исправно, но бьёт мимо
        const g = sim.artillery.gun(s.target);
        g.sightBias = rng.pick([-1, 1]) * rng.range(450, 900);
        break;
      }
      case 'ammo': {
        const p = this.targetPos('ammo');
        const near = sim.npcs.list.some((n) => n.status === 'active' && n.anim !== 'sleep' && Math.hypot(n.x - p.x, n.z - p.z) < 18);
        const loss = Math.min(sim.resources.ammo('he21'), near ? rng.int(8, 14) : rng.int(22, 34));
        sim.resources.add('he21', -loss);
        this.state.fires.push({ id: s.id, x: p.x, z: p.z, until: sim.now + (near ? 12 : 30) });
        sim.bus.emit('world:fire', { x: p.x, z: p.z, on: true, id: s.id });
        sim.alert.raise(2, 'Пожар на складе боеприпасов!');
        sim.radio.send('Дежурный по объекту', 'Пожар на складе боеприпасов', `На складе боеприпасов №1 возгорание. ${near ? 'Замечено сразу, тушат.' : 'Заметили поздно.'} Утрачено снарядов: ${loss}. Похоже на поджог.`, 'urgent', 'sabotage', { target: 'ammo' }, false);
        s.discovered = true;
        sim.ci.addClue('ammo', `Очаг возгорания — промасленная ветошь с замедлителем. Заложено около ${WorldTimeSystem.clock(s.plantedAt)}.`, 'time', s.plantedAt);
        sim.missions.flag('sabotage_discovered', true);
        break;
      }
      case 'food': {
        const loss = Math.round(sim.resources.get('food') * 0.35);
        sim.resources.add('food', -loss);
        sim.radio.send('Кухня', 'Испорчено продовольствие', `Повар докладывает: в мешках с мукой и крупой керосин. Негодно рационов: ${loss}. Само так не бывает.`, 'urgent', 'sabotage', { target: 'food' }, false);
        break;
      }
      case 'fuel': {
        const loss = Math.round(sim.resources.get('fuel') * 0.3);
        sim.resources.add('fuel', -loss);
        sim.radio.send('Склад топлива', 'Утечка топлива', `Обнаружена течь: вентиль цистерны открыт, в грунт ушло около ${loss} л. Вентиль сам не откручивается.`, 'urgent', 'sabotage', { target: 'fuel' }, false);
        break;
      }
      default:
        sim.repair.breakDown(s.target as EquipmentId, 'sabotage');
    }
  }

  /** Расчёт после нескольких промахов проверяет прицел и находит, что он сбит. */
  checkSight(gun: 'gun1' | 'gun2' | 'gun3'): boolean {
    const g = this.sim.artillery.gun(gun);
    if (!g.sightBias) return false;
    g.sightBias = 0;
    this.discovered(gun);
    return true;
  }

  save(): unknown {
    return this.state;
  }

  load(d: any): void {
    this.state = d;
  }
}
