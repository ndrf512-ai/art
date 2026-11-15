/**
 * EventDirector — динамические события. Не сценарий по рельсам: события выбираются
 * по весам в зависимости от фазы кампании, состояния объекта и уже случившегося.
 */
import { clamp, dist } from '../core/math';
import type { EquipmentId, NpcState, Step } from '../core/types';
import { FIRST_NAMES, LAST_NAMES } from '../data/names';
import { fullName, rankName } from './DocumentSystem';
import { blankNpc } from './npc/roster';
import type { GoalOption } from './NPCSystem';
import { describePlace, NODES, square } from './Region';
import type { Sim } from './Sim';

export type VisitorKind = 'officer' | 'courier' | 'suspicious' | 'inspector';

interface Visitor {
  id: string;
  kind: VisitorKind;
  legit: boolean;
  state: 'arriving' | 'waiting' | 'admitted' | 'denied' | 'done';
  reported: boolean;
  verifyAt: number;
  verified: boolean;
  since: number;
  data?: any;
}

export class EventDirector {
  state = {
    scheduled: [] as { name: string; at: number; data?: any }[],
    next: 0,
    cooldown: {} as Record<string, number>,
    visitors: [] as Visitor[],
    airRaidUntil: 0,
    airRaidJudgeAt: 0,
    conflict: null as null | { a: string; b: string; until: number; resolved: boolean },
    urgent: null as null | { unit: string; until: number; node: number; intel: string },
    inspection: null as null | { id: string; until: number },
    log: [] as string[],
  };

  constructor(private sim: Sim) {
    sim.calls['event.arrive'] = (n) => this.arriveInside(n);
    sim.calls['event.courier'] = (n) => this.courierDeliver(n);
    sim.calls['event.leave'] = (n) => {
      const v = this.visitor(n.id);
      if (v) v.state = 'done';
      sim.npcs.remove(n.id);
    };
    sim.calls['event.fight'] = () => this.conflictFight();
    sim.calls['event.inspected'] = (n) => this.inspectionEnd(n);
  }

  reset(): void {
    this.state = { scheduled: [], next: this.sim.now + 260, cooldown: {}, visitors: [], airRaidUntil: 0, airRaidJudgeAt: 0, conflict: null, urgent: null, inspection: null, log: [] };
  }

  schedule(name: string, at: number, data?: any): void {
    this.state.scheduled.push({ name, at, data });
  }

  visitor(id: string): Visitor | undefined {
    return this.state.visitors.find((v) => v.id === id);
  }

  private ready(name: string, cd: number): boolean {
    const c = this.state.cooldown[name];
    if (c !== undefined && this.sim.now < c) return false;
    this.state.cooldown[name] = this.sim.now + cd;
    return true;
  }

  update(): void {
    const sim = this.sim;
    const s = this.state;
    const now = sim.now;
    for (let i = s.scheduled.length - 1; i >= 0; i--) {
      if (now >= s.scheduled[i].at) {
        const e = s.scheduled.splice(i, 1)[0];
        this.fire(e.name, e.data);
      }
    }
    if (now >= s.next) {
      const phase = sim.enemy.state.phase;
      s.next = now + sim.rng.range(170, 380) / (1 + phase * 0.2);
      const day = sim.time.day;
      const opts: [string, number][] = [
        ['malfunction', 2],
        ['injury', 0.8],
        ['conflict', sim.relations.averages().discipline < 62 ? 2.2 : 0.9],
        ['urgent_fire', day >= 2 ? 1.6 + phase : 0],
        ['air_raid', phase >= 1 ? 1 + phase * 0.6 : 0],
        ['officer', day >= 2 ? 0.8 : 0],
        ['suspicious', phase >= 1 ? 1.1 : 0.3],
        ['inspection', day >= 3 ? 0.6 : 0],
        ['shortage', day >= 3 ? 0.5 : 0],
        ['comms', 0.5],
      ];
      const pick = sim.rng.weighted(opts, (o) => o[1]);
      if (pick) this.fire(pick[0]);
    }
    this.tickAirRaid();
    this.tickConflict();
    this.tickUrgent();
    this.tickVisitors();
  }

