/**
 * ArtilleryCrewAI — расчёт орудия как коллектив: по приказу расчёт сам собирается,
 * получает координаты, считает установки, наводит, заряжает, стреляет и докладывает.
 * Скорость и точность зависят от того, кто реально стоит на постах, от опыта и усталости.
 */
import { COMPLEX_POS } from '../core/constants';
import { approach, approachAngle, clamp, dist, wrapAngle, yawTo } from '../core/math';
import type { AnimId, GunId, GunPhase, GunState, NpcState } from '../core/types';
import { GUN_IDS } from './ArtillerySystem';
import { mils, SHELLS } from './BallisticsSystem';
import { rankName } from './DocumentSystem';
import type { GoalOption } from './NPCSystem';
import type { Sim } from './Sim';

const DEG = Math.PI / 180;

const PHASE_TASK: Record<GunPhase, string> = {
  idle: 'В готовности',
  assembling: 'Сбор расчёта у орудия',
  deploying: 'Выкатывание установки на позицию',
  stowing: 'Укрытие установки в ангаре',
  relocating: 'Смена огневой позиции',
  computing: 'Расчёт установок для стрельбы',
  laying: 'Наводка орудия',
  loading: 'Заряжание',
  ready: 'Орудие готово',
  firing: 'Огонь',
  cover: 'В укрытии',
  disabled: 'Орудие не боеготово',
};

export class ArtilleryCrewAI {
  /** Время, до которого расчёт остаётся у орудия после стрельбы (не сохраняется). */
  private holdUntil: Partial<Record<GunId, number>> = {};

  constructor(private sim: Sim) {}

  reset(): void {
    this.holdUntil = {};
  }

  phaseName(p: GunPhase): string {
    return PHASE_TASK[p];
  }

  /** Курс орудия в мире по азимуту (азимут — от севера по часовой стрелке). */
  gunYaw(g: GunState): number {
    return Math.PI - g.azimuth * DEG;
  }

  /** Мировая позиция боевого поста и направление взгляда номера расчёта. */
  stationPos(id: GunId, slot: number): { x: number; z: number; yaw: number } {
    const sim = this.sim;
    const g = sim.artillery.gun(id);
    const site = sim.layout.guns[id];
    const off = site.stations[Math.min(slot, site.stations.length - 1)];
    const yaw = this.gunYaw(g);
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    let x = g.x + off.x * c + off.z * s;
    let z = g.z - off.x * s + off.z * c;
    if (!sim.grid.walkableAt(x, z)) {
      const p = sim.grid.nearestWalkable(x, z, 4);
      if (p) {
        x = p.x;
        z = p.z;
      }
    }
    return { x, z, yaw: yawTo(g.x - x, g.z - z) };
  }

  /** Номера расчёта (индексы постов), которые сейчас на местах. */
  present(g: GunState): number[] {
    const out: number[] = [];
    g.crew.forEach((id, slot) => {
      const n = this.sim.npcs.byId(id);
      if (!n || n.status !== 'active' || !n.goal.startsWith('crew:')) return;
      const p = this.stationPos(g.id, slot);
      if (dist(n.x, n.z, p.x, p.z) < 2.2) out.push(slot);
    });
    return out;
  }

  private fitCrew(g: GunState): NpcState[] {
    return g.crew.map((id) => this.sim.npcs.byId(id)).filter((n): n is NpcState => !!n && n.status === 'active');
  }

  /** Командир орудия либо тот, кто его замещает. */
  commander(g: GunState): NpcState | null {
    const fit = this.fitCrew(g);
    return fit[0] ?? null;
  }

  animFor(n: NpcState, id: GunId, slot: number): AnimId {
    const g = this.sim.artillery.gun(id);
    const acting = this.commander(g)?.id === n.id;
    if (this.sim.combat.underFire && g.phase !== 'firing' && g.phase !== 'ready') return 'cover';
    switch (g.phase) {
      case 'computing':
        return acting ? 'write' : slot === 1 ? 'inspect' : 'attention';
      case 'laying':
        return slot === 1 || slot === 3 ? 'crank' : acting ? 'point' : 'attention';
      case 'loading':
        return slot === 2 || slot === 3 || slot === 4 ? 'ram' : slot === 5 ? 'pickup' : acting ? 'point' : 'inspect';
      case 'ready':
      case 'firing':
        return acting ? 'command' : 'cover';
      case 'deploying':
      case 'stowing':
      case 'relocating':
        return acting ? 'point' : 'work';
      case 'cover':
        return 'cover';
      default:
        return 'attention';
    }
  }

