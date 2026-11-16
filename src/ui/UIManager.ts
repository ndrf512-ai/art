/**
 * UIManager — минималистичный военный интерфейс. На экране постоянно только время,
 * тревога, связь, боеприпасы и активные приказы; всё остальное открывается
 * по необходимости — как правило, через взаимодействие с миром.
 */
import type { AudioSystem } from '../audio/AudioSystem';
import { ALERT_NAMES } from '../core/types';
import type { InteractTarget, PlayerController } from '../player/PlayerController';
import { FIRE_KIND_NAMES } from '../sim/ArtillerySystem';
import { SHELLS } from '../sim/BallisticsSystem';
import type { DialogueView } from '../sim/DialogueSystem';
import { fullName } from '../sim/DocumentSystem';
import type { SaveSystem } from '../sim/SaveSystem';
import type { Gender, Sim } from '../sim/Sim';
import type { UserSettings } from '../view/Quality';
import { clear, h } from './dom';
import { fireOrMapPanel } from './MapPanel';
import { showChapter, showEnding, showMainMenu, showPause } from './Menus';
import { PANELS, type PanelResult } from './Panels';

export interface GameApi {
  sim: Sim;
  save: SaveSystem;
  player: PlayerController;
  audio: AudioSystem;
  settings: UserSettings;
  state: 'menu' | 'playing' | 'paused' | 'ended';
  warp: number;
  touch: boolean;
  newGame(gender: Gender): void;
  continueGame(): boolean;
  loadSlot(slot: string): boolean;
  saveSlot(slot: string): boolean;
  setWarp(w: number): void;
  setPaused(p: boolean): void;
  sleep(minutes: number): void;
  toMenu(): void;
  applySettings(): void;
  exitApp(): void;
  fps(): number;
}

const WARPS = [1, 4, 12];

export class UIManager {
  readonly root: HTMLElement;
  private hudTime = h('div', { class: 'hud-time' });
  private chips = h('div', { class: 'chips' });
  private ammo = h('div', { class: 'chips' });
  private objectives = h('div', { class: 'hud-box' });
  private orders = h('div', { class: 'hud-box hud-orders' });
  private notes = h('div', { class: 'notes' });
  private subs = h('div', { class: 'subs' });
  private promptBtn = h('button', { class: 'prompt hidden', onclick: () => this.game.player.interact() });
  private hurt = h('div', { class: 'hurt' });
  readonly fade = h('div', { class: 'fade' });
  private dlg = h('div', { class: 'dlg hidden' });
  private panelEl = h('div', { class: 'panel hidden' });
  readonly overlay = h('div', { class: 'menu hidden' });
  private warpBtn = h('button', { onclick: () => this.cycleWarp() }, '×1');
  private journalBtn = h('button', { onclick: () => this.openPanel('journal') }, 'Журнал');
  private hud = h('div');
  private touchEl: HTMLElement | null = null;
  private dlgView: DialogueView | null = null;
  private panel: { name: string; res: PanelResult; t: number } | null = null;
  private hudT = 0;
  private subList: { el: HTMLElement; until: number }[] = [];
  private lastTarget = '';
  /** Меню поверх игры (главное, пауза, заставка главы). */
  overlayOpen = false;

  constructor(
    root: HTMLElement,
    readonly game: GameApi,
  ) {
    this.root = root;
    const tl = h('div', { class: 'hud-tl' }, this.hudTime, this.chips, this.ammo, this.objectives, this.orders);
    const tr = h('div', { class: 'hud-tr' }, this.journalBtn, h('button', { onclick: () => this.openPanel('map') }, 'Карта'), this.warpBtn, h('button', { onclick: () => this.pause() }, '≡'));
    this.hud.append(h('div', { class: 'vignette' }), this.hurt, h('div', { class: 'cross' }), tl, tr, this.notes, this.subs, this.promptBtn);
    if (game.touch) this.buildTouch();
    root.append(this.hud, this.dlg, this.panelEl, this.fade, this.overlay);
    this.hud.classList.add('hidden');
    this.bind();
  }

  private get sim(): Sim {
    return this.game.sim;
  }

  // ------------------------------------------------------------------ события мира

