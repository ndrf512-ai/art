/**
 * ArtillerySystem — батарея: состояние орудий, огневые задачи, расчёт выстрела.
 * Командир отдаёт приказ на огонь; исполняют его расчёты (ArtilleryCrewAI).
 */
import { COMPLEX_POS } from '../core/constants';
import { clamp, lerp } from '../core/math';
import type { FireKind, FireMission, GunId, GunState, MetData, ShellId } from '../core/types';
import { SHELLS } from './BallisticsSystem';
import type { Sim } from './Sim';

export const GUN_IDS: GunId[] = ['gun1', 'gun2', 'gun3'];

export const FIRE_KIND_NAMES: Record<FireKind, string> = {
  single: 'Одиночный выстрел',
  series: 'Серия',
  salvo: 'Залп батареи',
  raid: 'Огневой налёт',
  counter: 'Контрбатарейная стрельба',
  suppress: 'Подавление цели',
};

export interface FireOrder {
  kind: FireKind;
  guns: GunId[];
  tx: number;
  ty: number;
  targetName: string;
  intelId: string | null;
  shell: ShellId;
  rounds: number;
  corrRange?: number;
  corrAz?: number;
  minutes?: number;
}

export class ArtillerySystem {
  state = {
    guns: {} as Record<GunId, GunState>,
    missions: [] as FireMission[],
    seq: 0,
    met: { t: 0, windSpeed: 4, windDir: 250, tempC: 8, pressure: 1010 } as MetData,
    lastFireT: -1,
    /** Насколько точно противник засёк позиции (0..100). */
    located: { main: 0, alt: 0, rail: 0 },
    hangarDoor: 0,
    totalShots: 0,
  };

  constructor(private sim: Sim) {}

  reset(): void {
    const sim = this.sim;
    const guns = {} as Record<GunId, GunState>;
    for (const id of GUN_IDS) {
      const site = sim.layout.guns[id];
      const rail = site.kind === 'rail';
      const crew = sim.npcs.list.filter((n) => n.unit === id).map((n) => n.id);
      guns[id] = {
        id,
        phase: 'idle',
        phaseT: 0,
        phaseDur: 0,
        x: rail ? site.alt.x : site.main.x,
        z: rail ? site.alt.z : site.main.z,
        deploy: rail ? 0 : 1,
        atAlt: false,
        wantDeploy: false,
        azimuth: 180,
        elevation: rail ? 2 : 18,
        targetAz: 180,
        targetEl: rail ? 2 : 18,
        loaded: null,
        condition: 80,
        wear: id === 'gun1' ? 0.22 : id === 'gun2' ? 0.3 : 0.58,
        sightBias: 0,
        niche: rail ? { he38: 2 } : { he21: 6, cp21: 1, smoke21: 1 },
        missionId: null,
        shotsInMission: 0,
        totalShots: 0,
        crew,
        recoil: 0,
        lastShotT: -999,
        note: '',
        solution: null,
      };
    }
    this.state = { guns, missions: [], seq: 0, met: { ...sim.weather.met(), t: sim.now }, lastFireT: -1, located: { main: 0, alt: 0, rail: 0 }, hangarDoor: 0, totalShots: 0 };
    this.applyDoor();
  }

  gun(id: GunId): GunState {
    return this.state.guns[id];
  }

  guns(): GunState[] {
    return GUN_IDS.map((id) => this.state.guns[id]);
  }

  mission(id: string | null): FireMission | null {
    return id ? (this.state.missions.find((m) => m.id === id) ?? null) : null;
  }

  activeMissions(): FireMission[] {
    return this.state.missions.filter((m) => m.status === 'active');
  }

  shellsFor(id: GunId): ShellId[] {
    const kind = this.sim.layout.guns[id].kind;
    return (Object.keys(SHELLS) as ShellId[]).filter((s) => SHELLS[s].gun === kind);
  }

  gunName(id: GunId): string {
    return this.sim.layout.guns[id].name;
  }

