/**
 * Панели, открываемые по необходимости: журнал командира, личные дела, документы
 * и картотека, постовая ведомость, заявка на снабжение, осмотр оборудования, отдых.
 */
import { CLEARANCE_NAMES } from '../core/constants';
import { ALERT_NAMES, type AlertLevel, type Clearance, type EquipmentId, type NpcState, type PersonalDocument, type SupplyItem } from '../core/types';
import { UNIT_NAMES } from '../data/names';
import { ZONES } from '../world/layout';
import { SHELLS } from '../sim/BallisticsSystem';
import { fullName, rankName } from '../sim/DocumentSystem';
import { ITEM_NAMES } from '../sim/ResourceSystem';
import { SLOT_NAMES, SLOTS } from '../sim/SaveSystem';
import { QUALITY_NAMES } from '../view/Quality';
import { TARGET_NAMES } from '../sim/SabotageSystem';
import { ITEM_WEIGHT, TRUCK_CAPACITY } from '../sim/SupplySystem';
import { WorldTimeSystem } from '../sim/WorldTimeSystem';
import { bar, clear, h, softRefresh, stepper } from './dom';
import type { UIManager } from './UIManager';

export interface PanelResult {
  title: string;
  refresh?: () => void;
  dispose?: () => void;
}

export type PanelFn = (ui: UIManager, body: HTMLElement, arg: any, extra: HTMLElement) => PanelResult;

const GROUP_NAMES: Record<string, string> = { general: 'общие', tech: 'технические', supply: 'склады', arty: 'огневые позиции', guard: 'караульные', staff: 'штабные', ci: 'контрразведка', secret: 'секретный сектор', medical: 'медицинские' };
const STATUS_NAMES: Record<string, string> = { active: 'в строю', wounded: 'ранен', dead: 'погиб', arrested: 'под арестом', leave: 'в отпуске', away: 'в отъезде' };
const SHIFT_NAMES: Record<string, string> = { day: 'дневная смена (06–18)', night: 'ночная смена (18–06)', flex: 'ненормированный день' };

function stamp(t: number): string {
  return `${Math.floor(t / 1440) + 1}-й день ${WorldTimeSystem.clock(t)}`;
}

function qual(v: number, words: [string, string, string, string]): string {
  return v < 30 ? words[0] : v < 55 ? words[1] : v < 78 ? words[2] : words[3];
}

// ------------------------------------------------------------------ журнал

