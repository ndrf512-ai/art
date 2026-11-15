/**
 * Строит статическую 3D-геометрию комплекса по клеточной карте:
 * полы, стены, потолки бункера, бетонный фасад, холм, двор, лес вокруг.
 */
import * as THREE from 'three';
import { FACADE_H, FACADE_Z, MAP_H, MAP_W } from '../core/constants';
import { fbm, hash2 } from '../core/Rng';
import { clamp01, smoothstep } from '../core/math';
import type { LampDef, ZoneId } from '../core/types';
import { Grid, INDOOR, OUTDOOR, SOLID } from '../world/Grid';
import type { Layout } from '../world/layout';
import { Batcher } from './Batcher';
import { Materials } from './Materials';
import { buildProp } from './Props';
import { softDot, stencilTex } from './Textures';

const TILE = 3;

/** Накопитель четырёхугольников с цветом и запечённым светом. */
class QuadSink {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  idx: number[] = [];

  quad(
    a: [number, number, number],
    b: [number, number, number],
    c: [number, number, number],
    d: [number, number, number],
    n: [number, number, number],
    uva: [number, number],
    uvb: [number, number],
    uvc: [number, number],
    uvd: [number, number],
    col: [number, number, number],
    colTop?: [number, number, number],
  ): void {
    const base = this.pos.length / 3;
    this.pos.push(...a, ...b, ...c, ...d);
    for (let i = 0; i < 4; i++) this.nor.push(...n);
    this.uv.push(...uva, ...uvb, ...uvc, ...uvd);
    const ct = colTop ?? col;
    this.col.push(...col, ...col, ...ct, ...ct);
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    return g;
  }
}

const WALL_TINT: Partial<Record<ZoneId, [number, number, number]>> = {
  tunnel: [0.82, 0.82, 0.78],
  portal: [0.78, 0.78, 0.74],
  tunnel_ammo: [0.78, 0.78, 0.74],
  tunnel_staff: [0.9, 0.88, 0.8],
  secret_tunnel: [0.8, 0.82, 0.84],
  barracks: [1.0, 0.97, 0.88],
  mess: [1.0, 0.96, 0.86],
  food: [0.95, 0.93, 0.86],
  infirmary: [0.95, 1.0, 0.98],
  generator: [0.62, 0.6, 0.56],
  workshop: [0.76, 0.74, 0.68],
  repair: [0.72, 0.7, 0.66],
  command: [0.94, 0.91, 0.82],
  quarters: [0.96, 0.92, 0.82],
  officers: [0.96, 0.93, 0.84],
  radio: [0.9, 0.9, 0.84],
  archive: [0.92, 0.9, 0.82],
  ci: [0.86, 0.86, 0.84],
  cell: [0.66, 0.66, 0.66],
  hangar: [0.76, 0.78, 0.8],
  tech: [0.95, 0.95, 0.92],
  lab: [0.92, 0.96, 0.96],
  armory: [0.84, 0.84, 0.78],
  kpp_house: [0.9, 0.88, 0.8],
};

/** Помещения с окрашенной панелью в нижней части стены. */
const DADO: Partial<Record<ZoneId, [number, number, number]>> = {
  tunnel: [0.42, 0.46, 0.38],
  barracks: [0.44, 0.47, 0.38],
  mess: [0.46, 0.44, 0.34],
  command: [0.38, 0.42, 0.36],
  officers: [0.4, 0.38, 0.3],
  quarters: [0.4, 0.38, 0.3],
  infirmary: [0.62, 0.7, 0.66],
  tunnel_staff: [0.38, 0.42, 0.36],
  radio: [0.38, 0.42, 0.36],
  armory: [0.4, 0.43, 0.36],
};

export interface WorldView {
  group: THREE.Group;
  lamps: LampDef[];
  /** Освещённость клетки лампами: [бункер, улица]. */
  sampleLight(x: number, z: number): [number, number];
  setHangarDoor(open: number): void;
  setBarrier(open: number): void;
  haloIn: THREE.Points;
  haloOut: THREE.Points;
  exhaust: THREE.Vector3;
  terrainHeight(x: number, z: number): number;
}

