/**
 * DialogueSystem — контекстное взаимодействие с людьми: доклады, приказы,
 * кадровые решения, расследование. Меню строится по должности собеседника и
 * обстановке; тот же диалог доступен по телефону (без личных действий).
 */
import { CLEARANCE_NAMES } from '../core/constants';
import { ALERT_NAMES, type AlertLevel, type EquipmentId, type NpcState, type UnitId } from '../core/types';
import { UNIT_NAMES } from '../data/names';
import { ZONES } from '../world/layout';
import { SHELLS } from './BallisticsSystem';
import { fullName, rankName } from './DocumentSystem';
import type { Sim } from './Sim';
import { WorldTimeSystem } from './WorldTimeSystem';

export interface DialogueOption {
  id: string;
  text: string;
  disabled?: boolean;
}

export interface DialogueView {
  npcId: string | null;
  title: string;
  subtitle: string;
  text: string;
  options: DialogueOption[];
  remote: boolean;
}

const SECTORS: [string, string][] = [
  ['east', 'восточный сектор'],
  ['west', 'западный сектор'],
  ['south', 'южный сектор и КПП'],
  ['inner', 'внутренний двор'],
  ['tunnels', 'тоннели'],
  ['perimeter', 'весь периметр'],
];

const PHONE: [string, string, NpcState['role']][] = [
  ['battery', 'Батарея (командир батареи)', 'battery_cmd'],
  ['guard', 'Караульное помещение (начальник караула)', 'guard_sgt'],
  ['staff', 'Штаб (начальник штаба)', 'adjutant'],
  ['workshop', 'Мастерская (старший механик)', 'mech_chief'],
  ['ci', 'Контрразведка', 'ci_officer'],
  ['supply', 'Интендант', 'quartermaster'],
  ['medical', 'Медпункт', 'doctor'],
];

export class DialogueSystem {
  private cur: { npcId: string | null; remote: boolean; menu: string; text: string } | null = null;

  constructor(private sim: Sim) {}

  get active(): boolean {
    return !!this.cur;
  }

  get npcId(): string | null {
    return this.cur?.npcId ?? null;
  }

  close(): void {
    const n = this.cur?.npcId ? this.sim.npcs.byId(this.cur.npcId) : null;
    if (n && n.gesture?.anim === 'attention') n.gesture = null;
    this.cur = null;
  }

  private a(cap = false): string {
    return this.sim.address(cap);
  }

  /** Начать разговор с человеком (лично). */
  open(npcId: string, remote = false): DialogueView | null {
    const sim = this.sim;
    const n = sim.npcs.byId(npcId);
    if (!n || n.status === 'dead' || n.hostile) return null;
    if (n.anim === 'sleep' && !remote) {
      this.cur = { npcId, remote, menu: 'sleep', text: '(Спит. Будить без нужды не стоит — усталый солдат хуже работает.)' };
      return this.view();
    }
    let text: string;
    if (!remote) {
      sim.npcs.gesture(n, 'attention', 600, 'player');
      if (n.flags.dozing) {
        n.flags.dozing = false;
        sim.relations.offence(n, 'сон на посту');
        text = `(Часовой вздрагивает и вытягивается.) Виноват, ${this.a()}! Задремал…`;
      } else if (n.status === 'wounded') text = `${this.a(true)}… ранен. Простите, встать не могу.`;
      else if (sim.ci.isDetained(n.id)) text = `${this.a(true)}, меня задержали. Это недоразумение, прошу разобраться.`;
      else if (sim.events.conflictOf(n.id)) text = `${this.a(true)}! Рассудите нас. Он первый начал!`;
      else text = `${this.a(true)}! ${rankName(n)[0].toUpperCase()}${rankName(n).slice(1)} ${n.last}, ${n.position.toLowerCase()}.`;
    } else {
      text = `${n.position}, ${rankName(n)} ${n.last} у аппарата. Слушаю, ${this.a()}.`;
    }
    this.cur = { npcId, remote, menu: 'root', text };
    sim.bus.emit('dialogue:talked', { id: npcId });
    return this.view();
  }

  /** Снять трубку телефона. */
  openPhone(): DialogueView {
    const sim = this.sim;
    const ok = sim.resources.state.wire;
    this.cur = { npcId: null, remote: true, menu: 'phone', text: ok ? 'Коммутатор слушает. С кем соединить?' : 'В трубке тишина. Телефонная связь не работает.' };
    return this.view()!;
  }