  /** Цель для номера расчёта: занять боевой пост и работать. */
  option(n: NpcState): GoalOption | null {
    if (n.status !== 'active' || !(n.unit === 'gun1' || n.unit === 'gun2' || n.unit === 'gun3')) return null;
    const g = this.sim.artillery.gun(n.unit);
    const hold = (this.holdUntil[g.id] ?? -1) > this.sim.now;
    const alertReady = this.sim.alert.level >= 2 && (g.id !== 'gun1' || g.deploy >= 1);
    if (g.phase === 'idle' && !hold && !alertReady) return null;
    if (g.phase === 'disabled') return null;
    const slot = g.crew.indexOf(n.id);
    if (slot < 0) return null;
    return {
      key: `crew:${g.id}`,
      score: g.phase === 'idle' ? 66 : 82,
      task: `${this.sim.artillery.gunName(g.id)}: ${PHASE_TASK[g.phase].toLowerCase()}`,
      plan: () => [{ k: 'station', gun: g.id, slot }],
    };
  }

  private setPhase(g: GunState, phase: GunPhase, dur = 0): void {
    g.phase = phase;
    g.phaseT = 0;
    g.phaseDur = dur;
    this.sim.bus.emit('arty:phase', { gun: g.id, phase });
  }

  private report(g: GunState, text: string, speak = true): void {
    const sim = this.sim;
    const m = sim.artillery.mission(g.missionId);
    const full = `${sim.artillery.gunName(g.id)}: ${text}`;
    if (m) m.reports.push(`${sim.time.clockString()} ${full}`);
    sim.bus.emit('arty:report', { gun: g.id, text: full });
    const c = this.commander(g);
    if (c && speak) sim.npcs.speak(c, text, true);
  }

  update(_dt: number, gdt: number): void {
    for (const id of GUN_IDS) this.tick(this.sim.artillery.gun(id), gdt);
  }

