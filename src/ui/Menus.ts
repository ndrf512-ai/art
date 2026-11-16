/** Главное меню, выбор командира, пауза, заставки глав и итог кампании. */
import { SLOT_NAMES, SLOTS } from '../sim/SaveSystem';
import { QUALITY_NAMES } from '../view/Quality';
import type { Gender } from '../sim/Sim';
import { clear, h } from './dom';
import type { UIManager } from './UIManager';

function controlsHelp(touch: boolean): HTMLElement {
  const rows: [string, string][] = touch
    ? [
        ['Левый круг', 'движение (до упора — бег)'],
        ['Палец по экрану', 'обзор'],
        ['Подсказка внизу', 'заговорить / осмотреть'],
        ['«Журнал», «Карта»', 'донесения, люди, дела, карта района'],
        ['«×1»', 'ускорение времени'],
        ['«Назад»', 'закрыть окно / пауза'],
      ]
    : [
        ['W A S D', 'движение'],
        ['Мышь (щелчок по экрану)', 'обзор'],
        ['Shift', 'бег'],
        ['E', 'заговорить / осмотреть'],
        ['1–9', 'пункт диалога'],
        ['Tab / M', 'журнал / карта'],
        ['F', 'фонарь'],
        ['T', 'ускорение времени'],
        ['F5 / F9', 'быстрое сохранение / загрузка'],
        ['Esc', 'закрыть окно / пауза'],
      ];
  return h('table', { class: 'help' }, ...rows.map(([a, b]) => h('tr', null, h('td', null, a), h('td', null, b))));
}

export function showMainMenu(ui: UIManager): void {
  const g = ui.game;
  const o = ui.overlay;
  const home = (): void => {
    clear(o);
    const latest = g.save.latest();
    o.append(
      h('h1', null, 'ОБЪЕКТ «ГРАНИТ»'),
      h('div', { class: 'sub1' }, 'Командир секретного артиллерийского комплекса · 1944'),
      h('div', { class: 'btns' },
        h('button', { class: 'primary', disabled: !latest, onclick: () => g.continueGame() }, latest ? `Продолжить (${latest.label})` : 'Продолжить'),
        h('button', { onclick: () => chooseCommander() }, 'Новая кампания'),
        h('button', { disabled: !latest, onclick: () => loadMenu() }, 'Загрузить'),
        h('button', { onclick: () => helpMenu() }, 'Управление'),
        h('button', { onclick: () => graphicsMenu() }, 'Графика'),
        g.touch ? h('button', { onclick: () => g.exitApp() }, 'Выход') : null,
      ),
    );
  };
  const chooseCommander = (): void => {
    clear(o);
    let sel: Gender = 'm';
    const cards = h('div', { class: 'choice' });
    const render = (): void => {
      clear(cards);
      cards.append(
        h('div', { class: sel === 'm' ? 'sel' : '', onclick: () => ((sel = 'm'), render()) }, h('h3', null, 'Оберст'), h('p', null, 'Кадровый артиллерист. Серая полевая шинель, фуражка. К нему обращаются «господин оберст».')),
        h('div', { class: sel === 'f' ? 'sel' : '', onclick: () => ((sel = 'f'), render()) }, h('h3', null, 'Оберст (женщина)'), h('p', null, 'Командир в длинном чёрном плаще. К ней обращаются «госпожа оберст». Своё отражение можно увидеть в зеркалах — в помещении командира, у офицеров и в казарме.')),
      );
    };
    render();
    o.append(h('h1', { style: 'font-size:clamp(18px,5vh,30px)' }, 'КТО ПРИНИМАЕТ КОМАНДОВАНИЕ'), cards, h('div', { class: 'muted wide', style: 'text-align:center' }, 'Тело командира видно от первого лица — посмотрите вниз. Выбор влияет на внешность и обращение.'), h('div', { class: 'btns' }, h('button', { class: 'primary', onclick: () => g.newGame(sel) }, 'Принять командование'), h('button', { onclick: home }, 'Назад')));
  };
  const loadMenu = (): void => {
    clear(o);
    const btns = h('div', { class: 'btns' });
    for (const s of SLOTS) {
      const info = g.save.info(s);
      if (info) btns.append(h('button', { onclick: () => g.loadSlot(s) }, `${SLOT_NAMES[s]}: ${info.label}`));
    }
    btns.append(h('button', { onclick: home }, 'Назад'));
    o.append(h('h1', { style: 'font-size:clamp(18px,5vh,30px)' }, 'ЗАГРУЗИТЬ'), btns);
  };
  const graphicsMenu = (): void => {
    clear(o);
    const btns = h('div', { class: 'btns' });
    for (const q of ['auto', 'minimal', 'low', 'medium', 'high'] as const) {
      btns.append(h('button', { class: g.settings.quality === q ? 'on' : '', onclick: () => ((g.settings.quality = q), g.restartGraphics()) }, QUALITY_NAMES[q]));
    }
    btns.append(h('button', { onclick: home }, 'Назад'));
    o.append(h('h1', { style: 'font-size:clamp(18px,5vh,30px)' }, 'ГРАФИКА'), h('div', { class: 'muted wide', style: 'text-align:center' }, `Сейчас: ${QUALITY_NAMES[g.qualityLevel]}. Видеочип: ${g.gpuName}. Если экран белый или игра вылетает — выберите уровень ниже.`), btns);
  };
  const helpMenu = (): void => {
    clear(o);
    o.append(
      h('div', { class: 'intro' },
        h('h2', null, 'Управление'),
        controlsHelp(g.touch),
        h('p', { class: 'muted' }, 'Приказы отдаются людям: подойдите и заговорите либо снимите трубку телефона. Огонь открывается с планшета управления огнём в командном центре или на КП батареи. Противника на карте видно только по донесениям разведки.'),
        h('button', { onclick: home }, 'Назад'),
      ),
    );
  };
  home();
  ui.setOverlay(true);
}

