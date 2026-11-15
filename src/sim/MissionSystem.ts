/**
 * MissionSystem — сюжетная кампания из пяти глав. Главы задают цели и повышают
 * давление противника; как именно развиваются события внутри главы — решают
 * остальные системы и сам командир.
 */
import { COMPLEX_POS } from '../core/constants';
import type { MissionState, ObjectiveState } from '../core/types';
import { NODES } from './Region';
import type { Sim } from './Sim';

interface ObjectiveDef {
  id: string;
  text: string | ((sim: Sim) => string);
  check: (sim: Sim, m: MissionState) => boolean;
  optional?: boolean;
  /** Цель появляется только после выполнения условия. */
  when?: (sim: Sim, m: MissionState) => boolean;
  fail?: (sim: Sim, m: MissionState) => boolean;
}

interface ChapterDef {
  id: string;
  title: string;
  intro: string[];
  objectives: ObjectiveDef[];
  onStart?: (sim: Sim, m: MissionState) => void;
  /** Глава завершается принудительно (например, по времени). */
  timeout?: (sim: Sim, m: MissionState) => boolean;
}

const f = (m: MissionState, k: string) => !!m.flags[k];
const MEET = ['adjutant', 'battery_cmd', 'security_chief', 'ci_officer'];

const CHAPTERS: ChapterDef[] = [
  {
    id: 'arrival',
    title: 'Глава I. Прибытие',
    intro: [
      '16 октября 1944 года. Объект «Гранит» — отдельная тяжёлая батарея особого назначения, укрытая в лесистом холме в двадцати километрах от линии фронта.',
      'Вы назначены командиром объекта. В вашем распоряжении — две 21-см гаубицы и экспериментальная 38-см установка «Конрад», о существовании которой противник знать не должен.',
      'Начальник штаба ждёт вас за шлагбаумом. Через несколько минут — утреннее построение.',
    ],
    objectives: [
      { id: 'enter', text: 'Пройдите через КПП на территорию объекта', check: (s) => s.player.z < 117 },
      { id: 'formation', text: 'Примите утреннее построение на плацу (05:45–06:10)', optional: true, check: (_s, m) => f(m, 'formation_seen'), fail: (s) => s.time.t > 372 },
      { id: 'cc', text: 'Пройдите в командный центр (главный портал → тоннель → GEFECHTSSTAND)', check: (s) => s.player.zone === 'command' },
      {
        id: 'meet',
        text: (s) => `Познакомьтесь с офицерами: начальник штаба, командир батареи, начальник охраны, контрразведка (${MEET.filter((r) => s.missions.state.flags['met_' + r]).length}/4)`,
        check: (_s, m) => MEET.every((r) => f(m, 'met_' + r)),
      },
      { id: 'gun', text: 'Осмотрите установку «Конрад» в ангаре секретного сектора', check: (s, m) => f(m, 'inspected_gun1') || s.player.zone === 'hangar' },
      { id: 'report', text: 'Получите доклад часового или патруля', check: (_s, m) => f(m, 'report_guard') },
    ],
  },
  {
    id: 'first_fire',
    title: 'Глава II. Первый огневой',
    intro: [
      'Штаб корпуса ставит батарее первую задачу. Противник наводит переправу у Центрального моста — понтонный парк нужно уничтожить, пока он не ушёл.',
      'Приказ на огонь отдаётся с планшета управления огнём (командный центр или КП батареи) либо лично командиру орудия. Расчёт всё сделает сам — ваше дело выбрать цель, боеприпас и вносить поправки по докладам наблюдателя.',
    ],
    onStart: (sim) => sim.events.schedule('first_fire', sim.now + 12),
    objectives: [
      { id: 'order', text: 'Отдайте приказ на открытие огня по понтонному парку', when: (_s, m) => f(m, 'first_fire_sent'), check: (_s, m) => f(m, 'fire_ordered') },
      { id: 'adjust', text: 'Дождитесь доклада наблюдателя о разрывах и введите поправки', when: (_s, m) => f(m, 'fire_ordered'), optional: true, check: (_s, m) => f(m, 'corrected') || f(m, 'pontoon_destroyed') },
      { id: 'destroy', text: 'Уничтожьте понтонный парк', when: (_s, m) => f(m, 'first_fire_sent'), check: (_s, m) => f(m, 'pontoon_destroyed') },
    ],
    timeout: (sim, m) => f(m, 'first_fire_sent') && sim.now > Number(m.flags.first_fire_deadline ?? 1e9),
  },
  {
    id: 'shadows',
    title: 'Глава III. Чужой среди своих',
    intro: [
      'Контрразведка предупреждает: сведения об объекте уходят к противнику. Среди пятидесяти человек гарнизона есть агент.',
      'Никто не укажет на него пальцем. Смотрите, кто оказывается не там, где должен; сверяйте документы с картотекой; осматривайте места происшествий; расспрашивайте людей. Ошибочный арест ударит по доверию гарнизона.',
    ],
    onStart: (sim) => {
      sim.enemy.state.phase = 1;
      sim.enemy.state.nextRecon = sim.now + 1500;
      const ci = sim.npcs.first('ci_officer');
      sim.radio.send(ci ? `Контрразведка (${ci.last})` : 'Контрразведка', 'Утечка сведений', 'По данным абвера, противнику известно о существовании тяжёлой батареи в нашем районе. Источник — внутри объекта. Прошу усилить ночную охрану и докладывать мне обо всём необычном.', 'urgent', 'ci', undefined, false);
    },
    objectives: [
      { id: 'patrol', text: 'Организуйте дополнительный ночной патруль (начальник караула или постовая ведомость)', check: (_s, m) => f(m, 'patrol_created') },
      { id: 'cause', text: 'Выясните причину аварии: дождитесь диагностики или осмотрите оборудование лично', when: (_s, m) => f(m, 'power_lost') || f(m, 'sabotage_discovered'), check: (_s, m) => f(m, 'sabotage_discovered') },
      { id: 'scene', text: 'Осмотрите место диверсии и найдите следы', when: (_s, m) => f(m, 'sabotage_discovered'), check: (_s, m) => f(m, 'clue_found') },
      { id: 'evidence', text: 'Соберите материал: показания свидетелей, проверка документов, наблюдение', when: (_s, m) => f(m, 'sabotage_discovered'), check: (s) => s.ci.cases().some((c) => s.ci.evidenceFor(c.suspect).length >= 3) },
      { id: 'arrest', text: 'Передайте дело контрразведке и добейтесь разоблачения агента', when: (_s, m) => f(m, 'sabotage_discovered'), check: (_s, m) => f(m, 'spy_caught') },
    ],
    timeout: (sim, m) => sim.now > Number(m.flags.ch_start ?? 0) + 2880,
  },
  {
    id: 'hunt',
    title: 'Глава IV. Охота на «Гранит»',
    intro: [
      'Противник ищет объект: над лесом кружат разведчики, к ограждению подбираются наблюдатели. Каждый выстрел, каждый огонёк во дворе, каждая выкатка «Конрада» днём приближают удар.',
      'Из штаба идёт пакет с секретным приказом. Похоже, настало время, ради которого установку прятали полгода.',
    ],
    onStart: (sim) => {
      sim.enemy.state.phase = 2;
      sim.enemy.state.nextRecon = sim.now + 200;
      sim.events.schedule('air_raid', sim.now + 150);
      sim.events.schedule('courier', sim.now + 300, { order: 'hq_strike' });
    },
    objectives: [
      { id: 'air', text: 'Переживите воздушную тревогу, не выдав объект (светомаскировка, установка в ангаре, батарея молчит)', check: (_s, m) => f(m, 'air_raid_done'), fail: (_s, m) => f(m, 'air_spotted') },
      { id: 'order', text: 'Примите секретный пакет у офицера связи', check: (_s, m) => f(m, 'secret_order') },
      { id: 'deploy', text: 'Выкатите установку «Конрад» на позицию', when: (_s, m) => f(m, 'secret_order'), check: (s) => s.artillery.gun('gun1').deploy >= 1 },
      { id: 'strike', text: 'Уничтожьте штаб противника в Кроненберге спецснарядом', when: (_s, m) => f(m, 'secret_order'), check: (_s, m) => f(m, 'hq_destroyed') },
      { id: 'raid', text: 'Отбейте нападение диверсионной группы', optional: true, when: (_s, m) => f(m, 'infiltration'), check: (_s, m) => f(m, 'infiltration_over') },
    ],
    timeout: (sim, m) => sim.now > Number(m.flags.ch_start ?? 0) + 2400,
  },
  {
    id: 'last_stand',
    title: 'Глава V. Последний рубеж',
    intro: [
      'Противник перешёл в наступление по всему фронту. Его батареи бьют по засечённым позициям, диверсанты режут связь.',
      'Резервы подойдут через сутки. До тех пор батарея — единственное, что удерживает дороги к Вальдхофу. Держитесь и поддерживайте пехоту огнём.',
    ],
    onStart: (sim, m) => {
      sim.enemy.state.phase = 3;
      sim.enemy.state.nextRecon = sim.now + 120;
      m.flags.hold_until = sim.now + 1440;
      m.flags.kills_start = Number(m.flags.kills ?? 0);
      sim.radio.send('Штаб корпуса', 'Противник перешёл в наступление', 'Наступление противника началось на всём участке корпуса. Резервы выдвигаются, срок подхода — сутки. Батарее: всеми средствами поддерживать пехоту, объект удерживать.', 'urgent', 'hq');
    },
    objectives: [
      { id: 'hold', text: (s) => `Удержите объект до подхода резервов (осталось ${Math.max(0, Math.ceil((Number(s.missions.state.flags.hold_until ?? 0) - s.now) / 60))} ч)`, check: (s, m) => s.now >= Number(m.flags.hold_until ?? 1e9) },
      { id: 'support', text: (s) => `Уничтожьте огнём батареи не менее трёх целей (${Math.min(3, Number(s.missions.state.flags.kills ?? 0) - Number(s.missions.state.flags.kills_start ?? 0))}/3)`, optional: true, check: (_s, m) => Number(m.flags.kills ?? 0) - Number(m.flags.kills_start ?? 0) >= 3 },
      { id: 'front', text: 'Не допустите прорыва противника к Вальдхофу', optional: true, check: (s, m) => s.now >= Number(m.flags.hold_until ?? 1e9) && s.enemy.state.owner[1] === 'us', fail: (s) => s.enemy.state.owner[1] === 'enemy' },
    ],
  },
];

