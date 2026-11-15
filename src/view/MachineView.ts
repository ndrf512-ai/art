/**
 * Орудия и техника: 21-см гаубицы, 38-см установка «Конрад» на железнодорожном
 * транспортёре, грузовики и штабная машина. Модели процедурные, положение,
 * наводка и откат берутся из состояния симуляции.
 */
import * as THREE from 'three';
import { damp } from '../core/math';
import type { GunId, GunState } from '../core/types';
import type { Sim } from '../sim/Sim';
import { Batcher } from './Batcher';
import type { Materials } from './Materials';

const HALF = Math.PI / 2;
const DEG = Math.PI / 180;

interface GunObj {
  root: THREE.Group;
  cradle: THREE.Group;
  barrel: THREE.Group;
  tractor: THREE.Group | null;
  muzzle: THREE.Object3D;
  yaw: number;
  elev: number;
}

function meshes(b: Batcher, parent: THREE.Object3D, shadow = true): void {
  for (const m of b.build()) {
    m.castShadow = shadow;
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    parent.add(m);
  }
}

function buildHowitzer(M: Materials): GunObj {
  const g = (n: Parameters<Materials['get']>[0]) => M.get(n, false);
  const root = new THREE.Group();
  const b = new Batcher();
  b.cyl(g('metal'), 1.55, 1.65, 0.16, 0, 0.1, 0, 20);
  b.box(g('metalGreen'), 1.35, 0.85, 2.5, 0, 0.9, 0.1);
  for (const s of [-1, 1]) {
    b.cyl(g('rubber'), 0.8, 0.8, 0.32, s * 1.05, 0.8, 0.35, 18, 0, 0, HALF);
    b.cyl(g('metalGreen'), 0.5, 0.5, 0.34, s * 1.05, 0.8, 0.35, 12, 0, 0, HALF);
    b.box(g('metalGreen'), 0.16, 1.5, 0.9, s * 0.62, 1.7, 0.15);
    b.cyl(g('metal'), 0.07, 0.07, 1.5, s * 0.72, 1.55, 1.0, 8, 0.9);
  }
  b.box(g('metalGreen'), 0.55, 0.42, 4.4, 0, 0.55, -3.1, 0, 0.06);
  b.box(g('metal'), 1.5, 0.5, 0.2, 0, 0.3, -5.25, 0, 0.3);
  b.box(g('metal'), 0.5, 0.5, 0.5, -0.75, 1.35, -0.6);
  b.cyl(g('metal'), 0.22, 0.22, 0.05, -1.02, 1.45, -0.6, 10, 0, 0, HALF);
  meshes(b, root);
  const cradle = new THREE.Group();
  cradle.position.set(0, 1.85, 0.25);
  root.add(cradle);
  const cb = new Batcher();
  cb.box(g('metalGreen'), 0.75, 0.5, 2.9, 0, -0.18, 0.5);
  cb.cyl(g('metal'), 0.11, 0.11, 2.4, 0, 0.33, 0.6, 8, HALF);
  cb.cyl(g('metal'), 0.09, 0.09, 2.2, 0, -0.45, 0.7, 8, HALF);
  meshes(cb, cradle);
  const barrel = new THREE.Group();
  cradle.add(barrel);
  const bb = new Batcher();
  bb.cyl(g('metal'), 0.3, 0.3, 1.5, 0, 0.02, -1.25, 12, HALF);
  bb.box(g('metal'), 0.6, 0.6, 0.35, 0, 0.02, -2.05);
  bb.cyl(g('metalGrey'), 0.155, 0.2, 5.7, 0, 0.02, 2.35, 12, HALF);
  bb.cyl(g('metal'), 0.19, 0.19, 0.22, 0, 0.02, 5.1, 12, HALF);
  meshes(bb, barrel);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.02, 5.3);
  barrel.add(muzzle);
  // тягач для смены позиции
  const tractor = new THREE.Group();
  const tb = new Batcher();
  tb.box(g('metalGreen'), 2.1, 1.1, 4.6, 0, 1.15, 0);
  tb.box(g('metalGreen'), 2.0, 0.9, 1.6, 0, 2.1, 1.1);
  tb.box(g('rubber'), 0.4, 0.75, 4.4, 1.05, 0.42, 0);
  tb.box(g('rubber'), 0.4, 0.75, 4.4, -1.05, 0.42, 0);
  tb.box(g('canvas'), 2.0, 0.7, 2.2, 0, 2.0, -1.1);
  meshes(tb, tractor);
  tractor.position.set(0, 0, -8.2);
  tractor.visible = false;
  root.add(tractor);
  return { root, cradle, barrel, tractor, muzzle, yaw: 0, elev: 0.3 };
}