  view(): DialogueView | null {
    const c = this.cur;
    if (!c) return null;
    const sim = this.sim;
    const n = c.npcId ? sim.npcs.byId(c.npcId) : undefined;
    const title = n ? `${rankName(n)} ${n.first} ${n.last}` : 'Полевой телефон';
    const subtitle = n ? `${n.position} · ${UNIT_NAMES[n.unit]}${c.remote ? ' · по телефону' : ''}` : 'Внутренняя связь объекта';
    return { npcId: c.npcId, title, subtitle, text: c.text, options: this.options(), remote: c.remote };
  }

  private options(): DialogueOption[] {
    const c = this.cur!;
    const sim = this.sim;
    const o: DialogueOption[] = [];
    const add = (id: string, text: string, disabled = false) => o.push({ id, text, disabled });
    if (c.menu === 'phone') {
      if (sim.resources.state.wire) {
        for (const [id, label, role] of PHONE) add('ph:' + id, label, !sim.npcs.first(role));
        if (sim.events.waitingVisitor()) add('ph:kpp', 'КПП (прибывший ждёт решения)');
      }
      add('close', 'Положить трубку');
      return o;
    }
    const n = sim.npcs.byId(c.npcId!)!;
    if (c.menu === 'sleep') {
      add('wake', 'Разбудить');
      add('file', 'Личное дело');
      add('close', 'Не будить');
      return o;
    }
    const back = () => add('back', '← Назад');
    switch (c.menu) {
      case 'root': {
        const visitor = sim.events.visitor(n.id);
        const conflict = sim.events.conflictOf(n.id);
        if (visitor && visitor.state === 'waiting') {
          add('v:admit', visitor.kind === 'suspicious' ? 'Задержать для проверки контрразведкой' : 'Пропустить на объект');
          add('v:deny', 'Отказать и выпроводить');
          if (visitor.kind !== 'suspicious') add('v:verify', 'Запросить штаб: направляли ли его к нам', visitor.verifyAt > 0);
          if (!c.remote) add('doc', 'Ваши документы');
          add('close', 'Пусть ждёт');
          return o;
        }
        if (conflict) {
          add('c:a', `Виноват ${fullName(conflict.a)} — выговор`);
          add('c:b', `Виноват ${fullName(conflict.b)} — выговор`);
          add('c:both', 'Обоим — наряд вне очереди');
          add('c:peace', 'Разойтись. Ещё раз увижу — пеняйте на себя');
          add('close', 'Уйти');
          return o;
        }
        add('report', 'Доложите обстановку');
        if (this.orderList(n).length) add('m:orders', 'Приказы…');
        if (!c.remote) add('doc', 'Ваши документы');
        add('file', 'Личное дело');
        if (!c.remote && n.unit !== 'external') add('m:personnel', 'Кадровые решения…');
        if (n.unit !== 'external') add('m:invest', 'Расследование…');
        add('close', sim.command.following(n) ? 'Продолжайте следовать за мной' : 'Свободны');
        break;
      }
      case 'orders':
        for (const [id, text, dis] of this.orderList(n)) add(id, text, !!dis);
        back();
        break;
      case 'sector':
        for (const [id, name] of SECTORS) add('sector:' + id, `Усилить: ${name}`);
        back();
        break;
      case 'alert':
        ALERT_NAMES.forEach((name, i) => add('alert:' + i, `Уровень: ${name}`, sim.alert.level === i));
        add('blackout', sim.alert.state.blackout ? 'Отменить светомаскировку' : 'Объявить светомаскировку (погасить огни двора)');
        back();
        break;
      case 'repairs': {
        const list = sim.repair.all().filter((e) => e.broken || e.condition < 62);
        if (!list.length) add('noop', 'Вся техника исправна', true);
        for (const e of list) add('prio:' + e.id, `Первым делом: ${e.name} (${e.broken ? 'неисправно' : Math.round(e.condition) + '%'})`);
        back();
        break;
      }
      case 'personnel': {
        const off = sim.relations.hasOffence(n);
        add('p:commend', 'Объявить благодарность');
        add('p:promote', 'Повысить в звании');
        add('p:reprimand', `Выговор${off ? ` (за: ${off})` : ''}`);
        add('p:duty', 'Наряд вне очереди');
        add('p:arrest', 'Сутки ареста на гауптвахте');
        add('p:leave', 'Отпуск на двое суток');
        for (const u of sim.officers.vacancies()) add('p:appoint:' + u, `Назначить командиром: ${UNIT_NAMES[u]}`);
        if (n.rank < 8) add('m:transfer', 'Перевести в другое подразделение…');
        back();
        break;
      }
      case 'transfer':
        for (const u of ['gun1', 'gun2', 'gun3', 'guard'] as UnitId[]) add('tr:' + u, UNIT_NAMES[u], n.unit === u);
        back();
        break;
      case 'invest': {
        const cs = sim.ci.case(n.id);
        add('i:seen', 'Не замечали ли вы чего-нибудь необычного?');
        add('m:alibi', 'Где вы были во время происшествия?…');
        add('i:smoke', 'Что курите?');
        add('i:boot', 'Какой у вас размер сапог?');
        add('i:watch', cs?.surveillance ? 'Снять наружное наблюдение' : 'Установить за ним наружное наблюдение');
        add('i:restrict', cs?.restricted ? 'Вернуть допуск' : 'Ограничить допуск общими зонами');
        if (sim.ci.isDetained(n.id)) add('i:release', 'Отпустить задержанного');
        else add('i:summon', sim.ci.state.summoned[n.id] ? 'Отпустить с допроса' : 'Вызвать на допрос в отдел контрразведки');
        add('m:handover', 'Арестовать и передать дело контрразведке…');
        back();
        break;
      }
      case 'alibi': {
        const times = this.incidentTimes();
        if (!times.length) add('noop', 'Пока не о чем спрашивать: происшествий с установленным временем нет', true);
        for (const t of times) add('alibi:' + Math.round(t.t), `…${t.label}?`);
        back();
        break;
      }
      case 'handover':
        add('i:handover', 'Да. Арестовать.');
        back();
        break;
    }
    return o;
  }