  private tick(g: GunState, gdt: number): void {
    const sim = this.sim;
    const art = sim.artillery;
    const site = sim.layout.guns[g.id];
    const rail = site.kind === 'rail';
    const mission = art.mission(g.missionId);
    const eq = sim.repair.get(g.id);
    g.phaseT += gdt;

    if (eq.broken && g.phase !== 'disabled' && g.phase !== 'relocating') {
      if (mission) this.report(g, 'Орудие вышло из строя, огонь вести не могу!');
      this.setPhase(g, 'disabled');
      return;
    }
    if (g.phase === 'disabled') {
      if (!eq.broken) this.setPhase(g, 'idle');
      return;
    }
    const fit = this.fitCrew(g);
    const present = this.present(g);

    switch (g.phase) {
      case 'idle': {
        const needMove = rail && ((g.wantDeploy && g.deploy < 1) || (!g.wantDeploy && g.deploy > 0));
        if ((mission && mission.status === 'active') || needMove) {
          if (fit.length < 2) {
            if (mission) {
              this.report(g, 'Нет расчёта, задачу выполнить не могу.', false);
              art.ceaseFire([g.id]);
            }
            return;
          }
          this.setPhase(g, 'assembling');
          const c = this.commander(g);
          if (c) sim.npcs.speak(c, 'Расчёт, к орудию!', true);
        }
        break;
      }
      case 'assembling': {
        const need = Math.min(fit.length, rail ? 4 : 3);
        if (present.length >= need || (g.phaseT > 9 && present.length >= 2)) {
          if (rail && g.wantDeploy && g.deploy < 1) this.setPhase(g, 'deploying');
          else if (rail && !g.wantDeploy && g.deploy > 0 && !mission) this.setPhase(g, 'stowing');
          else if (mission) this.setPhase(g, 'computing');
          else this.setPhase(g, 'idle');
        } else if (g.phaseT > 25) {
          if (mission) this.report(g, 'Расчёт не собран, задача сорвана.', false);
          art.ceaseFire([g.id]);
          this.setPhase(g, 'idle');
        }
        break;
      }
      case 'deploying': {
        if (art.state.hangarDoor < 0.95 && g.deploy < 0.47) break;
        g.elevation = approach(g.elevation, 2, gdt * 4);
        g.azimuth = 180;
        g.deploy = clamp(g.deploy + gdt / 20, 0, 1);
        if (g.deploy >= 1) {
          this.report(g, 'Установка на позиции.');
          this.holdUntil[g.id] = sim.now + 30;
          this.setPhase(g, mission ? 'computing' : 'idle');
        }
        break;
      }
      case 'stowing': {
        // сначала ствол по-походному и вдоль пути
        const azOk = Math.abs(wrapAngle((g.azimuth - 180) * DEG)) < 0.01;
        if (!azOk || g.elevation > 2.5) {
          g.azimuth = (approachAngle(g.azimuth * DEG, Math.PI, 6 * DEG * gdt) / DEG + 360) % 360;
          g.elevation = approach(g.elevation, 2, gdt * 4);
          break;
        }
        if (art.state.hangarDoor < 0.95 && g.deploy > 0.5) break;
        g.deploy = clamp(g.deploy - gdt / 20, 0, 1);
        if (g.deploy <= 0) {
          this.report(g, 'Установка укрыта в ангаре.');
          this.setPhase(g, 'idle');
        }
        break;
      }
      case 'relocating': {
        const toAlt = g.note === 'toAlt';
        const from = toAlt ? site.main : site.alt;
        const to = toAlt ? site.alt : site.main;
        const t = clamp(g.phaseT / g.phaseDur, 0, 1);
        g.x = from.x + (to.x - from.x) * t;
        g.z = from.z + (to.z - from.z) * t;
        g.elevation = approach(g.elevation, 4, gdt * 4);
        if (t >= 1) {
          g.atAlt = toAlt;
          g.note = '';
          this.report(g, toAlt ? 'Заняли запасную позицию.' : 'Вернулись на основную позицию.');
          this.setPhase(g, 'idle');
        }
        break;
      }
      case 'computing': {
        if (!mission || mission.status !== 'active') return this.release(g);
        if (g.phaseDur === 0) {
          const c = this.commander(g);
          const acting = c && c.id !== g.crew[0];
          const skill = c ? c.skill : 30;
          let dur = (rail ? 13 : 7.5) * (1.45 - skill / 130) * (acting ? 1.35 : 1) * (1 + (c?.fatigue ?? 40) / 300);
          if (g.note === 'shift') dur *= 0.3;
          if (!sim.resources.state.wire && !sim.resources.state.radio) dur *= 1.6;
          g.phaseDur = dur;
          g.note = '';
        }
        if (g.phaseT < g.phaseDur) break;
        // поправки командира: дальность (м) и доворот (деления угломера)
        const dx0 = mission.tx - COMPLEX_POS.x;
        const dy0 = mission.ty - COMPLEX_POS.y;
        const r0 = Math.hypot(dx0, dy0) || 1;
        const azCorr = (mission.corrAz * 0.06 * DEG) * r0;
        const ux = dx0 / r0;
        const uy = dy0 / r0;
        const tx = dx0 + ux * mission.corrRange + uy * azCorr;
        const ty = dy0 + uy * mission.corrRange - ux * azCorr;
        const sol = sim.ballistics.solve(tx, ty, mission.shell, art.state.met, 1 - (Math.floor(g.wear * 10) / 10) * 0.035);
        if (!sol.ok) {
          this.report(g, `Огонь невозможен: ${sol.reason}.`);
          art.ceaseFire([g.id]);
          return this.release(g);
        }
        g.solution = sol;
        g.targetAz = sol.azimuth;
        g.targetEl = sol.elevation;
        this.report(g, `Данные готовы: дальность ${Math.round(sol.range)}, угломер ${mils(sol.azimuth)}, заряд ${sol.charge}.`, false);
        this.setPhase(g, 'laying');
        break;
      }
      case 'laying': {
        if (!mission || mission.status !== 'active') return this.release(g);
        const rate = (rail ? 5 : 9) * (present.includes(1) ? 1 : 0.4) * (present.length >= 3 ? 1 : 0.7);
        const cur = g.azimuth * DEG;
        const tgt = g.targetAz * DEG;
        g.azimuth = ((approachAngle(cur, wrapAngle(tgt), rate * DEG * gdt) / DEG) % 360 + 360) % 360;
        g.elevation = approach(g.elevation, g.targetEl, (rail ? 3 : 6) * gdt * (present.includes(1) ? 1 : 0.4));
        const dAz = Math.abs(wrapAngle(cur - tgt)) / DEG;
        if (dAz < 0.03 && Math.abs(g.elevation - g.targetEl) < 0.03) {
          g.azimuth = g.targetAz;
          g.elevation = g.targetEl;
          this.setPhase(g, g.loaded === mission.shell ? 'ready' : 'loading');
        }
        break;
      }
      case 'loading': {
        if (!mission || mission.status !== 'active') return this.release(g);
        const have = g.niche[mission.shell] ?? 0;
        if (have <= 0) {
          sim.supply.requestNiche(g.id, mission.shell);
          if (sim.resources.ammo(mission.shell) <= 0 && !sim.supply.hasNicheJob(g.id)) {
            this.report(g, `Снаряды (${SHELLS[mission.shell].short}) кончились. Огонь прекращаю.`);
            art.ceaseFire([g.id]);
            return this.release(g);
          }
          if (g.note !== 'noammo') {
            g.note = 'noammo';
            this.report(g, 'На позиции нет снарядов, жду подноса.', false);
          }
          g.phaseT = 0;
          break;
        }
        if (g.phaseDur === 0) {
          const hands = present.filter((s) => s >= 2).length;
          const avgFat = fit.reduce((a, n) => a + n.fatigue, 0) / Math.max(1, fit.length);
          let dur = (rail ? 13 : 2.4) * (1 + avgFat / 220) * (hands >= 3 ? 0.9 : hands === 2 ? 1 : hands === 1 ? 1.6 : 2.6);
          if (rail && (sim.resources.state.power < 1 || sim.repair.get('hoist').broken)) dur *= 2.8;
          if (mission.kind === 'raid') dur *= 0.8;
          g.phaseDur = dur;
          g.note = '';
        }
        if (g.phaseT < g.phaseDur) break;
        g.niche[mission.shell] = have - 1;
        g.loaded = mission.shell;
        if ((g.niche[mission.shell] ?? 0) < 3) sim.supply.requestNiche(g.id, mission.shell);
        this.setPhase(g, 'ready');
        break;
      }
      case 'ready': {
        if (!mission || mission.status !== 'active') return this.release(g);
        if (mission.kind === 'salvo') {
          const others = mission.guns.filter((id) => id !== g.id).map((id) => art.gun(id));
          const allReady = others.every((o) => o.phase === 'ready' || o.missionId !== mission.id || o.phase === 'disabled');
          if (!allReady && g.phaseT < 14) break;
        }
        if (mission.kind === 'suppress' && g.shotsInMission > 0 && sim.now - g.lastShotT < 5) break;
        this.setPhase(g, 'firing', 0.5);
        const c = this.commander(g);
        if (c) sim.npcs.speak(c, 'Орудие… Огонь!', true);
        art.fire(g);
        this.report(g, `Выстрел! (${mission.fired}/${mission.kind === 'suppress' ? '…' : mission.rounds})`, false);
        this.holdUntil[g.id] = sim.now + 12;
        break;
      }
      case 'firing': {
        if (g.phaseT < g.phaseDur) break;
        if (!mission || mission.status !== 'active') return this.release(g);
        const perGun = Math.ceil(mission.rounds / Math.max(1, mission.guns.length));
        const done = mission.kind === 'suppress' ? sim.now > mission.until : mission.fired >= mission.rounds || g.shotsInMission >= perGun;
        if (done) {
          const allDone = mission.kind === 'suppress' || mission.fired >= mission.rounds || mission.guns.every((id) => art.gun(id).shotsInMission >= perGun || art.gun(id).missionId !== mission.id);
          g.missionId = null;
          if (allDone) art.finish(mission);
          return this.release(g);
        }
        this.setPhase(g, 'laying');
        break;
      }
      case 'cover':
        if (g.phaseT > 8) this.setPhase(g, mission ? 'computing' : 'idle');
        break;
    }
  }