export function terrainHeight(x: number, z: number): number {
  const n = fbm(x * 0.011 + 40, z * 0.011 + 40, 4, 5);
  const dx = x < 0 ? -x : x > MAP_W ? x - MAP_W : 0;
  if (z <= FACADE_Z) {
    return FACADE_H + 0.1 + (FACADE_Z - z) * 0.1 + n * 9 * smoothstep(0, 40, FACADE_Z - z) + dx * 0.02;
  }
  const dz = z > MAP_H ? z - MAP_H : 0;
  const d = Math.hypot(dx, dz);
  let k = smoothstep(0, 50, d);
  // дорога на юг от КПП
  if (z > MAP_H - 10) k *= smoothstep(5, 16, Math.abs(x - 57.5));
  let h = k * (1.5 + n * 15);
  // холм огибает объект с флангов
  if (dx > 0) {
    const wrap = smoothstep(26, 0, z - FACADE_Z) * smoothstep(0, 14, dx);
    h = Math.max(h, (FACADE_H + 0.1) * wrap);
  }
  return h;
}

export function buildWorld(layout: Layout, M: Materials): WorldView {
  const grid = layout.grid;
  const group = new THREE.Group();
  group.name = 'world';

  // ------------------------------------------------------------ запекание света
  const BUCKET = 8;
  const buckets = new Map<number, LampDef[]>();
  const bkey = (bx: number, bz: number) => bx * 1000 + bz;
  const lampRange = (l: LampDef) => (l.outdoor ? 17 : 8.5 + l.y);
  for (const l of layout.lamps) {
    const r = lampRange(l);
    for (let bz = Math.floor((l.z - r) / BUCKET); bz <= Math.floor((l.z + r) / BUCKET); bz++) {
      for (let bx = Math.floor((l.x - r) / BUCKET); bx <= Math.floor((l.x + r) / BUCKET); bx++) {
        const k = bkey(bx, bz);
        let list = buckets.get(k);
        if (!list) buckets.set(k, (list = []));
        list.push(l);
      }
    }
  }

  function bakeAt(x: number, y: number, z: number, nx: number, ny: number, nz: number): [number, number] {
    const list = buckets.get(bkey(Math.floor(x / BUCKET), Math.floor(z / BUCKET)));
    if (!list) return [0, 0];
    let li = 0;
    let lo = 0;
    const sx = x + nx * 0.3;
    const sz = z + nz * 0.3;
    for (const l of list) {
      const dx = l.x - x;
      const dy = l.y - y;
      const dz = l.z - z;
      const d2 = dx * dx + dy * dy + dz * dz;
      const r = lampRange(l);
      if (d2 > r * r) continue;
      const d = Math.sqrt(d2) + 1e-4;
      if (!grid.los(l.x, l.z, sx, sz)) continue;
      const ndl = (dx * nx + dy * ny + dz * nz) / d;
      const lambert = Math.max(0.22, ndl * 0.85 + 0.15);
      const fade = smoothstep(r, r * 0.55, d);
      const v = (l.power * 2.6 * lambert * fade) / (1 + 0.42 * d2);
      if (l.outdoor) lo += v;
      else li += v;
    }
    return [Math.min(li, 2.2), Math.min(lo, 2.2)];
  }

  function applyBake(geo: THREE.BufferGeometry): void {
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const nor = geo.attributes.normal as THREE.BufferAttribute;
    const baked = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      const b = bakeAt(pos.getX(i), pos.getY(i), pos.getZ(i), nor.getX(i), nor.getY(i), nor.getZ(i));
      baked[i * 2] = b[0];
      baked[i * 2 + 1] = b[1];
    }
    geo.setAttribute('baked', new THREE.BufferAttribute(baked, 2));
  }

  // ------------------------------------------------------------ бункер из клеток
  const floor = new QuadSink();
  const wall = new QuadSink();
  const ceil = new QuadSink();
  const facade = new QuadSink();

  const zoneOf = (x: number, z: number): ZoneId => grid.zoneIds[grid.zone[grid.idx(x, z)]];

  /** Вертикальная стена от (x0,z0) к (x1,z1), разбитая по высоте на полосы. */
  function wallStrip(
    sink: QuadSink,
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    y0: number,
    y1: number,
    n: [number, number, number],
    tint: [number, number, number],
    dado: [number, number, number] | null,
    cuts: number[],
  ): void {
    const ys = [y0, ...cuts.filter((c) => c > y0 + 0.05 && c < y1 - 0.05), y1];
    const u0 = (x0 + z0) / TILE;
    const u1 = (x1 + z1) / TILE;
    for (let i = 0; i < ys.length - 1; i++) {
      const a = ys[i];
      const b = ys[i + 1];
      let c = tint;
      if (dado && b <= 1.16) c = dado;
      sink.quad([x0, a, z0], [x1, a, z1], [x1, b, z1], [x0, b, z0], n, [u0, a / TILE], [u1, a / TILE], [u1, b / TILE], [u0, b / TILE], c);
    }
  }

  const DIRS: { dx: number; dz: number; n: [number, number, number]; edge: (x: number, z: number) => [number, number, number, number] }[] = [
    { dx: -1, dz: 0, n: [1, 0, 0], edge: (x, z) => [x, z + 1, x, z] },
    { dx: 1, dz: 0, n: [-1, 0, 0], edge: (x, z) => [x + 1, z, x + 1, z + 1] },
    { dx: 0, dz: -1, n: [0, 0, 1], edge: (x, z) => [x, z, x + 1, z] },
    { dx: 0, dz: 1, n: [0, 0, -1], edge: (x, z) => [x + 1, z + 1, x, z + 1] },
  ];

  for (let z = 0; z < grid.h; z++) {
    for (let x = 0; x < grid.w; x++) {
      const i = grid.idx(x, z);
      const t = grid.type[i];
      if (t === SOLID) continue;
      const zone = zoneOf(x, z);
      if (t === INDOOR) {
        const h = grid.ceil[i];
        const wt = WALL_TINT[zone] ?? [0.86, 0.85, 0.81];
        const ft: [number, number, number] = [0.5 + wt[0] * 0.5, 0.5 + wt[1] * 0.5, 0.5 + wt[2] * 0.5];
        floor.quad([x, 0, z], [x, 0, z + 1], [x + 1, 0, z + 1], [x + 1, 0, z], [0, 1, 0], [x / TILE, z / TILE], [x / TILE, (z + 1) / TILE], [(x + 1) / TILE, (z + 1) / TILE], [(x + 1) / TILE, z / TILE], ft);
        ceil.quad([x, h, z], [x + 1, h, z], [x + 1, h, z + 1], [x, h, z + 1], [0, -1, 0], [x / TILE, z / TILE], [(x + 1) / TILE, z / TILE], [(x + 1) / TILE, (z + 1) / TILE], [x / TILE, (z + 1) / TILE], wt);
        for (const d of DIRS) {
          const nx = x + d.dx;
          const nz = z + d.dz;
          const nt = grid.typeAt(nx, nz);
          const [ex0, ez0, ex1, ez1] = d.edge(x, z);
          if (nt === SOLID) {
            wallStrip(wall, ex0, ez0, ex1, ez1, 0, h, d.n, wt, DADO[zone] ?? null, [1.15, 2.2, 3.6, 5.0]);
          } else if (nt === INDOOR) {
            const nh = grid.ceil[grid.idx(nx, nz)];
            if (nh < h - 0.01) wallStrip(wall, ex0, ez0, ex1, ez1, nh, h, d.n, wt, null, [3.6, 5.0]);
          }
        }
      } else if (t === OUTDOOR) {
        for (const d of DIRS) {
          const nx = x + d.dx;
          const nz = z + d.dz;
          if (!grid.inBounds(nx, nz)) continue;
          const ni = grid.idx(nx, nz);
          const nt = grid.type[ni];
          if (nt === OUTDOOR) continue;
          const top = grid.roof[ni];
          const [ex0, ez0, ex1, ez1] = d.edge(x, z);
          const weather = 0.72 + 0.3 * fbm((ex0 + ez0) * 0.09, 3.3, 3, 77);
          const tint: [number, number, number] = [weather, weather, weather * 0.97];
          const low: [number, number, number] = [weather * 0.62, weather * 0.58, weather * 0.5];
          if (nt === SOLID) {
            wallStrip(facade, ex0, ez0, ex1, ez1, 0, top, d.n, tint, low, [1.15, 3.2, 5.4]);
          } else {
            const nh = grid.ceil[ni];
            if (nh < top - 0.01) wallStrip(facade, ex0, ez0, ex1, ez1, nh, top, d.n, tint, null, [5.4]);
          }
        }
      }
      // плоские крыши отдельных зданий
      if (grid.building[i]) {
        const top = grid.roof[i];
        facade.quad([x, top, z], [x, top, z + 1], [x + 1, top, z + 1], [x + 1, top, z], [0, 1, 0], [x / TILE, z / TILE], [x / TILE, (z + 1) / TILE], [(x + 1) / TILE, (z + 1) / TILE], [(x + 1) / TILE, z / TILE], [0.5, 0.5, 0.48]);
      }
    }
  }
  // крыши над массивом зданий (клетки SOLID тоже)
  for (let z = FACADE_Z; z < grid.h; z++) {
    for (let x = 0; x < grid.w; x++) {
      const i = grid.idx(x, z);
      if (grid.type[i] === SOLID && grid.building[i]) {
        const top = grid.roof[i];
        facade.quad([x, top, z], [x, top, z + 1], [x + 1, top, z + 1], [x + 1, top, z], [0, 1, 0], [x / TILE, z / TILE], [x / TILE, (z + 1) / TILE], [(x + 1) / TILE, (z + 1) / TILE], [(x + 1) / TILE, z / TILE], [0.5, 0.5, 0.48]);
      }
    }
  }

  const addSink = (sink: QuadSink, mat: THREE.Material, cast: boolean, receive: boolean, name: string): void => {
    const geo = sink.geometry();
    applyBake(geo);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    mesh.name = name;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  };
  addSink(floor, M.floor, false, true, 'floor');
  addSink(wall, M.wall, false, true, 'walls');
  addSink(ceil, M.ceiling, false, false, 'ceiling');
  addSink(facade, M.facade, true, true, 'facade');

  // ------------------------------------------------------------ двор
  {
    const sink = new QuadSink();
    const paths: [number, number, number, number][] = [
      [57.5, 59, 57.5, 121],
      [57.5, 62, 80.5, 78],
      [57.5, 62, 100.5, 78],
      [88.5, 59, 84.5, 77],
      [88.5, 59, 104.5, 77],
      [57.5, 64, 38.5, 80],
      [46.5, 59, 36, 66],
      [57.5, 62, 16, 68],
      [57.5, 100, 30, 100],
      [91.5, 74, 124.5, 72],
      [57.5, 110, 110, 108],
    ];
    const segDist = (px: number, pz: number, s: [number, number, number, number]): number => {
      const vx = s[2] - s[0];
      const vz = s[3] - s[1];
      const t = clamp01(((px - s[0]) * vx + (pz - s[1]) * vz) / (vx * vx + vz * vz));
      return Math.hypot(px - (s[0] + vx * t), pz - (s[1] + vz * t));
    };
    const colorAt = (x: number, z: number): [number, number, number] => {
      const n = fbm(x * 0.08, z * 0.08, 4, 3);
      const n2 = fbm(x * 0.31 + 9, z * 0.31, 3, 8);
      let r = 0.46 * (0.75 + 0.5 * n);
      let g = 0.4 * (0.75 + 0.5 * n);
      let b = 0.3 * (0.75 + 0.5 * n);
      let wear = 0;
      for (const s of paths) wear = Math.max(wear, 1 - smoothstep(1.2, 4.5, segDist(x, z, s)));
      const inParade = x > 45 && x < 71 && z > 60 && z < 77;
      if (inParade) wear = Math.max(wear, 0.8);
      const outsideFence = x < 5 || x > 145 || z > 122;
      let grass = smoothstep(0.42, 0.62, n2) * (1 - wear) * (outsideFence ? 1.4 : 0.9);
      grass = clamp01(grass + (outsideFence ? 0.35 : 0));
      r = r * (1 - grass) + 0.2 * grass * (0.8 + n * 0.5);
      g = g * (1 - grass) + 0.25 * grass * (0.8 + n * 0.5);
      b = b * (1 - grass) + 0.13 * grass * (0.8 + n * 0.5);
      if (inParade) {
        r = r * 0.5 + 0.26;
        g = g * 0.5 + 0.25;
        b = b * 0.5 + 0.22;
      }
      // раскисшая колея у ворот и на рельсовом пути
      const mud = Math.max(1 - smoothstep(1.5, 3.5, Math.abs(x - 57.5)) - smoothstep(118, 100, z), 0);
      const k = 1 - 0.35 * wear - 0.3 * mud;
      return [r * k, g * k, b * k * 0.96];
    };
    const STEP = 1;
    for (let z = FACADE_Z; z < MAP_H; z += STEP) {
      for (let x = 0; x < MAP_W; x += STEP) {
        const c00 = colorAt(x, z);
        const base = sink.pos.length / 3;
        sink.pos.push(x, 0, z, x, 0, z + STEP, x + STEP, 0, z + STEP, x + STEP, 0, z);
        for (let k = 0; k < 4; k++) sink.nor.push(0, 1, 0);
        sink.uv.push(x / TILE, z / TILE, x / TILE, (z + STEP) / TILE, (x + STEP) / TILE, (z + STEP) / TILE, (x + STEP) / TILE, z / TILE);
        sink.col.push(...c00, ...colorAt(x, z + STEP), ...colorAt(x + STEP, z + STEP), ...colorAt(x + STEP, z));
        sink.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
    addSink(sink, M.ground, false, true, 'yard');
  }

  // ------------------------------------------------------------ окружающий рельеф
  {
    const STEP = 3;
    const X0 = -249;
    const X1 = 399;
    const Z0 = -211;
    const Z1 = 341;
    const nx = Math.round((X1 - X0) / STEP);
    const nz = Math.round((Z1 - Z0) / STEP);
    const pos: number[] = [];
    const col: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (let j = 0; j <= nz; j++) {
      for (let i = 0; i <= nx; i++) {
        const x = X0 + i * STEP;
        const z = Z0 + j * STEP;
        const insideEdge = x >= 0 && x <= MAP_W && z > FACADE_Z && z <= MAP_H;
        const h = insideEdge ? 0 : terrainHeight(x, z);
        pos.push(x, h, z);
        uv.push(x / 5, z / 5);
        const n = fbm(x * 0.05, z * 0.05, 4, 21);
        const road = z > MAP_H - 1 && Math.abs(x - 57.5) < 4;
        if (road) col.push(0.3 * (0.8 + n * 0.4), 0.26 * (0.8 + n * 0.4), 0.2);
        else col.push(0.19 * (0.7 + n * 0.6), 0.23 * (0.7 + n * 0.6), 0.13 * (0.7 + n * 0.6));
      }
    }
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const x = X0 + i * STEP;
        const z = Z0 + j * STEP;
        // пропускаем прямоугольник двора — там отдельная детальная сетка
        if (x >= 0 && x + STEP <= MAP_W && z >= FACADE_Z - 0.5 && z + STEP <= MAP_H) continue;
        const a = j * (nx + 1) + i;
        const b = a + 1;
        const c = a + nx + 1;
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, M.terrain);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    mesh.name = 'terrain';
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }

  // ------------------------------------------------------------ предметы обстановки
  const batchIn = new Batcher();
  const batchOut = new Batcher();
  for (const p of layout.props) {
    const indoor = grid.typeAt(Math.floor(p.x), Math.floor(p.z)) === INDOOR;
    buildProp(p, indoor ? batchIn : batchOut, M, indoor);
  }
  // карниз фасада
  batchOut.box(M.get('concrete', false), MAP_W, 0.45, 0.9, MAP_W / 2, FACADE_H + 0.1, FACADE_Z - 0.25);

  // светильники
  const bulbsIn: THREE.BufferGeometry[] = [];
  const bulbsOut: THREE.BufferGeometry[] = [];
  const haloInPos: number[] = [];
  const haloOutPos: number[] = [];
  const metalIn = M.get('metal', true);
  const metalOut = M.get('metal', false);
  for (const l of layout.lamps) {
    const bulb = new THREE.SphereGeometry(l.kind === 'pole' ? 0.11 : 0.075, 8, 6);
    if (l.kind === 'ceiling') {
      batchIn.cyl(metalIn, 0.03, 0.03, 0.12, l.x, l.y + 0.08, l.z, 6);
      batchIn.cyl(metalIn, 0.16, 0.05, 0.05, l.x, l.y + 0.02, l.z, 8);
      bulb.translate(l.x, l.y - 0.07, l.z);
      bulbsIn.push(bulb);
      haloInPos.push(l.x, l.y - 0.07, l.z);
    } else if (l.kind === 'wall') {
      batchOut.box(metalOut, 0.3, 0.12, 0.3, l.x, l.y + 0.12, l.z - 0.2);
      batchOut.cyl(metalOut, 0.22, 0.1, 0.1, l.x, l.y + 0.03, l.z, 8);
      bulb.translate(l.x, l.y - 0.06, l.z);
      bulbsOut.push(bulb);
      haloOutPos.push(l.x, l.y - 0.06, l.z);
    } else {
      batchOut.cyl(metalOut, 0.28, 0.1, 0.12, l.x, l.y + 0.05, l.z, 8);
      bulb.translate(l.x, l.y - 0.06, l.z);
      bulbsOut.push(bulb);
      haloOutPos.push(l.x, l.y - 0.06, l.z);
    }
  }

  for (const [batch, name] of [
    [batchIn, 'props-in'],
    [batchOut, 'props-out'],
  ] as const) {
    for (const mesh of batch.build()) {
      applyBake(mesh.geometry);
      mesh.castShadow = name === 'props-out';
      mesh.receiveShadow = true;
      mesh.name = name;
      group.add(mesh);
    }
  }

  const mergeBulbs = (list: THREE.BufferGeometry[], mat: THREE.Material): void => {
    if (!list.length) return;
    const pos: number[] = [];
    const idx: number[] = [];
    for (const g of list) {
      const base = pos.length / 3;
      const p = g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) pos.push(p.getX(i), p.getY(i), p.getZ(i));
      const ind = g.index!;
      for (let i = 0; i < ind.count; i++) idx.push(base + ind.getX(i));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  };
  mergeBulbs(bulbsIn, M.bulbIn);
  mergeBulbs(bulbsOut, M.bulbOut);

  const haloTex = softDot('rgba(255,225,170,0.85)', 'rgba(255,190,110,0.18)');
  const makeHalo = (pos: number[], size: number): THREE.Points => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ map: haloTex, size, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55, fog: true });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    group.add(pts);
    return pts;
  };
  const haloIn = makeHalo(haloInPos, 0.9);
  const haloOut = makeHalo(haloOutPos, 2.2);

  // трафаретные надписи
  for (const s of layout.signs) {
    const tex = stencilTex(s.text);
    const aspect = (tex.image as HTMLCanvasElement).width / (tex.image as HTMLCanvasElement).height;
    let w = s.w;
    let h = w / aspect;
    if (h > 0.3) {
      h = 0.3;
      w = h * aspect;
    }
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.8, color: 0x9a968a });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    mesh.position.set(s.x, s.y, s.z);
    mesh.rotation.y = s.yaw;
    group.add(mesh);
  }

  // ------------------------------------------------------------ лес вокруг
  {
    const trunkGeo = new THREE.CylinderGeometry(0.12, 0.2, 1, 5);
    trunkGeo.translate(0, 0.5, 0);
    const crown: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 4; k++) {
      const c = new THREE.ConeGeometry(1.5 - k * 0.3, 2.0, 6);
      c.translate(0, 0.42 + k * 0.19, 0);
      crown.push(c);
    }
    const places: { x: number; z: number; h: number; s: number }[] = [];
    for (let gz = -200; gz < 330; gz += 4.2) {
      for (let gx = -240; gx < 390; gx += 4.2) {
        const r = hash2(Math.round(gx * 10), Math.round(gz * 10), 5);
        const x = gx + hash2(Math.round(gx * 10), Math.round(gz * 10), 6) * 4;
        const z = gz + hash2(Math.round(gx * 10), Math.round(gz * 10), 7) * 4;
        const inMap = x > -3 && x < MAP_W + 3 && z > FACADE_Z - 2 && z < MAP_H + 2;
        if (inMap) continue;
        if (z > MAP_H - 4 && Math.abs(x - 57.5) < 7) continue;
        const dens = 0.3 + 0.6 * fbm(x * 0.02, z * 0.02, 3, 91);
        const dist = Math.hypot(x - 75, z - 80);
        if (r > dens * (dist > 260 ? 0.35 : 0.8)) continue;
        places.push({ x, z, h: 7 + hash2(Math.round(x), Math.round(z), 8) * 8, s: 0.8 + hash2(Math.round(x), Math.round(z), 9) * 0.7 });
      }
    }
    const trunks = new THREE.InstancedMesh(trunkGeo, M.get('bark', false), places.length);
    const dummy = new THREE.Object3D();
    places.forEach((p, i) => {
      dummy.position.set(p.x, terrainHeight(p.x, p.z) - 0.3, p.z);
      dummy.scale.set(p.s, p.h, p.s);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      trunks.setMatrixAt(i, dummy.matrix);
    });
    trunks.frustumCulled = false;
    group.add(trunks);
    const foliageMat = M.get('foliage', false);
    crown.forEach((cg, k) => {
      const inst = new THREE.InstancedMesh(cg, foliageMat, places.length);
      places.forEach((p, i) => {
        dummy.position.set(p.x, terrainHeight(p.x, p.z) - 0.3, p.z);
        dummy.scale.set(p.s * (1.5 + (k === 0 ? 0.2 : 0)), p.h, p.s * (1.5 + (k === 0 ? 0.2 : 0)));
        dummy.rotation.set(0, hash2(i, k, 3) * 6.28, 0);
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
      });
      inst.frustumCulled = false;
      group.add(inst);
    });
  }

  // ------------------------------------------------------------ подвижные ворота
  const doorMat = M.get('metalGrey', false);
  const hangarL = new THREE.Mesh(new THREE.BoxGeometry(4.05, 6.5, 0.18), doorMat);
  const hangarR = new THREE.Mesh(new THREE.BoxGeometry(4.05, 6.5, 0.18), doorMat);
  hangarL.position.set(123, 3.25, 58.9);
  hangarR.position.set(127, 3.25, 58.9);
  hangarL.castShadow = hangarR.castShadow = true;
  group.add(hangarL, hangarR);
  const barrierPivot = new THREE.Group();
  barrierPivot.position.set(60.0, 1.05, 120.6);
  const pole = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.1, 0.1), new THREE.MeshStandardMaterial({ color: 0xb8b4a4, roughness: 0.8 }));
  pole.position.set(-2.6, 0, 0);
  barrierPivot.add(pole);
  for (let i = 0; i < 4; i++) {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.105, 0.105), new THREE.MeshStandardMaterial({ color: 0x8a1f16, roughness: 0.8 }));
    stripe.position.set(-0.8 - i * 1.25, 0, 0);
    barrierPivot.add(stripe);
  }
  group.add(barrierPivot);

  // освещённость клеток для подсветки персонажей
  const cellLight = new Float32Array(grid.w * grid.h * 2);
  for (let z = 0; z < grid.h; z++) {
    for (let x = 0; x < grid.w; x++) {
      if (grid.type[grid.idx(x, z)] === SOLID) continue;
      const b = bakeAt(x + 0.5, 1.2, z + 0.5, 0, 1, 0);
      cellLight[(z * grid.w + x) * 2] = b[0];
      cellLight[(z * grid.w + x) * 2 + 1] = b[1];
    }
  }

  return {
    group,
    lamps: layout.lamps,
    haloIn,
    haloOut,
    exhaust: new THREE.Vector3(15.5, FACADE_H + 0.4, 59.3),
    terrainHeight,
    sampleLight(x: number, z: number): [number, number] {
      const cx = Math.floor(x);
      const cz = Math.floor(z);
      if (!grid.inBounds(cx, cz)) return [0, 0];
      const i = (cz * grid.w + cx) * 2;
      return [cellLight[i], cellLight[i + 1]];
    },
    setHangarDoor(open: number): void {
      hangarL.position.x = 123 - open * 4.1;
      hangarR.position.x = 127 + open * 4.1;
    },
    setBarrier(open: number): void {
      barrierPivot.rotation.z = -open * 1.35;
    },
  };
}