  /** Истинное положение орудия на карте района. */
  mapPos(): { x: number; y: number } {
    return COMPLEX_POS;
  }

  /** Предварительный расчёт для панели управления огнём. */
  preview(id: GunId, tx: number, ty: number, shell: ShellId) {
    const g = this.gun(id);
    return this.sim.ballistics.solve(tx - COMPLEX_POS.x, ty - COMPLEX_POS.y, shell, this.state.met, 1 - Math.floor(g.wear * 10) / 10 * 0.035);
  }

  /** Может ли орудие сейчас принять задачу; иначе — причина. */
  availability(id: GunId): string | null {
    const g = this.gun(id);
    const eq = this.sim.repair.get(id);
    if (eq.broken) return 'неисправно';
    if (g.phase === 'relocating') return 'меняет позицию';
    const fit = g.crew.filter((c) => this.sim.npcs.byId(c)?.status === 'active').length;
    if (fit < 2) return 'нет расчёта';
    return null;
  }

  /** Приказ на открытие огня. Возвращает задачу либо текст отказа. */
  order(o: FireOrder): FireMission | string {
    const sim = this.sim;
    const guns = o.guns.filter((id) => SHELLS[o.shell].gun === sim.layout.guns[id].kind);
    if (!guns.length) return 'Выбранный боеприпас не подходит ни одному из назначенных орудий.';
    const usable = guns.filter((id) => !this.availability(id));
    if (!usable.length) return 'Назначенные орудия не могут вести огонь: ' + guns.map((id) => `${this.gunName(id)} — ${this.availability(id)}`).join('; ') + '.';
    const pre = this.preview(usable[0], o.tx, o.ty, o.shell);
    if (!pre.ok) return `Огонь невозможен: ${pre.reason} (дальность ${(pre.range / 1000).toFixed(1)} км).`;
    const rounds = clamp(Math.round(o.rounds), 1, 24);
    const m: FireMission = {
      id: 'f' + ++this.state.seq,
      t: sim.now,
      kind: o.kind,
      guns: usable,
      tx: o.tx,
      ty: o.ty,
      targetName: o.targetName,
      intelId: o.intelId,
      shell: o.shell,
      rounds: o.kind === 'single' ? 1 : rounds,
      corrRange: o.corrRange ?? 0,
      corrAz: o.corrAz ?? 0,
      status: 'active',
      fired: 0,
      reports: [],
      until: o.kind === 'suppress' ? sim.now + (o.minutes ?? 30) : 0,
    };
    for (const id of usable) {
      const g = this.gun(id);
      const old = this.mission(g.missionId);
      // перенос огня: орудие уже наведено в район
      const shift = !!old && Math.hypot(old.tx - o.tx, old.ty - o.ty) < 900 && g.phase !== 'idle';
      if (old && old.status === 'active') {
        old.guns = old.guns.filter((x) => x !== id);
        if (!old.guns.length) old.status = 'cancelled';
      }
      g.missionId = m.id;
      g.shotsInMission = 0;
      g.note = shift ? 'shift' : '';
      if (g.phase === 'ready' || g.phase === 'laying' || g.phase === 'loading' || g.phase === 'computing' || g.phase === 'firing') {
        g.phase = 'computing';
        g.phaseT = 0;
        g.phaseDur = 0;
      }
      if (sim.layout.guns[id].kind === 'rail') g.wantDeploy = true;
    }
    this.state.missions.push(m);
    if (this.state.missions.length > 40) this.state.missions.shift();
    sim.bus.emit('arty:mission', { mission: m });
    return m;
  }

  /** Поправки командира для последующих выстрелов. */
  correct(missionId: string, dRange: number, dAz: number): void {
    const m = this.mission(missionId);
    if (!m) return;
    m.corrRange += dRange;
    m.corrAz += dAz;
    for (const id of m.guns) {
      const g = this.gun(id);
      if (g.phase === 'ready' || g.phase === 'laying') {
        g.phase = 'computing';
        g.phaseT = 0;
        g.phaseDur = 0;
        g.note = 'shift';
      }
    }
  }