  fire(name: string, data?: any): void {
    const sim = this.sim;
    const rng = sim.rng;
    switch (name) {
      case 'malfunction': {
        if (!this.ready(name, 300)) return;
        const pool = sim.repair.all().filter((e) => !e.broken && e.condition < 78 && e.id !== 'generator2');
        const e = rng.weighted(pool, (x) => 100 - x.condition);
        if (e) sim.repair.breakDown(e.id as EquipmentId, 'wear');
        break;
      }
      case 'comms': {
        if (!this.ready(name, 900) || sim.repair.get('radio').broken) return;
        sim.repair.breakDown('radio', 'wear');
        break;
      }
      case 'injury': {
        if (!this.ready(name, 600)) return;
        const pool = sim.npcs.list.filter((n) => n.status === 'active' && (n.goal.startsWith('repair') || n.anim === 'repair_low' || n.anim === 'work') && n.rank < 8 && n.unit !== 'external');
        if (pool.length) sim.combat.wound(rng.pick(pool), rng.range(40, 55), 'получил травму при работе');
        break;
      }
      case 'conflict':
        this.startConflict();
        break;
      case 'urgent_fire':
        this.startUrgent();
        break;
      case 'air_raid':
        this.startAirRaid();
        break;
      case 'officer':
      case 'suspicious':
      case 'courier':
      case 'inspection':
        this.spawnVisitor(name === 'inspection' ? 'inspector' : (name as VisitorKind), data);
        break;
      case 'shortage': {
        if (!this.ready(name, 2800)) return;
        sim.supply.state.shortage = 0.5;
        this.schedule('shortage_end', sim.now + 2400);
        sim.radio.send('Штаб снабжения', 'Лимиты урезаны', 'Из-за потерь на коммуникациях нормы отпуска боеприпасов и горючего временно сокращены вдвое. Расходуйте запасы обдуманно.', 'urgent', 'supply');
        break;
      }
      case 'shortage_end':
        sim.supply.state.shortage = 1;
        break;
      case 'archive_disturbed': {
        const clerk = sim.npcs.first('clerk');
        sim.radio.send(clerk ? fullName(clerk) : 'Архив', 'Беспорядок в архиве', 'Утром обнаружил: папки технической переписки стоят не на местах, одна вскрыта. Ночью в архиве кто-то был. Ключи есть только у штабных.', 'urgent', 'ci', { place: 'archive' }, false);
        sim.alert.raise(1, 'Следы проникновения в архив.');
        break;
      }
      case 'first_fire':
      case 'secret_order':
        sim.missions.trigger(name);
        break;
    }
  }

  // ------------------------------------------------------------------ воздушная тревога

  private startAirRaid(): void {
    const sim = this.sim;
    if (!this.ready('air_raid', 700) || this.state.airRaidUntil > sim.now) return;
    const dur = sim.rng.range(12, 18);
    this.state.airRaidUntil = sim.now + dur;
    this.state.airRaidJudgeAt = sim.now + dur * 0.5;
    sim.alert.setAirRaid(true);
    sim.bus.emit('world:plane', { hostile: true });
    sim.notify('Воздушная тревога! Самолёты противника на подходе.', 'alarm');
    sim.radio.send('Пост ВНОС', 'Воздушная тревога', 'Группа самолётов противника идёт курсом на район объекта. Рекомендую светомаскировку, укрыть установку и прекратить огонь.', 'urgent', 'air', undefined, false);
  }