  private release(g: GunState): void {
    this.holdUntil[g.id] = this.sim.now + 6;
    g.solution = g.solution;
    this.setPhase(g, 'idle');
  }

  /** Доклад командира орудия о состоянии. */
  status(g: GunState): string {
    const sim = this.sim;
    const fit = this.fitCrew(g).length;
    const eq = sim.repair.get(g.id);
    const c = this.commander(g);
    const acting = c && c.id !== g.crew[0] ? ` Обязанности командира исполняет ${rankName(c)} ${c.last}.` : '';
    const niche = Object.entries(g.niche)
      .filter(([, n]) => (n ?? 0) > 0)
      .map(([s, n]) => `${SHELLS[s as keyof typeof SHELLS].short} — ${n}`)
      .join(', ');
    const barrel = g.wear < 0.35 ? 'ствол в хорошем состоянии' : g.wear < 0.65 ? 'ствол изношен умеренно' : 'ствол сильно расстрелян, рассеивание большое';
    return `${sim.artillery.gunName(g.id)}: ${PHASE_TASK[g.phase].toLowerCase()}. Расчёт ${fit} из ${g.crew.length}.${acting} Матчасть ${Math.round(eq.condition)}%, ${barrel}. На позиции: ${niche || 'снарядов нет'}.`;
  }
}