  /** Продолжить задачу: ещё N выстрелов с текущими поправками. */
  repeat(missionId: string, rounds: number): boolean {
    const m = this.mission(missionId);
    if (!m) return false;
    m.rounds = m.fired + rounds * Math.max(1, m.guns.length);
    m.status = 'active';
    for (const id of m.guns) {
      const g = this.gun(id);
      if (this.availability(id)) continue;
      g.missionId = m.id;
      g.note = 'shift';
      if (g.phase === 'ready') g.phase = 'computing';
    }
    this.sim.bus.emit('arty:mission', { mission: m });
    return true;
  }

  ceaseFire(guns?: GunId[]): void {
    for (const id of guns ?? GUN_IDS) {
      const g = this.gun(id);
      const m = this.mission(g.missionId);
      if (m && m.status === 'active') {
        m.guns = m.guns.filter((x) => x !== id);
        if (!m.guns.length) {
          m.status = 'cancelled';
          this.sim.bus.emit('arty:mission', { mission: m });
        }
      }
      g.missionId = null;
    }
    this.sim.bus.emit('arty:report', { gun: null, text: 'Прекратить огонь! Приказ передан расчётам.' });
  }

  /** Выкатить установку «Конрад» на позицию либо укрыть в ангаре. */
  setDeploy(out: boolean): string | null {
    const g = this.gun('gun1');
    if (this.sim.repair.get('gun1').broken) return 'Установка неисправна.';
    if (!out && g.missionId) return 'Установка выполняет огневую задачу. Сначала прекратите огонь.';
    g.wantDeploy = out;
    return null;
  }

  /** Перевести гаубицу на запасную (или обратно на основную) позицию. */
  relocate(id: GunId, toAlt: boolean): string | null {
    const g = this.gun(id);
    if (this.sim.layout.guns[id].kind !== 'howitzer') return 'Установка «Конрад» позицию не меняет.';
    if (g.atAlt === toAlt) return 'Орудие уже на этой позиции.';
    if (g.missionId) return 'Орудие выполняет огневую задачу.';
    if (g.phase !== 'idle') return 'Орудие занято.';
    if (!this.sim.resources.take('fuel', 40)) return 'Нет топлива для тягача.';
    g.phase = 'relocating';
    g.phaseT = 0;
    g.phaseDur = 80;
    g.note = toAlt ? 'toAlt' : 'toMain';
    this.sim.bus.emit('arty:phase', { gun: id, phase: 'relocating' });
    return null;
  }

  /** Какая позиция демаскируется при выстреле орудия. */
  positionKey(id: GunId): 'main' | 'alt' | 'rail' {
    if (id === 'gun1') return 'rail';
    return this.gun(id).atAlt ? 'alt' : 'main';
  }

  update(_dt: number, gdt: number): void {
    const sim = this.sim;
    // метеосводка приходит по радио каждые три часа
    if (sim.now - this.state.met.t > 180 && sim.resources.state.radio) {
      const t = sim.weather.met();
      this.state.met = { t: sim.now, windSpeed: Math.max(0, t.windSpeed + sim.rng.gauss(0, 1)), windDir: t.windDir + sim.rng.gauss(0, 8), tempC: t.tempC, pressure: t.pressure };
    }
    for (const g of this.guns()) {
      g.recoil = Math.max(0, g.recoil - gdt * 2.5);
      g.condition = sim.repair.get(g.id).condition;
      if (g.id === 'gun1') {
        const site = sim.layout.guns.gun1;
        g.z = lerp(site.alt.z, site.main.z, g.deploy);
      }
    }
    const g1 = this.gun('gun1');
    const wantOpen = g1.phase === 'deploying' || g1.phase === 'stowing' ? 1 : 0;
    const prev = this.state.hangarDoor;
    this.state.hangarDoor = clamp(prev + Math.sign(wantOpen - prev) * gdt * 0.6, 0, 1);
    if (prev < 0.5 !== this.state.hangarDoor < 0.5) this.applyDoor();
    // засечка позиций со временем «остывает»
    const L = this.state.located;
    const cool = gdt * 0.004;
    L.main = Math.max(0, L.main - cool);
    L.alt = Math.max(0, L.alt - cool);
    L.rail = Math.max(0, L.rail - cool);
    for (const m of this.state.missions) {
      if (m.status === 'active' && m.kind === 'suppress' && sim.now > m.until) this.finish(m);
    }
  }