  private tickAirRaid(): void {
    const sim = this.sim;
    const s = this.state;
    if (!sim.alert.state.airRaid) return;
    const now = sim.now;
    if (s.airRaidJudgeAt && now >= s.airRaidJudgeAt) {
      s.airRaidJudgeAt = 0;
      const g1 = sim.artillery.gun('gun1');
      const dark = sim.time.darkness() > 0.6;
      const lights = dark && sim.resources.state.power > 0 && !sim.alert.state.blackout;
      const gunOut = !dark && g1.deploy > 0.3;
      const firing = sim.artillery.state.lastFireT > 0 && now - sim.artillery.state.lastFireT < 12;
      const cover = sim.weather.state.fog > 0.5 || sim.weather.state.rain > 0.6;
      let seen = 0;
      if (lights) seen += 12;
      if (gunOut) seen += 15;
      if (firing) seen += 9;
      if (cover) seen *= 0.3;
      s.log.push(`${sim.time.stamp()}: налёт, заметность ${Math.round(seen)}`);
      if (seen >= 8) {
        sim.enemy.state.intel = Math.min(100, sim.enemy.state.intel + seen);
        if (sim.rng.chance(0.55)) {
          const c = gunOut ? { x: 124.5, z: 84 } : { x: 70, z: 82 };
          sim.combat.bombs(sim.rng.int(4, 7), c.x, c.z);
          sim.notify('Самолёты сбрасывают бомбы на объект!', 'alarm');
        }
        sim.missions.flag('air_spotted', true);
        sim.radio.send('Пост ВНОС', 'Объект обнаружен с воздуха', `Самолёты делали круги над объектом: ${[lights ? 'горело освещение двора' : '', gunOut ? 'установка стояла открыто на позиции' : '', firing ? 'батарея вела огонь' : ''].filter(Boolean).join(', ')}. Противник знает о нас больше.`, 'urgent', 'air', undefined, false);
      } else {
        sim.radio.send('Пост ВНОС', 'Самолёты прошли стороной', 'Противник объект не обнаружил.', 'routine', 'air', undefined, false);
      }
    }
    if (now >= s.airRaidUntil) {
      sim.alert.setAirRaid(false);
      sim.notify('Отбой воздушной тревоги.', 'good');
      sim.missions.flag('air_raid_done', true);
    }
  }

  // ------------------------------------------------------------------ срочный огонь

  private startUrgent(): void {
    const sim = this.sim;
    if (this.state.urgent || !this.ready('urgent_fire', 500)) return;
    const front = [4, 5, 6].filter((n) => sim.enemy.state.owner[n] === 'us');
    if (!front.length) return;
    const node = sim.rng.pick(front);
    const nd = NODES[node];
    const x = nd.x + sim.rng.range(-900, 900);
    const y = nd.y - sim.rng.range(2200, 3200);
    const type = sim.rng.pick(['infantry', 'armor'] as const);
    const u = sim.enemy.spawn(type, type === 'armor' ? 'Танковая группа прорыва' : 'Штурмовой батальон', x, y, node);
    u.state = 'move';
    u.camo = 0.1;
    u.route = [node];
    u.routeI = 0;
    u.speed = type === 'armor' ? 120 : 55;
    const rep = sim.recon.add('hq', 'Штаб корпуса (заявка пехоты)', 'B', type, x + sim.rng.gauss(0, 120), y + sim.rng.gauss(0, 120), 150, `Срочная заявка: ${type === 'armor' ? 'танки' : 'пехота'} противника сосредоточиваются для атаки, ${square(x, y)} (${describePlace(x, y)}). Цель движется к ${nd.name}.`, u.id);
    const mins = 50;
    this.state.urgent = { unit: u.id, until: sim.now + mins, node, intel: rep.id };
    sim.radio.send('Штаб корпуса', 'СРОЧНО: огонь по заявке пехоты', `Противник атакует на ${nd.name}. Цель — ${type === 'armor' ? 'танки' : 'пехота'}, ${square(x, y)}, координаты X ${Math.round(rep.x)} Y ${Math.round(rep.y)}. Цель подвижная. Откройте огонь не позднее чем через ${mins} минут.`, 'urgent', 'urgent_fire', { intel: rep.id });
  }

  private tickUrgent(): void {
    const sim = this.sim;
    const u = this.state.urgent;
    if (!u) return;
    const unit = sim.enemy.byId(u.unit);
    const hit = !unit || !unit.alive || unit.strength < 68 || unit.suppress > 55;
    if (hit) {
      this.state.urgent = null;
      sim.enemy.state.front[u.node] = clamp((sim.enemy.state.front[u.node] ?? 0) + 10, 0, 100);
      sim.relations.event('fire_success');
      sim.missions.addScore(8);
      sim.radio.send('Штаб корпуса', 'Заявка выполнена', `Атака на ${NODES[u.node].name} сорвана огнём вашей батареи. Пехота благодарит.`, 'routine', 'urgent_done');
    } else if (sim.now > u.until) {
      this.state.urgent = null;
      sim.enemy.state.front[u.node] = clamp((sim.enemy.state.front[u.node] ?? 0) - 14, 0, 100);
      sim.missions.addScore(-5);
      sim.radio.send('Штаб корпуса', 'Заявка не выполнена', `Огневой поддержки пехота не дождалась. Противник потеснил наши части у ${NODES[u.node].name}.`, 'urgent', 'urgent_fail');
    }
  }

