/**
 * Сборщик статической геометрии: все неподвижные предметы сливаются в несколько
 * мешей (по одному на материал), чтобы сцена рисовалась малым числом вызовов.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const TEX_SCALE = 1 / 1.6;

/** Параллелепипед с UV в мировом масштабе (текстура не растягивается). */
export function boxGeo(w: number, h: number, d: number): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const dims: [number, number][] = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, uv.getX(k) * dims[f][0] * TEX_SCALE, uv.getY(k) * dims[f][1] * TEX_SCALE);
    }
  }
  return g;
}

export class Batcher {
  private groups = new Map<THREE.Material, THREE.BufferGeometry[]>();
  private stack: THREE.Matrix4[] = [];
  private base = new THREE.Matrix4();
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();

  /** Локальная система координат предмета (позиция + поворот вокруг Y). */
  push(x: number, y: number, z: number, ry = 0): void {
    this.stack.push(this.base.clone());
    this.e.set(0, ry, 0);
    this.m.compose(this.p.set(x, y, z), this.q.setFromEuler(this.e), this.s.set(1, 1, 1));
    this.base.multiply(this.m);
  }

  pop(): void {
    const m = this.stack.pop();
    if (m) this.base.copy(m);
  }

  add(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): void {
    this.e.set(rx, ry, rz, 'YXZ');
    this.m.compose(this.p.set(x, y, z), this.q.setFromEuler(this.e), this.s.set(sx, sy, sz));
    this.m.premultiply(this.base);
    geo.applyMatrix4(this.m);
    let list = this.groups.get(mat);
    if (!list) {
      list = [];
      this.groups.set(mat, list);
    }
    list.push(geo);
  }

  /** Коробка с центром в (x, y, z). */
  box(mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0): void {
    this.add(boxGeo(w, h, d), mat, x, y, z, rx, ry, rz);
  }

  /** Вертикальный цилиндр с центром в (x, y, z); rx/rz позволяют положить его. */
  cyl(mat: THREE.Material, rTop: number, rBot: number, h: number, x: number, y: number, z: number, seg = 10, rx = 0, ry = 0, rz = 0): void {
    this.add(new THREE.CylinderGeometry(rTop, rBot, h, seg), mat, x, y, z, rx, ry, rz);
  }

  sphere(mat: THREE.Material, r: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, seg = 10): void {
    this.add(new THREE.SphereGeometry(r, seg, Math.max(6, Math.round(seg * 0.7))), mat, x, y, z, 0, 0, 0, sx, sy, sz);
  }

  cone(mat: THREE.Material, r: number, h: number, x: number, y: number, z: number, seg = 8): void {
    this.add(new THREE.ConeGeometry(r, h, seg), mat, x, y, z);
  }

  plane(mat: THREE.Material, w: number, h: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): void {
    this.add(new THREE.PlaneGeometry(w, h), mat, x, y, z, rx, ry, rz);
  }

  /** Возвращает слитые меши; геометрии без индексов приводятся к общему виду. */
  build(): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const [mat, list] of this.groups) {
      if (list.length === 0) continue;
      // все примитивы индексированы: сливаем с индексами, без размножения вершин
      const norm = list.map((g) => {
        let gi = g;
        if (!gi.index) {
          const n = gi.attributes.position.count;
          const idx = new Array(n);
          for (let i = 0; i < n; i++) idx[i] = i;
          gi.setIndex(idx);
        }
        for (const name of Object.keys(gi.attributes)) {
          if (name !== 'position' && name !== 'normal' && name !== 'uv') gi.deleteAttribute(name);
        }
        return gi;
      });
      const merged = mergeGeometries(norm, false);
      if (!merged) continue;
      for (const g of list) g.dispose();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.matrixAutoUpdate = false;
      out.push(mesh);
    }
    this.groups.clear();
    return out;
  }
}