const journal: PanelFn = (ui, body, arg, extra) => {
  const sim = ui.game.sim;
  let tab: string = arg?.tab ?? 'objectives';
  let openMsg: string | null = arg?.id ?? null;
  const tabs: [string, string][] = [
    ['objectives', 'Задачи'],
    ['messages', 'Донесения'],
    ['orders', 'Приказы'],
    ['roster', 'Люди'],
    ['cases', 'Дела'],
    ['resources', 'Ресурсы'],
    ['guard', 'Караул'],
    ['system', 'Система'],
  ];
  const renderTabs = (): void => {
    clear(extra);
    for (const [id, name] of tabs) {
      extra.append(h('button', { class: tab === id ? 'on' : '', onclick: () => ((tab = id), render()) }, name));
    }
  };
  const render = (): void => {
    renderTabs();
    clear(body);
    fill(body);
  };
  const fill = (t: HTMLElement): void => {
    if (tab === 'objectives') {
      const m = sim.missions;
      t.append(h('h3', null, m.state.title || 'Кампания'));
      for (const o of m.visible()) t.append(h('div', { class: o.done ? 'good' : o.failed ? 'bad' : o.optional ? 'muted' : '' }, `${o.done ? '✔' : o.failed ? '✘' : '▸'} ${o.text}${o.optional ? ' (необязательно)' : ''}`));
      const vac = sim.officers.vacancies();
      if (vac.length) t.append(h('h3', null, 'Требуют решения'), ...vac.map((u) => h('div', { class: 'amber' }, `Нет командира: ${UNIT_NAMES[u]} — назначьте лично (Кадровые решения в разговоре).`)));
      t.append(h('h3', null, 'Подсказка'), h('div', { class: 'muted pre' }, 'Приказы отдаются людям: подойдите и заговорите, либо снимите трубку телефона.\nОгонь — с планшета управления огнём (командный центр, КП батареи) или через командира орудия.\nКарта района показывает только то, что донесла разведка.'));
    } else if (tab === 'messages') {
      const list = [...sim.radio.messages].filter((m) => m.delivered).reverse();
      if (!list.length) t.append(h('div', { class: 'muted' }, 'Донесений нет.'));
      const box = h('div', { class: 'list' });
      for (const m of list) {
        const open = openMsg === m.id;
        const item = h('div', {
          class: 'item' + (m.read ? '' : ' unread') + (open ? ' sel' : ''),
          onclick: () => {
            m.read = true;
            openMsg = open ? null : m.id;
            render();
          },
        }, h('b', null, `${m.priority === 'secret' ? '[СЕКРЕТНО] ' : m.priority === 'urgent' ? '[СРОЧНО] ' : ''}${m.subject}`), h('small', null, `${stamp(m.t)} · ${m.from}`));
        if (open) item.append(h('div', { class: 'pre', style: 'margin-top:4px' }, m.body));
        box.append(item);
      }
      t.append(box);
    } else if (tab === 'orders') {
      t.append(h('h3', null, 'Огневые задачи'));
      const ms = [...sim.artillery.state.missions].reverse().slice(0, 8);
      if (!ms.length) t.append(h('div', { class: 'muted' }, 'Огневых задач не было.'));
      for (const m of ms) {
        t.append(h('div', { class: 'item' }, h('b', null, `${m.targetName} — ${SHELLS[m.shell].short}, ${m.fired}/${m.kind === 'suppress' ? '…' : m.rounds}`), h('small', null, `${stamp(m.t)} · ${m.status === 'active' ? 'выполняется' : m.status === 'done' ? 'выполнена' : 'отменена'}`), h('div', { class: 'pre muted' }, m.reports.slice(-6).join('\n'))));
      }
      t.append(h('h3', null, 'Приказы'));
      const os = [...sim.command.orders].reverse().slice(0, 14);
      if (!os.length) t.append(h('div', { class: 'muted' }, 'Приказов не отдавалось.'));
      for (const o of os) t.append(h('div', { class: o.status === 'active' ? '' : 'muted' }, `${stamp(o.t)} — ${sim.command.summary(o)} [${o.status === 'active' ? 'действует' : o.status === 'done' ? 'выполнен' : 'снят'}]`));
    } else if (tab === 'roster') {
      const units: Record<string, NpcState[]> = {};
      for (const n of sim.npcs.list) {
        if (n.unit === 'enemy' || n.unit === 'external') continue;
        (units[n.unit] ??= []).push(n);
      }
      for (const [u, list] of Object.entries(units)) {
        t.append(h('h3', null, `${UNIT_NAMES[u]}${sim.officers.vacancy(u as any) ? ' — БЕЗ КОМАНДИРА' : ''}`));
        const box = h('div', { class: 'list' });
        for (const n of list.sort((a, b) => b.rank - a.rank)) {
          box.append(h('div', { class: 'item', onclick: () => ui.openPanel('personnel', n.id) }, h('b', { class: n.status === 'dead' ? 'bad' : n.status !== 'active' ? 'amber' : '' }, `${fullName(n)} ${n.first}`), h('small', null, `${n.position} · ${STATUS_NAMES[n.status]}${n.status === 'active' ? ' · ' + n.task : ''}`)));
        }
        t.append(box);
      }
    } else if (tab === 'cases') {
      casesBody(ui, t);
    } else if (tab === 'resources') {
      resourcesBody(ui, t);
    } else if (tab === 'guard') {
      t.append(h('h3', null, 'Посты'));
      for (const p of sim.guard.requiredPosts()) {
        const id = sim.guard.state.holder[p];
        const n = id ? sim.npcs.byId(id) : undefined;
        t.append(h('div', null, `${sim.guard.postName(p)} — ${n ? fullName(n) : 'НЕ ЗАНЯТ'}`));
      }
      t.append(h('h3', null, 'Патрули'));
      for (const p of sim.patrols.patrols) t.append(h('div', { class: sim.patrols.activeNow(p) ? '' : 'muted' }, `${p.name}: ${sim.patrols.routeName(p)}${sim.patrols.activeNow(p) ? '' : ' (не в смене)'} — ${p.lastReport}`));
      t.append(h('h3', null, 'Журнал караула'));
      const j = [...sim.guard.state.journal].reverse().slice(0, 30);
      if (!j.length) t.append(h('div', { class: 'muted' }, 'Записей нет.'));
      for (const e of j) t.append(h('div', null, `${stamp(e.t)} — ${e.text}`));
    } else if (tab === 'system') {
      systemBody(ui, t, render);
    }
  };
  render();
  // живые вкладки обновляются, только если что-то изменилось, и без сброса прокрутки
  return { title: 'Журнал командира', refresh: () => (tab === 'guard' || tab === 'resources' || tab === 'orders') && softRefresh(body, fill) };
};