  // ------------------------------------------------------------------ конфликт

  private startConflict(): void {
    const sim = this.sim;
    if (this.state.conflict || !this.ready('conflict', 900) || sim.alert.level >= 2) return;
    const free = sim.npcs.list.filter((n) => n.status === 'active' && n.rank < 6 && n.unit !== 'external' && (sim.schedule.block(n) === 'free' || sim.schedule.block(n) === 'meal'));
    if (free.length < 2) return;
    const a = sim.rng.pick(free);
    const others = free.filter((n) => n.unit !== a.unit);
    if (!others.length) return;
    const b = sim.rng.pick(others);
    this.state.conflict = { a: a.id, b: b.id, until: sim.now + 70, resolved: false };
    const sgt = sim.npcs.first('guard_sgt');
    sim.radio.send(sgt ? fullName(sgt) : 'Дежурный', 'Ссора между подразделениями', `${fullName(a)} и ${fullName(b)} сцепились во дворе у курилки — не поделили очередь на работы. Того и гляди дойдёт до драки. Нужен ваш разбор.`, 'routine', 'conflict', { a: a.id, b: b.id }, false);
  }

  conflictOf(id: string): { a: NpcState; b: NpcState } | null {
    const c = this.state.conflict;
    if (!c || c.resolved || (c.a !== id && c.b !== id)) return null;
    const a = this.sim.npcs.byId(c.a);
    const b = this.sim.npcs.byId(c.b);
    return a && b ? { a, b } : null;
  }

  /** Решение командира: 'a' — виноват первый, 'b' — второй, 'both', 'peace'. */
  resolveConflict(choice: 'a' | 'b' | 'both' | 'peace'): string {
    const sim = this.sim;
    const c = this.state.conflict;
    if (!c) return '';
    const a = sim.npcs.byId(c.a)!;
    const b = sim.npcs.byId(c.b)!;
    c.resolved = true;
    this.state.conflict = null;
    // истинный зачинщик — менее дисциплинированный
    const culprit = a.discipline <= b.discipline ? a : b;
    let text: string;
    if (choice === 'peace') {
      a.discipline = clamp(a.discipline + 2, 0, 100);
      b.discipline = clamp(b.discipline + 2, 0, 100);
      a.attitude = clamp(a.attitude + 2, 0, 100);
      b.attitude = clamp(b.attitude + 2, 0, 100);
      text = 'Оба разошлись без взысканий. Вопрос закрыт, хотя осадок остался.';
    } else if (choice === 'both') {
      sim.relations.offence(a, 'ссора с сослуживцем');
      sim.relations.offence(b, 'ссора с сослуживцем');
      sim.relations.punish(a, 'duty');
      sim.relations.punish(b, 'duty');
      text = 'Оба получили наряд вне очереди. Дисциплина подтянулась, любви к командиру не прибавилось.';
    } else {
      const blamed = choice === 'a' ? a : b;
      const other = choice === 'a' ? b : a;
      sim.relations.offence(blamed, 'затеял ссору');
      if (blamed === culprit) {
        sim.relations.punish(blamed, 'reprimand');
        other.attitude = clamp(other.attitude + 6, 0, 100);
        sim.relations.unitMood(other.unit, 1.5, 'Командир разобрался справедливо');
        text = 'Вы разобрались верно: зачинщик получил выговор, второй вам благодарен.';
      } else {
        delete blamed.flags.offence;
        sim.relations.punish(blamed, 'reprimand');
        text = 'Наказан не тот. Солдаты всё видели — справедливым это решение не считают.';
      }
    }
    for (const n of [a, b]) sim.npcs.clearGoal(n);
    return text;
  }