function buildRailGun(M: Materials): GunObj {
  const g = (n: Parameters<Materials['get']>[0]) => M.get(n, false);
  const root = new THREE.Group();
  const b = new Batcher();
  // главная балка транспортёра
  b.box(g('metalGreen'), 2.5, 1.25, 20.5, 0, 1.75, 0);
  b.box(g('metal'), 2.7, 0.14, 20.7, 0, 2.42, 0);
  for (const zb of [-6.6, 6.6]) {
    b.box(g('metal'), 2.3, 0.6, 5.6, 0, 0.82, zb);
    for (let i = 0; i < 5; i++) {
      b.cyl(g('metal'), 0.46, 0.46, 1.9, 0, 0.47, zb - 2.2 + i * 1.1, 14, 0, 0, HALF);
    }
  }
  // площадки и поручни
  for (const s of [-1, 1]) {
    b.box(g('rust'), 0.6, 0.06, 16, s * 1.55, 2.4, -1);
    for (let z = -8.5; z <= 6.5; z += 2.5) b.cyl(g('metal'), 0.02, 0.02, 0.9, s * 1.8, 2.85, z, 5);
    b.box(g('metal'), 0.03, 0.03, 15.5, s * 1.8, 3.3, -1);
    b.box(g('metalGreen'), 0.22, 2.3, 1.7, s * 0.95, 3.2, -1.2);
  }
  b.box(g('metal'), 0.5, 2.4, 0.06, 1.45, 1.2, -9.2, 0, 0.18);
  // генератор и подъёмник в корме
  b.box(g('metalGreen'), 1.8, 1.2, 2.2, 0, 3.05, -8.6);
  b.cyl(g('metal'), 0.09, 0.09, 3.2, 0.9, 4.0, -6.6, 8);
  b.box(g('metal'), 0.14, 0.14, 2.6, 0.9, 5.5, -5.5);
  b.cyl(g('rust'), 0.012, 0.012, 1.6, 0.9, 4.7, -4.4, 5);
  meshes(b, root);
  const cradle = new THREE.Group();
  cradle.position.set(0, 3.25, -1.2);
  root.add(cradle);
  const cb = new Batcher();
  cb.box(g('metalGreen'), 1.2, 0.9, 6.5, 0, -0.35, 0.8);
  cb.cyl(g('metal'), 0.16, 0.16, 4.5, 0, 0.72, 0.5, 8, HALF);
  meshes(cb, cradle);
  const barrel = new THREE.Group();
  cradle.add(barrel);
  const bb = new Batcher();
  bb.cyl(g('metal'), 0.62, 0.62, 3.2, 0, 0, -3.6, 14, HALF);
  bb.box(g('metal'), 1.2, 1.2, 0.6, 0, 0, -5.4);
  bb.cyl(g('metalGrey'), 0.27, 0.44, 17.5, 0, 0, 6.6, 14, HALF);
  bb.cyl(g('metal'), 0.46, 0.5, 3.0, 0, 0, -0.6, 14, HALF);
  bb.cyl(g('metal'), 0.31, 0.31, 0.4, 0, 0, 15.2, 14, HALF);
  meshes(bb, barrel);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0, 15.6);
  barrel.add(muzzle);
  return { root, cradle, barrel, tractor: null, muzzle, yaw: 0, elev: 0.03 };
}

function buildTruck(M: Materials): THREE.Group {
  const g = (n: Parameters<Materials['get']>[0]) => M.get(n, false);
  const root = new THREE.Group();
  const b = new Batcher();
  b.box(g('metal'), 2.0, 0.3, 5.8, 0, 0.85, 0);
  b.box(g('metalGreen'), 2.1, 1.5, 1.6, 0, 1.75, 1.3);
  b.box(g('metalGreen'), 1.7, 0.95, 1.4, 0, 1.45, 2.65);
  b.box(g('glass'), 1.8, 0.55, 0.05, 0, 2.1, 2.11);
  b.box(g('wood'), 2.2, 0.7, 3.3, 0, 1.35, -1.25);
  b.box(g('canvas'), 2.25, 1.15, 3.35, 0, 2.25, -1.25);
  for (const s of [-1, 1]) {
    b.cyl(g('rubber'), 0.48, 0.48, 0.3, s * 0.95, 0.48, 2.3, 14, 0, 0, HALF);
    b.cyl(g('rubber'), 0.48, 0.48, 0.5, s * 0.9, 0.48, -1.0, 14, 0, 0, HALF);
    b.cyl(g('rubber'), 0.48, 0.48, 0.5, s * 0.9, 0.48, -2.1, 14, 0, 0, HALF);
    b.cyl(g('steel'), 0.11, 0.11, 0.06, s * 0.6, 1.5, 3.37, 8, HALF);
  }
  meshes(b, root);
  return root;
}