function casesBody(ui: UIManager, body: HTMLElement): void {
  const sim = ui.game.sim;
  body.append(h('h3', null, 'Найденные следы'));
  const clues = sim.ci.foundClues();
  if (!clues.length) body.append(h('div', { class: 'muted' }, 'Следов пока не найдено. Осматривайте места происшествий лично.'));
  for (const c of clues) body.append(h('div', null, `${stamp(c.t)} · ${TARGET_NAMES[c.place] ?? c.place}: ${c.text}`));
  body.append(h('h3', null, 'Дела'));
  const cases = sim.ci.cases();
  if (!cases.length) body.append(h('div', { class: 'muted' }, 'Дел не заведено.'));
  for (const c of cases) {
    const n = sim.npcs.byId(c.suspect);
    if (!n) continue;
    const st = c.status === 'convicted' ? 'агент разоблачён' : c.status === 'cleared' ? 'невиновен' : c.status === 'handed' ? 'под следствием' : c.status === 'interrogation' ? 'вызван на допрос' : 'в разработке';
    const cm = sim.ci.clueMatch(n);
    const item = h('div', { class: 'item', onclick: () => ui.openPanel('personnel', n.id) }, h('b', null, `${fullName(n)} — ${n.position}`), h('small', null, `${st}${c.surveillance ? ' · наружное наблюдение' : ''}${c.restricted ? ' · допуск ограничен' : ''}`));
    for (const e of sim.ci.evidenceFor(c.suspect)) item.append(h('div', null, `• ${stamp(e.t)} — ${e.text} (${e.source})`));
    if (cm.match.length) item.append(h('div', { class: 'amber' }, `Приметы сходятся со следами: ${cm.match.length}`));
    if (cm.mismatch.length) item.append(h('div', { class: 'muted' }, `Приметы НЕ сходятся со следами: ${cm.mismatch.length}`));
    for (const note of c.notes.slice(-3)) item.append(h('div', { class: 'muted' }, note));
    body.append(item);
  }
  body.append(h('div', { class: 'muted', style: 'margin-top:8px' }, 'Мнение о деле спрашивайте у офицера контрразведки. Наблюдение, допрос и арест — в разговоре с человеком («Расследование»).'));
}

function resourcesBody(ui: UIManager, body: HTMLElement): void {
  const sim = ui.game.sim;
  const r = sim.resources.res;
  const mp = sim.resources.manpower();
  const t = h('table');
  const row = (a: string, b: string, cls = '') => t.append(h('tr', null, h('th', null, a), h('td', { class: cls }, b)));
  for (const s of Object.keys(SHELLS) as (keyof typeof SHELLS)[]) row(SHELLS[s].name, String(r.ammo[s]), r.ammo[s] < 8 ? 'bad' : '');
  row('Топливо', `${Math.round(r.fuel)} л (≈ ${(r.fuel / 360).toFixed(1)} сут.)`, r.fuel < 500 ? 'bad' : '');
  row('Продовольствие', `${Math.round(r.food)} рационов (≈ ${(r.food / Math.max(1, mp.total * 3)).toFixed(1)} сут.)`, r.food < 160 ? 'bad' : '');
  row('Медикаменты', `${Math.round(r.medicine)} компл.`);
  row('Запчасти', `${Math.round(r.parts)} компл.`, r.parts < 6 ? 'bad' : '');
  row('Электропитание', sim.resources.state.power >= 1 ? 'главный генератор' : sim.resources.state.power > 0 ? 'резервный генератор' : 'ОТСУТСТВУЕТ', sim.resources.state.power >= 1 ? '' : 'bad');
  row('Связь', `радио: ${sim.resources.state.radio ? 'есть' : 'НЕТ'}; телефон: ${sim.resources.state.wire ? 'есть' : 'НЕТ'}`);
  row('Личный состав', `в строю ${mp.fit} из ${mp.total}`);
  body.append(h('h3', null, 'Запасы'), t, h('h3', null, 'Техника'));
  const t2 = h('table');
  for (const e of sim.repair.all()) {
    t2.append(h('tr', null, h('th', null, e.name), h('td', null, e.broken ? h('span', { class: 'bad' }, 'НЕИСПРАВНО') : bar(e.condition, Math.round(e.condition) + '%')), h('td', { class: 'muted' }, e.broken ? (e.finding || 'причина выясняется') + (e.mechanic ? ' · в ремонте' : ' · ждёт механика') : '')));
  }
  body.append(t2);
  const req = sim.supply.activeRequest();
  body.append(h('h3', null, 'Снабжение'), h('div', null, req ? (req.status === 'unloading' ? 'Колонна разгружается.' : `Колонна в пути, ожидается около ${WorldTimeSystem.clock(req.eta)}.`) : 'Колонна на объекте. Заявку принимает интендант.'));
}