  private bind(): void {
    const bus = this.sim.bus;
    bus.on('notify', ({ text, kind }) => this.note(text, kind));
    bus.on('npc:speech', ({ id, text, quiet }) => {
      const n = this.sim.npcs.byId(id);
      if (!n) return;
      const p = this.sim.player;
      const d = Math.hypot(n.x - p.x, n.z - p.z);
      if (d > (quiet ? 8 : 16)) return;
      if (this.dlgView && this.dlgView.npcId === id) return;
      this.sub(fullName(n), text, quiet);
      this.game.audio.murmur(d);
    });
    bus.on('radio:delivered', ({ msg }) => {
      this.note(`${msg.priority === 'routine' ? 'Донесение' : msg.priority === 'secret' ? 'СЕКРЕТНО' : 'СРОЧНО'}: ${msg.subject}`, 'radio', () => this.openPanel('journal', { tab: 'messages', id: msg.id }));
      if (msg.priority !== 'routine') this.game.audio.beep();
    });
    bus.on('arty:report', ({ text }) => this.note(text, 'order'));
    bus.on('ui:open', ({ panel, arg }) => this.openPanel(panel, arg));
    bus.on('mission:chapter', ({ title, intro }) => showChapter(this, title, intro));
    bus.on('campaign:ended', (e) => showEnding(this, e.title, e.text));
    bus.on('player:hurt', () => {
      this.hurt.style.opacity = '1';
      setTimeout(() => (this.hurt.style.opacity = '0'), 250);
      try {
        navigator.vibrate?.(120);
      } catch {
        /* вибрация недоступна */
      }
    });
    bus.on('save:done', ({ slot }) => {
      if (slot !== 'auto') this.note('Игра сохранена.', 'good');
    });
  }

  // ------------------------------------------------------------------ сообщения

  note(text: string, kind: string = 'info', onClick?: () => void): void {
    const el = h('div', { class: `note ${kind}`, onclick: onClick ? () => onClick() : undefined }, text);
    if (onClick) el.style.pointerEvents = 'auto';
    this.notes.prepend(el);
    while (this.notes.children.length > 5) this.notes.lastChild!.remove();
    setTimeout(() => el.remove(), kind === 'alarm' || kind === 'radio' ? 11000 : 7000);
  }

  sub(name: string, text: string, quiet: boolean): void {
    const el = h('div', { class: quiet ? 'sub quiet' : 'sub' }, h('b', null, name + ': '), text);
    this.subs.append(el);
    this.subList.push({ el, until: performance.now() + Math.min(8000, 2400 + text.length * 55) });
    while (this.subList.length > 3) this.subList.shift()!.el.remove();
  }

  // ------------------------------------------------------------------ состояние занятости

  private syncBusy(): void {
    const busy = !!this.dlgView || !!this.panel || this.overlayOpen;
    this.sim.player.busy = busy;
    if (busy) this.game.player.releasePointer();
    if (this.touchEl) this.touchEl.classList.toggle('hidden', busy);
  }

  showHud(on: boolean): void {
    this.hud.classList.toggle('hidden', !on);
  }

  setOverlay(open: boolean): void {
    this.overlayOpen = open;
    this.overlay.classList.toggle('hidden', !open);
    if (!open) clear(this.overlay);
    this.syncBusy();
  }

  // ------------------------------------------------------------------ взаимодействие с миром

  interact(t: InteractTarget): void {
    const sim = this.sim;
    this.game.audio.click();
    if (t.kind === 'npc') {
      this.showDialogue(sim.dialogue.open(t.id));
      return;
    }
    const it = t.obj!;
    switch (it.kind) {
      case 'fire_table':
        this.openPanel('fire');
        break;
      case 'map_table':
        this.openPanel('map');
        break;
      case 'phone':
        this.showDialogue(sim.dialogue.openPhone());
        break;
      case 'radio_log':
      case 'safe':
        this.openPanel('journal', { tab: 'messages' });
        break;
      case 'archive':
        this.openPanel('archive');
        break;
      case 'bed':
        this.openPanel('rest');
        break;
      case 'patrol_board':
        this.openPanel('patrols');
        break;
      case 'siren':
        this.openPanel('alert');
        break;
      case 'gun':
        if (it.ref === 'gun1') sim.missions.flag('inspected_gun1', true);
        this.openPanel('inspect', { kind: 'gun', ref: it.ref });
        break;
      case 'equipment':
        this.openPanel('inspect', { kind: 'equipment', ref: it.ref });
        break;
      case 'ammo':
      case 'fuel':
        this.openPanel('inspect', { kind: 'store', ref: it.ref });
        break;
    }
  }

  // ------------------------------------------------------------------ диалог

