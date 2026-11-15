import { describe, expect, it } from 'vitest';
import { BallisticsSystem, SHELLS, STANDARD_MET } from '../src/sim/BallisticsSystem';

describe('баллистика', () => {
  const b = new BallisticsSystem();

  it('предельные дальности соответствуют орудиям', () => {
    const r21 = b.maxRange('he21');
    const r38 = b.maxRange('he38');
    console.log('max he21', Math.round(r21), 'he38', Math.round(r38), 'sp38', Math.round(b.maxRange('sp38')), 'min21', Math.round(b.minRange('he21')), 'min38', Math.round(b.minRange('he38')));
    expect(r21).toBeGreaterThan(15500);
    expect(r21).toBeLessThan(18000);
    expect(r38).toBeGreaterThan(29000);
    expect(r38).toBeLessThan(36000);
  });

  it('решение приводит снаряд в цель в тех же условиях', () => {
    const met = { ...STANDARD_MET, windSpeed: 9, windDir: 250, tempC: 4, pressure: 1002 };
    for (const [dx, dy] of [[1200, -9000], [-4000, -13500], [3000, -6000]]) {
      const s = b.solve(dx, dy, 'he21', met);
      expect(s.ok).toBe(true);
      const imp = b.simulate(s.v0, s.elevation, s.azimuth, SHELLS.he21.drag, met);
      expect(Math.hypot(imp.x - dx, imp.y - dy)).toBeLessThan(25);
    }
  });

  it('неучтённый ветер даёт заметное отклонение', () => {
    const s = b.solve(0, -12000, 'he21', STANDARD_MET);
    const imp = b.simulate(s.v0, s.elevation, s.azimuth, SHELLS.he21.drag, { ...STANDARD_MET, windSpeed: 12, windDir: 90 });
    const miss = Math.hypot(imp.x - 0, imp.y + 12000);
    console.log('miss with unaccounted 12 m/s crosswind:', Math.round(miss), 'tof', s.tof.toFixed(1), 'elev', s.elevation.toFixed(1), 'charge', s.charge);
    expect(miss).toBeGreaterThan(40);
    expect(miss).toBeLessThan(900);
  });

  it('цель вне досягаемости отклоняется', () => {
    expect(b.solve(0, -24000, 'he21', STANDARD_MET).ok).toBe(false);
    expect(b.solve(0, -24000, 'he38', STANDARD_MET).ok).toBe(true);
  });
});