export class MissionSystem {
  state: MissionState = { chapter: -1, chapterId: '', title: '', objectives: [], flags: {}, startedAt: 0, ended: null, score: 0 };
  private tick = 0;

  constructor(private sim: Sim) {
    sim.bus.on('dialogue:talked', ({ id }) => {
      const n = sim.npcs.byId(id);
      if (n && MEET.includes(n.role)) this.flag('met_' + n.role, true);
    });
    sim.bus.on('arty:mission', ({ mission }) => {
      if (mission.intelId && mission.intelId === this.state.flags.pontoon_intel) this.flag('fire_ordered', true);
    });
    sim.bus.on('enemy:destroyed', ({ id, type }) => {
      if (type !== 'bridge' && type !== 'decoy') this.state.flags.kills = Number(this.state.flags.kills ?? 0) + 1;
      if (id === this.state.flags.pontoon_unit) this.flag('pontoon_destroyed', true);
      if (type === 'hq') this.flag('hq_destroyed', true);
      this.addScore(type === 'hq' ? 15 : type === 'decoy' ? -1 : 4);
    });
    sim.bus.on('power:changed', ({ on }) => {
      if (!on || sim.resources.state.power < 1) this.flag('power_lost', true);
    });
  }

  reset(): void {
    this.state = { chapter: -1, chapterId: '', title: '', objectives: [], flags: {}, startedAt: 0, ended: null, score: 0 };
    this.tick = 0;
  }