  private conflictFight(): void {
    const c = this.state.conflict;
    if (!c || c.resolved) return;
    const sim = this.sim;
    const a = sim.npcs.byId(c.a);
    const b = sim.npcs.byId(c.b);
    this.state.conflict = null;
    if (!a || !b) return;
    sim.relations.offence(a, 'драка');
    sim.relations.offence(b, 'драка');
    a.discipline = clamp(a.discipline - 6, 0, 100);
    b.discipline = clamp(b.discipline - 6, 0, 100);
    sim.relations.unitMood(a.unit, -2, 'Драка с соседним подразделением');
    sim.relations.unitMood(b.unit, -2, 'Драка с соседним подразделением');
    if (sim.rng.chance(0.4)) sim.combat.wound(sim.rng.pick([a, b]), 42, 'пострадал в драке');
    sim.notify(`Ссора закончилась дракой: ${fullName(a)} и ${fullName(b)}.`, 'warn');
  }

  private tickConflict(): void {
    const c = this.state.conflict;
    if (c && !c.resolved && this.sim.now > c.until) this.conflictFight();
  }

  // ------------------------------------------------------------------ прибывающие

  private spawnVisitor(kind: VisitorKind, data?: any): NpcState | null {
    const sim = this.sim;
    if (kind !== 'courier' && !this.ready('visitor_' + kind, kind === 'officer' ? 2400 : 1200)) return null;
    if (this.state.visitors.some((v) => v.state === 'arriving' || v.state === 'waiting')) return null;
    const rng = sim.rng;
    const P = sim.layout.points;
    const n = blankNpc(sim.npcs.nextId('v'));
    n.first = rng.pick(FIRST_NAMES);
    n.last = rng.pick(LAST_NAMES);
    n.unit = 'external';
    n.x = P.road_far.x + rng.range(-0.5, 0.5);
    n.z = P.road_far.z;
    n.zone = 'outside';
    n.age = rng.int(24, 45);
    let legit = true;
    if (kind === 'officer') {
      n.role = 'new_officer';
      n.rank = rng.pick([8, 9]);
      n.position = 'Прибыл по предписанию: помощник командира батареи';
      n.skill = rng.range(55, 80);
      legit = rng.chance(sim.spy.state.agents.length ? 0.75 : 0.5);
    } else if (kind === 'courier') {
      n.role = 'courier';
      n.rank = 8;
      n.position = 'Офицер связи штаба корпуса';
    } else if (kind === 'inspector') {
      n.role = 'inspector';
      n.rank = 12;
      n.position = 'Инспектор штаба корпуса';
    } else {
      n.role = 'visitor';
      n.rank = 0;
      n.position = rng.pick(['Линейный монтёр связи', 'Лесник', 'Возчик из Вальдхофа']);
      legit = rng.chance(0.5);
    }
    sim.docs.issue(n, false);
    n.doc.unit = kind === 'suspicious' ? 'Гражданское лицо' : 'Штаб корпуса';
    n.doc.issuedBy = kind === 'suspicious' ? 'Бургомистр Вальдхофа' : 'Штаб корпуса';
    n.doc.clearance = kind === 'inspector' ? 4 : kind === 'suspicious' ? 0 : 3;
    if (!legit) n.doc.issued = `31.${rng.pick(['04', '06', '09'])}.1944`;
    sim.npcs.add(n);
    this.state.visitors.push({ id: n.id, kind, legit, state: 'arriving', reported: false, verifyAt: 0, verified: false, since: sim.now, data });
    return n;
  }

  /** Часовой КПП остановил прибывшего и докладывает командиру. */
  visitorAtGate(n: NpcState, sentry: NpcState | null): void {
    const v = this.visitor(n.id);
    if (!v || v.reported) return;
    v.reported = true;
    v.state = 'waiting';
    const sim = this.sim;
    const who = v.kind === 'officer' ? `${rankName(n)} ${n.last} с предписанием о назначении на объект` : v.kind === 'courier' ? `офицер связи штаба корпуса ${rankName(n)} ${n.last} с пакетом лично командиру` : v.kind === 'inspector' ? `инспектор штаба корпуса ${rankName(n)} ${n.last}` : `гражданский, называет себя: ${n.position.toLowerCase()} ${n.last}. Шёл вдоль ограждения`;
    sim.radio.send(sentry ? `КПП (${fullName(sentry)})` : 'КПП', 'На КПП посторонний', `На КПП ${who}. В списках объекта не значится. Жду приказа: пропустить или отказать. Решение — лично или по телефону (КПП).`, 'urgent', 'visitor', { id: n.id }, false);
    sim.guard.log(`КПП: прибыл ${n.position.toLowerCase()} ${n.last}, ждёт решения командира.`);
  }