  private incidentTimes(): { t: number; label: string }[] {
    const sim = this.sim;
    const out: { t: number; label: string }[] = [];
    for (const c of sim.ci.foundClues()) {
      if (c.trait !== 'time' || typeof c.value !== 'number') continue;
      if (out.some((x) => Math.abs(x.t - (c.value as number)) < 20)) continue;
      out.push({ t: c.value, label: `в ${WorldTimeSystem.clock(c.value)} ${Math.floor(c.value / 1440) + 1}-го дня` });
    }
    for (const s of sim.sabotage.state.list) {
      if (!s.discovered || out.some((x) => Math.abs(x.t - s.plantedAt) < 20)) continue;
      out.push({ t: s.plantedAt, label: `в ${WorldTimeSystem.clock(s.plantedAt)} ${Math.floor(s.plantedAt / 1440) + 1}-го дня` });
    }
    return out.slice(-5);
  }

  /** Приказы, которые можно отдать этому человеку: [id, текст, недоступно]. */
  private orderList(n: NpcState): [string, string, boolean?][] {
    const sim = this.sim;
    const remote = this.cur?.remote ?? false;
    const L: [string, string, boolean?][] = [];
    if (n.unit === 'external') return L;
    const p = sim.patrols.memberOf(n.id);
    if (p && p.leader === n.id) {
      L.push(['pt:route', 'Продолжить патрулирование'], ['pt:checkall', p.checkAll ? 'Проверять только подозрительных' : 'Проверять всех встречных'], ['pt:follow', 'Патруль — за мной', remote], ['m:sector', 'Усилить сектор…'], ['pt:hold', 'Занять пост здесь', remote], ['pt:return', 'Вернуться на свой маршрут']);
    }
    switch (n.role) {
      case 'guard_sgt':
      case 'security_chief':
        L.push(['ui:patrols', 'Организовать патруль (постовая ведомость)'], ['m:sector', 'Усилить сектор…'], ['m:alert', 'Объявить тревогу…'], ['journal', 'Журнал караула']);
        break;
      case 'adjutant':
        L.push(['m:alert', 'Объявить тревогу…'], ['ui:roster', 'Список личного состава'], ['ui:journal', 'Журнал приказов и донесений']);
        break;
      case 'battery_cmd':
        L.push(['ui:fire', 'К планшету управления огнём'], ['cease', 'Батарее — прекратить огонь'], ['deploy', sim.artillery.gun('gun1').wantDeploy ? 'Укрыть «Конрад» в ангаре' : 'Выкатить «Конрад» на позицию']);
        break;
      case 'gun_cmd': {
        const g = sim.artillery.gun(n.unit as 'gun1');
        L.push(['ui:fire:' + n.unit, 'Подготовить огонь…'], ['cease:' + n.unit, 'Прекратить огонь']);
        if (n.unit === 'gun1') L.push(['deploy', g.wantDeploy ? 'Укрыть установку в ангаре' : 'Выкатить установку на позицию']);
        else L.push(['reloc:' + n.unit, g.atAlt ? 'Вернуться на основную позицию' : 'Перейти на запасную позицию']);
        break;
      }
      case 'mech_chief':
      case 'mechanic':
      case 'electrician':
        L.push(['m:repairs', 'Назначить приоритет ремонта…']);
        break;
      case 'quartermaster':
        L.push(['ui:supply', 'Заявка на снабжение']);
        break;
      case 'ci_officer':
        L.push(['ui:cases', 'Дела и улики'], ['m:alert', 'Объявить тревогу…']);
        break;
      case 'radio_op':
        L.push(['ui:radio', 'Журнал радиограмм']);
        break;
      case 'engineer':
        L.push(['deploy', sim.artillery.gun('gun1').wantDeploy ? 'Укрыть «Конрад» в ангаре' : 'Выкатить «Конрад» на позицию'], ['prio:gun1', 'Первым делом — установка'], ['prio:hoist', 'Первым делом — подъёмник']);
        break;
    }
    if (!remote && !p) {
      if (sim.command.following(n)) L.push(['dismiss', 'Вернуться к своим обязанностям']);
      else L.push(['follow', 'Следуйте за мной']);
    }
    return L;
  }

