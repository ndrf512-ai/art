/**
 * Процедурные модели обстановки. Каждый предмет собирается из примитивов в
 * локальной системе координат (+z — «лицевая» сторона) и попадает в общий батч.
 */
import * as THREE from 'three';
import { hash2 } from '../core/Rng';
import type { PropDef } from '../core/types';
import type { Batcher } from './Batcher';
import type { Materials, MatName } from './Materials';
import { paperMapTex } from './Textures';
import { patchBaked } from './Materials';

const special = new Map<string, THREE.MeshStandardMaterial>();
function paperMat(kind: 'map' | 'blueprint' | 'schedule', M: Materials): THREE.MeshStandardMaterial {
  let m = special.get(kind);
  if (!m) {
    m = patchBaked(new THREE.MeshStandardMaterial({ map: paperMapTex(kind, 3), roughness: 1, aoMap: M.black1, aoMapIntensity: 0.9 }));
    special.set(kind, m);
  }
  return m;
}

const HALF = Math.PI / 2;

export function buildProp(p: PropDef, b: Batcher, M: Materials, indoor: boolean): void {
  const m = (name: MatName) => M.get(name, indoor);
  const swap = Math.abs(Math.sin(p.yaw)) > 0.5;
  const lw = swap ? p.d : p.w;
  const ld = swap ? p.w : p.d;
  const h = p.h;
  const r = (k: number) => hash2(Math.round(p.x * 10), Math.round(p.z * 10), k);
  b.push(p.x, 0, p.z, p.yaw);
  switch (p.type) {
    case 'bunk': {
      const fw = lw - 0.12;
      const fl = ld - 0.08;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(m('woodDark'), 0.07, h, 0.07, (sx * fw) / 2, h / 2, (sz * fl) / 2);
      for (const y of [0.36, 1.26]) {
        b.box(m('wood'), fw, 0.05, fl, 0, y, 0);
        b.box(m('bedding'), fw - 0.06, 0.09, fl - 0.06, 0, y + 0.07, 0);
        b.box(m('blanket'), fw - 0.04, 0.05, fl * 0.62, 0, y + 0.13, fl * 0.16);
        b.box(m('white'), fw - 0.2, 0.08, 0.3, 0, y + 0.15, -fl / 2 + 0.22);
        b.box(m('woodDark'), 0.04, 0.16, fl, -fw / 2, y + 0.06, 0);
        b.box(m('woodDark'), 0.04, 0.16, fl, fw / 2, y + 0.06, 0);
      }
      break;
    }
    case 'bed': {
      const fw = lw - 0.1;
      const fl = ld - 0.06;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl(m('metal'), 0.025, 0.025, h + (sz < 0 ? 0.4 : 0.15), (sx * fw) / 2, (h + (sz < 0 ? 0.4 : 0.15)) / 2, (sz * fl) / 2, 6);
      b.box(m('metal'), fw, 0.04, fl, 0, h - 0.12, 0);
      b.box(m(p.p?.plain ? 'canvas' : 'bedding'), fw - 0.04, 0.1, fl - 0.04, 0, h - 0.05, 0);
      if (!p.p?.plain) {
        b.box(m(p.p?.med ? 'white' : 'blanket'), fw - 0.02, 0.05, fl * 0.6, 0, h + 0.02, fl * 0.17);
        b.box(m('white'), fw - 0.25, 0.09, 0.32, 0, h + 0.04, -fl / 2 + 0.24);
      }
      break;
    }
    case 'table': {
      b.box(m('wood'), lw - 0.08, 0.05, ld - 0.08, 0, h, 0);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(m('woodDark'), 0.07, h, 0.07, sx * (lw / 2 - 0.14), h / 2, sz * (ld / 2 - 0.14));
      if (p.p?.charges) {
        for (let i = 0; i < 4; i++) b.cyl(m('brass'), 0.09, 0.09, 0.42, -lw / 2 + 0.4 + i * 0.45, h + 0.24, 0, 8);
        b.box(m('metalGrey'), 0.4, 0.25, 0.3, lw / 2 - 0.4, h + 0.15, 0.1);
      } else if (r(1) > 0.5) {
        b.cyl(m('metalGrey'), 0.07, 0.06, 0.1, lw * (r(2) - 0.5) * 0.6, h + 0.075, ld * (r(3) - 0.5) * 0.4, 8);
      }
      break;
    }
    case 'bench': {
      b.box(m('wood'), lw, 0.05, ld, 0, h, 0);
      for (const sx of [-1, 1]) b.box(m('woodDark'), 0.06, h, ld * 0.8, sx * (lw / 2 - 0.25), h / 2, 0);
      break;
    }
    case 'desk': {
      b.box(m('wood'), lw - 0.06, 0.05, ld - 0.1, 0, h, 0);
      b.box(m('woodDark'), 0.42, h - 0.06, ld - 0.16, -lw / 2 + 0.26, (h - 0.06) / 2, 0);
      b.box(m('woodDark'), 0.42, h - 0.06, ld - 0.16, lw / 2 - 0.26, (h - 0.06) / 2, 0);
      b.box(m('woodDark'), lw - 0.1, h * 0.55, 0.03, 0, h * 0.7, -ld / 2 + 0.08);
      b.box(m('paper'), 0.3, 0.012, 0.22, -0.25 + r(1) * 0.2, h + 0.032, 0.05, r(2) * 0.6);
      b.box(m('paper'), 0.22, 0.03, 0.3, 0.35, h + 0.04, -0.05, r(3) * 0.5);
      b.cyl(m('metalGreen'), 0.1, 0.04, 0.12, lw / 2 - 0.25, h + 0.38, -ld / 2 + 0.25, 8);
      b.cyl(m('metal'), 0.012, 0.012, 0.32, lw / 2 - 0.25, h + 0.18, -ld / 2 + 0.25, 5);
      b.cyl(m('metal'), 0.07, 0.07, 0.02, lw / 2 - 0.25, h + 0.035, -ld / 2 + 0.25, 8);
      break;
    }
    case 'cabinet': {
      const mat = p.p?.files ? m('woodDark') : m('metalGreen');
      b.box(mat, lw - 0.06, h, ld - 0.1, 0, h / 2, 0);
      const n = Math.max(1, Math.round(lw / 0.6));
      for (let i = 1; i < n; i++) b.box(m('black'), 0.015, h - 0.1, 0.02, -lw / 2 + (lw * i) / n, h / 2, ld / 2 - 0.045);
      for (let i = 0; i < n; i++) b.box(m('steel'), 0.03, 0.1, 0.03, -lw / 2 + (lw * (i + 0.8)) / n, h * 0.55, ld / 2 - 0.03);
      if (p.p?.blueprints) for (let i = 0; i < 5; i++) b.cyl(m('paper'), 0.04, 0.04, 0.7, -lw / 2 + 0.3 + i * 0.18, h + 0.05, 0, 6, 0, 0, HALF);
      break;
    }
    case 'locker': {
      b.box(m('metalGreen'), lw - 0.04, h, ld - 0.2, 0, h / 2, -0.05);
      const n = Math.max(1, Math.round(lw / 0.5));
      for (let i = 1; i < n; i++) b.box(m('black'), 0.012, h - 0.06, 0.02, -lw / 2 + (lw * i) / n, h / 2, ld / 2 - 0.145);
      for (let i = 0; i < n; i++) b.box(m('black'), 0.12, 0.012, 0.02, -lw / 2 + (lw * (i + 0.5)) / n, h * 0.85, ld / 2 - 0.145);
      break;
    }
    case 'shelf': {
      const depth = Math.min(ld, 0.55);
      const zc = -ld / 2 + depth / 2 + 0.03;
      const n = Math.max(2, Math.round(lw / 1.2) + 1);
      for (let i = 0; i < n; i++) b.box(m('woodDark'), 0.05, h, depth, -lw / 2 + 0.05 + ((lw - 0.1) * i) / (n - 1), h / 2, zc);
      for (let s = 0; s < 4; s++) {
        const y = 0.12 + (s * (h - 0.3)) / 3;
        b.box(m('wood'), lw - 0.06, 0.035, depth, 0, y, zc);
        if (s === 3) continue;
        let x = -lw / 2 + 0.2;
        let k = 0;
        while (x < lw / 2 - 0.25) {
          const rr = hash2(Math.round(p.x * 7 + s * 13), Math.round(p.z * 7 + k), 4);
          const bw = 0.18 + rr * 0.3;
          const bh = 0.14 + hash2(k, s, Math.round(p.x)) * 0.3;
          if (rr > 0.18) {
            if (p.p?.files) b.box(m(rr > 0.6 ? 'paper' : 'leather'), bw, Math.min(bh + 0.14, 0.42), depth * 0.7, x + bw / 2, y + 0.02 + Math.min(bh + 0.14, 0.42) / 2, zc);
            else if (p.p?.food && rr > 0.55) b.cyl(m('metalGrey'), 0.08, 0.08, 0.22, x + bw / 2, y + 0.13, zc, 8);
            else if (p.p?.food) b.box(m('canvas'), bw, bh, depth * 0.75, x + bw / 2, y + 0.02 + bh / 2, zc);
            else if (p.p?.parts) b.box(m(rr > 0.5 ? 'metal' : 'rust'), bw, bh * 0.6, depth * 0.6, x + bw / 2, y + 0.02 + bh * 0.3, zc);
            else b.box(m(rr > 0.5 ? 'wood' : 'metalGreen'), bw, bh, depth * 0.7, x + bw / 2, y + 0.02 + bh / 2, zc);
          }
          x += bw + 0.06;
          k++;
        }
      }
      break;
    }
    case 'crates': {
      const mat = p.p?.ammo ? m('metalGreen') : m('wood');
      const nx = Math.max(1, Math.round(lw / 1.0));
      const nz = Math.max(1, Math.round(ld / 0.8));
      const levels = Math.max(1, Math.round(h / 0.45));
      for (let ix = 0; ix < nx; ix++) {
        for (let iz = 0; iz < nz; iz++) {
          const lv = Math.max(1, levels - Math.floor(hash2(ix + Math.round(p.x), iz + Math.round(p.z), 5) * 2.2));
          for (let l = 0; l < lv; l++) {
            const cw = lw / nx - 0.1;
            const cd = ld / nz - 0.1;
            const rot = (hash2(ix, iz + l, Math.round(p.x * 3)) - 0.5) * 0.14;
            b.box(mat, cw, 0.42, cd, -lw / 2 + (lw * (ix + 0.5)) / nx, 0.22 + l * 0.44, -ld / 2 + (ld * (iz + 0.5)) / nz, rot);
            b.box(m('woodDark'), cw + 0.02, 0.05, 0.05, -lw / 2 + (lw * (ix + 0.5)) / nx, 0.22 + l * 0.44, -ld / 2 + (ld * (iz + 0.5)) / nz + cd / 2, rot);
          }
        }
      }
      break;
    }
    case 'shellrack': {
      const big = !!p.p?.big;
      const cal = big ? 0.19 : 0.105;
      const len = big ? 1.5 : 0.8;
      // деревянные ложементы
      const beams = Math.max(2, Math.round(lw / 1.3) + 1);
      for (let i = 0; i < beams; i++) b.box(m('woodDark'), 0.1, 0.14, ld - 0.1, -lw / 2 + 0.1 + ((lw - 0.2) * i) / (beams - 1), 0.07, 0);
      const perRow = Math.floor((lw - 0.1) / (cal * 2 + 0.03));
      const rows = big ? 2 : 3;
      const cols = Math.max(1, Math.floor((ld - 0.1) / (len + 0.12)));
      for (let c = 0; c < cols; c++) {
        const zc = -ld / 2 + (ld * (c + 0.5)) / cols;
        for (let row = 0; row < rows; row++) {
          const count = perRow - row;
          for (let i = 0; i < count; i++) {
            if (hash2(i + row * 9, c + Math.round(p.x), Math.round(p.z)) < 0.12 && row === rows - 1) continue;
            const x = -((count - 1) * (cal * 2 + 0.03)) / 2 + i * (cal * 2 + 0.03);
            const y = 0.14 + cal + row * (cal * 1.76);
            b.cyl(m('shell'), cal, cal, len * 0.7, x, y, zc - len * 0.12, 10, HALF);
            b.cyl(m('shell'), 0.02, cal, len * 0.3, x, y, zc + len * 0.38, 10, HALF);
            b.cyl(m(big ? 'copper' : 'shellYellow'), cal + 0.004, cal + 0.004, 0.05, x, y, zc - len * 0.4, 10, HALF);
          }
        }
      }
      break;
    }
    case 'cage': {
      for (let i = 0; i <= 6; i++) {
        b.cyl(m('metal'), 0.012, 0.012, h, -lw / 2 + (lw * i) / 6, h / 2, ld / 2, 5);
        b.cyl(m('metal'), 0.012, 0.012, h, -lw / 2, h / 2, -ld / 2 + (ld * i) / 6, 5);
      }
      b.box(m('metal'), lw, 0.04, 0.04, 0, h, ld / 2);
      b.box(m('metal'), lw, 0.04, 0.04, 0, h * 0.5, ld / 2);
      for (let i = 0; i < 3; i++) {
        b.cyl(m('shell'), 0.19, 0.19, 1.1, -0.5 + i * 0.5, 0.7, 0, 10);
        b.cone(m('red'), 0.19, 0.5, -0.5 + i * 0.5, 1.5, 0, 10);
        b.cyl(m('copper'), 0.195, 0.195, 0.06, -0.5 + i * 0.5, 0.3, 0, 10);
      }
      break;
    }
    case 'generator':
    case 'generator2': {
      const s = p.type === 'generator' ? 1 : 0.62;
      b.box(m('metal'), lw - 0.2, 0.18, ld - 0.5, 0, 0.09, 0);
      // дизель
      b.box(m('metalGreen'), lw * 0.5, 1.15 * s, 1.0 * s, -lw * 0.18, 0.18 + 0.58 * s, 0);
      b.box(m('metal'), lw * 0.46, 0.22 * s, 0.7 * s, -lw * 0.18, 0.18 + 1.26 * s, 0);
      for (let i = 0; i < 6; i++) b.cyl(m('rust'), 0.07 * s, 0.07 * s, 0.24 * s, -lw * 0.4 + (i * lw * 0.44) / 5, 0.18 + 1.46 * s, 0.15 * s, 6);
      // маховик и генератор
      b.cyl(m('metal'), 0.62 * s, 0.62 * s, 0.14, lw * 0.1, 0.2 + 0.66 * s, 0, 16, 0, 0, HALF);
      b.cyl(m('metalGrey'), 0.5 * s, 0.5 * s, lw * 0.26, lw * 0.3, 0.2 + 0.62 * s, 0, 14, 0, 0, HALF);
      b.box(m('metalGrey'), 0.4, 0.3, 0.4, lw * 0.3, 0.2 + 1.2 * s, 0);
      // выхлопная труба к потолку и в стену фасада
      b.cyl(m('rust'), 0.09 * s, 0.09 * s, 3.4 - 1.5 * s, -lw * 0.36, 1.5 * s + (3.4 - 1.5 * s) / 2, -0.25 * s, 8);
      if (p.type === 'generator') b.cyl(m('rust'), 0.09, 0.09, 9, -lw * 0.36, 3.4, 4.3, 8, HALF);
      // радиатор и топливопровод
      b.box(m('metal'), 0.16, 1.0 * s, 1.0 * s, -lw * 0.46, 0.2 + 0.56 * s, 0);
      b.cyl(m('copper'), 0.02, 0.02, lw * 0.6, -lw * 0.1, 0.35, ld / 2 - 0.35, 5, 0, 0, HALF);
      break;
    }
    case 'panel': {
      b.box(m('metalGrey'), lw - 0.3, h - 0.5, 0.28, 0, 0.5 + (h - 0.5) / 2, -ld / 2 + 0.16);
      for (let i = 0; i < 4; i++) {
        b.cyl(m('white'), 0.09, 0.09, 0.03, -lw / 2 + 0.45 + i * ((lw - 0.9) / 3), h - 0.35, -ld / 2 + 0.31, 12, HALF);
        b.box(m('black'), 0.06, 0.16, 0.06, -lw / 2 + 0.45 + i * ((lw - 0.9) / 3), h - 0.85, -ld / 2 + 0.32);
        b.box(m(i % 2 ? 'red' : 'brass'), 0.05, 0.05, 0.04, -lw / 2 + 0.45 + i * ((lw - 0.9) / 3), h - 1.15, -ld / 2 + 0.31);
      }
      b.cyl(m('metal'), 0.03, 0.03, 1.6, lw / 2 - 0.25, h + 0.6, -ld / 2 + 0.1, 6);
      b.cyl(m('metal'), 0.03, 0.03, 1.6, lw / 2 - 0.4, h + 0.6, -ld / 2 + 0.1, 6);
      break;
    }
    case 'tank': {
      if (p.p?.small) {
        b.cyl(m('metalGreen'), 0.75, 0.75, h - 0.2, 0, 0.3 + (h - 0.2) / 2, 0, 14);
        b.box(m('metal'), 1.5, 0.3, 1.5, 0, 0.15, 0);
        b.cyl(m('copper'), 0.025, 0.025, 1.2, 0.7, 0.6, 0.5, 5, HALF);
      } else {
        const len = lw - 0.3;
        b.cyl(m('metalGreen'), 0.82, 0.82, len, 0, 1.15, 0, 16, 0, 0, HALF);
        b.sphere(m('metalGreen'), 0.82, -len / 2, 1.15, 0, 0.35, 1, 1, 12);
        b.sphere(m('metalGreen'), 0.82, len / 2, 1.15, 0, 0.35, 1, 1, 12);
        for (const sx of [-1, 1]) b.box(m('concrete'), 0.4, 0.7, 1.5, sx * len * 0.3, 0.35, 0);
        b.cyl(m('metal'), 0.12, 0.12, 0.25, 0, 2.05, 0, 8);
        b.cyl(m('rust'), 0.03, 0.03, 1.4, len * 0.4, 0.7, 0.7, 6);
        b.box(m('rust'), 0.25, 0.5, 0.2, len * 0.4, 1.1, 0.8);
      }
      break;
    }
    case 'barrels': {
      const nx = Math.max(1, Math.floor(lw / 0.68));
      const nz = Math.max(1, Math.floor(ld / 0.68));
      for (let ix = 0; ix < nx; ix++) {
        for (let iz = 0; iz < nz; iz++) {
          const rr = hash2(ix + Math.round(p.x), iz + Math.round(p.z), 6);
          if (rr < 0.12) continue;
          const x = -lw / 2 + (lw * (ix + 0.5)) / nx;
          const z = -ld / 2 + (ld * (iz + 0.5)) / nz;
          const mat = m(rr > 0.7 ? 'rust' : rr > 0.4 ? 'metalGreen' : 'metal');
          b.cyl(mat, 0.29, 0.29, 0.88, x, 0.44, z, 12);
          b.cyl(m('metal'), 0.3, 0.3, 0.03, x, 0.3, z, 12);
          b.cyl(m('metal'), 0.3, 0.3, 0.03, x, 0.6, z, 12);
        }
      }
      break;
    }
    case 'barrel_sand': {
      b.cyl(m('rust'), 0.32, 0.32, h, 0, h / 2, 0, 12);
      b.cyl(m('dirtPile'), 0.29, 0.29, 0.04, 0, h - 0.01, 0, 12);
      break;
    }
    case 'workbench': {
      b.box(m('wood'), lw - 0.1, 0.08, 0.75, 0, h, -ld / 2 + 0.42);
      const legs = Math.max(2, Math.round(lw / 2) + 1);
      for (let i = 0; i < legs; i++) {
        const x = -lw / 2 + 0.15 + ((lw - 0.3) * i) / (legs - 1);
        b.box(m('woodDark'), 0.09, h, 0.09, x, h / 2, -ld / 2 + 0.12);
        b.box(m('woodDark'), 0.09, h, 0.09, x, h / 2, -ld / 2 + 0.72);
      }
      b.box(m('woodDark'), lw - 0.2, 0.04, 0.6, 0, 0.3, -ld / 2 + 0.42);
      b.box(m('wood'), lw - 0.1, 0.9, 0.04, 0, h + 0.75, -ld / 2 + 0.06);
      for (let i = 0; i < Math.floor(lw / 1.1); i++) {
        const x = -lw / 2 + 0.6 + i * 1.1;
        const rr = hash2(i, Math.round(p.x), 9);
        if (rr > 0.66) {
          b.box(m('metal'), 0.2, 0.16, 0.14, x, h + 0.12, -ld / 2 + 0.6);
          b.box(m('metal'), 0.07, 0.08, 0.3, x, h + 0.22, -ld / 2 + 0.6);
        } else if (rr > 0.33) {
          b.box(m('metalGreen'), 0.4, 0.2, 0.24, x, h + 0.14, -ld / 2 + 0.4, rr);
        } else {
          b.box(m('steel'), 0.3, 0.025, 0.05, x, h + 0.055, -ld / 2 + 0.5, rr * 3);
          b.box(m('woodDark'), 0.04, 0.04, 0.28, x + 0.2, h + 0.06, -ld / 2 + 0.45, rr * 5);
        }
        b.box(m('steel'), 0.03, 0.3, 0.02, x, h + 0.85, -ld / 2 + 0.09);
        b.box(m('steel'), 0.18, 0.04, 0.02, x + 0.3, h + 0.95, -ld / 2 + 0.09);
      }
      break;
    }
    case 'lathe': {
      b.box(m('metalGreen'), lw - 0.3, 0.75, 0.6, 0, 0.375, 0);
      b.box(m('metal'), lw - 0.2, 0.12, 0.5, 0, 0.81, 0);
      b.box(m('metalGreen'), 0.5, 0.5, 0.55, -lw / 2 + 0.45, 1.1, 0);
      b.cyl(m('steel'), 0.14, 0.14, 0.16, -lw / 2 + 0.78, 1.1, 0, 12, 0, 0, HALF);
      b.cyl(m('steel'), 0.04, 0.04, lw * 0.5, 0.1, 1.1, 0, 8, 0, 0, HALF);
      b.box(m('metal'), 0.3, 0.3, 0.4, lw / 2 - 0.45, 1.02, 0);
      b.cyl(m('metal'), 0.2, 0.2, 0.3, -lw / 2 + 0.4, 0.3, -0.45, 10, 0, 0, HALF);
      break;
    }
    case 'carriage': {
      for (const sx of [-1, 1]) {
        b.cyl(m('rubber'), 0.72, 0.72, 0.28, sx * 1.15, 0.72, 0.4, 16, 0, 0, HALF);
        b.cyl(m('metalGreen'), 0.42, 0.42, 0.3, sx * 1.15, 0.72, 0.4, 10, 0, 0, HALF);
      }
      b.cyl(m('metal'), 0.1, 0.1, 2.3, 0, 0.72, 0.4, 8, 0, 0, HALF);
      b.box(m('metalGreen'), 0.5, 0.4, ld - 0.6, 0, 0.75, -0.3);
      b.box(m('metalGreen'), 1.3, 0.9, 1.2, 0, 1.25, 0.5);
      b.box(m('woodDark'), 0.3, 0.3, 0.6, 0, 0.3, -ld / 2 + 0.5);
      b.box(m('woodDark'), 0.3, 0.45, 0.6, 0, 0.22, 0.9);
      b.cyl(m('metal'), 0.16, 0.2, 2.6, 1.0, 0.25, -0.6, 10, HALF, 0.2);
      break;
    }
    case 'hoist': {
      b.box(m('metal'), lw, 0.3, 0.2, 0, h, 0);
      b.box(m('rust'), 0.5, 0.35, 0.4, lw * 0.18, h - 0.3, 0);
      b.cyl(m('metal'), 0.012, 0.012, 1.4, lw * 0.18, h - 1.15, 0, 5);
      b.box(m('metal'), 0.12, 0.2, 0.06, lw * 0.18, h - 1.9, 0);
      break;
    }
    case 'drum': {
      b.cyl(m('wood'), 0.62, 0.62, 0.07, 0, 0.62, -0.3, 14, HALF);
      b.cyl(m('wood'), 0.62, 0.62, 0.07, 0, 0.62, 0.3, 14, HALF);
      b.cyl(m('black'), 0.4, 0.4, 0.55, 0, 0.62, 0, 12, HALF);
      break;
    }
    case 'timber': {
      const n = Math.max(2, Math.floor(ld / 0.3));
      for (let l = 0; l < 3; l++) {
        for (let i = 0; i < n - l; i++) {
          b.cyl(m('bark'), 0.14, 0.15, lw - 0.2 - hash2(i, l, 3) * 0.4, (hash2(i, l, 4) - 0.5) * 0.2, 0.15 + l * 0.26, -((n - l - 1) * 0.3) / 2 + i * 0.3, 7, 0, 0, HALF);
        }
      }
      break;
    }
    case 'rifle_rack': {
      b.box(m('woodDark'), lw - 0.1, 0.1, 0.3, 0, 0.25, -ld / 2 + 0.2);
      b.box(m('woodDark'), lw - 0.1, 0.08, 0.16, 0, 1.25, -ld / 2 + 0.12);
      b.box(m('wood'), lw - 0.1, h, 0.04, 0, h / 2, -ld / 2 + 0.03);
      const n = Math.floor((lw - 0.4) / 0.24);
      for (let i = 0; i < n; i++) {
        if (hash2(i, Math.round(p.z), 2) < 0.2) continue;
        const x = -lw / 2 + 0.3 + i * 0.24;
        b.box(m('wood'), 0.045, 0.75, 0.07, x, 0.66, -ld / 2 + 0.2, 0, -0.08);
        b.cyl(m('metal'), 0.014, 0.014, 0.7, x, 1.3, -ld / 2 + 0.14, 5, -0.08);
      }
      break;
    }
    case 'medcab': {
      b.box(m('white'), lw - 0.08, h, ld - 0.2, 0, h / 2, -0.06);
      b.box(m('red'), 0.3, 0.1, 0.02, 0, h * 0.8, ld / 2 - 0.15);
      b.box(m('red'), 0.1, 0.3, 0.02, 0, h * 0.8, ld / 2 - 0.15);
      b.box(m('black'), 0.012, h - 0.1, 0.02, 0, h / 2, ld / 2 - 0.155);
      break;
    }
    case 'exam_table': {
      b.box(m('white'), lw - 0.1, 0.08, ld - 0.25, 0, h, 0);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl(m('steel'), 0.02, 0.02, h, sx * (lw / 2 - 0.15), h / 2, sz * (ld / 2 - 0.2), 6);
      break;
    }
    case 'map_table': {
      b.box(m('woodDark'), lw - 0.1, 0.08, ld - 0.1, 0, h, 0);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(m('woodDark'), 0.12, h, 0.12, sx * (lw / 2 - 0.25), h / 2, sz * (ld / 2 - 0.25));
      b.plane(paperMat('map', M), lw - 0.5, ld - 0.5, 0, h + 0.046, 0, -HALF);
      b.box(m('brass'), 0.25, 0.02, 0.03, lw * 0.2, h + 0.06, ld * 0.15, 0.6);
      b.cyl(m('red'), 0.03, 0.03, 0.05, -lw * 0.2, h + 0.07, ld * 0.2, 6);
      b.cyl(m('red'), 0.03, 0.03, 0.05, -lw * 0.1, h + 0.07, ld * 0.25, 6);
      b.cyl(m('metalGrey'), 0.03, 0.03, 0.05, lw * 0.05, h + 0.07, -ld * 0.2, 6);
      break;
    }
    case 'fire_table': {
      b.box(m('woodDark'), lw - 0.1, h - 0.1, ld - 0.3, 0, (h - 0.1) / 2, -0.05);
      b.box(m('wood'), lw - 0.05, 0.05, ld - 0.1, 0, h + 0.08, 0, 0, 0.2);
      b.plane(paperMat('map', M), lw - 0.4, ld - 0.5, 0, h + 0.115, 0, -HALF + 0.2);
      b.box(m('brass'), 0.7, 0.012, 0.05, 0.2, h + 0.13, 0.1, 0.5, 0.2);
      b.box(m('black'), 0.22, 0.16, 0.14, -lw / 2 + 0.3, h + 0.2, -ld / 2 + 0.3);
      break;
    }
    case 'switchboard': {
      b.box(m('woodDark'), lw - 0.3, h, ld - 0.1, -0.1, h / 2, 0);
      for (let row = 0; row < 5; row++) {
        for (let c = 0; c < 8; c++) {
          b.cyl(m(hash2(row, c, 8) > 0.7 ? 'brass' : 'black'), 0.018, 0.018, 0.03, lw / 2 - 0.24, 0.85 + row * 0.15, -ld / 2 + 0.25 + (c * (ld - 0.5)) / 7, 6, 0, 0, HALF);
        }
      }
      b.box(m('wood'), 0.35, 0.04, ld - 0.14, lw / 2 - 0.1, 0.72, 0);
      break;
    }
    case 'radio_set': {
      const small = !!p.p?.small;
      b.box(m('wood'), lw - 0.1, 0.05, 0.7, 0, 0.76, -ld / 2 + 0.4);
      for (const sx of [-1, 1]) b.box(m('woodDark'), 0.06, 0.76, 0.6, sx * (lw / 2 - 0.12), 0.38, -ld / 2 + 0.4);
      const units = small ? 2 : 3;
      for (let i = 0; i < units; i++) {
        const x = -lw / 2 + (lw * (i + 0.5)) / units;
        const uw = lw / units - 0.14;
        b.box(m('metalGrey'), uw, 0.5, 0.36, x, 1.04, -ld / 2 + 0.26);
        b.cyl(m('black'), 0.06, 0.06, 0.03, x - uw * 0.22, 1.12, -ld / 2 + 0.455, 10, HALF);
        b.cyl(m('black'), 0.035, 0.035, 0.03, x + uw * 0.2, 1.16, -ld / 2 + 0.455, 8, HALF);
        b.cyl(m('white'), 0.07, 0.07, 0.012, x + uw * 0.2, 0.96, -ld / 2 + 0.447, 10, HALF);
        b.box(m('black'), uw * 0.6, 0.03, 0.01, x, 0.86, -ld / 2 + 0.445);
      }
      b.box(m('brass'), 0.1, 0.03, 0.16, 0, 0.8, -ld / 2 + 0.62);
      b.cyl(m('copper'), 0.012, 0.012, 2.0, lw / 2 - 0.2, 2.0, -ld / 2 + 0.1, 5);
      break;
    }
    case 'stove': {
      if (p.p?.heater) {
        b.cyl(m('metal'), 0.3, 0.34, 0.9, 0, 0.55, 0, 12);
        b.cyl(m('metal'), 0.07, 0.07, 2.4, 0, 2.1, -0.15, 8);
        b.box(m('rust'), 0.2, 0.2, 0.03, 0, 0.5, 0.33);
        for (const a of [0, 2.1, 4.2]) b.cyl(m('metal'), 0.025, 0.025, 0.14, Math.sin(a) * 0.25, 0.07, Math.cos(a) * 0.25, 5);
      } else {
        b.box(m('metal'), lw - 0.1, h - 0.06, ld - 0.15, 0, (h - 0.06) / 2, 0);
        b.box(m('black'), lw - 0.06, 0.06, ld - 0.1, 0, h - 0.03, 0);
        b.cyl(m('metalGrey'), 0.24, 0.24, 0.3, -lw * 0.2, h + 0.15, ld * 0.2, 12);
        b.cyl(m('metalGrey'), 0.2, 0.2, 0.36, lw * 0.15, h + 0.18, -ld * 0.2, 12);
        b.cyl(m('metal'), 0.1, 0.1, 2.3, 0, h + 1.15, -ld / 2 + 0.2, 8);
      }
      break;
    }
    case 'sacks': {
      const n = Math.round(lw * ld * 1.6);
      for (let i = 0; i < n; i++) {
        const x = (hash2(i, 1, Math.round(p.x)) - 0.5) * (lw - 0.7);
        const z = (hash2(i, 2, Math.round(p.z)) - 0.5) * (ld - 0.6);
        const y = 0.16 + (i % 3) * 0.24;
        b.sphere(m('canvas'), 0.35, x, y, z, 1, 0.42, 0.7, 8);
      }
      break;
    }
    case 'counter': {
      b.box(m('wood'), lw - 0.05, h, ld - 0.3, 0, h / 2, 0);
      b.box(m('woodDark'), lw, 0.05, ld - 0.1, 0, h + 0.025, 0);
      b.cyl(m('metalGrey'), 0.22, 0.22, 0.32, -lw * 0.25, h + 0.21, 0, 12);
      b.cyl(m('metalGrey'), 0.18, 0.18, 0.26, lw * 0.1, h + 0.18, 0, 12);
      for (let i = 0; i < 5; i++) b.cyl(m('white'), 0.1, 0.07, 0.03 + i * 0.012, lw * 0.34, h + 0.065 + i * 0.006, 0, 10);
      break;
    }
    case 'safe': {
      b.box(m('metal'), lw - 0.2, h, ld - 0.25, 0, h / 2, -0.05);
      b.cyl(m('brass'), 0.06, 0.06, 0.04, 0.1, h * 0.6, ld / 2 - 0.16, 10, HALF);
      b.box(m('steel'), 0.03, 0.16, 0.03, -0.15, h * 0.6, ld / 2 - 0.16);
      break;
    }
    case 'drafting': {
      b.box(m('woodDark'), 0.08, 0.95, 0.08, -lw / 2 + 0.3, 0.475, 0);
      b.box(m('woodDark'), 0.08, 0.95, 0.08, lw / 2 - 0.3, 0.475, 0);
      b.box(m('woodDark'), lw - 0.5, 0.06, 0.5, 0, 0.06, 0);
      b.box(m('wood'), lw - 0.15, 0.04, 0.95, 0, h, 0, 0, 0.5);
      b.plane(paperMat('blueprint', M), lw - 0.4, 0.75, 0, h + 0.025, 0.012, -HALF + 0.5);
      break;
    }
    case 'lab_bench': {
      b.box(m('metalGrey'), lw - 0.1, 0.05, 0.8, 0, h, -ld / 2 + 0.45);
      const legs = Math.max(2, Math.round(lw / 2) + 1);
      for (let i = 0; i < legs; i++) b.box(m('metal'), 0.06, h, 0.7, -lw / 2 + 0.15 + ((lw - 0.3) * i) / (legs - 1), h / 2, -ld / 2 + 0.45);
      for (let i = 0; i < Math.floor(lw / 0.9); i++) {
        const x = -lw / 2 + 0.5 + i * 0.9;
        const rr = hash2(i, Math.round(p.x), 12);
        if (rr > 0.6) b.cyl(m('glass'), 0.06, 0.08, 0.22, x, h + 0.14, -ld / 2 + 0.4, 8);
        else if (rr > 0.3) b.box(m('metalGreen'), 0.35, 0.28, 0.3, x, h + 0.17, -ld / 2 + 0.35);
        else b.cyl(m('brass'), 0.1, 0.1, 0.4, x, h + 0.23, -ld / 2 + 0.4, 10);
      }
      break;
    }
    case 'cellbars': {
      for (let i = 0; i < 7; i++) b.cyl(m('metal'), 0.015, 0.015, h, -0.42, h / 2, -0.5 - i * 0.13, 5);
      b.box(m('metal'), 0.04, 0.04, 0.9, -0.42, h - 0.05, -0.9);
      b.box(m('metal'), 0.04, 0.04, 0.9, -0.42, 0.1, -0.9);
      break;
    }
    case 'gate_frame': {
      b.box(m('metal'), 0.16, h, 0.16, 0, h / 2, -ld / 2 + 0.08);
      b.box(m('metal'), 0.16, h, 0.16, 0, h / 2, ld / 2 - 0.08);
      b.box(m('metal'), 0.16, 0.16, ld, 0, h - 0.08, 0);
      // распахнутая решётчатая створка вдоль стены
      for (let i = 0; i < 9; i++) b.cyl(m('metal'), 0.014, 0.014, 2.1, -0.15 - i * 0.16, 1.05, ld / 2 - 0.1, 5);
      b.box(m('metal'), 1.5, 0.04, 0.04, -0.8, 2.1, ld / 2 - 0.1);
      b.box(m('metal'), 1.5, 0.04, 0.04, -0.8, 0.08, ld / 2 - 0.1);
      b.box(m('red'), 0.05, 0.12, 2.2, 0.09, h - 0.34, 0);
      break;
    }
    case 'fence': {
      const alongZ = p.d > p.w;
      const len = alongZ ? p.d : p.w;
      const n = Math.max(2, Math.round(len / 2.5) + 1);
      for (let i = 0; i < n; i++) {
        const t = -len / 2 + (len * i) / (n - 1);
        const x = alongZ ? 0 : t;
        const z = alongZ ? t : 0;
        b.box(m('concrete'), 0.13, h, 0.13, x, h / 2, z);
        b.box(m('concrete'), 0.1, 0.45, 0.1, x + (alongZ ? 0.14 : 0), h + 0.17, z + (alongZ ? 0 : 0.14), 0, alongZ ? 0 : 0.6, alongZ ? -0.6 : 0);
      }
      for (let w = 0; w < 6; w++) {
        const y = 0.25 + w * 0.4;
        if (alongZ) b.box(m('rust'), 0.02, 0.02, len, 0, y, 0);
        else b.box(m('rust'), len, 0.02, 0.02, 0, y, 0);
      }
      for (let w = 0; w < 2; w++) {
        if (alongZ) b.box(m('rust'), 0.02, 0.02, len, 0.16 + w * 0.1, h + 0.22 + w * 0.12, 0);
        else b.box(m('rust'), len, 0.02, 0.02, 0, h + 0.22 + w * 0.12, 0.16 + w * 0.1);
      }
      break;
    }
    case 'barrier': {
      b.box(m('concrete'), 0.25, 1.15, 0.25, 2.6, 0.575, 0);
      b.box(m('concrete'), 0.2, 1.0, 0.2, -2.7, 0.5, 0);
      b.box(m('metal'), 0.3, 0.08, 0.14, -2.7, 1.02, 0);
      break;
    }
    case 'sandbags': {
      b.box(m('sandbag'), lw - 0.05, h - 0.15, ld - 0.1, 0, (h - 0.15) / 2, 0);
      const n = Math.max(1, Math.round(Math.max(lw, ld) / 0.75));
      for (let i = 0; i < n; i++) {
        const t = -0.5 + (i + 0.5) / n;
        if (lw >= ld) b.sphere(m('sandbag'), 0.4, t * (lw - 0.2), h - 0.12, 0, 0.95, 0.38, Math.min(1.2, ld * 1.1), 8);
        else b.sphere(m('sandbag'), 0.4, 0, h - 0.12, t * (ld - 0.2), Math.min(1.2, lw * 1.1), 0.38, 0.95, 8);
      }
      break;
    }
    case 'sandbag_ring': {
      const rad = (p.p?.r as number) ?? 6;
      const n = Math.round((Math.PI * 2 * rad) / 1.05);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const x = Math.sin(a) * rad;
        const z = Math.cos(a) * rad;
        if (z < 0 && Math.abs(x) < 1.75) continue;
        b.box(m('sandbag'), 1.12, h - 0.2, 0.62, x, (h - 0.2) / 2, z, a);
        b.sphere(m('sandbag'), 0.42, Math.sin(a + 0.08) * rad, h - 0.17, Math.cos(a + 0.08) * rad, 1.0, 0.36, 0.72, 8);
      }
      // утоптанная площадка и отбитый грунт бруствера
      b.cyl(m('dirtPile'), rad + 1.3, rad + 2.1, 0.5, 0, 0.02, 0, 28);
      b.cyl(m('dirtPile'), rad - 0.55, rad - 0.55, 0.6, 0, 0.03, 0, 28);
      break;
    }
    case 'camo_net': {
      const geo = new THREE.PlaneGeometry(lw, ld, 8, 8);
      const pos = geo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const u = pos.getX(i) / lw;
        const v = pos.getY(i) / ld;
        const sag = Math.cos(u * Math.PI * 2) * Math.cos(v * Math.PI * 2) * 0.28 - (u * u + v * v) * 1.3;
        pos.setZ(i, sag + (hash2(i, Math.round(p.x), 3) - 0.5) * 0.15);
      }
      const uv = geo.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (lw / 4), uv.getY(i) * (ld / 4));
      geo.computeVertexNormals();
      b.add(geo, M.camoNet, 0, h, 0, -HALF);
      for (const sx of [-1, 0, 1]) {
        for (const sz of [-1, 1]) {
          if (p.p?.pit && sx === 0) continue;
          b.cyl(m('bark'), 0.05, 0.06, h - 0.25, sx * (lw / 2 - 0.2), (h - 0.25) / 2 - 0.1, sz * (ld / 2 - 0.2), 5);
        }
      }
      break;
    }
    case 'tower': {
      const ph = h - 1.9;
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          b.box(m('woodDark'), 0.18, ph + 0.1, 0.18, sx * 1.05, ph / 2, sz * 1.05, 0, sz * 0.045, -sx * 0.045);
          b.box(m('woodDark'), 0.1, 2.0, 0.1, sx * 1.2, ph + 1.0, sz * 1.2);
        }
      }
      for (let lv = 0; lv < 2; lv++) {
        const y = 1.2 + lv * 2.2;
        for (const s of [-1, 1]) {
          b.box(m('wood'), 2.5, 0.09, 0.07, 0, y, s * 1.1, 0, 0, 0.5 * s);
          b.box(m('wood'), 0.07, 0.09, 2.5, s * 1.1, y, 0, 0, 0.5 * s, 0);
        }
      }
      b.box(m('wood'), 2.8, 0.1, 2.8, 0, ph, 0);
      for (const s of [-1, 1]) {
        b.box(m('wood'), 2.7, 0.75, 0.05, 0, ph + 0.48, s * 1.33);
        b.box(m('wood'), 0.05, 0.75, 2.7, s * 1.33, ph + 0.48, 0);
      }
      b.box(m('woodDark'), 3.3, 0.08, 3.3, 0, ph + 2.05, 0, 0, 0.06);
      // лестница
      b.box(m('wood'), 0.06, ph + 0.4, 0.06, -0.25, ph / 2, 1.5, 0, -0.1);
      b.box(m('wood'), 0.06, ph + 0.4, 0.06, 0.25, ph / 2, 1.5, 0, -0.1);
      for (let i = 1; i < 14; i++) b.box(m('wood'), 0.5, 0.04, 0.04, 0, (ph * i) / 14, 1.5 + ((ph / 2 - (ph * i) / 14) * 0.1) / 1, 0);
      // прожектор
      b.cyl(m('metal'), 0.03, 0.03, 0.6, 0.9, ph + 0.95, 0.9, 6);
      b.cyl(m('metal'), 0.22, 0.22, 0.3, 0.9, ph + 1.35, 0.9, 12, HALF, 0.8);
      break;
    }
    case 'tree': {
      b.cyl(m('bark'), 0.1, 0.22, h * 0.5, 0, h * 0.25, 0, 6);
      for (let k = 0; k < 4; k++) {
        b.cone(m('foliage'), 2.3 - k * 0.45, h * 0.36, 0, h * 0.34 + k * h * 0.19, 0, 7);
      }
      break;
    }
    case 'pole': {
      b.cyl(m('bark'), 0.07, 0.1, h, 0, h / 2, 0, 7);
      b.box(m('metal'), 0.05, 0.05, 0.4, 0, h - 0.1, 0);
      break;
    }
    case 'siren_pole': {
      b.cyl(m('bark'), 0.08, 0.11, h, 0, h / 2, 0, 7);
      b.cyl(m('metalGrey'), 0.22, 0.22, 0.3, 0, h + 0.15, 0, 12);
      b.cyl(m('metalGrey'), 0.36, 0.2, 0.25, 0, h + 0.42, 0, 12);
      b.cyl(m('red'), 0.24, 0.24, 0.04, 0, h + 0.02, 0, 12);
      break;
    }
    case 'rails': {
      const z0 = (p.p?.z0 as number) - p.z;
      const z1 = (p.p?.z1 as number) - p.z;
      const len = z1 - z0;
      const zc = (z0 + z1) / 2;
      b.box(m('dirtPile'), 3.2, 0.14, len, 0, 0.05, zc);
      for (const sx of [-1, 1]) {
        b.box(m('steel'), 0.07, 0.14, len, sx * 0.72, 0.24, zc);
        b.box(m('rust'), 0.15, 0.03, len, sx * 0.72, 0.165, zc);
      }
      for (let z = z0 + 0.4; z < z1; z += 0.75) b.box(m('woodDark'), 2.5, 0.14, 0.24, 0, 0.1, z);
      break;
    }
    case 'turntable': {
      b.cyl(m('concrete'), lw / 2, lw / 2, 0.12, 0, 0.03, 0, 40);
      b.cyl(m('rust'), lw / 2 - 0.4, lw / 2 - 0.4, 0.03, 0, 0.1, 0, 40);
      b.cyl(m('concrete'), lw / 2 - 0.55, lw / 2 - 0.55, 0.04, 0, 0.1, 0, 40);
      b.cyl(m('metal'), 0.9, 1.0, 0.16, 0, 0.14, 0, 16);
      break;
    }
    case 'niche': {
      const big = !!p.p?.big;
      b.box(m('sandbag'), lw + 0.6, h, 0.5, 0, h / 2, -ld / 2 - 0.1);
      b.box(m('sandbag'), 0.5, h, ld + 0.4, -lw / 2 - 0.1, h / 2, 0);
      b.box(m('sandbag'), 0.5, h, ld + 0.4, lw / 2 + 0.1, h / 2, 0);
      const cal = big ? 0.19 : 0.105;
      const count = big ? 3 : 7;
      for (let i = 0; i < count; i++) {
        const x = -((count - 1) * (cal * 2 + 0.04)) / 2 + i * (cal * 2 + 0.04);
        b.cyl(m('shell'), cal, cal, big ? 1.1 : 0.58, x, (big ? 0.55 : 0.29) + 0.05, 0, 10);
        b.cone(m('shell'), cal, big ? 0.5 : 0.28, x, (big ? 1.1 : 0.58) + (big ? 0.25 : 0.14) + 0.05, 0, 10);
      }
      b.box(m('woodDark'), lw, 0.05, ld, 0, 0.025, 0);
      b.box(m('canvas'), lw + 0.5, 0.04, 0.7, 0, h + 0.05, -ld / 2 + 0.1, 0, 0.25);
      break;
    }
    case 'bcp': {
      b.box(m('sandbag'), lw + 0.6, 1.1, 0.5, 0, 0.55, -ld / 2 - 0.1);
      b.box(m('sandbag'), 0.5, 1.1, ld + 0.3, -lw / 2 - 0.1, 0.55, 0);
      b.box(m('sandbag'), 0.5, 1.1, ld + 0.3, lw / 2 + 0.1, 0.55, 0);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl(m('bark'), 0.09, 0.09, h, sx * (lw / 2 + 0.1), h / 2, sz * (ld / 2 - 0.05), 6);
      for (let i = 0; i < 9; i++) b.cyl(m('bark'), 0.11, 0.11, ld + 1.0, -lw / 2 - 0.3 + i * ((lw + 0.6) / 8), h + 0.1, 0, 6, HALF);
      b.box(m('dirtPile'), lw + 0.9, 0.25, ld + 0.8, 0, h + 0.33, 0);
      b.box(m('wood'), lw - 0.4, 0.05, 0.8, 0, 0.9, ld / 2 - 0.5);
      b.box(m('woodDark'), 0.08, 0.9, 0.7, -lw / 2 + 0.4, 0.45, ld / 2 - 0.5);
      b.box(m('woodDark'), 0.08, 0.9, 0.7, lw / 2 - 0.4, 0.45, ld / 2 - 0.5);
      b.plane(paperMat('map', M), lw - 0.9, 0.6, -0.1, 0.93, ld / 2 - 0.5, -HALF);
      b.box(m('black'), 0.22, 0.16, 0.14, lw / 2 - 0.55, 1.0, ld / 2 - 0.45);
      // стереотруба
      b.cyl(m('metal'), 0.02, 0.02, 1.3, -lw / 2 + 0.2, 1.4, ld / 2 + 0.15, 5);
      b.cyl(m('metalGreen'), 0.035, 0.035, 0.4, -lw / 2 + 0.12, 2.1, ld / 2 + 0.15, 6);
      b.cyl(m('metalGreen'), 0.035, 0.035, 0.4, -lw / 2 + 0.28, 2.1, ld / 2 + 0.15, 6);
      break;
    }
    case 'board': {
      b.box(m('woodDark'), lw, h, 0.04, 0, 1.55, 0);
      b.plane(paperMat('schedule', M), lw - 0.16, h - 0.14, 0, 1.55, 0.024);
      break;
    }
    case 'wallmap': {
      const kind = p.p?.blueprint ? 'blueprint' : 'map';
      const ww = swap ? p.d : p.w;
      b.box(m('woodDark'), ww + 0.1, h + 0.1, 0.03, 0, 1.75, 0);
      b.plane(paperMat(kind, M), ww, h, 0, 1.75, 0.02);
      break;
    }
    case 'alert_panel': {
      b.box(m('metalGrey'), 0.7, 0.9, 0.12, 0, 1.45, 0.02);
      const cols: MatName[] = ['metalGreen', 'brass', 'copper', 'red'];
      cols.forEach((c, i) => b.sphere(m(c), 0.045, -0.22 + i * 0.15, 1.72, 0.09, 1, 1, 1, 8));
      b.box(m('red'), 0.06, 0.26, 0.06, 0.18, 1.3, 0.1);
      b.box(m('black'), 0.3, 0.12, 0.02, -0.12, 1.3, 0.085);
      break;
    }
    case 'pipes': {
      const n = (p.p?.n as number) ?? 2;
      const mats: MatName[] = ['rust', 'metalGrey', 'copper'];
      for (let i = 0; i < n; i++) b.cyl(m(mats[i % 3]), 0.035 + (i === 0 ? 0.02 : 0), 0.035 + (i === 0 ? 0.02 : 0), lw, 0, h - i * 0.14, 0, 6, 0, 0, HALF);
      for (let x = -lw / 2 + 1; x < lw / 2; x += 4) b.box(m('metal'), 0.04, n * 0.14 + 0.08, 0.1, x, h - ((n - 1) * 0.14) / 2, 0.03);
      break;
    }
    case 'duct': {
      b.box(m('metalGrey'), lw, 0.3, ld, 0, h, 0);
      for (let x = -lw / 2 + 1.5; x < lw / 2; x += 3) {
        b.box(m('metal'), 0.05, 0.34, ld + 0.06, x, h, 0);
      }
      for (let x = -lw / 2 + 4; x < lw / 2; x += 9) b.box(m('black'), 0.5, 0.02, ld * 0.6, x, h - 0.155, 0);
      break;
    }
    case 'exhaust': {
      b.cyl(m('rust'), 0.11, 0.11, h, -0.2, h / 2 + 1.4, 0, 8);
      b.cyl(m('rust'), 0.08, 0.08, h - 0.6, 0.25, h / 2 + 1.5, 0, 8);
      b.box(m('metal'), 0.9, 0.06, 0.2, 0, 3.2, -0.1);
      b.box(m('metal'), 0.9, 0.06, 0.2, 0, 5.6, -0.1);
      break;
    }
    case 'buttress': {
      b.box(m('concrete'), 1.0, h, 0.7, 0, h / 2, -0.15, 0, 0.035);
      b.box(m('concrete'), 1.2, 0.5, 0.9, 0, 0.25, -0.05);
      break;
    }
    default:
      b.box(m('wood'), lw - 0.1, h, ld - 0.1, 0, h / 2, 0);
  }
  b.pop();
}

/** Телефонный аппарат на столе или стене. */
export function buildPhone(b: Batcher, M: Materials, x: number, y: number, z: number, indoor: boolean): void {
  const black = M.get('black', indoor);
  b.box(black, 0.2, 0.1, 0.16, x, y + 0.05, z);
  b.box(black, 0.24, 0.045, 0.05, x, y + 0.13, z);
  b.cyl(M.get('metalGrey', indoor), 0.035, 0.035, 0.012, x + 0.11, y + 0.06, z, 8, 0, 0, HALF);
}