  showDialogue(view: DialogueView | null): void {
    this.dlgView = view;
    clear(this.dlg);
    this.dlg.classList.toggle('hidden', !view);
    if (view) {
      const opts = h('div', { class: 'opts' });
      view.options.forEach((o, i) => {
        opts.append(h('button', { disabled: o.disabled, onclick: () => this.chooseDialogue(i) }, i < 9 ? h('kbd', null, String(i + 1)) : null, o.text));
      });
      this.dlg.append(h('header', null, h('b', null, view.title), h('small', null, view.subtitle)), h('div', { class: 'text' }, view.text), opts);
    }
    this.syncBusy();
  }

  chooseDialogue(i: number): void {
    const v = this.dlgView;
    if (!v) return;
    const o = v.options[i];
    if (!o || o.disabled) return;
    this.game.audio.click();
    const next = this.sim.dialogue.choose(o.id);
    this.showDialogue(next);
  }

  closeDialogue(): void {
    this.sim.dialogue.close();
    this.showDialogue(null);
  }

  // ------------------------------------------------------------------ панели

  openPanel(name: string, arg?: any): void {
    if (this.dlgView && name !== 'doc' && name !== 'personnel') this.closeDialogue();
    this.closePanel(true);
    const body = h('div', { class: 'body' });
    const title = h('h2', null, '');
    const extra = h('div', { class: 'tabs' });
    clear(this.panelEl);
    this.panelEl.append(h('header', null, title, extra, h('button', { onclick: () => this.closePanel() }, '✕')), body);
    const fn = name === 'fire' || name === 'map' ? fireOrMapPanel : PANELS[name];
    if (!fn) return;
    const res = fn(this, body, name === 'fire' || name === 'map' ? { ...(typeof arg === 'object' ? arg : { gun: arg }), mode: name } : arg, extra);
    title.textContent = res.title;
    this.panel = { name, res, t: 0 };
    this.panelEl.classList.remove('hidden');
    this.syncBusy();
  }

  closePanel(silent = false): void {
    if (!this.panel) return;
    this.panel.res.dispose?.();
    this.panel = null;
    this.panelEl.classList.add('hidden');
    clear(this.panelEl);
    if (!silent) {
      // закрыли карточку, открытую из разговора, — разговор продолжается
      if (this.dlgView) this.showDialogue(this.sim.dialogue.view());
      this.syncBusy();
    }
  }

  get panelOpen(): boolean {
    return !!this.panel;
  }

  // ------------------------------------------------------------------ меню

  mainMenu(): void {
    this.showHud(false);
    this.closePanel();
    this.closeDialogue();
    showMainMenu(this);
  }

  pause(): void {
    if (this.game.state !== 'playing') return;
    this.closePanel();
    this.closeDialogue();
    showPause(this);
  }

  private cycleWarp(): void {
    const i = WARPS.indexOf(this.game.warp);
    this.game.setWarp(WARPS[(i + 1) % WARPS.length]);
    this.warpBtn.textContent = '×' + this.game.warp;
    this.warpBtn.classList.toggle('on', this.game.warp > 1);
  }

  syncWarp(): void {
    this.warpBtn.textContent = '×' + this.game.warp;
    this.warpBtn.classList.toggle('on', this.game.warp > 1);
  }

  /** Системная кнопка «Назад» и Esc: закрыть верхнее окно. true — обработано. */
  back(): boolean {
    if (this.panel) {
      this.closePanel();
      return true;
    }
    if (this.dlgView) {
      this.closeDialogue();
      return true;
    }
    if (this.overlayOpen) {
      if (this.game.state === 'paused') {
        this.game.setPaused(false);
        this.setOverlay(false);
        return true;
      }
      return this.game.state !== 'menu';
    }
    if (this.game.state === 'playing') {
      this.pause();
      return true;
    }
    return false;
  }