  waitingVisitor(): NpcState | null {
    const v = this.state.visitors.find((x) => x.state === 'waiting');
    return v ? (this.sim.npcs.byId(v.id) ?? null) : null;
  }

  /** Запрос в штаб: действительно ли этого человека направляли. Нужна радиосвязь. */
  verifyVisitor(id: string): string {
    const sim = this.sim;
    const v = this.visitor(id);
    if (!v) return '';
    if (!sim.resources.state.radio) return 'Радиосвязи со штабом нет — запрос отправить невозможно.';
    if (v.verifyAt) return 'Запрос уже отправлен, ответа пока нет.';
    v.verifyAt = sim.now + sim.rng.range(70, 130);
    return 'Запрос в штаб отправлен. Ответ будет через час-два.';
  }

  /** Решение командира по прибывшему. */
  decideVisitor(id: string, admit: boolean): string {
    const sim = this.sim;
    const v = this.visitor(id);
    const n = sim.npcs.byId(id);
    if (!v || !n) return '';
    if (!admit) {
      v.state = 'denied';
      sim.npcs.clearGoal(n);
      if (v.kind === 'officer' && v.legit) {
        sim.missions.addScore(-3);
        this.schedule('hq_displeased', sim.now + 120);
      }
      if (v.kind === 'suspicious' && !v.legit) sim.enemy.state.intel = Math.min(100, sim.enemy.state.intel + 8);
      return 'Отказано. Его проводят за шлагбаум.';
    }
    v.state = 'admitted';
    n.flags.admitted = true;
    sim.npcs.clearGoal(n);
    if (v.kind === 'suspicious') {
      // «пропустить» постороннего — значит взять под стражу для проверки
      const ci = sim.npcs.first('ci_officer') ?? sim.npcs.first('security_chief');
      if (ci) sim.ci.detain(n, ci, ['посторонний у ограждения, документы гражданские'], 'КПП', true);
      this.schedule('suspicious_result', sim.now + sim.rng.range(120, 200), { id });
      return 'Задержан и передан контрразведке для проверки.';
    }
    return 'Пропущен на объект.';
  }

  private arriveInside(n: NpcState): void {
    const sim = this.sim;
    const v = this.visitor(n.id);
    if (!v) return;
    if (v.state === 'arriving' || v.state === 'waiting') {
      // прошёл без решения командира — на КПП не оказалось часового
      v.state = 'admitted';
      n.flags.admitted = true;
      if (v.kind === 'suspicious') {
        v.state = 'denied';
        if (!v.legit) sim.enemy.state.intel = Math.min(100, sim.enemy.state.intel + 8);
        return;
      }
    }
    if (v.kind === 'officer') {
      v.state = 'done';
      n.unit = 'staff';
      n.role = 'battery_cmd';
      n.shift = 'flex';
      n.position = 'Помощник командира батареи';
      n.workSpot = 'bcp';
      const bed = sim.npcs.freeSpot('officer_bed', n) ?? sim.layout.byTag('officer_bed')[6];
      n.bedSpot = bed.id;
      const wasForged = !v.legit;
      sim.docs.issue(n);
      if (wasForged) sim.spy.addAgent(n, sim.now + sim.rng.range(500, 900));
      else {
        // толковый помощник ускоряет работу батареи
        for (const g of sim.artillery.guns()) {
          const c = sim.npcs.byId(g.crew[0]);
          if (c) c.skill = Math.min(96, c.skill + 4);
        }
      }
      sim.access.invalidate();
      sim.notify(`${fullName(n)} приступил к обязанностям помощника командира батареи.`, 'info');
    } else if (v.kind === 'inspector') {
      this.state.inspection = { id: n.id, until: sim.now + 150 };
    }
  }

