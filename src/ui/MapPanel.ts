/**
 * Карта района и планшет управления огнём. На карте — только то, что известно
 * командиру: местность, свои пункты и донесения разведки с их давностью и
 * надёжностью. Противник сам по себе не отображается.
 */
import { COMPLEX_POS, REGION_SIZE } from '../core/constants';
import type { FireKind, GunId, IntelReport, ShellId } from '../core/types';
import { FIRE_KIND_NAMES, GUN_IDS } from '../sim/ArtillerySystem';
import { mils, SHELLS } from '../sim/BallisticsSystem';
import { ENEMY_TYPE_NAMES } from '../sim/EnemySystem';
import { BRIDGE_NODES, describePlace, EDGES, FORESTS, HEIGHTS, NODES, OPS, RIVER, square } from '../sim/Region';
import { WorldTimeSystem } from '../sim/WorldTimeSystem';
import { clear, h, stepper } from './dom';
import type { PanelResult } from './Panels';
import type { UIManager } from './UIManager';

interface MapArg {
  mode: 'fire' | 'map';
  gun?: GunId;
}

const SOURCE_SHORT: Record<string, string> = { observer: 'НП', scouts: 'развед.', intercept: 'перехват', photo: 'фото', allied: 'сосед', sound: 'звук', hq: 'штаб' };