  applyDoor(): void {
    this.sim.grid.setBlockedRect(121, 58, 128, 58, this.state.hangarDoor < 0.5);
  }

  finish(m: FireMission): void {
    if (m.status !== 'active') return;
    m.status = 'done';
    for (const id of m.guns) {
      const g = this.gun(id);
      if (g.missionId === m.id) g.missionId = null;
    }
    this.sim.bus.emit('arty:mission', { mission: m });
    this.sim.bus.emit('arty:report', { gun: null, text: `Задача «${m.targetName}» выполнена: израсходовано ${m.fired} снар.` });
  }

  /** Выстрел: истинная траектория с рассеиванием, ошибками наводки и реальной погодой. */
  fire(g: GunState): void {
    const sim = this.sim;
    const m = this.mission(g.missionId);
    const sol = g.solution;
    if (!m || !sol || !g.loaded) return;
    const shell = SHELLS[g.loaded];
    const rng = sim.rng;
    const crew = sim.crewAI.present(g);
    const gunner = sim.npcs.byId(g.crew[1] ?? '');
    const skill = gunner && crew.includes(1) ? gunner.skill : 35;
    const fat = gunner ? gunner.fatigue : 50;
    const lay = (1.25 - skill / 100) * (1 + fat / 150) * 0.035;
    const met = sim.weather.met();
    const v0 = shell.charges[sol.charge - 1] * (1 - g.wear * 0.035) * (1 + rng.gauss(0, 0.0022 * (1 + g.wear * 2))) * (1 + 0.0007 * (met.tempC - 15));
    const imp = sim.ballistics.simulate(v0, sol.elevation + rng.gauss(0, lay), sol.azimuth + rng.gauss(0, lay), shell.drag, met);
    // сбитый прицел даёт систематическую ошибку по дальности
    const r = Math.max(1, imp.range);
    const ux = imp.x / r;
    const uy = imp.y / r;
    const dr = g.sightBias + rng.gauss(0, r * 0.0032 * (1 + g.wear * 1.5));
    const dd = rng.gauss(0, r * 0.0009 * (1 + g.wear));
    const ix = COMPLEX_POS.x + imp.x + ux * dr + uy * dd;
    const iy = COMPLEX_POS.y + imp.y + uy * dr - ux * dd;

    g.loaded = null;
    g.recoil = 1;
    g.lastShotT = sim.now;
    g.totalShots++;
    g.shotsInMission++;
    g.wear = Math.min(1, g.wear + shell.wear);
    m.fired++;
    this.state.totalShots++;
    this.state.lastFireT = sim.now;
    sim.repair.wear(g.id, g.id === 'gun1' ? 1.6 : 0.7);
    if (g.id === 'gun1') sim.repair.wear('hoist', 0.8);
    // звукометрическая разведка противника
    const key = this.positionKey(g.id);
    this.state.located[key] = Math.min(100, this.state.located[key] + (g.id === 'gun1' ? 7 : 2.6) * (1 + sim.enemy.state.intel / 120));
    sim.bus.emit('arty:shot', { gun: g.id, shell: shell.id, x: g.x, z: g.z, azimuth: g.azimuth });
    const result = sim.enemy.impact(ix, iy, shell.id);
    sim.recon.spotImpact(m, g.id, ix, iy, imp.tof, result);
    for (const id of g.crew) {
      const n = sim.npcs.byId(id);
      if (n) n.fatigue = Math.min(100, n.fatigue + (g.id === 'gun1' ? 1.2 : 0.6));
    }
  }

  save(): unknown {
    return this.state;
  }

  load(d: any): void {
    this.state = d;
    this.applyDoor();
  }
}