function systemBody(ui: UIManager, body: HTMLElement, render: () => void): void {
  const g = ui.game;
  body.append(h('h3', null, 'Сохранение'));
  for (const s of SLOTS) {
    const info = g.save.info(s);
    body.append(
      h('div', { class: 'row' }, h('span', { style: 'flex:1' }, h('b', null, SLOT_NAMES[s]), ' ', h('span', { class: 'muted' }, info ? `${info.label} · ${info.chapter}` : 'пусто')), s !== 'auto' ? h('button', { onclick: () => (g.saveSlot(s), render()) }, 'Сохранить') : null, h('button', { disabled: !info, onclick: () => g.loadSlot(s) && ui.closePanel() }, 'Загрузить')),
    );
  }
  body.append(h('h3', null, 'Настройки'));
  const s = g.settings;
  const sel = h('select', { onchange: (e: Event) => ((s.quality = (e.target as HTMLSelectElement).value as any), g.applySettings()) }, ...(['auto', 'minimal', 'low', 'medium', 'high'] as const).map((q) => h('option', { value: q, selected: s.quality === q }, QUALITY_NAMES[q])));
  body.append(h('div', { class: 'row' }, 'Качество графики: ', sel, h('button', { onclick: () => g.restartGraphics() }, 'Применить (перезапуск)')), h('div', { class: 'muted' }, `Сейчас: ${QUALITY_NAMES[g.qualityLevel]}. Видеочип: ${g.gpuName}`));
  body.append(h('div', { class: 'row' }, 'Чувствительность обзора: ', stepper(() => s.sensitivity, (v) => ((s.sensitivity = Math.max(0.3, Math.min(3, Math.round(v * 10) / 10))), g.applySettings()), 0.1, (v) => v.toFixed(1))));
  body.append(h('div', { class: 'row' }, 'Громкость: ', stepper(() => s.volume, (v) => ((s.volume = Math.max(0, Math.min(1, Math.round(v * 10) / 10))), g.applySettings()), 0.1, (v) => Math.round(v * 100) + '%')));
  body.append(h('div', { class: 'row' }, h('button', { class: s.invertY ? 'on' : '', onclick: () => ((s.invertY = !s.invertY), g.applySettings(), render()) }, 'Инверсия вертикали'), h('button', { class: s.autoRes ? 'on' : '', onclick: () => ((s.autoRes = !s.autoRes), g.applySettings(), render()) }, 'Авторазрешение')));
  body.append(h('div', { class: 'muted' }, `Кадров в секунду: ${Math.round(g.fps())}`));
  body.append(h('h3', null, 'Игра'), h('div', { class: 'row' }, h('button', { class: 'danger', onclick: () => g.toMenu() }, 'Выйти в главное меню')));
}

// ------------------------------------------------------------------ личное дело

const personnel: PanelFn = (ui, body, id: string) => {
  const sim = ui.game.sim;
  const n = sim.npcs.byId(id);
  if (!n) return { title: 'Личное дело' };
  const fill = (out: HTMLElement): void => {
    const t = h('table');
    const row = (a: string, b: any) => t.append(h('tr', null, h('th', null, a), h('td', null, b)));
    row('Фамилия, имя', `${n.last} ${n.first}`);
    row('Звание', rankName(n));
    row('Должность', n.position);
    row('Подразделение', UNIT_NAMES[n.unit]);
    row('Возраст', `${n.age} лет, в армии ${n.serviceYears} ${n.serviceYears === 1 ? 'год' : n.serviceYears < 5 ? 'года' : 'лет'}`);
    row('Состояние', STATUS_NAMES[n.status]);
    row('Опыт', bar(n.skill, qual(n.skill, ['новичок', 'обучен', 'опытный', 'мастер своего дела'])));
    row('Здоровье', bar(n.health, qual(n.health, ['тяжёлое', 'ослаблен', 'удовлетворительное', 'здоров'])));
    row('Усталость', bar(100 - n.fatigue, qual(100 - n.fatigue, ['валится с ног', 'сильно устал', 'утомлён', 'бодр'])));
    row('Мораль', bar(n.morale, qual(n.morale, ['подавлен', 'унылый', 'ровный', 'боевой дух высок'])));
    row('Дисциплина', bar(n.discipline, qual(n.discipline, ['разболтан', 'слабая', 'удовлетворительная', 'образцовая'])));
    row('Отношение к командиру', bar(n.attitude, qual(n.attitude, ['неприязнь', 'настороженное', 'уважение', 'предан'])));
    row('Распорядок', SHIFT_NAMES[n.shift]);
    row('Сейчас', n.status === 'active' ? n.task || '—' : STATUS_NAMES[n.status]);
    row('Допуск', `${CLEARANCE_NAMES[n.doc.clearance]}; зоны: ${n.doc.zones.map((z) => GROUP_NAMES[z]).join(', ') || '—'}`);
    row('Вещевая карточка', `сапоги ${n.traits.boot}-го размера${n.traits.leftHanded ? '; левша' : ''}`);
    const off = sim.relations.hasOffence(n);
    if (off) row('Проступок', h('span', { class: 'amber' }, off));
    out.append(t, h('h3', null, 'Послужной список'), h('div', { class: 'pre' }, n.history.join('\n')));
    const mem = n.memory.slice(-6).reverse();
    if (mem.length) out.append(h('h3', null, 'Что у него на памяти'), h('div', { class: 'pre muted' }, mem.map((m) => `${stamp(m.t)} — ${m.text}`).join('\n')));
    const ev = sim.ci.evidenceFor(n.id);
    if (ev.length) out.append(h('h3', null, 'Материалы контрразведки'), h('div', { class: 'pre' }, ev.map((e) => `${stamp(e.t)} — ${e.text} (${e.source})`).join('\n')));
  };
  fill(body);
  return { title: `Личное дело: ${fullName(n)}`, refresh: () => softRefresh(body, fill) };
};