  private courierDeliver(n: NpcState): void {
    const sim = this.sim;
    const v = this.visitor(n.id);
    if (!v) return;
    sim.npcs.gesture(n, 'salute', 2, 'player');
    sim.npcs.speak(n, `${sim.address(true)}, пакет из штаба корпуса. Лично в руки.`);
    v.state = 'done';
    v.data = { ...(v.data ?? {}), delivered: true };
    sim.missions.trigger('courier_delivered');
  }

  private inspectionEnd(n: NpcState): void {
    const sim = this.sim;
    const insp = this.state.inspection;
    if (!insp) return;
    this.state.inspection = null;
    const avg = sim.relations.averages();
    const eq = sim.repair.all();
    const cond = eq.reduce((a, e) => a + (e.broken ? 0 : e.condition), 0) / eq.length;
    const spy = sim.spy.state.agents.length > 0 && sim.time.day >= 3 ? -8 : 0;
    const score = avg.discipline * 0.4 + cond * 0.35 + avg.morale * 0.25 + spy - sim.ci.state.wrongArrests * 4;
    const good = score >= 64;
    if (good) {
      sim.supply.state.shortage = Math.max(sim.supply.state.shortage, 1.25);
      this.schedule('shortage_end', sim.now + 2880);
      sim.relations.event('inspection_good');
      sim.missions.addScore(6);
    } else {
      sim.relations.event('inspection_bad');
      sim.missions.addScore(-4);
    }
    sim.radio.send(`Инспектор (${fullName(n)})`, good ? 'Итоги проверки: объект в порядке' : 'Итоги проверки: замечания', good ? `Дисциплина и состояние техники удовлетворительны (дисциплина ${Math.round(avg.discipline)}, техника ${Math.round(cond)}%). Доложу в штаб положительно; снабжение объекта будет усилено.` : `Замечания: ${avg.discipline < 60 ? 'слабая дисциплина; ' : ''}${cond < 60 ? 'запущена техника; ' : ''}${avg.morale < 50 ? 'подавленное настроение людей; ' : ''}${spy ? 'на объекте до сих пор не выявлен агент; ' : ''}доложу в штаб как есть.`, 'urgent', 'inspection', undefined, false);
    const v = this.visitor(n.id);
    if (v) v.state = 'denied';
    sim.npcs.clearGoal(n);
  }

  private tickVisitors(): void {
    const sim = this.sim;
    for (const v of this.state.visitors) {
      if (v.verifyAt && !v.verified && sim.now >= v.verifyAt) {
        v.verified = true;
        const n = sim.npcs.byId(v.id);
        if (n) sim.radio.send('Штаб корпуса', `Ответ на запрос: ${n.last}`, v.legit ? `Подтверждаем: ${rankName(n)} ${n.last} действительно направлен в ваше распоряжение.` : `${rankName(n)} ${n.last} в списках направленных к вам НЕ значится. Задержите его.`, 'urgent', 'verify', { id: v.id, legit: v.legit });
      }
      // долго ждать у шлагбаума никто не станет
      if (v.state === 'waiting' && sim.now - v.since > 420 && v.kind !== 'courier') {
        v.state = 'denied';
        const n = sim.npcs.byId(v.id);
        if (n) sim.npcs.clearGoal(n);
      }
    }
    for (let i = this.state.scheduled.length - 1; i >= 0; i--) {
      const e = this.state.scheduled[i];
      if (e.name === 'suspicious_result' && sim.now >= e.at) {
        this.state.scheduled.splice(i, 1);
        const v = this.visitor(e.data.id);
        const n = sim.npcs.byId(e.data.id);
        if (!v || !n) continue;
        const ci = sim.npcs.first('ci_officer');
        const from = ci ? `Контрразведка (${fullName(ci)})` : 'Контрразведка';
        if (v.legit) {
          sim.radio.send(from, `${n.last}: проверен, отпущен`, `Задержанный ${n.position.toLowerCase()} ${n.last} проверен через бургомистра. Личность подтверждена, отпущен.`, 'routine', 'ci', undefined, false);
        } else {
          sim.enemy.state.intel = Math.max(0, sim.enemy.state.intel - 6);
          sim.enemy.state.nextRecon = sim.now + 900;
          sim.missions.addScore(4);
          sim.radio.send(from, `${n.last}: разведчик противника`, `Задержанный ${n.last} раскололся: послан считать посты и искать подходы к ограждению. Противник готовит вылазку диверсионной группы. Отправлен в штаб.`, 'urgent', 'ci', undefined, false);
        }
        v.state = 'done';
        sim.ci.release(n.id, 'проверка завершена');
        sim.npcs.remove(n.id);
      } else if (e.name === 'hq_displeased' && sim.now >= e.at) {
        this.state.scheduled.splice(i, 1);
        sim.radio.send('Штаб корпуса', 'Недоумение штаба', 'Вы отправили назад офицера, назначенного к вам приказом. Впредь проверяйте запросом, а не отказом.', 'routine', 'hq');
      }
    }
  }