export function fireOrMapPanel(ui: UIManager, body: HTMLElement, arg: MapArg): PanelResult {
  const sim = ui.game.sim;
  const fire = arg.mode === 'fire';
  const canvas = h('canvas');
  const info = h('div', { class: 'mapinfo' }, '');
  const view = { cx: 15000, cy: 17000, scale: 0 };
  const sel = {
    intel: null as string | null,
    tx: 0,
    ty: 0,
    has: false,
    guns: new Set<GunId>(arg.gun ? [arg.gun] : ['gun2']),
    kind: 'single' as FireKind,
    shell: (arg.gun === 'gun1' ? 'he38' : 'he21') as ShellId,
    rounds: 4,
    mission: null as string | null,
    dR: 0,
    dAz: 0,
  };
  const side = h('div', { class: 'right' });
  const zoom = (k: number): void => {
    view.scale = Math.max(0.008, Math.min(0.25, view.scale * k));
    draw();
  };
  const wrap = h('div', { class: 'mapwrap' }, canvas, h('div', { class: 'mapbtns' }, h('button', { onclick: () => zoom(1.4) }, '+'), h('button', { onclick: () => zoom(1 / 1.4) }, '−'), h('button', { onclick: () => ((view.scale = 0), draw()) }, '◎')), info);
  body.append(h('div', { class: 'col2' }, h('div', { class: 'left' }, wrap), side));

  const toScreen = (x: number, y: number, w: number, hgt: number): [number, number] => [w / 2 + (x - view.cx) * view.scale, hgt / 2 - (y - view.cy) * view.scale];
  const toWorld = (px: number, py: number, w: number, hgt: number): [number, number] => [view.cx + (px - w / 2) / view.scale, view.cy - (py - hgt / 2) / view.scale];

  function draw(): void {
    const r = canvas.getBoundingClientRect();
    if (r.width < 10) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = r.width;
    const hgt = r.height;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(hgt * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(hgt * dpr);
    }
    if (view.scale === 0) {
      view.scale = Math.min(w, hgt) / (REGION_SIZE * 0.78);
      view.cx = 15000;
      view.cy = 16500;
    }
    const c = canvas.getContext('2d')!;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const S = (x: number, y: number) => toScreen(x, y, w, hgt);
    c.fillStyle = '#cdc5a4';
    c.fillRect(0, 0, w, hgt);
    // километровая сетка
    c.lineWidth = 1;
    c.font = '10px monospace';
    for (let k = 0; k <= 30; k++) {
      const [x] = S(k * 1000, 0);
      const [, y] = S(0, k * 1000);
      const bold = k % 5 === 0;
      c.strokeStyle = bold ? 'rgba(70,60,45,0.38)' : 'rgba(70,60,45,0.13)';
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x, hgt);
      c.moveTo(0, y);
      c.lineTo(w, y);
      c.stroke();
      if (bold) {
        c.fillStyle = 'rgba(60,50,40,0.75)';
        c.fillText(String(k).padStart(2, '0'), x + 2, hgt - 3);
        c.fillText(String(k).padStart(2, '0'), 2, y - 2);
      }
    }
    // леса
    c.fillStyle = 'rgba(96,124,78,0.42)';
    for (const f of FORESTS) {
      const [x, y] = S(f.x, f.y);
      c.beginPath();
      c.ellipse(x, y, f.rx * view.scale, f.ry * view.scale, -f.rot, 0, Math.PI * 2);
      c.fill();
    }
    // река
    c.strokeStyle = '#4f79b5';
    c.lineWidth = Math.max(2, 220 * view.scale);
    c.lineJoin = 'round';
    c.beginPath();
    RIVER.forEach(([x, y], i) => {
      const [px, py] = S(x, y);
      i ? c.lineTo(px, py) : c.moveTo(px, py);
    });
    c.stroke();
    // дороги
    c.strokeStyle = '#5a4634';
    c.lineWidth = 1.6;
    for (const [a, b] of EDGES) {
      const [x0, y0] = S(NODES[a].x, NODES[a].y);
      const [x1, y1] = S(NODES[b].x, NODES[b].y);
      c.beginPath();
      c.moveTo(x0, y0);
      c.lineTo(x1, y1);
      c.stroke();
    }
    // высоты
    c.fillStyle = '#7a4a22';
    for (const p of HEIGHTS) {
      const [x, y] = S(p.x, p.y);
      c.beginPath();
      c.moveTo(x, y - 5);
      c.lineTo(x - 4, y + 3);
      c.lineTo(x + 4, y + 3);
      c.fill();
      c.fillText(String(p.h), x + 6, y + 3);
    }
    // населённые пункты и мосты
    c.font = '11px monospace';
    for (const n of NODES) {
      const [x, y] = S(n.x, n.y);
      const ours = sim.enemy.state.owner[n.id] === 'us';
      if (BRIDGE_NODES.includes(n.id)) {
        const down = (sim.enemy.state.bridgeDown[n.id] ?? 0) > sim.now;
        c.strokeStyle = '#2b2620';
        c.lineWidth = 2;
        c.strokeRect(x - 5, y - 3, 10, 6);
        if (down) {
          c.strokeStyle = '#a03325';
          c.beginPath();
          c.moveTo(x - 7, y - 6);
          c.lineTo(x + 7, y + 6);
          c.moveTo(x + 7, y - 6);
          c.lineTo(x - 7, y + 6);
          c.stroke();
        }
        c.fillStyle = '#2b2620';
        c.fillText(n.name + (down ? ' (разрушен)' : ''), x + 8, y - 6);
      } else if (n.town) {
        c.fillStyle = '#2b2620';
        for (let i = 0; i < 5; i++) c.fillRect(x - 6 + ((i * 5) % 11), y - 5 + ((i * 7) % 9), 4, 4);
        c.fillStyle = ours ? '#1f3f78' : '#8f2a1e';
        c.fillText(n.name, x + 9, y + 4);
      }
    }
    // объект, дальность орудий
    const [ox, oy] = S(COMPLEX_POS.x, COMPLEX_POS.y);
    c.setLineDash([6, 5]);
    c.lineWidth = 1;
    for (const [shell, col] of [['he21', 'rgba(31,63,120,0.7)'], ['he38', 'rgba(31,63,120,0.4)']] as const) {
      c.strokeStyle = col;
      c.beginPath();
      c.arc(ox, oy, sim.ballistics.maxRange(shell) * 0.94 * view.scale, 0, Math.PI * 2);
      c.stroke();
    }
    // наблюдательные пункты и линии связи
    for (const op of OPS) {
      const [x, y] = S(op.x, op.y);
      const on = sim.recon.opOnline(op.id);
      c.strokeStyle = on ? 'rgba(31,63,120,0.75)' : 'rgba(160,51,37,0.7)';
      c.setLineDash([3, 4]);
      c.beginPath();
      c.moveTo(ox, oy);
      c.lineTo(x, y);
      c.stroke();
      c.setLineDash([2, 5]);
      c.beginPath();
      c.arc(x, y, op.range * view.scale, 0, Math.PI * 2);
      c.stroke();
      c.setLineDash([]);
      c.fillStyle = on ? '#1f3f78' : '#8f2a1e';
      c.beginPath();
      c.moveTo(x, y - 6);
      c.lineTo(x - 5, y + 4);
      c.lineTo(x + 5, y + 4);
      c.fill();
      c.fillText(op.name + (on ? '' : ' — нет связи'), x + 8, y + 4);
    }
    c.setLineDash([]);
    c.fillStyle = '#1f3f78';
    c.fillRect(ox - 6, oy - 4, 12, 8);
    c.fillText('«Гранит»', ox + 9, oy + 4);
    // донесения разведки
    for (const rep of sim.recon.current()) drawReport(c, rep, S);
    // выбранная цель
    if (sel.has) {
      const [x, y] = S(sel.tx, sel.ty);
      c.strokeStyle = '#111';
      c.lineWidth = 1.5;
      c.beginPath();
      c.arc(x, y, 9, 0, Math.PI * 2);
      c.moveTo(x - 14, y);
      c.lineTo(x + 14, y);
      c.moveTo(x, y - 14);
      c.lineTo(x, y + 14);
      c.stroke();
      c.strokeStyle = 'rgba(20,20,20,0.35)';
      c.beginPath();
      c.moveTo(ox, oy);
      c.lineTo(x, y);
      c.stroke();
    }
  }

  function drawReport(c: CanvasRenderingContext2D, rep: IntelReport, S: (x: number, y: number) => [number, number]): void {
    const [x, y] = S(rep.x, rep.y);
    const age = sim.now - rep.seenT;
    const a = Math.max(0.3, 1 - age / 700);
    const selected = sel.intel === rep.id;
    c.globalAlpha = a;
    c.strokeStyle = '#a02a1c';
    c.fillStyle = '#a02a1c';
    c.lineWidth = selected ? 2.4 : 1.5;
    if (rep.err * view.scale > 5) {
      c.setLineDash([2, 3]);
      c.beginPath();
      c.arc(x, y, rep.err * view.scale, 0, Math.PI * 2);
      c.stroke();
      c.setLineDash([]);
    }
    c.strokeRect(x - 9, y - 6, 18, 12);
    c.beginPath();
    switch (rep.type) {
      case 'infantry':
        c.moveTo(x - 9, y - 6);
        c.lineTo(x + 9, y + 6);
        c.moveTo(x + 9, y - 6);
        c.lineTo(x - 9, y + 6);
        break;
      case 'armor':
        c.ellipse(x, y, 6, 3.5, 0, 0, Math.PI * 2);
        break;
      case 'artillery':
        c.arc(x, y, 2.5, 0, Math.PI * 2);
        c.fill();
        break;
      case 'hq':
        c.moveTo(x - 9, y - 6);
        c.lineTo(x - 9, y - 15);
        c.lineTo(x, y - 15);
        c.lineTo(x, y - 6);
        break;
      case 'depot':
        c.moveTo(x - 6, y + 3);
        c.lineTo(x + 6, y + 3);
        c.moveTo(x - 6, y - 3);
        c.lineTo(x + 6, y - 3);
        break;
      case 'column':
        c.moveTo(x - 6, y);
        c.lineTo(x + 6, y);
        c.lineTo(x + 2, y - 3);
        c.moveTo(x + 6, y);
        c.lineTo(x + 2, y + 3);
        break;
      default:
        c.fillText('?', x - 3, y + 4);
    }
    c.stroke();
    c.font = '10px monospace';
    const ageTxt = age < 60 ? `${Math.round(age)}м` : `${(age / 60).toFixed(1)}ч`;
    c.fillText(`${rep.grade}·${ageTxt}${rep.struck ? ' ✕' : ''}`, x + 12, y + 4);
    c.globalAlpha = 1;
  }

  // ---- управление картой
  let drag: { x: number; y: number; moved: number } | null = null;
  const pos = (e: MouseEvent | Touch): [number, number] => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const startDrag = (x: number, y: number) => (drag = { x, y, moved: 0 });
  const moveDrag = (x: number, y: number): void => {
    if (!drag) return;
    const dx = x - drag.x;
    const dy = y - drag.y;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    view.cx -= dx / view.scale;
    view.cy += dy / view.scale;
    drag.x = x;
    drag.y = y;
    draw();
  };
  const endDrag = (x: number, y: number): void => {
    if (drag && drag.moved < 8) tap(x, y);
    drag = null;
  };
  canvas.addEventListener('mousedown', (e) => startDrag(...pos(e)));
  canvas.addEventListener('mousemove', (e) => {
    const [x, y] = pos(e);
    moveDrag(x, y);
    const r = canvas.getBoundingClientRect();
    const [wx, wy] = toWorld(x, y, r.width, r.height);
    if (wx >= 0 && wy >= 0 && wx <= REGION_SIZE && wy <= REGION_SIZE) info.textContent = `X ${Math.round(wx)}  Y ${Math.round(wy)} · ${square(wx, wy)}`;
  });
  canvas.addEventListener('mouseup', (e) => endDrag(...pos(e)));
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoom(e.deltaY < 0 ? 1.2 : 1 / 1.2);
  }, { passive: false });
  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    startDrag(...pos(e.touches[0]));
  }, { passive: false });
  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    moveDrag(...pos(e.touches[0]));
  }, { passive: false });
  canvas.addEventListener('touchend', (e) => endDrag(...pos(e.changedTouches[0])));

  function tap(px: number, py: number): void {
    const r = canvas.getBoundingClientRect();
    let best: IntelReport | null = null;
    let bd = 24;
    for (const rep of sim.recon.current()) {
      const [x, y] = toScreen(rep.x, rep.y, r.width, r.height);
      const d = Math.hypot(x - px, y - py);
      if (d < bd) {
        bd = d;
        best = rep;
      }
    }
    if (best) selectReport(best);
    else {
      const [wx, wy] = toWorld(px, py, r.width, r.height);
      if (wx < 0 || wy < 0 || wx > REGION_SIZE || wy > REGION_SIZE) return;
      sel.intel = null;
      sel.tx = Math.round(wx / 10) * 10;
      sel.ty = Math.round(wy / 10) * 10;
      sel.has = true;
    }
    renderSide();
    draw();
  }

  function selectReport(rep: IntelReport): void {
    sel.intel = rep.id;
    sel.tx = rep.x;
    sel.ty = rep.y;
    sel.has = true;
  }

  function targetName(): string {
    const rep = sim.recon.byId(sel.intel);
    return rep ? `${ENEMY_TYPE_NAMES[rep.type]}, ${square(rep.x, rep.y)}` : `${square(sel.tx, sel.ty)} (по координатам)`;
  }

  // ---- боковая панель
  function renderSide(): void {
    clear(side);
    if (sel.has) {
      const rep = sim.recon.byId(sel.intel);
      side.append(h('h3', null, 'Цель'));
      if (rep) {
        side.append(h('div', null, h('b', null, `${ENEMY_TYPE_NAMES[rep.type]}`), ` — ${rep.sourceName}, надёжность ${rep.grade}`), h('div', { class: 'pre' }, rep.text), h('div', { class: 'muted' }, `Получено ${WorldTimeSystem.clock(rep.t)}, сведения на ${WorldTimeSystem.clock(rep.seenT)} (${Math.round(sim.now - rep.seenT)} мин назад), погрешность ±${rep.err} м.${rep.struck ? ' По цели уже вёлся огонь.' : ''}`));
      } else side.append(h('div', null, `${describePlace(sel.tx, sel.ty)}`));
      side.append(h('div', null, `X ${sel.tx}  Y ${sel.ty}`));
      if (fire) side.append(h('div', { class: 'row' }, 'X: ', stepper(() => sel.tx, (v) => ((sel.tx = v), (sel.intel = null), draw(), renderCalc()), 10, String, 100), ' Y: ', stepper(() => sel.ty, (v) => ((sel.ty = v), (sel.intel = null), draw(), renderCalc()), 10, String, 100)));
    } else side.append(h('div', { class: 'muted' }, fire ? 'Укажите цель: коснитесь донесения разведки или любой точки карты.' : 'Коснитесь значка донесения, чтобы прочитать его. Красные значки — сведения разведки: буква — надёжность (A–D), рядом — давность.'));

    if (fire) renderFire();
    // список донесений
    side.append(h('h3', null, 'Донесения разведки'));
    const list = h('div', { class: 'list' });
    const reps = sim.recon.current().slice(0, 14);
    if (!reps.length) list.append(h('div', { class: 'muted' }, 'Свежих донесений нет.'));
    for (const rep of reps) {
      const age = Math.round(sim.now - rep.seenT);
      list.append(
        h('div', {
          class: 'item' + (sel.intel === rep.id ? ' sel' : ''),
          onclick: () => {
            selectReport(rep);
            view.cx = rep.x;
            view.cy = rep.y;
            renderSide();
            draw();
          },
        }, h('b', null, `${ENEMY_TYPE_NAMES[rep.type]} · ${square(rep.x, rep.y)}`), h('small', null, `${SOURCE_SHORT[rep.source]} · ${rep.grade} · ${age < 60 ? age + ' мин' : (age / 60).toFixed(1) + ' ч'} назад${rep.struck ? ' · обстреляна' : ''}`)),
      );
    }
    side.append(list);
  }

  const calc = h('div', { class: 'pre' });
  function renderCalc(): void {
    clear(calc);
    if (!sel.has) return;
    const gid = [...sel.guns][0];
    if (!gid) {
      calc.textContent = 'Орудия не назначены.';
      return;
    }
    const p = sim.artillery.preview(gid, sel.tx, sel.ty, sel.shell);
    const met = sim.artillery.state.met;
    const lines = [`Дальность ${(p.range / 1000).toFixed(2)} км, угломер ${mils(p.azimuth)} (${p.azimuth.toFixed(1)}°)`];
    if (p.ok) lines.push(`Заряд ${p.charge}, прицел ${p.elevation.toFixed(1)}°, время полёта ${Math.round(p.tof)} с`);
    else lines.push(`ОГОНЬ НЕВОЗМОЖЕН: ${p.reason}`);
    lines.push(`Метеосводка от ${WorldTimeSystem.clock(met.t)}: ветер ${met.windSpeed.toFixed(0)} м/с, ${Math.round(met.windDir)}°; ${Math.round(met.tempC)}°C${sim.now - met.t > 200 ? ' — УСТАРЕЛА' : ''}`);
    calc.append(h('span', { class: p.ok ? '' : 'bad' }, lines.join('\n')));
  }

  function renderFire(): void {
    const art = sim.artillery;
    side.append(h('h3', null, 'Орудия'));
    for (const id of GUN_IDS) {
      const g = art.gun(id);
      const why = art.availability(id);
      const on = sel.guns.has(id);
      side.append(
        h('div', { class: 'row' },
          h('button', {
            class: on ? 'on' : '',
            disabled: !!why,
            onclick: () => {
              on ? sel.guns.delete(id) : sel.guns.add(id);
              // боеприпас должен подходить назначенным орудиям
              const kinds = new Set([...sel.guns].map((x) => sim.layout.guns[x].kind));
              if (!kinds.has(SHELLS[sel.shell].gun)) sel.shell = kinds.has('rail') ? 'he38' : 'he21';
              renderSide();
            },
          }, id === 'gun1' ? '«Конрад»' : '№' + id.slice(3)),
          h('span', { class: why ? 'bad' : 'muted' }, why ?? `${sim.crewAI.phaseName(g.phase).toLowerCase()}${id === 'gun1' ? (g.deploy >= 1 ? ', на позиции' : g.deploy <= 0 ? ', в ангаре' : ', в движении') : g.atAlt ? ', запасная поз.' : ''}; на позиции ${Object.entries(g.niche).filter(([, n]) => (n ?? 0) > 0).map(([s, n]) => `${SHELLS[s as ShellId].short} ${n}`).join(', ') || 'снарядов нет'}`),
        ),
      );
    }
    const kinds = new Set([...sel.guns].map((x) => sim.layout.guns[x].kind));
    const shells = (Object.keys(SHELLS) as ShellId[]).filter((s) => kinds.has(SHELLS[s].gun));
    side.append(
      h('h3', null, 'Приказ'),
      h('div', { class: 'row' }, 'Вид огня: ', h('select', { onchange: (e: Event) => ((sel.kind = (e.target as HTMLSelectElement).value as FireKind), renderSide()) }, ...(Object.keys(FIRE_KIND_NAMES) as FireKind[]).map((k) => h('option', { value: k, selected: sel.kind === k }, FIRE_KIND_NAMES[k])))),
      h('div', { class: 'row' }, 'Боеприпас: ', h('select', { onchange: (e: Event) => ((sel.shell = (e.target as HTMLSelectElement).value as ShellId), renderCalc()) }, ...shells.map((s) => h('option', { value: s, selected: sel.shell === s }, `${SHELLS[s].name} (на складе ${sim.resources.ammo(s)})`)))),
    );
    if (sel.kind !== 'single') side.append(h('div', { class: 'row' }, sel.kind === 'suppress' ? 'Длительность, мин: ' : 'Выстрелов всего: ', stepper(() => sel.rounds, (v) => (sel.rounds = Math.max(1, Math.min(sel.kind === 'suppress' ? 90 : 24, v))), sel.kind === 'suppress' ? 10 : 1)));
    side.append(calc);
    renderCalc();
    side.append(
      h('div', { class: 'row' },
        h('button', {
          class: 'primary',
          disabled: !sel.has || !sel.guns.size,
          onclick: () => {
            const res = art.order({ kind: sel.kind, guns: [...sel.guns], tx: sel.tx, ty: sel.ty, targetName: targetName(), intelId: sel.intel, shell: sel.shell, rounds: sel.kind === 'suppress' ? 99 : sel.rounds, minutes: sel.rounds });
            if (typeof res === 'string') {
              ui.note(res, 'warn');
              return;
            }
            const bc = sim.npcs.first('battery_cmd') ?? null;
            sim.command.issue('fire', bc, `${FIRE_KIND_NAMES[sel.kind]}: ${targetName()}`, { mission: res.id });
            if (!sim.resources.state.wire) ui.note('Телефонной связи нет: приказ на батарею понёс посыльный, подготовка займёт больше времени.', 'warn');
            sel.mission = res.id;
            sel.dR = sel.dAz = 0;
            renderSide();
          },
        }, 'Открыть огонь'),
        h('button', { class: 'danger', onclick: () => (art.ceaseFire(), renderSide()) }, 'Стой! Прекратить огонь'),
      ),
    );
    // задачи и поправки
    const ms = [...art.state.missions].reverse().slice(0, 4);
    if (ms.length) side.append(h('h3', null, 'Огневые задачи и доклады'));
    for (const m of ms) {
      const active = m.status === 'active';
      const cur = sel.mission === m.id;
      const item = h('div', { class: 'item' + (cur ? ' sel' : ''), onclick: () => ((sel.mission = m.id), (sel.dR = sel.dAz = 0), renderSide()) }, h('b', null, `${m.targetName} — ${SHELLS[m.shell].short} ${m.fired}/${m.kind === 'suppress' ? '…' : m.rounds}`), h('small', null, `${active ? 'выполняется' : m.status === 'done' ? 'выполнена' : 'отменена'}; введённые поправки: дальность ${m.corrRange >= 0 ? '+' : ''}${m.corrRange} м, угломер ${m.corrAz >= 0 ? '+' : ''}${m.corrAz}`), h('div', { class: 'pre' }, m.reports.slice(-4).join('\n')));
      side.append(item);
      if (cur) {
        const range = Math.hypot(m.tx - COMPLEX_POS.x, m.ty - COMPLEX_POS.y);
        const perMil = (range * 2 * Math.PI) / 6000;
        side.append(
          h('div', { class: 'row' }, 'Дальность, м: ', stepper(() => sel.dR, (v) => (sel.dR = v), 50, (v) => (v > 0 ? '+' + v + ' дальше' : v < 0 ? v + ' ближе' : '0'))),
          h('div', { class: 'row' }, 'Угломер, дел.: ', stepper(() => sel.dAz, (v) => (sel.dAz = v), 1, (v) => (v === 0 ? '0' : `${v > 0 ? 'правее' : 'левее'} ${Math.abs(v)} (≈${Math.round(Math.abs(v) * perMil)} м)`), 5)),
          h('div', { class: 'muted' }, 'Разрыв с недолётом — добавьте дальность; разрыв правее цели — поправка «левее».'),
          h('div', { class: 'row' },
            h('button', {
              onclick: () => {
                art.correct(m.id, sel.dR, sel.dAz);
                sim.missions.flag('corrected', true);
                if (!active) art.repeat(m.id, 1);
                sel.dR = sel.dAz = 0;
                renderSide();
              },
            }, active ? 'Передать поправку' : 'Поправка и ещё выстрел'),
            h('button', { onclick: () => (art.repeat(m.id, 4), renderSide()) }, 'Серия: ещё 4 на орудие'),
          ),
        );
      }
    }
  }

  renderSide();
  requestAnimationFrame(draw);
  const onResize = (): void => draw();
  window.addEventListener('resize', onResize);
  return {
    title: fire ? 'Планшет управления огнём' : 'Карта района',
    refresh: () => {
      draw();
      // доклады и состояния орудий обновляются, пока пользователь не правит поля
      if (fire && !(document.activeElement instanceof HTMLSelectElement)) {
        const top = side.scrollTop;
        renderSide();
        side.scrollTop = top;
      }
    },
    dispose: () => window.removeEventListener('resize', onResize),
  };
}