// ------------------------------------------------------------------ документы

function docCard(title: string, d: PersonalDocument): HTMLElement {
  const t = h('table');
  const row = (a: string, b: string) => t.append(h('tr', null, h('th', null, a), h('td', null, b)));
  row('Владелец', d.holder);
  row('Звание', d.rank);
  row('Часть', d.unit);
  row('Должность', d.position);
  row('Возраст', String(d.age));
  row('Допуск', CLEARANCE_NAMES[d.clearance]);
  row('Зоны', d.zones.map((z) => GROUP_NAMES[z]).join(', ') || '—');
  row('Серия и №', d.serial);
  row('Выдан', d.issued);
  row('Кем выдан', d.issuedBy);
  row('Действителен', d.validUntilDay ? `до ${WorldTimeSystem.date((d.validUntilDay - 1) * 1440)}` : 'бессрочно');
  return h('div', { class: 'card' }, h('h4', null, title), t);
}

const doc: PanelFn = (ui, body, id: string) => {
  const sim = ui.game.sim;
  const n = sim.npcs.byId(id);
  if (!n) return { title: 'Документы' };
  sim.docs.markSeen(n);
  n.lastCheck = sim.now;
  body.append(h('div', { class: 'row', style: 'align-items:stretch' }, docCard('Солдатская книжка и пропуск', n.doc)));
  body.append(h('div', { class: 'muted', style: 'margin-top:8px' }, 'Запись предъявленного документа сохранена. Сверить её с учётной карточкой можно в архиве (картотека личного состава). Расхождения игра не подсвечивает — сравнивайте сами.'));
  return { title: `Документы: ${fullName(n)}` };
};

const archive: PanelFn = (ui, body) => {
  const sim = ui.game.sim;
  let sel: string | null = null;
  const render = (): void => {
    clear(body);
    const left = h('div', { class: 'right', style: 'flex:0.8' });
    const right = h('div', { class: 'right', style: 'flex:1.6' });
    const list = h('div', { class: 'list' });
    for (const n of sim.npcs.list) {
      if (n.unit === 'enemy') continue;
      const seen = !!sim.docs.seenDoc(n.id);
      list.append(h('div', { class: 'item' + (sel === n.id ? ' sel' : ''), onclick: () => ((sel = n.id), render()) }, h('b', null, `${n.last} ${n.first}`), h('small', null, `${rankName(n)} · ${n.position}${seen ? ' · документ у вас записан' : ''}`)));
    }
    left.append(list);
    if (sel) {
      const n = sim.npcs.byId(sel)!;
      const reg = sim.docs.registry(sel);
      const seen = sim.docs.seenDoc(sel);
      const cards = h('div', { class: 'row', style: 'align-items:stretch' });
      cards.append(reg ? docCard('Учётная карточка (архив)', reg) : h('div', { class: 'card' }, h('h4', null, 'Учётная карточка'), 'В картотеке объекта такой человек не значится.'));
      if (seen) cards.append(docCard('Предъявленный документ (ваша запись)', seen));
      right.append(cards);
      if (!seen) right.append(h('div', { class: 'muted', style: 'margin-top:6px' }, 'Документ этого человека вы ещё не смотрели. Попросите предъявить («Ваши документы») — запись появится здесь для сверки.'));
      right.append(h('div', { class: 'row' }, h('button', { onclick: () => ui.openPanel('personnel', n.id) }, 'Личное дело')));
    } else right.append(h('div', { class: 'muted' }, 'Выберите человека. Здесь хранятся подлинные учётные карточки; документ на руках может от них отличаться.'));
    body.append(h('div', { class: 'col2' }, left, right));
  };
  render();
  return { title: 'Архив: картотека личного состава' };
};

// ------------------------------------------------------------------ патрули