  start(): void {
    this.startChapter(0);
  }

  flag(name: string, value: number | boolean | string): void {
    if (this.state.flags[name] === value) return;
    this.state.flags[name] = value;
    this.sim.bus.emit('mission:updated', {});
  }

  addScore(n: number): void {
    this.state.score += n;
  }

  private def(): ChapterDef | undefined {
    return CHAPTERS[this.state.chapter];
  }

  private startChapter(i: number): void {
    const sim = this.sim;
    const def = CHAPTERS[i];
    if (!def) return this.end('auto');
    const m = this.state;
    m.chapter = i;
    m.chapterId = def.id;
    m.title = def.title;
    m.startedAt = sim.now;
    m.flags.ch_start = sim.now;
    m.objectives = def.objectives.map((o) => ({ id: o.id, text: typeof o.text === 'string' ? o.text : o.text(sim), done: false, failed: false, optional: !!o.optional }));
    def.onStart?.(sim, m);
    sim.bus.emit('mission:chapter', { title: def.title, intro: def.intro });
    sim.bus.emit('mission:updated', {});
  }

  /** Сюжетные триггеры от событий. */
  trigger(name: string): void {
    const sim = this.sim;
    const m = this.state;
    if (name === 'first_fire') {
      // понтонный парк у Центрального моста; координаты штаба даны с ошибкой
      const node = NODES[9];
      const x = node.x - 380;
      const y = node.y + 720;
      const u = sim.enemy.spawn('depot', 'Понтонный парк', x, y, 9);
      u.camo = 0.2;
      const rep = sim.recon.add('hq', 'Штаб корпуса', 'B', 'depot', x + sim.rng.pick([-1, 1]) * sim.rng.range(160, 240), y + sim.rng.pick([-1, 1]) * sim.rng.range(140, 220), 250, 'Понтонный парк противника, скопление машин и переправочных средств севернее Центрального моста. Координаты сняты с аэрофотоснимка, возможна ошибка привязки до 250 м.', u.id);
      m.flags.pontoon_unit = u.id;
      m.flags.pontoon_intel = rep.id;
      m.flags.first_fire_deadline = sim.now + 420;
      const dx = rep.x - COMPLEX_POS.x;
      const dy = rep.y - COMPLEX_POS.y;
      sim.radio.send('Штаб корпуса', 'Огневая задача №1', `Уничтожить понтонный парк противника: X ${rep.x} Y ${rep.y} (дальность около ${(Math.hypot(dx, dy) / 1000).toFixed(1)} км). Цель наблюдает НП-1. Рекомендуется пристрелка одиночными с поправками, затем серия на поражение. Срок — до исхода дня.`, 'urgent', 'fire_task', { intel: rep.id });
      this.flag('first_fire_sent', true);
    } else if (name === 'courier_delivered') {
      const hq = sim.enemy.alive('hq')[0];
      if (hq) {
        const rep = sim.recon.hqTarget(hq, 'Узел управления противника. Координаты подтверждены агентурой.');
        m.flags.hq_intel = rep.id;
        sim.radio.send('Штаб корпуса (секретный пакет)', 'Совершенно секретно. Операция «Удар грома»', `Командиру объекта «Гранит». Приказываю: с наступлением темноты выкатить установку «Конрад» и уничтожить штаб дивизии противника в Кроненберге — X ${rep.x} Y ${rep.y}. Цель укреплена: применять спецснаряд особой мощности. После выполнения установку немедленно укрыть. Спецснарядов в наличии: ${sim.resources.ammo('sp38')}.`, 'secret', 'secret_order', { intel: rep.id }, false);
      }
      this.flag('secret_order', true);
    }
  }

