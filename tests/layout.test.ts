import { describe, expect, it } from 'vitest';
import { buildLayout } from '../src/world/layout';
import { Pathfinder } from '../src/world/Pathfinder';

describe('планировка комплекса', () => {
  const L = buildLayout();
  const pf = new Pathfinder(L.grid);
  const from = { x: 57.5, z: 62.5 };

  it('все служебные точки достижимы с плаца', () => {
    const bad: string[] = [];
    for (const s of L.spots) {
      if (!pf.find(from.x, from.z, s.x, s.z)) bad.push(s.id);
    }
    expect(bad).toEqual([]);
  });

  it('точки маршрутов патрулей проходимы и связаны', () => {
    const bad: string[] = [];
    for (const [name, pts] of Object.entries(L.routes)) {
      pts.forEach((p, i) => {
        if (!L.grid.walkableAt(p.x, p.z) || !pf.find(from.x, from.z, p.x, p.z)) bad.push(`${name}[${i}]`);
      });
    }
    expect(bad).toEqual([]);
  });

  it('именованные точки достижимы', () => {
    const bad: string[] = [];
    for (const [name, p] of Object.entries(L.points)) {
      if (!pf.find(from.x, from.z, p.x, p.z)) bad.push(name);
    }
    expect(bad).toEqual([]);
  });

  it('посты пропуска ссылаются на существующие точки', () => {
    for (const g of L.gates) {
      if (g.kind === 'post') expect(L.spotById[g.postSpot], g.id).toBeTruthy();
    }
  });

  it('у орудий есть проходимые ниши', () => {
    for (const g of Object.values(L.guns)) {
      expect(L.grid.walkableAt(g.niche.x, g.niche.z), g.id).toBe(true);
      expect(L.grid.walkableAt(g.nicheAlt.x, g.nicheAlt.z), g.id + ' alt').toBe(true);
    }
  });
});