const patrols: PanelFn = (ui, body) => {
  const sim = ui.game.sim;
  const draft = { route: 'perimeter', shift: 'night', checkAll: false, leader: '' };
  const render = (): void => {
    clear(body);
    body.append(h('h3', null, 'Действующие патрули'));
    for (const p of sim.patrols.patrols) {
      const l = sim.npcs.byId(p.leader);
      const act = sim.patrols.activeNow(p);
      body.append(
        h('div', { class: 'item' },
          h('b', null, p.name),
          h('small', null, `старший — ${l ? fullName(l) : '—'}; состав ${1 + p.members.length} чел.; допуск «${CLEARANCE_NAMES[p.clearance]}»; ${p.temporary ? 'до ' + WorldTimeSystem.clock(p.shiftEnd) : `смена ${WorldTimeSystem.clock(p.shiftStart)}–${WorldTimeSystem.clock(p.shiftEnd)}`}${act ? '' : ' (сейчас не в смене)'}`),
          h('div', { class: 'row' },
            h('select', { onchange: (e: Event) => (sim.patrols.setMode(p, 'route', null, (e.target as HTMLSelectElement).value), render()) }, ...Object.entries(sim.layout.routeNames).filter(([id]) => (id !== 'secret' || p.clearance >= 4) && (id !== 'staff' || p.clearance >= 3)).map(([id, name]) => h('option', { value: id, selected: p.route === id }, name))),
            h('button', { class: p.checkAll ? 'on' : '', onclick: () => ((p.checkAll = !p.checkAll), render()) }, 'Проверять всех'),
            h('button', { class: 'danger', onclick: () => (sim.patrols.disband(p.id), render()) }, 'Снять'),
          ),
        ),
      );
    }
    body.append(h('h3', null, 'Назначить новый патруль'));
    const pool = sim.npcs.list.filter((n) => n.unit === 'guard' && n.role !== 'guard_sgt' && n.status === 'active' && !sim.patrols.memberOf(n.id) && !n.goal.startsWith('post:'));
    if (pool.length < 2) {
      body.append(h('div', { class: 'muted' }, 'Свободных караульных меньше двух: все на постах и в патрулях. Снимите патруль или дождитесь смены.'));
    } else {
      if (!pool.some((n) => n.id === draft.leader)) draft.leader = pool.sort((a, b) => b.rank - a.rank)[0].id;
      const leader = sim.npcs.byId(draft.leader)!;
      body.append(
        h('div', { class: 'row' }, 'Старший: ', h('select', { onchange: (e: Event) => ((draft.leader = (e.target as HTMLSelectElement).value), render()) }, ...pool.map((n) => h('option', { value: n.id, selected: n.id === draft.leader }, `${fullName(n)} (опыт ${n.skill}, усталость ${Math.round(n.fatigue)})`)))),
        h('div', { class: 'row' }, 'Маршрут: ', h('select', { onchange: (e: Event) => (draft.route = (e.target as HTMLSelectElement).value) }, ...Object.entries(sim.layout.routeNames).filter(([id]) => (id !== 'secret' || leader.doc.clearance >= 4) && (id !== 'staff' || leader.doc.clearance >= 3)).map(([id, name]) => h('option', { value: id, selected: draft.route === id }, name)))),
        h('div', { class: 'row' }, 'Время: ', h('select', { onchange: (e: Event) => (draft.shift = (e.target as HTMLSelectElement).value) }, ...[['night', 'каждую ночь (18–06)'], ['day', 'каждый день (06–18)'], ['now4', 'сейчас, на 4 часа'], ['now8', 'сейчас, на 8 часов']].map(([id, name]) => h('option', { value: id, selected: draft.shift === id }, name)))),
        h('div', { class: 'row' }, h('button', { class: draft.checkAll ? 'on' : '', onclick: () => ((draft.checkAll = !draft.checkAll), render()) }, 'Проверять документы у всех'), h('span', { class: 'muted' }, `Допуск патруля: «${CLEARANCE_NAMES[leader.doc.clearance]}»`)),
        h('div', { class: 'row' },
          h('button', {
            class: 'primary',
            onclick: () => {
              const second = pool.filter((n) => n.id !== draft.leader).sort((a, b) => a.fatigue - b.fatigue)[0];
              const temp = draft.shift.startsWith('now');
              const hours = draft.shift === 'now8' ? 8 : 4;
              sim.patrols.create({
                name: `Патруль: ${sim.layout.routeNames[draft.route]}`,
                leader: draft.leader,
                members: [second.id],
                route: draft.route,
                shiftStart: temp ? sim.now : draft.shift === 'night' ? 1080 : 360,
                shiftEnd: temp ? sim.now + hours * 60 : draft.shift === 'night' ? 360 : 1080,
                clearance: leader.doc.clearance as Clearance,
                checkAll: draft.checkAll,
                temporary: temp,
              });
              sim.guard.log(`По приказу командира назначен патруль: ${sim.layout.routeNames[draft.route]}, старший ${fullName(leader)}.`);
              sim.missions.flag('patrol_created', true);
              render();
            },
          }, 'Назначить патруль'),
        ),
      );
    }
  };
  render();
  return { title: 'Постовая ведомость' };
};

// ------------------------------------------------------------------ снабжение