  /** Завершение кампании. */
  end(reason: 'auto' | 'wounded' | 'overrun'): void {
    const sim = this.sim;
    const m = this.state;
    if (m.ended) return;
    const guns = sim.artillery.guns().filter((g) => !sim.repair.get(g.id).broken).length;
    const mp = sim.resources.manpower();
    const frontHeld = [4, 5, 6, 7].filter((n) => sim.enemy.state.owner[n] === 'us').length;
    const lines: string[] = [];
    let outcome: string;
    let title: string;
    if (reason === 'wounded') {
      outcome = 'wounded';
      title = 'Командир выбыл из строя';
      lines.push('Вы тяжело ранены и эвакуированы в тыл. Командование объектом принял начальник штаба.');
    } else if (reason === 'overrun' || guns === 0) {
      outcome = 'defeat';
      title = 'Объект потерян';
      lines.push('Батарея небоеспособна, противник вышел к объекту. Гарнизон подорвал установку и отошёл лесом к Вальдхофу.');
    } else {
      const total = m.score + frontHeld * 6 + guns * 5 + (f(m, 'spy_caught') ? 12 : -8) + (f(m, 'hq_destroyed') ? 10 : 0) - sim.combat.state.losses.length * 2 - Math.round(sim.enemy.state.intel / 10);
      if (total >= 45) {
        outcome = 'victory';
        title = 'Рубеж удержан';
        lines.push('Резервы подошли вовремя. Наступление противника выдохлось под огнём батареи, фронт устоял.');
      } else if (total >= 15) {
        outcome = 'hold';
        title = 'Объект устоял';
        lines.push('Объект удержан дорогой ценой. Фронт отошёл, но батарея цела и продолжает вести огонь.');
      } else {
        outcome = 'evacuation';
        title = 'Приказ на эвакуацию';
        lines.push('Удержать район не удалось. По приказу штаба установку вывезли по железнодорожной ветке, объект оставлен.');
      }
      lines.push(`Итоговая оценка командования: ${total}.`);
    }
    lines.push(`Удержано пунктов на фронте: ${frontHeld} из 4. Боеготовых орудий: ${guns} из 3.`);
    lines.push(`В строю ${mp.fit} из ${mp.total + sim.combat.state.losses.length}. Безвозвратные потери: ${sim.combat.state.losses.length}.`);
    lines.push(f(m, 'spy_caught') ? 'Агент противника разоблачён.' : 'Агент противника так и не был раскрыт.');
    if (sim.ci.state.wrongArrests) lines.push(`Арестовано невиновных: ${sim.ci.state.wrongArrests}.`);
    lines.push(`Выпущено снарядов: ${sim.artillery.state.totalShots}. Уничтожено целей: ${Number(m.flags.kills ?? 0)}.`);
    m.ended = outcome;
    sim.bus.emit('campaign:ended', { outcome, title, text: lines });
  }