  private say(text: string, menu?: string): DialogueView | null {
    if (!this.cur) return null;
    this.cur.text = text;
    if (menu) this.cur.menu = menu;
    return this.view();
  }

  /** Выбор пункта меню. Возвращает новое состояние диалога или null, если он закрыт. */
  choose(id: string): DialogueView | null {
    const c = this.cur;
    if (!c) return null;
    const sim = this.sim;
    if (id === 'close') {
      this.close();
      return null;
    }
    if (id === 'noop') return this.view();
    if (id === 'back') {
      c.menu = c.menu === 'sector' || c.menu === 'alert' || c.menu === 'repairs' ? 'orders' : c.menu === 'transfer' ? 'personnel' : c.menu === 'alibi' || c.menu === 'handover' ? 'invest' : 'root';
      return this.view();
    }
    if (id.startsWith('ph:')) {
      const key = id.slice(3);
      if (key === 'kpp') {
        const v = sim.events.waitingVisitor();
        return v ? this.open(v.id, true) : this.say('На КПП никого.');
      }
      const role = PHONE.find((p) => p[0] === key)?.[2];
      const n = role ? sim.npcs.first(role) : undefined;
      if (!n) return this.say('Абонент не отвечает.');
      return this.open(n.id, true);
    }
    const n = sim.npcs.byId(c.npcId!)!;
    if (id.startsWith('m:')) {
      c.menu = id.slice(2);
      if (c.menu === 'handover') c.text = `${sim.npcs.first('ci_officer') ? 'Мнение контрразведки: ' + sim.ci.opinion(n.id) : ''} Арестовать ${fullName(n)}?`;
      return this.view();
    }
    if (id.startsWith('ui:')) {
      const [, panel, arg] = id.split(':');
      this.close();
      sim.bus.emit('ui:open', { panel, arg });
      return null;
    }
    const A = this.a();
    switch (id) {
      case 'wake':
        sim.npcs.clearGoal(n);
        n.anim = 'idle';
        n.fatigue = Math.min(100, n.fatigue + 4);
        n.attitude = Math.max(0, n.attitude - 1);
        return this.open(n.id);
      case 'report':
        return this.say(this.report(n));
      case 'doc':
        sim.bus.emit('ui:open', { panel: 'doc', arg: n.id });
        return this.say(`Пожалуйста, ${A}.`);
      case 'file':
        sim.bus.emit('ui:open', { panel: 'personnel', arg: n.id });
        return this.view();
      case 'journal': {
        const j = sim.guard.state.journal.slice(-6);
        return this.say(j.length ? j.map((e) => `${WorldTimeSystem.clock(e.t)} — ${e.text}`).join('\n') : 'В журнале записей нет.');
      }
      case 'follow':
        sim.command.issue('follow', n, 'Сопровождать командира');
        this.close();
        sim.npcs.speak(n, `Слушаюсь, ${A}!`);
        return null;
      case 'dismiss':
        sim.command.dismiss(n);
        return this.say(`Слушаюсь, ${A}. Возвращаюсь к обязанностям.`);
      case 'cease':
        sim.artillery.ceaseFire();
        return this.say('Слушаюсь! Батарея, стой! Прекратить огонь!');
      case 'deploy': {
        const g = sim.artillery.gun('gun1');
        const err = sim.artillery.setDeploy(!g.wantDeploy);
        if (err) return this.say(err);
        sim.command.issue('deploy', n, g.wantDeploy ? 'Выкатить «Конрад» на позицию' : 'Укрыть «Конрад» в ангаре', {}, 1);
        return this.say(g.wantDeploy ? `Слушаюсь! Расчёт к установке, выкатываем. Минут двадцать, ${A}.` : 'Слушаюсь! Убираем установку в ангар.');
      }
      case 'blackout':
        sim.alert.state.blackout = !sim.alert.state.blackout;
        return this.say(sim.alert.state.blackout ? 'Светомаскировка объявлена. Огни двора погашены.' : 'Светомаскировка отменена.');
      case 'pt:route':
      case 'pt:return': {
        const p = sim.patrols.memberOf(n.id);
        if (p) sim.patrols.setMode(p, 'route');
        return this.say(`Слушаюсь, ${A}! Продолжаем по маршруту.`);
      }
      case 'pt:checkall': {
        const p = sim.patrols.memberOf(n.id);
        if (p) p.checkAll = !p.checkAll;
        return this.say(p?.checkAll ? 'Слушаюсь! Проверяем всех, невзирая на звания.' : 'Слушаюсь! Проверяем по обстановке.');
      }
      case 'pt:follow': {
        const p = sim.patrols.memberOf(n.id);
        if (p) sim.patrols.setMode(p, 'follow');
        this.close();
        sim.npcs.speak(n, `Слушаюсь! Патруль, за ${sim.player.gender === 'f' ? 'госпожой' : 'господином'} оберстом!`);
        return null;
      }
      case 'pt:hold': {
        const p = sim.patrols.memberOf(n.id);
        if (p) sim.patrols.setMode(p, 'post', { x: n.x, z: n.z });
        return this.say(`Слушаюсь! Занимаем пост здесь до вашего приказа.`);
      }
    }
    if (id.startsWith('sector:')) {
      const route = id.slice(7);
      const name = SECTORS.find((s) => s[0] === route)?.[1] ?? route;
      const p = sim.patrols.memberOf(n.id);
      if (p && p.leader === n.id) {
        sim.patrols.setMode(p, 'route', null, route);
        sim.command.issue('sector', n, `Патрулю усилить: ${name}`, {}, 4);
        sim.missions.flag('patrol_created', true);
        return this.say(`Слушаюсь! Переходим: ${name}.`, 'root');
      }
      // сержант сам подбирает людей
      const made = sim.patrols.reinforce(route, 5, n);
      if (!made) return this.say(`Свободных людей нет, ${A}. Все на постах и в патрулях.`, 'root');
      sim.command.issue('reinforce', n, `Усилить: ${name}`, { patrol: made.id }, 5);
      sim.missions.flag('patrol_created', true);
      const l = sim.npcs.byId(made.leader)!;
      return this.say(`Слушаюсь! Выделяю двоих, старший — ${fullName(l)}. На пять часов: ${name}.`, 'root');
    }
    if (id.startsWith('alert:')) {
      const lvl = Number(id.slice(6)) as AlertLevel;
      sim.alert.set(lvl, 'Приказ командира.');
      sim.command.issue('alert', n, `Тревога: ${ALERT_NAMES[lvl]}`, {}, 0.2);
      return this.say(`Слушаюсь! Уровень тревоги — ${ALERT_NAMES[lvl]}.`, 'root');
    }
    if (id.startsWith('prio:')) {
      const eq = id.slice(5) as EquipmentId;
      sim.repair.prioritize(eq);
      sim.command.issue('repair', n, `Ремонт в первую очередь: ${sim.repair.get(eq).name}`, {}, 6);
      return this.say(`Слушаюсь! ${sim.repair.get(eq).name} — в первую очередь.`, 'root');
    }
    if (id.startsWith('cease:')) {
      sim.artillery.ceaseFire([id.slice(6) as 'gun1']);
      return this.say('Слушаюсь! Стой, прекратить огонь!');
    }
    if (id.startsWith('reloc:')) {
      const gid = id.slice(6) as 'gun2';
      const g = sim.artillery.gun(gid);
      const err = sim.artillery.relocate(gid, !g.atAlt);
      if (err) return this.say(err);
      sim.command.issue('relocate', n, `${sim.artillery.gunName(gid)}: сменить позицию`, {}, 2);
      return this.say(`Слушаюсь! Снимаемся. Часа полтора, ${A}.`);
    }
    if (id.startsWith('p:')) return this.personnel(n, id.slice(2));
    if (id.startsWith('tr:')) {
      const err = sim.relations.transfer(n, id.slice(3) as UnitId);
      return this.say(err ?? `Слушаюсь, ${A}. Убываю: ${n.position.toLowerCase()}.`, 'root');
    }
    if (id.startsWith('i:') || id.startsWith('alibi:')) return this.investigate(n, id);
    if (id.startsWith('v:')) {
      const text = id === 'v:verify' ? sim.events.verifyVisitor(n.id) : sim.events.decideVisitor(n.id, id === 'v:admit');
      if (id === 'v:verify') return this.say(text);
      this.close();
      sim.notify(text, 'info');
      return null;
    }
    if (id.startsWith('c:')) {
      const text = sim.events.resolveConflict(id.slice(2) as 'a');
      this.close();
      sim.notify(text, 'info');
      return null;
    }
    return this.view();
  }