  /** Горячие клавиши (клавиатура). */
  onKey(code: string): boolean {
    const g = this.game;
    if (code === 'Escape') return this.back();
    if (g.state !== 'playing') return false;
    if (this.dlgView && code.startsWith('Digit')) {
      this.chooseDialogue(Number(code.slice(5)) - 1);
      return true;
    }
    if (this.overlayOpen) return false;
    switch (code) {
      case 'Tab':
      case 'KeyJ':
        this.panel?.name === 'journal' ? this.closePanel() : this.openPanel('journal');
        return true;
      case 'KeyM':
        this.panel?.name === 'map' ? this.closePanel() : this.openPanel('map');
        return true;
      case 'KeyT':
        this.cycleWarp();
        return true;
      case 'KeyF':
        if (!this.sim.player.busy) this.sim.player.flashlight = !this.sim.player.flashlight;
        return true;
      case 'F5':
        g.saveSlot('quick');
        return true;
      case 'F9':
        if (g.loadSlot('quick')) this.note('Загружено быстрое сохранение.', 'good');
        return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ сенсорное управление

  private buildTouch(): void {
    const knob = h('i');
    const joy = h('div', { class: 'joy' }, knob);
    let jid: number | null = null;
    const setJoy = (t: Touch | null): void => {
      if (!t) {
        knob.style.transform = '';
        this.game.player.setMove(0, 0);
        return;
      }
      const r = joy.getBoundingClientRect();
      const R = r.width / 2;
      let dx = (t.clientX - (r.left + R)) / R;
      let dy = (t.clientY - (r.top + R)) / R;
      const l = Math.hypot(dx, dy);
      if (l > 1) {
        dx /= l;
        dy /= l;
      }
      knob.style.transform = `translate(${dx * R * 0.6}px, ${dy * R * 0.6}px)`;
      this.game.player.setMove(dx, -dy);
    };
    joy.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      jid = t.identifier;
      setJoy(t);
    }, { passive: false });
    joy.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of Array.from(e.changedTouches)) if (t.identifier === jid) setJoy(t);
    }, { passive: false });
    const end = (e: TouchEvent): void => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === jid) {
          jid = null;
          setJoy(null);
        }
      }
    };
    joy.addEventListener('touchend', end);
    joy.addEventListener('touchcancel', end);

    // обзор: палец по свободной части экрана
    const canvas = document.getElementById('view')!;
    let lid: number | null = null;
    let lx = 0;
    let ly = 0;
    canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (lid !== null) return;
      const t = e.changedTouches[0];
      lid = t.identifier;
      lx = t.clientX;
      ly = t.clientY;
    }, { passive: false });
    canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier !== lid) continue;
        if (!this.sim.player.busy) this.game.player.addLook((t.clientX - lx) * 2.4, (t.clientY - ly) * 2.4);
        lx = t.clientX;
        ly = t.clientY;
      }
    }, { passive: false });
    const lend = (e: TouchEvent): void => {
      for (const t of Array.from(e.changedTouches)) if (t.identifier === lid) lid = null;
    };
    canvas.addEventListener('touchend', lend);
    canvas.addEventListener('touchcancel', lend);

    let run = false;
    const runBtn = h('button', {
      onclick: () => {
        run = !run;
        this.game.player.setRun(run);
        runBtn.classList.toggle('on', run);
      },
    }, 'Бег');
    const lightBtn = h('button', {
      onclick: () => {
        this.sim.player.flashlight = !this.sim.player.flashlight;
        lightBtn.classList.toggle('on', this.sim.player.flashlight);
      },
    }, 'Фонарь');
    const btns = h('div', { class: 'tbtns' }, h('div', { class: 'row' }, lightBtn, runBtn));
    this.touchEl = h('div', null, joy, btns);
    this.hud.append(this.touchEl);
  }

  // ------------------------------------------------------------------ обновление

  update(dt: number): void {
    const now = performance.now();
    for (let i = this.subList.length - 1; i >= 0; i--) {
      if (now > this.subList[i].until) {
        this.subList[i].el.remove();
        this.subList.splice(i, 1);
      }
    }
    // подсказка взаимодействия
    const t = this.game.player.target;
    const key = t ? t.id + t.label : '';
    if (key !== this.lastTarget) {
      this.lastTarget = key;
      this.promptBtn.classList.toggle('hidden', !t);
      if (t) {
        clear(this.promptBtn);
        const verb = t.kind === 'npc' ? 'Говорить' : 'Осмотреть';
        this.promptBtn.append(this.game.touch ? null : h('kbd', null, '[E]'), `${verb}: ${t.label}`, t.hint ? h('small', null, t.hint) : null);
      }
    }
    if (this.panel?.res.refresh) {
      this.panel.t += dt;
      if (this.panel.t > 1) {
        this.panel.t = 0;
        this.panel.res.refresh();
      }
    }
    this.hudT -= dt;
    if (this.hudT > 0) return;
    this.hudT = 0.3;
    this.refreshHud();
  }

  private refreshHud(): void {
    const sim = this.sim;
    clear(this.hudTime);
    this.hudTime.append(sim.time.clockString(), h('small', null, `${sim.time.dateString()} · ${sim.weather.name}, ${Math.round(sim.weather.state.tempC)}°`));
    const r = sim.resources.state;
    const mp = sim.resources.manpower();
    const a = sim.alert.level;
    clear(this.chips);
    const chip = (text: string, cls: string) => this.chips.append(h('span', { class: 'chip ' + cls }, text));
    chip(`ТРЕВОГА: ${ALERT_NAMES[a]}`, 'a' + a);
    if (sim.alert.state.airRaid) chip('ВОЗДУХ!', 'a3');
    chip(r.power >= 1 ? 'ПИТАНИЕ' : r.power > 0 ? 'РЕЗЕРВ' : 'НЕТ ПИТАНИЯ', r.power >= 1 ? 'ok' : r.power > 0 ? 'warn' : 'bad');
    chip(r.radio ? 'РАДИО' : 'РАДИО ✕', r.radio ? 'ok' : 'bad');
    chip(r.wire ? 'ТЕЛЕФОН' : 'ТЕЛЕФОН ✕', r.wire ? 'ok' : 'bad');
    chip(`ЛЮДИ ${mp.fit}/${mp.total}`, mp.fit < mp.total - 4 ? 'warn' : 'ok');
    if (sim.player.health < 99) chip(`ЗДОРОВЬЕ ${Math.round(sim.player.health)}`, sim.player.health < 50 ? 'bad' : 'warn');
    clear(this.ammo);
    const am = r.res.ammo;
    this.ammo.append(h('span', { class: 'chip' + (am.he21 < 24 ? ' warn' : '') }, `21 см: ОФ ${am.he21} · БЕТ ${am.cp21} · ДЫМ ${am.smoke21}`), h('span', { class: 'chip' }, `38 см: ФУГ ${am.he38} · СПЕЦ ${am.sp38}`));

    // цели главы
    clear(this.objectives);
    const m = sim.missions;
    const vis = m.visible();
    if (m.state.title && !m.state.ended) {
      this.objectives.append(h('h4', null, m.state.title));
      const open = vis.filter((o) => !o.done && !o.failed).slice(0, 3);
      for (const o of open) this.objectives.append(h('div', { class: o.optional ? 'opt' : '' }, '▸ ' + o.text));
      if (!open.length) this.objectives.append(h('div', { class: 'opt' }, 'Ждите дальнейших указаний.'));
      this.objectives.classList.remove('hidden');
    } else this.objectives.classList.add('hidden');

    // активные приказы и огневые задачи
    clear(this.orders);
    const lines: string[] = [];
    for (const fm of sim.artillery.activeMissions()) {
      const guns = fm.guns.map((id) => `${id === 'gun1' ? '«Конрад»' : '№' + id.slice(3)} — ${sim.crewAI.phaseName(sim.artillery.gun(id).phase).toLowerCase()}`).join('; ');
      lines.push(`${FIRE_KIND_NAMES[fm.kind]}, ${SHELLS[fm.shell].short}: ${fm.targetName} (${fm.fired}/${fm.kind === 'suppress' ? '…' : fm.rounds}). ${guns}`);
    }
    for (const o of sim.command.active().slice(-3)) if (o.type !== 'fire') lines.push(sim.command.summary(o));
    const req = sim.supply.activeRequest();
    if (req) lines.push(req.status === 'unloading' ? 'Снабжение: идёт разгрузка' : `Снабжение: колонна в пути, прибытие около ${sim.time.constructor.name ? '' : ''}${this.clock(req.eta)}`);
    const unread = sim.radio.unread();
    this.journalBtn.textContent = 'Журнал';
    if (unread) this.journalBtn.append(h('span', { class: 'badge' }, String(unread)));
    if (lines.length) {
      this.orders.append(h('h4', null, 'Приказы'));
      for (const l of lines.slice(0, 4)) this.orders.append(h('div', null, l));
      this.orders.classList.remove('hidden');
    } else this.orders.classList.add('hidden');
  }

  clock(t: number): string {
    const m = Math.floor(((t % 1440) + 1440) % 1440);
    const hh = Math.floor(m / 60);
    const mm = m % 60;
    return `${hh < 10 ? '0' + hh : hh}:${mm < 10 ? '0' + mm : mm}`;
  }
}