  /** Цели прибывших на объект. */
  option(n: NpcState): GoalOption | null {
    const v = this.visitor(n.id);
    if (!v || n.status !== 'active') {
      // участники ссоры
      const c = this.state.conflict;
      if (c && !c.resolved && (c.a === n.id || c.b === n.id) && n.status === 'active') {
        const P = this.sim.layout.points.conflict;
        const first = c.a === n.id;
        return {
          key: 'conflict',
          score: 64,
          task: 'Выясняет отношения с сослуживцем',
          plan: () => [{ k: 'go', x: P.x + (first ? -0.6 : 0.6), z: P.z, tol: 0.5 }, { k: 'do', anim: 'argue', dur: 20, yaw: first ? Math.PI / 2 : -Math.PI / 2 }],
        };
      }
      return null;
    }
    const sim = this.sim;
    const P = sim.layout.points;
    if (v.state === 'done') return null;
    if (v.state === 'denied') {
      return { key: 'visitor:leave', score: 96, task: 'Покидает объект', plan: () => [{ k: 'go', x: P.road_far.x, z: P.road_far.z, tol: 1.5 }, { k: 'call', fn: 'event.leave' }] };
    }
    if (v.state === 'arriving' || v.state === 'waiting') {
      return { key: 'visitor:gate', score: 70, task: 'Ждёт на КПП', plan: () => [{ k: 'go', x: P.gate_in.x, z: P.gate_in.z, tol: 1 }, { k: 'call', fn: 'event.arrive' }] };
    }
    // допущен
    if (v.kind === 'courier') {
      return {
        key: 'visitor:courier',
        score: 80,
        task: 'Доставляет пакет командиру',
        plan: () => {
          const p = sim.player;
          const steps: Step[] = [{ k: 'follow', target: 'player', dist: 2.4, run: true, until: sim.now + 4 }];
          if (dist(n.x, n.z, p.x, p.z) < 3.2) return [{ k: 'call', fn: 'event.courier' }, { k: 'do', anim: 'attention', dur: 2 }, { k: 'go', x: P.road_far.x, z: P.road_far.z, tol: 1.5 }, { k: 'call', fn: 'event.leave' }];
          return steps;
        },
      };
    }
    if (v.kind === 'inspector') {
      const insp = this.state.inspection;
      if (!insp) return { key: 'visitor:arrive', score: 70, task: 'Прибыл с проверкой', plan: () => [{ k: 'call', fn: 'event.arrive' }, { k: 'do', anim: 'idle', dur: 1 }] };
      return {
        key: 'visitor:inspect',
        score: 70,
        task: 'Проверяет объект',
        plan: () => {
          const tags = ['form_adj', 'post_portal', 'ws_bench', 'ammo_pick', 'cc_map', 'mess', 'bcp'];
          const steps: Step[] = [];
          for (const t of tags) {
            const sp = sim.layout.byTag(t)[0];
            if (sp) steps.push({ k: 'go', x: sp.x, z: sp.z, tol: 1.2 }, { k: 'do', anim: sim.rng.pick(['inspect', 'write'] as const), dur: sim.rng.range(5, 9) });
          }
          steps.push({ k: 'call', fn: 'event.inspected' });
          return steps;
        },
      };
    }
    return { key: 'visitor:arrive', score: 70, task: 'Следует в штаб', plan: () => [{ k: 'go', x: P.gate_in.x, z: P.gate_in.z - 6, tol: 1.5 }, { k: 'call', fn: 'event.arrive' }] };
  }

  save(): unknown {
    return this.state;
  }

  load(d: any): void {
    this.state = d;
  }
}