  private personnel(n: NpcState, act: string): DialogueView | null {
    const sim = this.sim;
    const A = this.a();
    if (act === 'commend') return this.say(sim.relations.commend(n), 'root');
    if (act === 'promote') {
      const err = sim.relations.promote(n);
      return this.say(err ?? `Благодарю за доверие, ${A}! ${rankName(n)[0].toUpperCase()}${rankName(n).slice(1)} ${n.last} — служу отечеству!`, 'root');
    }
    if (act === 'reprimand' || act === 'duty' || act === 'arrest') {
      const text = sim.relations.punish(n, act);
      if (act === 'arrest') {
        this.close();
        sim.npcs.speak(n, text);
        return null;
      }
      return this.say(text, 'root');
    }
    if (act === 'leave') {
      const err = sim.relations.grantLeave(n);
      if (err) return this.say(err, 'root');
      this.close();
      sim.notify(`${fullName(n)} убыл в отпуск на двое суток.`, 'info');
      return null;
    }
    if (act.startsWith('appoint:')) {
      const err = sim.officers.appoint(act.slice(8) as UnitId, n);
      return this.say(err ?? `Слушаюсь, ${A}! Принимаю командование. Не подведу.`, 'root');
    }
    return this.view();
  }

  private investigate(n: NpcState, id: string): DialogueView | null {
    const sim = this.sim;
    const A = this.a();
    if (id === 'i:seen') return this.say(sim.ci.testimony(n).join('\n'));
    if (id === 'i:smoke') return this.say(n.traits.smokes ? `Курю, ${A}. ${n.traits.smokes}, когда достану.` : `Не курю, ${A}.`);
    if (id === 'i:boot') return this.say(`${n.traits.boot}-й, ${A}.${n.traits.leftHanded ? ' (Вы замечаете: честь он отдал неловко — похоже, левша.)' : ''}`);
    if (id === 'i:watch') {
      const on = !sim.ci.case(n.id)?.surveillance;
      const err = sim.ci.surveillance(n.id, on);
      this.close();
      sim.notify(err ?? `${fullName(n)}: наружное наблюдение ${on ? 'установлено' : 'снято'}.`, 'info');
      return null;
    }
    if (id === 'i:restrict') {
      const on = !sim.ci.case(n.id)?.restricted;
      sim.ci.restrict(n.id, on);
      return this.say(on ? `Слушаюсь, ${A}… Но чем я провинился?` : `Благодарю, ${A}.`, 'root');
    }
    if (id === 'i:summon') {
      const on = !sim.ci.state.summoned[n.id];
      sim.ci.summon(n.id, on);
      this.close();
      sim.notify(on ? `${fullName(n)} вызван на допрос в отдел контрразведки.` : `${fullName(n)} отпущен с допроса.`, 'info');
      return null;
    }
    if (id === 'i:release') {
      sim.ci.release(n.id, 'освобождён по приказу командира.');
      n.attitude = Math.min(100, n.attitude + 3);
      return this.say(`Благодарю, ${A}!`, 'root');
    }
    if (id === 'i:handover') {
      sim.ci.handOver(n.id);
      this.close();
      sim.notify(`${fullName(n)} арестован. Дело передано контрразведке, итог следствия — через несколько часов.`, 'warn');
      return null;
    }
    if (id.startsWith('alibi:')) {
      const t = Number(id.slice(6));
      const secret = sim.spy.secretAct(n.id, t);
      let zone: string;
      let text: string;
      if (secret) {
        zone = n.rank >= 8 ? 'officers' : 'barracks';
        text = `Спал, ${A}. В ${n.rank >= 8 ? 'офицерском помещении' : 'казарме'}, где же ещё.`;
      } else {
        const entry = n.log.reduce<{ t: number; zone: string; act: string } | null>((b, e) => (!b || Math.abs(e.t - t) < Math.abs(b.t - t) ? e : b), null);
        if (!entry || Math.abs(entry.t - t) > 40) return this.say(`Точно не вспомню, ${A}. Давно было.`);
        zone = entry.zone;
        text = `В это время я был: ${(ZONES[entry.zone as keyof typeof ZONES]?.name ?? entry.zone).toLowerCase()}. ${entry.act}.`;
      }
      const contra = sim.ci.contradicts(n.id, t, zone);
      if (contra) {
        sim.ci.addEvidence(n.id, 'contradiction', `Показания о ${WorldTimeSystem.clock(t)} расходятся с записью: «${contra.text}»`, 'Допрос', 2.6);
        text += `\n(Это расходится с имеющимися сведениями: «${contra.text}» — ${contra.source}.)`;
      }
      return this.say(text);
    }
    return this.view();
  }