export function showPause(ui: UIManager): void {
  const g = ui.game;
  const o = ui.overlay;
  g.setPaused(true);
  clear(o);
  const resume = (): void => {
    g.setPaused(false);
    ui.setOverlay(false);
  };
  o.append(
    h('h1', { style: 'font-size:clamp(18px,5vh,30px)' }, 'ПАУЗА'),
    h('div', { class: 'btns' },
      h('button', { class: 'primary', onclick: resume }, 'Продолжить'),
      h('button', { onclick: () => (g.saveSlot('quick'), resume()) }, 'Быстрое сохранение'),
      h('button', { onclick: () => (resume(), ui.openPanel('journal', { tab: 'system' })) }, 'Сохранение и настройки'),
      h('button', { onclick: () => (resume(), ui.openPanel('journal', { tab: 'objectives' })) }, 'Задачи'),
      h('button', { class: 'danger', onclick: () => g.toMenu() }, 'В главное меню'),
    ),
    h('div', { class: 'intro', style: 'margin-top:8px' }, controlsHelp(g.touch)),
  );
  ui.setOverlay(true);
}

/** Заставка главы: игра стоит, пока командир не прочтёт. */
export function showChapter(ui: UIManager, title: string, intro: string[]): void {
  const g = ui.game;
  if (g.state !== 'playing') return;
  const o = ui.overlay;
  g.setPaused(true);
  clear(o);
  o.append(
    h('div', { class: 'intro' },
      h('h2', null, title),
      ...intro.map((p) => h('p', null, p)),
      h('button', {
        class: 'primary',
        onclick: () => {
          g.setPaused(false);
          ui.setOverlay(false);
        },
      }, 'Продолжить'),
    ),
  );
  ui.setOverlay(true);
}

export function showEnding(ui: UIManager, title: string, text: string[]): void {
  const g = ui.game;
  const o = ui.overlay;
  g.state = 'ended';
  clear(o);
  o.append(h('div', { class: 'intro' }, h('h2', null, title), ...text.map((p) => h('p', null, p)), h('div', { class: 'row' }, h('button', { class: 'primary', onclick: () => g.toMenu() }, 'В главное меню'), g.save.latest() ? h('button', { onclick: () => g.continueGame() }, 'Загрузить последнее сохранение') : null)));
  ui.setOverlay(true);
}
