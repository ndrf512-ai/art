/**
 * BallisticsSystem — внешняя баллистика: материальная точка с сопротивлением воздуха,
 * ветром и плотностью атмосферы. Расчёт установок и «настоящий» выстрел используют
 * одну модель, но разные данные: расчёт верит метеосводке, снаряд летит в реальной погоде.
 */
import type { FiringSolution, MetData, ShellId } from '../core/types';

export interface ShellDef {
  id: ShellId;
  name: string;
  short: string;
  gun: 'howitzer' | 'rail';
  /** Коэффициент сопротивления, 1/м. */
  drag: number;
  /** Начальные скорости по зарядам, м/с. */
  charges: number[];
  /** Радиус поражения, м, и «мощность». */
  radius: number;
  power: number;
  /** Действие по укреплённым целям. */
  pierce: number;
  smoke?: boolean;
  wear: number;
}

export const SHELLS: Record<ShellId, ShellDef> = {
  he21: { id: 'he21', name: '21-см осколочно-фугасный', short: 'ОФ', gun: 'howitzer', drag: 0.000058, charges: [300, 400, 490, 565], radius: 130, power: 52, pierce: 0.25, wear: 0.004 },
  cp21: { id: 'cp21', name: '21-см бетонобойный', short: 'БЕТ', gun: 'howitzer', drag: 0.000054, charges: [400, 490, 565], radius: 45, power: 60, pierce: 1, wear: 0.005 },
  smoke21: { id: 'smoke21', name: '21-см дымовой', short: 'ДЫМ', gun: 'howitzer', drag: 0.000064, charges: [300, 400, 490, 565], radius: 320, power: 0, pierce: 0, smoke: true, wear: 0.003 },
  he38: { id: 'he38', name: '38-см фугасный', short: 'ФУГ', gun: 'rail', drag: 0.000039, charges: [640, 820], radius: 300, power: 85, pierce: 0.5, wear: 0.012 },
  sp38: { id: 'sp38', name: '38-см спецснаряд особой мощности', short: 'СПЕЦ', gun: 'rail', drag: 0.000036, charges: [820], radius: 190, power: 150, pierce: 1.6, wear: 0.02 },
};

const G = 9.81;
const DEG = Math.PI / 180;

export const STANDARD_MET: MetData = { t: 0, windSpeed: 0, windDir: 0, tempC: 15, pressure: 1013 };

export interface Impact {
  /** Смещение точки падения от орудия: восток и север, м. */
  x: number;
  y: number;
  tof: number;
  range: number;
}

/** Форматирует угол в делениях угломера (6000 в окружности): «47-20». */
export function mils(deg: number): string {
  const m = Math.round((((deg % 360) + 360) % 360) * (6000 / 360));
  const a = Math.floor(m / 100);
  const b = m % 100;
  return `${a < 10 ? '0' + a : a}-${b < 10 ? '0' + b : b}`;
}

export class BallisticsSystem {
  /**
   * Интегрирует траекторию. Азимут — градусы по часовой стрелке от севера.
   * Ветер задан направлением, ОТКУДА он дует.
   */
  simulate(v0: number, elevDeg: number, azDeg: number, drag: number, met: MetData): Impact {
    const el = elevDeg * DEG;
    const az = azDeg * DEG;
    const rho0 = (met.pressure / 1013) * (288 / (met.tempC + 273));
    // ветер: вектор скорости воздуха
    const wa = (met.windDir + 180) * DEG;
    const wx = Math.sin(wa) * met.windSpeed;
    const wy = Math.cos(wa) * met.windSpeed;
    let x = 0;
    let y = 0;
    let z = 0;
    let vx = Math.sin(az) * Math.cos(el) * v0;
    let vy = Math.cos(az) * Math.cos(el) * v0;
    let vz = Math.sin(el) * v0;
    let t = 0;
    const dt = 0.25;
    for (let i = 0; i < 2400; i++) {
      const rho = rho0 * Math.exp(-Math.max(0, z) / 9000);
      const rx = vx - wx;
      const ry = vy - wy;
      const sp = Math.sqrt(rx * rx + ry * ry + vz * vz);
      const k = drag * rho * sp;
      const ax = -k * rx;
      const ay = -k * ry;
      const azz = -k * vz - G;
      const nx = x + vx * dt + 0.5 * ax * dt * dt;
      const ny = y + vy * dt + 0.5 * ay * dt * dt;
      const nz = z + vz * dt + 0.5 * azz * dt * dt;
      if (nz <= 0 && i > 0) {
        const f = z / (z - nz);
        x += (nx - x) * f;
        y += (ny - y) * f;
        t += dt * f;
        break;
      }
      x = nx;
      y = ny;
      z = nz;
      vx += ax * dt;
      vy += ay * dt;
      vz += azz * dt;
      t += dt;
    }
    return { x, y, tof: t, range: Math.hypot(x, y) };
  }

  private maxCache = new Map<string, number>();

  /** Предельная дальность заряда в нормальных условиях. */
  maxRange(shell: ShellId, charge?: number): number {
    const def = SHELLS[shell];
    const c = charge ?? def.charges.length - 1;
    const key = `${shell}:${c}`;
    let r = this.maxCache.get(key);
    if (r === undefined) {
      r = 0;
      for (let e = 30; e <= 50; e += 2) r = Math.max(r, this.simulate(def.charges[c], e, 0, def.drag, STANDARD_MET).range);
      this.maxCache.set(key, r);
    }
    return r;
  }

  minRange(shell: ShellId): number {
    const def = SHELLS[shell];
    return this.simulate(def.charges[0], 6, 0, def.drag, STANDARD_MET).range;
  }

  /**
   * Решение огневой задачи: заряд, прицел и доворот для попадания в точку (dx, dy)
   * при заданных (предполагаемых) метеоусловиях и начальной скорости.
   */
  solve(dx: number, dy: number, shell: ShellId, met: MetData, v0Scale = 1): FiringSolution {
    const def = SHELLS[shell];
    const range = Math.hypot(dx, dy);
    const azimuth = ((Math.atan2(dx, dy) / DEG) % 360 + 360) % 360;
    const fail = (reason: string): FiringSolution => ({ ok: false, reason, range, azimuth, elevation: 0, v0: 0, charge: 0, tof: 0 });
    if (range < this.minRange(shell)) return fail('цель ближе минимальной дальности');
    let charge = -1;
    for (let c = 0; c < def.charges.length; c++) {
      if (this.maxRange(shell, c) * 0.94 >= range) {
        charge = c;
        break;
      }
    }
    if (charge < 0) return fail('цель вне досягаемости');
    const v0 = def.charges[charge] * v0Scale;
    // точка прицеливания смещается так, чтобы с учётом ветра снаряд пришёл в цель
    let ax = dx;
    let ay = dy;
    let elev = 20;
    let az = azimuth;
    let tof = 0;
    for (let iter = 0; iter < 4; iter++) {
      const r = Math.hypot(ax, ay);
      az = Math.atan2(ax, ay) / DEG;
      let lo = 4;
      let hi = 46;
      for (let i = 0; i < 22; i++) {
        const mid = (lo + hi) / 2;
        const imp = this.simulate(v0, mid, az, def.drag, STANDARD_MET);
        if (imp.range < r) lo = mid;
        else hi = mid;
      }
      elev = (lo + hi) / 2;
      const imp = this.simulate(v0, elev, az, def.drag, met);
      tof = imp.tof;
      ax += dx - imp.x;
      ay += dy - imp.y;
    }
    return { ok: true, range, azimuth: ((az % 360) + 360) % 360, elevation: elev, v0, charge: charge + 1, tof };
  }
}