  /** Доклад по должности. */
  report(n: NpcState): string {
    const sim = this.sim;
    const A = this.a();
    const res = sim.resources;
    const patrol = sim.patrols.memberOf(n.id);
    if (n.status === 'wounded') return `Ранен, ${A}. Санитар говорит — отлежусь.`;
    if (patrol) {
      sim.missions.flag('report_guard', true);
      return `${this.a(true)}! ${sim.patrols.report(patrol)}`;
    }
    if (n.goal.startsWith('post:')) {
      sim.missions.flag('report_guard', true);
      const last = sim.guard.state.journal.slice(-1)[0];
      return `${this.a(true)}! Пост — ${sim.guard.postName(n.goal.slice(5))}. За время несения службы ${last && sim.now - last.t < 240 ? 'отмечено: ' + last.text : 'происшествий не случилось.'}`;
    }
    switch (n.role) {
      case 'adjutant': {
        const mp = res.manpower();
        const av = sim.relations.averages();
        const vac = sim.officers.vacancies();
        return `По списку ${mp.total}, в строю ${mp.fit}. Настроение людей ${av.morale > 62 ? 'бодрое' : av.morale > 45 ? 'ровное' : 'подавленное'}, дисциплина ${av.discipline > 68 ? 'твёрдая' : av.discipline > 52 ? 'удовлетворительная' : 'хромает'}. Тревога: ${ALERT_NAMES[sim.alert.level]}.${vac.length ? ' Без командира: ' + vac.map((u) => UNIT_NAMES[u]).join(', ') + '.' : ''} Непрочитанных донесений: ${sim.radio.unread()}.`;
      }
      case 'battery_cmd':
        return sim.artillery.guns().map((g) => sim.crewAI.status(g)).join('\n') + `\nНа складах: ${(Object.keys(SHELLS) as (keyof typeof SHELLS)[]).map((s) => `${SHELLS[s].short} ${res.ammo(s)}`).join(', ')}.`;
      case 'gun_cmd':
      case 'gunner':
      case 'loader':
      case 'assistant':
      case 'bearer':
        return n.unit.startsWith('gun') ? sim.crewAI.status(sim.artillery.gun(n.unit as 'gun1')) : 'Жалоб нет.';
      case 'guard_sgt':
      case 'security_chief': {
        const posts = sim.guard.requiredPosts().length;
        const pat = sim.patrols.patrols.filter((p) => sim.patrols.activeNow(p)).length;
        const last = sim.guard.state.journal.slice(-2).map((e) => `${WorldTimeSystem.clock(e.t)} — ${e.text}`);
        sim.missions.flag('report_guard', true);
        return `Постов выставлено ${posts}, патрулей ${pat}, в резерве ${sim.guard.reserve().length} чел.${last.length ? '\nПоследние записи журнала:\n' + last.join('\n') : ' Происшествий нет.'}`;
      }
      case 'mech_chief':
      case 'mechanic':
      case 'electrician': {
        const bad = sim.repair.all().filter((e) => e.broken || e.condition < 62);
        if (!bad.length) return `Техника в порядке, ${A}. Запчастей: ${Math.round(res.get('parts'))} компл.`;
        return bad.map((e) => `${e.name}: ${e.broken ? 'неисправно' + (e.finding ? ' — ' + e.finding : ', причина выясняется') : 'износ, ' + Math.round(e.condition) + '%'}`).join('\n') + `\nЗапчастей: ${Math.round(res.get('parts'))} компл.`;
      }
      case 'quartermaster': {
        const r = res.res;
        const days = r.food / Math.max(1, res.manpower().total * 3);
        const req = sim.supply.activeRequest();
        return `Топлива ${Math.round(r.fuel)} л (примерно на ${Math.round(r.fuel / 360)} сут.), продовольствия на ${days.toFixed(1)} сут., медикаментов ${Math.round(r.medicine)}, запчастей ${Math.round(r.parts)}. ${req ? 'Колонна в пути.' : 'Колонна на месте, можно подавать заявку.'}`;
      }
      case 'ci_officer': {
        const cases = sim.ci.cases().filter((c) => c.status !== 'cleared' && c.status !== 'convicted');
        if (!cases.length) return `Дел в производстве нет, ${A}. Но это не значит, что на объекте чисто.`;
        return cases
          .slice(0, 5)
          .map((c) => {
            const s = sim.npcs.byId(c.suspect);
            return s ? `${fullName(s)}: ${sim.ci.opinion(c.suspect)}` : '';
          })
          .filter(Boolean)
          .join('\n');
      }
      case 'radio_op':
        return `Радиосвязь: ${res.state.radio ? 'есть' : 'НЕТ'}. Телефон: ${res.state.wire ? 'работает' : 'НЕ РАБОТАЕТ'}. Метеосводка получена в ${WorldTimeSystem.clock(sim.artillery.state.met.t)}.`;
      case 'doctor':
      case 'medic': {
        const w = sim.npcs.list.filter((o) => o.status === 'wounded');
        return `${w.length ? 'Раненых: ' + w.map((o) => fullName(o)).join(', ') + '.' : 'Раненых нет.'} Медикаментов: ${Math.round(res.get('medicine'))} компл.`;
      }
      case 'engineer': {
        const g = sim.artillery.gun('gun1');
        return `${sim.crewAI.status(g)}\nПодъёмник: ${sim.repair.get('hoist').broken ? 'неисправен — заряжание вручную, втрое дольше' : 'исправен'}. Спецснарядов: ${res.ammo('sp38')}.`;
      }
      case 'cook':
      case 'cook_helper':
        return `Продуктов на ${(res.res.food / Math.max(1, res.manpower().total * 3)).toFixed(1)} суток, ${A}.`;
      case 'clerk':
        return `Картотека в порядке, ${A}. Личные дела всех ${res.manpower().total} человек на месте. Допуск «${CLEARANCE_NAMES[3]}» и выше — у ${sim.npcs.list.filter((o) => o.doc.clearance >= 3 && o.status !== 'dead').length} человек.`;
      default:
        if (n.fatigue > 75) return `Устал, ${A}. Но служба есть служба.`;
        if (n.morale < 40) return `Тяжело, ${A}. Люди ропщут.`;
        return `Всё в порядке, ${A}. Жалоб нет.`;
    }
  }
}