const supply: PanelFn = (ui, body) => {
  const sim = ui.game.sim;
  const items: Partial<Record<SupplyItem, number>> = {};
  const opts = { escort: false, night: false };
  const STEP: Record<SupplyItem, number> = { he21: 4, cp21: 2, smoke21: 2, he38: 1, sp38: 1, fuel: 200, food: 60, medicine: 5, parts: 3 };
  const render = (): void => {
    clear(body);
    const req = sim.supply.activeRequest();
    if (req) {
      body.append(h('div', { class: 'amber' }, req.status === 'unloading' ? 'Колонна на объекте, идёт разгрузка.' : `Колонна в пути. Ожидается около ${WorldTimeSystem.clock(req.eta)}.`));
      body.append(h('div', { class: 'pre' }, Object.entries(req.items).map(([k, n]) => `${ITEM_NAMES[k as SupplyItem]} — ${n}`).join('\n')));
      return;
    }
    const trucks = sim.supply.availableTrucks().length;
    const cap = trucks * TRUCK_CAPACITY;
    const t = h('table');
    t.append(h('tr', null, h('th', null, 'Груз'), h('th', null, 'На складе'), h('th', null, 'Лимит штаба'), h('th', null, 'Заявка')));
    for (const k of Object.keys(ITEM_NAMES) as SupplyItem[]) {
      const lim = sim.supply.limit(k);
      t.append(h('tr', null, h('td', null, ITEM_NAMES[k]), h('td', null, String(Math.round(sim.resources.get(k)))), h('td', { class: lim ? '' : 'bad' }, String(lim)), h('td', null, stepper(() => items[k] ?? 0, (v) => ((items[k] = Math.max(0, Math.min(lim, v))), update()), STEP[k]))));
    }
    const info = h('div', { class: 'row' });
    const send = h('button', {
      class: 'primary',
      onclick: () => {
        const err = sim.supply.request(items, opts.escort, opts.night);
        if (err) ui.note(err, 'warn');
        else {
          sim.command.issue('supply', sim.npcs.first('quartermaster') ?? null, 'Заявка на снабжение, колонна вышла', {}, 8);
          render();
        }
      },
    }, 'Отправить колонну');
    const update = (): void => {
      const w = sim.supply.weight(items);
      clear(info);
      info.append(h('span', { class: w > cap ? 'bad' : '' }, `Вес: ${Math.round(w)} из ${cap} кг (машин: ${trucks}).`), h('span', { class: 'muted' }, ` Обстановка: ${sim.supply.riskText(opts.escort, opts.night)}.`));
      send.disabled = w <= 0 || w > cap || trucks === 0;
    };
    body.append(t, info, h('div', { class: 'row' }, h('button', { class: opts.escort ? 'on' : '', onclick: () => ((opts.escort = !opts.escort), render()) }, 'Охрана: двое караульных'), h('button', { class: opts.night ? 'on' : '', onclick: () => ((opts.night = !opts.night), render()) }, 'Идти ночью (дольше, безопаснее)'), send));
    body.append(h('div', { class: 'muted' }, 'Рейс занимает 5–7 часов. Пока колонна в пути, водителей и машин на объекте нет; охрана колонны ослабляет караул.'));
    update();
  };
  render();
  return { title: 'Заявка на снабжение' };
};

// ------------------------------------------------------------------ осмотр

const inspect: PanelFn = (ui, body, arg: { kind: string; ref: string }) => {
  const sim = ui.game.sim;
  let found: string[] = [];
  let title = 'Осмотр';
  const search = (place: string): void => {
    found = sim.sabotage.inspect(place);
    if (found.some((f) => f.startsWith('Найдено'))) sim.missions.flag('clue_found', true);
    if (!found.length) found = ['Ничего подозрительного не обнаружено.'];
    render();
  };
  const render = (): void => {
    clear(body);
    if (arg.kind === 'equipment') {
      const e = sim.repair.get(arg.ref as EquipmentId);
      title = e.name;
      body.append(h('div', null, 'Состояние: ', e.broken ? h('span', { class: 'bad' }, 'НЕИСПРАВНО') : bar(e.condition, Math.round(e.condition) + '%')));
      if (e.broken) body.append(h('div', null, `Заключение механика: ${e.finding || 'диагностика ещё не проведена.'}`), h('div', { class: 'muted' }, e.mechanic ? `В ремонте: ${fullName(sim.npcs.byId(e.mechanic)!)}, готовность ${Math.round(e.progress)}%.` : 'Механик ещё не назначен.'));
      if (arg.ref === 'generator') body.append(h('div', { class: 'muted' }, `Топлива на складе: ${Math.round(sim.resources.get('fuel'))} л. Расход — около 15 л/ч.`));
      body.append(h('div', { class: 'row' }, h('button', { onclick: () => search(arg.ref) }, 'Осмотреть на предмет вмешательства'), h('button', { onclick: () => (sim.repair.prioritize(e.id), ui.note(`${e.name}: ремонт в первую очередь.`, 'order')) }, 'Чинить в первую очередь')));
    } else if (arg.kind === 'gun') {
      const g = sim.artillery.gun(arg.ref as 'gun1');
      title = sim.artillery.gunName(g.id);
      body.append(h('div', { class: 'pre' }, sim.crewAI.status(g)));
      const eq = sim.repair.get(g.id);
      if (eq.broken) body.append(h('div', { class: 'bad' }, `Неисправно. ${eq.finding}`));
      const row = h('div', { class: 'row' }, h('button', { onclick: () => search(g.id) }, 'Осмотреть прицел и механизмы'), h('button', { onclick: () => ui.openPanel('fire', { gun: g.id }) }, 'Подготовить огонь…'));
      if (g.id === 'gun1') row.append(h('button', { onclick: () => { const err = sim.artillery.setDeploy(!g.wantDeploy); ui.note(err ?? (g.wantDeploy ? 'Приказ: выкатить установку.' : 'Приказ: укрыть установку.'), err ? 'warn' : 'order'); render(); } }, g.wantDeploy ? 'Укрыть в ангаре' : 'Выкатить на позицию'));
      body.append(row);
    } else {
      const names: Record<string, string> = { ammo1: 'Склад боеприпасов №1', ammo2: 'Склад спецбоеприпасов №2', food: 'Склад продовольствия', fuel: 'Топливохранилище', medicine: 'Аптечный шкаф' };
      title = names[arg.ref] ?? 'Склад';
      const r = sim.resources.res;
      const lines: string[] = [];
      if (arg.ref === 'ammo1') lines.push(`ОФ: ${r.ammo.he21}`, `Бетонобойные: ${r.ammo.cp21}`, `Дымовые: ${r.ammo.smoke21}`);
      if (arg.ref === 'ammo2') lines.push(`38-см фугасные: ${r.ammo.he38}`, `Спецснаряды: ${r.ammo.sp38}`);
      if (arg.ref === 'food') lines.push(`Рационов: ${Math.round(r.food)}`);
      if (arg.ref === 'fuel') lines.push(`Топлива: ${Math.round(r.fuel)} л`);
      if (arg.ref === 'medicine') lines.push(`Медикаментов: ${Math.round(r.medicine)} компл.`);
      body.append(h('div', { class: 'pre' }, lines.join('\n')));
      const place = arg.ref === 'ammo1' ? 'ammo' : arg.ref;
      body.append(h('div', { class: 'row' }, h('button', { onclick: () => search(place) }, 'Осмотреть помещение')));
    }
    if (found.length) body.append(h('h3', null, 'Результат осмотра'), h('div', { class: 'pre' }, found.join('\n')));
  };
  render();
  return { title };
};