function buildCar(M: Materials): THREE.Group {
  const g = (n: Parameters<Materials['get']>[0]) => M.get(n, false);
  const root = new THREE.Group();
  const b = new Batcher();
  b.box(g('metalGreen'), 1.55, 0.6, 3.6, 0, 0.75, 0);
  b.box(g('metalGreen'), 1.4, 0.35, 1.1, 0, 1.05, 1.2, 0, 0.12);
  b.box(g('glass'), 1.4, 0.45, 0.04, 0, 1.35, 0.6, 0, -0.2);
  b.box(g('canvas'), 1.5, 0.12, 1.7, 0, 1.35, -0.6);
  b.cyl(g('rubber'), 0.34, 0.34, 0.16, 0, 1.2, 1.85, 12, HALF);
  for (const s of [-1, 1]) {
    b.cyl(g('rubber'), 0.36, 0.36, 0.22, s * 0.78, 0.36, 1.15, 12, 0, 0, HALF);
    b.cyl(g('rubber'), 0.36, 0.36, 0.22, s * 0.78, 0.36, -1.15, 12, 0, 0, HALF);
  }
  meshes(b, root);
  return root;
}

export class MachineView {
  private guns = new Map<GunId, GunObj>();
  private vehicles = new Map<string, THREE.Group>();
  private v = new THREE.Vector3();

  constructor(
    private sim: Sim,
    private scene: THREE.Scene,
    private M: Materials,
  ) {
    for (const id of ['gun1', 'gun2', 'gun3'] as GunId[]) {
      const o = id === 'gun1' ? buildRailGun(M) : buildHowitzer(M);
      this.guns.set(id, o);
      scene.add(o.root);
    }
  }

  /** Мировые координаты дульного среза (для вспышки и дыма). */
  muzzle(id: GunId): THREE.Vector3 {
    const o = this.guns.get(id)!;
    o.root.updateMatrixWorld(true);
    return o.muzzle.getWorldPosition(this.v).clone();
  }

  /** Окружности-препятствия для командира: орудия и машины. */
  obstacles(out: { x: number; z: number; r: number }[]): void {
    for (const g of this.sim.artillery.guns()) {
      const o = this.guns.get(g.id)!;
      if (g.id === 'gun1') {
        const fx = Math.sin(o.yaw);
        const fz = Math.cos(o.yaw);
        for (let k = -9; k <= 9; k += 3) out.push({ x: g.x + fx * k, z: g.z + fz * k, r: 1.75 });
      } else {
        out.push({ x: g.x, z: g.z, r: 1.6 });
        out.push({ x: g.x - Math.sin(o.yaw) * 2.8, z: g.z - Math.cos(o.yaw) * 2.8, r: 0.9 });
      }
    }
    for (const v of this.sim.supply.vehicles) {
      if (v.state !== 'driving') continue;
      out.push({ x: v.x, z: v.z, r: 2.2 });
    }
  }

  update(dt: number): void {
    const sim = this.sim;
    for (const g of sim.artillery.guns()) this.updateGun(g, dt);
    for (const v of sim.supply.vehicles) {
      let o = this.vehicles.get(v.id);
      if (!o) {
        o = v.kind === 'truck' ? buildTruck(this.M) : buildCar(this.M);
        this.vehicles.set(v.id, o);
        this.scene.add(o);
      }
      o.visible = v.state !== 'away';
      o.position.set(v.x, 0, v.z);
      o.rotation.y = v.yaw;
      o.rotation.z = v.state === 'wreck' ? 0.3 : 0;
    }
  }

  private updateGun(g: GunState, dt: number): void {
    const o = this.guns.get(g.id)!;
    const yaw = Math.PI - g.azimuth * DEG;
    let d = yaw - o.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    o.yaw += d * Math.min(1, dt * 4);
    o.elev = damp(o.elev, g.elevation * DEG, 4, dt);
    o.root.position.set(g.x, g.id === 'gun1' ? 0.3 : 0.02, g.z);
    o.root.rotation.y = o.yaw;
    o.cradle.rotation.x = -o.elev;
    const recoil = g.recoil > 0 ? Math.sin(Math.min(1, g.recoil) * Math.PI * 0.5) : 0;
    o.barrel.position.z = -recoil * (g.id === 'gun1' ? 1.6 : 1.0);
    if (o.tractor) o.tractor.visible = g.phase === 'relocating';
    if (g.phase === 'relocating') {
      const site = this.sim.layout.guns[g.id];
      const to = g.note === 'toAlt' ? site.alt : site.main;
      o.root.rotation.y = Math.atan2(to.x - g.x, to.z - g.z) + Math.PI;
      o.yaw = o.root.rotation.y;
    }
  }
}