  update(dt: number): void {
    const sim = this.sim;
    const m = this.state;
    if (m.ended || m.chapter < 0) return;
    this.tick += dt;
    if (this.tick < 0.5) return;
    this.tick = 0;
    const def = this.def();
    if (!def) return;
    let changed = false;
    let allDone = true;
    def.objectives.forEach((od, i) => {
      const os: ObjectiveState = m.objectives[i];
      const visible = !od.when || od.when(sim, m);
      const text = typeof od.text === 'string' ? od.text : od.text(sim);
      if (text !== os.text) {
        os.text = text;
        changed = true;
      }
      (os as any).hidden = !visible;
      if (!os.done && !os.failed && visible) {
        if (od.check(sim, m)) {
          os.done = true;
          changed = true;
          this.addScore(os.optional ? 2 : 3);
          sim.notify(`Выполнено: ${text}`, 'good');
        } else if (od.fail?.(sim, m)) {
          os.failed = true;
          changed = true;
        }
      }
      if (!os.done && !os.optional && !os.failed) allDone = false;
    });
    if (changed) sim.bus.emit('mission:updated', {});
    // противник дошёл до объекта
    if (sim.enemy.state.owner[0] === 'enemy' || sim.enemy.units.some((u) => u.alive && (u.type === 'infantry' || u.type === 'armor') && Math.hypot(u.x - COMPLEX_POS.x, u.y - COMPLEX_POS.y) < 900)) return this.end('overrun');
    if (allDone || def.timeout?.(sim, m)) {
      if (m.chapter + 1 >= CHAPTERS.length) this.end('auto');
      else this.startChapter(m.chapter + 1);
    }
  }

  /** Видимые цели текущей главы. */
  visible(): ObjectiveState[] {
    return this.state.objectives.filter((o) => !(o as any).hidden);
  }

  save(): unknown {
    return this.state;
  }

  load(d: any): void {
    this.state = d;
  }
}