// ------------------------------------------------------------------ отдых и тревога

const rest: PanelFn = (ui, body) => {
  const g = ui.game;
  const sim = g.sim;
  const m = sim.time.minuteOfDay;
  const toMorning = ((330 - m + 1440) % 1440) || 1440;
  body.append(
    h('div', { class: 'pre' }, 'Пока вы спите, объект живёт своей жизнью: караул несёт службу, противник не ждёт. Вас разбудят при тревоге и срочных донесениях.'),
    h('div', { class: 'row' }, h('button', { onclick: () => (ui.closePanel(), g.sleep(120)) }, 'Отдохнуть 2 часа'), h('button', { onclick: () => (ui.closePanel(), g.sleep(toMorning)) }, `Спать до подъёма (05:30)`), h('button', { class: 'primary', onclick: () => g.saveSlot('slot1') }, 'Сохранить игру (ячейка 1)')),
  );
  return { title: 'Отдых' };
};

const alert: PanelFn = (ui, body) => {
  const sim = ui.game.sim;
  const render = (): void => {
    clear(body);
    const desc = ['Обычный режим службы.', 'Есть подозрение: патрули проверяют всех, выставлен пост у портала.', 'Угроза подтверждена: весь караул в ружьё, расчёты у орудий, свободные — в казарме.', 'Нападение или проникновение: объект переходит к обороне.'];
    for (let i = 0; i < 4; i++) body.append(h('div', { class: 'row' }, h('button', { class: sim.alert.level === i ? 'on' : '', onclick: () => (sim.alert.set(i as AlertLevel, 'Приказ командира.'), render()) }, ALERT_NAMES[i]), h('span', { class: 'muted' }, desc[i])));
    body.append(h('div', { class: 'row' }, h('button', { class: sim.alert.state.blackout ? 'on' : '', onclick: () => ((sim.alert.state.blackout = !sim.alert.state.blackout), render()) }, 'Светомаскировка'), h('span', { class: 'muted' }, 'Гасит освещение двора: объект не виден с воздуха, но часовые хуже видят ночью.')));
    body.append(h('div', { class: 'muted', style: 'margin-top:6px' }, `Зоны: ${Object.values(ZONES).filter((z) => z.level >= 3).length} закрытых. Длительная тревога изматывает людей.`));
  };
  render();
  return { title: 'Пульт тревоги' };
};

export const PANELS: Record<string, PanelFn> = {
  journal,
  roster: (ui, b, _a, e) => journal(ui, b, { tab: 'roster' }, e),
  cases: (ui, b, _a, e) => journal(ui, b, { tab: 'cases' }, e),
  radio: (ui, b, _a, e) => journal(ui, b, { tab: 'messages' }, e),
  personnel,
  doc,
  archive,
  patrols,
  supply,
  inspect,
  rest,
  alert,
};
