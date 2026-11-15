/**
 * Фигура человека: одна скелетная (skinned) сетка на персонажа — один вызов отрисовки.
 * Геометрия собирается процедурно из примитивов, жёстко привязанных к костям;
 * позы и движения задаются аналитически и плавно смешиваются.
 */
import * as THREE from 'three';
import type { AnimId, CarryKind } from '../core/types';

export type HeadGear = 'helmet' | 'cap' | 'sidecap' | 'none' | 'headphones' | 'flatcap';

export interface Look {
  tunic: number;
  trousers: number;
  boots: number;
  belt: number;
  skin: number;
  hair: number;
  head: HeadGear;
  headColor: number;
  coat: boolean;
  apron?: boolean;
  armband?: boolean;
  female?: boolean;
  officer?: boolean;
  /** Отдельная сетка головы на слое 1 (тело игрока: голова видна только в зеркале). */
  splitHead?: boolean;
  scale?: number;
}

const B = { root: 0, hips: 1, spine: 2, head: 3, armL: 4, foreL: 5, armR: 6, foreR: 7, legL: 8, shinL: 9, legR: 10, shinR: 11 } as const;
const HIP_Y = 0.93;

class Parts {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  skinI: number[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private c = new THREE.Color();
  private nm = new THREE.Matrix3();

  add(geo: THREE.BufferGeometry, bone: number, color: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0): void {
    const g = geo.index ? geo.toNonIndexed() : geo;
    this.e.set(rx, ry, rz);
    this.m.compose(new THREE.Vector3(x, y, z), this.q.setFromEuler(this.e), new THREE.Vector3(sx, sy, sz));
    this.nm.getNormalMatrix(this.m);
    const p = g.attributes.position as THREE.BufferAttribute;
    const n = g.attributes.normal as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    this.c.set(color);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(this.m);
      this.pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(n, i).applyMatrix3(this.nm).normalize();
      this.nor.push(v.x, v.y, v.z);
      this.col.push(this.c.r, this.c.g, this.c.b);
      this.skinI.push(bone, 0, 0, 0);
    }
    if (g !== geo) g.dispose();
    geo.dispose();
  }

  cyl(bone: number, color: number, rTop: number, rBot: number, h: number, x: number, y: number, z: number, sx = 1, sz = 1, seg = 8, rx = 0, rz = 0): void {
    this.add(new THREE.CylinderGeometry(rTop, rBot, h, seg), bone, color, x, y, z, sx, 1, sz, rx, 0, rz);
  }

  sphere(bone: number, color: number, r: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, seg = 8): void {
    this.add(new THREE.SphereGeometry(r, seg, Math.max(5, seg - 2)), bone, color, x, y, z, sx, sy, sz);
  }

  box(bone: number, color: number, w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): void {
    this.add(new THREE.BoxGeometry(w, h, d), bone, color, x, y, z, 1, 1, 1, rx, ry, rz);
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    const n = this.pos.length / 3;
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.skinI, 4));
    const w = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) w[i * 4] = 1;
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(w, 4));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.7);
    g.boundingBox = new THREE.Box3(new THREE.Vector3(-1.2, -0.3, -1.2), new THREE.Vector3(1.2, 2.2, 1.2));
    return g;
  }
}

function buildHead(P: Parts, L: Look): void {
  const y = 1.6;
  P.sphere(B.head, L.skin, 0.1, 0, y, 0.005, 0.9, 1.1, 0.98, 10);
  P.box(B.head, L.skin, 0.028, 0.04, 0.03, 0, y - 0.015, 0.1);
  // волосы
  if (L.female) {
    P.sphere(B.head, L.hair, 0.106, 0, y + 0.012, -0.018, 0.95, 1.08, 1.0, 10);
    P.sphere(B.head, L.hair, 0.06, 0, y - 0.03, -0.11, 1, 0.9, 0.9, 8);
  } else if (L.head === 'none' || L.head === 'sidecap' || L.head === 'headphones') {
    P.sphere(B.head, L.hair, 0.103, 0, y + 0.02, -0.02, 0.93, 1.0, 0.98, 8);
  }
  switch (L.head) {
    case 'helmet':
      P.sphere(B.head, L.headColor, 0.125, 0, y + 0.035, -0.005, 1, 0.82, 1.08, 10);
      P.cyl(B.head, L.headColor, 0.128, 0.15, 0.06, 0, y - 0.035, -0.025, 1, 1.1, 10);
      break;
    case 'cap':
      P.cyl(B.head, L.headColor, 0.11, 0.105, 0.05, 0, y + 0.085, 0, 1, 1, 10);
      P.cyl(B.head, L.tunic, 0.135, 0.115, 0.045, 0, y + 0.125, -0.005, 1, 1, 10, -0.12);
      P.box(B.head, 0x0c0c0c, 0.15, 0.012, 0.075, 0, y + 0.062, 0.105, 0.25);
      break;
    case 'sidecap':
      P.box(B.head, L.headColor, 0.115, 0.06, 0.23, 0, y + 0.1, -0.005, 0, 0, 0.08);
      break;
    case 'flatcap':
      P.cyl(B.head, L.headColor, 0.12, 0.115, 0.035, 0, y + 0.095, 0.01, 1, 1.1, 10);
      P.box(B.head, L.headColor, 0.12, 0.01, 0.06, 0, y + 0.08, 0.12);
      break;
    case 'headphones':
      P.box(B.head, L.headColor, 0.115, 0.06, 0.23, 0, y + 0.1, -0.005, 0, 0, 0.08);
      P.cyl(B.head, 0x101010, 0.035, 0.035, 0.03, 0.098, y, 0, 1, 1, 8, 0, Math.PI / 2);
      P.cyl(B.head, 0x101010, 0.035, 0.035, 0.03, -0.098, y, 0, 1, 1, 8, 0, Math.PI / 2);
      P.box(B.head, 0x101010, 0.2, 0.012, 0.02, 0, y + 0.135, 0);
      break;
  }
}

function buildBody(P: Parts, L: Look): void {
  const f = !!L.female;
  const tun = L.tunic;
  // таз и пола мундира / плащ
  P.sphere(B.hips, L.trousers, 0.16, 0, 0.93, 0, f ? 1.1 : 1.05, 0.75, 0.8, 8);
  if (L.coat) {
    P.cyl(B.hips, tun, f ? 0.165 : 0.18, f ? 0.25 : 0.24, 0.56, 0, 0.7, 0, 1, 0.82, 10);
  } else {
    P.cyl(B.hips, tun, 0.175, 0.2, 0.2, 0, 0.9, 0, 1, 0.74, 10);
  }
  // торс
  P.cyl(B.spine, tun, f ? 0.165 : 0.19, f ? 0.135 : 0.165, 0.42, 0, 1.2, 0, 1, 0.68, 10);
  P.sphere(B.spine, tun, 0.12, 0, 1.415, 0, f ? 1.62 : 1.9, 0.5, 0.92, 8);
  if (f) {
    P.sphere(B.spine, tun, 0.074, 0.074, 1.3, 0.085, 1, 0.95, 0.9, 8);
    P.sphere(B.spine, tun, 0.074, -0.074, 1.3, 0.085, 1, 0.95, 0.9, 8);
  }
  P.cyl(B.spine, L.skin, 0.045, 0.05, 0.09, 0, 1.475, 0, 1, 1, 8);
  P.cyl(B.spine, tun, 0.065, 0.075, 0.045, 0, 1.45, 0, 1, 1, 8);
  // ремень
  P.cyl(B.spine, L.belt, f ? 0.142 : 0.172, f ? 0.142 : 0.172, 0.05, 0, 1.01, 0, 1, 0.7, 10);
  P.box(B.spine, 0x8a8468, 0.05, 0.04, 0.02, 0, 1.01, f ? 0.1 : 0.122);
  if (L.officer) {
    P.box(B.spine, 0x9a9a8c, 0.09, 0.012, 0.045, 0.19, 1.468, 0);
    P.box(B.spine, 0x9a9a8c, 0.09, 0.012, 0.045, -0.19, 1.468, 0);
    P.box(B.hips, 0x2a1d14, 0.06, 0.13, 0.11, -0.185, 0.96, 0.02);
  }
  if (L.apron) P.box(B.spine, 0xb9b5a8, 0.3, 0.46, 0.02, 0, 1.08, 0.125);
  if (L.armband) P.cyl(B.armL, 0xc8c4b8, 0.057, 0.057, 0.06, 0.215, 1.3, 0, 1, 1, 8);
  // руки
  for (const s of [1, -1]) {
    const arm = s > 0 ? B.armL : B.armR;
    const fore = s > 0 ? B.foreL : B.foreR;
    const x = s * (f ? 0.195 : 0.215);
    P.sphere(arm, tun, 0.058, x, 1.42, 0, 1, 1, 1, 8);
    P.cyl(arm, tun, 0.052, 0.046, 0.29, x, 1.275, 0, 1, 1, 8);
    P.cyl(fore, tun, 0.044, 0.037, 0.25, x, 1.005, 0, 1, 1, 8);
    P.sphere(fore, L.officer && !f ? 0x2a2622 : L.skin, 0.042, x, 0.855, 0.005, 0.85, 1.15, 1, 8);
  }
  // ноги
  for (const s of [1, -1]) {
    const leg = s > 0 ? B.legL : B.legR;
    const shin = s > 0 ? B.shinL : B.shinR;
    const x = s * 0.095;
    P.cyl(leg, L.trousers, 0.083, 0.064, 0.44, x, 0.7, 0, 1, 1, 8);
    P.cyl(shin, L.boots, 0.062, 0.052, 0.4, x, 0.28, 0, 1, 1, 8);
    P.box(shin, L.boots, 0.095, 0.085, 0.25, x, 0.045, 0.045);
  }
}

export interface Pose {
  hipY: number;
  pitch: number;
  spX: number;
  spY: number;
  hdX: number;
  hdY: number;
  aLx: number;
  aLy: number;
  aLz: number;
  eL: number;
  aRx: number;
  aRy: number;
  aRz: number;
  eR: number;
  lLx: number;
  kL: number;
  lRx: number;
  kR: number;
}

const KEYS: (keyof Pose)[] = ['hipY', 'pitch', 'spX', 'spY', 'hdX', 'hdY', 'aLx', 'aLy', 'aLz', 'eL', 'aRx', 'aRy', 'aRz', 'eR', 'lLx', 'kL', 'lRx', 'kR'];

export function zeroPose(): Pose {
  return { hipY: 0, pitch: 0, spX: 0, spY: 0, hdX: 0, hdY: 0, aLx: 0, aLy: 0, aLz: 0, eL: 0, aRx: 0, aRy: 0, aRz: 0, eR: 0, lLx: 0, kL: 0, lRx: 0, kR: 0 };
}

export type MoveAnim = 'walk' | 'run' | 'carry' | null;

/** Заполняет целевую позу для анимации. t — время, ph — фаза шага, sd — индивидуальный сдвиг. */
export function computePose(p: Pose, anim: AnimId, move: MoveAnim, t: number, ph: number, sd: number): void {
  for (const k of KEYS) p[k] = 0;
  const s = Math.sin;
  const breath = s(t * 1.3 + sd) * 0.012;
  p.spX = 0.02 + breath;
  p.eL = p.eR = 0.12;
  p.aLz = p.aRz = 0.04;
  if (move) {
    const run = move === 'run';
    const A = run ? 0.85 : move === 'carry' ? 0.42 : 0.5;
    const K = run ? 1.45 : 0.85;
    const sw = s(ph);
    p.lLx = A * sw;
    p.lRx = -A * sw;
    p.kL = 0.08 + K * Math.max(0, Math.cos(ph));
    p.kR = 0.08 + K * Math.max(0, -Math.cos(ph));
    p.hipY = -0.025 * Math.abs(sw);
    p.spY = 0.07 * sw;
    if (move === 'carry') {
      p.aLx = p.aRx = 0.8;
      p.eL = p.eR = 1.05;
      p.aLz = p.aRz = -0.1;
      p.spX = -0.04;
    } else {
      const arm = run ? 0.85 : 0.42;
      p.aLx = -arm * sw;
      p.aRx = arm * sw;
      p.eL = p.eR = run ? 1.3 : 0.28;
      p.spX = run ? 0.2 : 0.04;
    }
    return;
  }
  const sit = (): void => {
    p.hipY = -0.43;
    p.lLx = p.lRx = 1.5;
    p.kL = p.kR = 1.5;
    p.aLx = p.aRx = 0.45;
    p.eL = p.eR = 0.95;
    p.spX = 0.05 + breath;
  };
  switch (anim) {
    case 'idle':
      p.hdY = s(t * 0.37 + sd) * 0.18;
      p.lLx = 0.03;
      break;
    case 'attention':
      p.eL = p.eR = 0.03;
      p.aLz = p.aRz = 0.02;
      p.spX = -0.02;
      break;
    case 'salute':
      p.eL = 0.03;
      p.aRz = 1.25;
      p.aRy = 0.75;
      p.aRx = 0.15;
      p.eR = 2.3;
      p.spX = -0.02;
      break;
    case 'guard':
      p.aRx = 0.55;
      p.eR = 1.75;
      p.aRz = -0.15;
      p.eL = 0.2;
      p.hdY = s(t * 0.4 + sd) * 0.55;
      break;
    case 'aim':
      p.aLx = 1.3;
      p.aLz = -0.35;
      p.eL = 0.35;
      p.aRx = 1.15;
      p.aRz = -0.1;
      p.eR = 1.15;
      p.spY = -0.3;
      p.hdY = 0.25;
      p.hdX = 0.08;
      break;
    case 'kneel_aim':
      p.aLx = 1.3;
      p.aLz = -0.35;
      p.eL = 0.35;
      p.aRx = 1.15;
      p.eR = 1.15;
      p.hipY = -0.46;
      p.lLx = 1.5;
      p.kL = 1.5;
      p.lRx = -0.1;
      p.kR = 1.75;
      p.spY = -0.25;
      p.hdY = 0.2;
      break;
    case 'work':
      p.spX = 0.3;
      p.aLx = 0.7;
      p.eL = 0.9;
      p.aRx = 0.72 + 0.14 * s(t * 5 + sd);
      p.eR = 0.9 + 0.3 * s(t * 5 + sd);
      p.hdX = 0.3;
      break;
    case 'repair':
      p.spX = 0.3;
      p.aLx = 0.7;
      p.eL = 0.9;
      p.aRx = 0.95 + 0.5 * s(t * 6.5 + sd);
      p.eR = 0.8 + 0.5 * s(t * 6.5 + sd + 0.8);
      p.hdX = 0.3;
      break;
    case 'repair_low':
      p.hipY = -0.5;
      p.lLx = p.lRx = 1.95;
      p.kL = p.kR = 2.25;
      p.spX = 0.5;
      p.aLx = 1.0;
      p.eL = 0.55;
      p.aRx = 1.0 + 0.15 * s(t * 5 + sd);
      p.eR = 0.6 + 0.35 * s(t * 5 + sd);
      p.hdX = 0.2;
      break;
    case 'crank':
      p.spX = 0.22;
      p.aLx = 0.7;
      p.eL = 0.8;
      p.aRx = 0.9 + 0.35 * Math.cos(t * 5.2);
      p.eR = 1.0 + 0.4 * s(t * 5.2);
      p.hdX = 0.15;
      break;
    case 'ram': {
      const u = 0.5 + 0.5 * s(t * 3.2 + sd);
      p.spX = 0.22 + 0.22 * u;
      p.aLx = p.aRx = 1.25 - 0.5 * u;
      p.eL = p.eR = 0.35 + 0.85 * (1 - u);
      p.lLx = 0.38;
      p.lRx = -0.3;
      p.kR = 0.2;
      break;
    }
    case 'sit':
      sit();
      break;
    case 'sit_write':
      sit();
      p.spX = 0.25;
      p.aLx = 0.9;
      p.eL = 1.2;
      p.aRx = 0.95 + 0.03 * s(t * 9 + sd);
      p.eR = 1.2 + 0.04 * s(t * 11 + sd);
      p.hdX = 0.36;
      break;
    case 'sit_eat': {
      sit();
      const u = Math.max(0, s(t * 1.5 + sd));
      p.spX = 0.2;
      p.aLx = 0.9;
      p.eL = 1.2;
      p.aRx = 0.9 + 0.45 * u;
      p.eR = 1.25 + 1.05 * u;
      p.hdX = 0.22 - 0.1 * u;
      break;
    }
    case 'sit_radio':
      sit();
      p.spX = 0.16;
      p.aLx = 1.0;
      p.aLz = 0.5;
      p.eL = 2.45;
      p.aRx = 0.92;
      p.eR = 1.25 + 0.07 * s(t * 14 + sd) * (s(t * 1.7) > -0.2 ? 1 : 0);
      p.hdX = 0.15;
      break;
    case 'sit_talk':
      sit();
      p.eR = 1.25 + 0.4 * s(t * 2.3 + sd);
      p.aRx = 0.6;
      p.hdY = 0.42 * s(t * 0.7 + sd);
      p.hdX = 0.05 * s(t * 2.1 + sd);
      break;
    case 'sit_doze':
      sit();
      p.spX = 0.36;
      p.hdX = 0.6;
      break;
    case 'sleep':
      p.pitch = -Math.PI / 2;
      p.aLz = p.aRz = 0.14;
      p.eL = 0.25;
      p.eR = 0.6;
      p.aRx = 0.25;
      p.spX = breath * 2;
      break;
    case 'lie':
      p.pitch = -Math.PI / 2;
      p.aLz = 0.2;
      p.aRz = 0.5;
      p.lLx = 0.6;
      p.kL = 1.1;
      p.hdY = 0.4;
      break;
    case 'talk':
      p.aRx = 0.3;
      p.eR = 0.95 + 0.5 * s(t * 2.1 + sd);
      p.hdY = 0.2 * s(t * 0.9 + sd);
      p.hdX = 0.05 * s(t * 2.4 + sd);
      p.eL = 0.2;
      break;
    case 'argue':
      p.spX = 0.14;
      p.aLx = 0.5 + 0.3 * s(t * 4.2 + sd);
      p.eL = 1.2 + 0.5 * s(t * 4.2 + sd + 1);
      p.aRx = 0.6 + 0.35 * s(t * 3.6 + sd + 2);
      p.eR = 1.0 + 0.6 * s(t * 3.6 + sd);
      p.hdY = 0.2 * s(t * 5 + sd);
      break;
    case 'check_docs':
      p.aLx = 0.8;
      p.eL = 1.5;
      p.aLz = -0.15;
      p.aRx = 0.8;
      p.eR = 1.5 + 0.2 * s(t * 4);
      p.aRz = -0.15;
      p.hdX = 0.42;
      break;
    case 'show_papers':
      p.aRx = 1.1;
      p.eR = 0.5;
      p.eL = 0.05;
      break;
    case 'command':
      p.aRx = 2.7 + 0.12 * s(t * 3);
      p.eR = 0.1;
      p.hdX = -0.1;
      break;
    case 'write':
      p.aLx = 0.7;
      p.eL = 1.5;
      p.aLz = -0.2;
      p.aRx = 0.75;
      p.aRz = -0.2;
      p.eR = 1.6 + 0.05 * s(t * 10);
      p.hdX = 0.36;
      break;
    case 'point':
      p.aRx = 1.4;
      p.eR = 0.1;
      p.hdX = -0.05;
      break;
    case 'smoke': {
      const u = Math.max(0, s(t * 0.9 + sd));
      p.aRx = 0.1 + 0.55 * u;
      p.eR = 0.4 + 2.0 * u;
      p.lRx = 0.08;
      p.hdY = 0.15 * s(t * 0.3 + sd);
      break;
    }
    case 'doze':
      p.hdX = 0.55;
      p.spX = 0.12 + 0.02 * s(t * 0.7);
      break;
    case 'cover':
      p.hipY = -0.46;
      p.lLx = p.lRx = 1.9;
      p.kL = p.kR = 2.2;
      p.spX = 0.7;
      p.aLx = p.aRx = 2.4;
      p.eL = p.eR = 1.6;
      p.hdX = 0.5;
      break;
    case 'cook':
      p.spX = 0.12;
      p.aRx = 0.9 + 0.1 * Math.cos(t * 4);
      p.aRz = 0.12 * s(t * 4);
      p.eR = 1.0;
      p.aLz = 0.35;
      p.eL = 1.4;
      p.hdX = 0.25;
      break;
    case 'inspect':
      p.spX = 0.18 + 0.08 * s(t * 0.6 + sd);
      p.hdY = 0.6 * s(t * 0.8 + sd);
      p.aRx = 0.6;
      p.eR = 1.9;
      break;
    case 'binoculars':
      p.aLx = p.aRx = 1.3;
      p.aLz = p.aRz = -0.3;
      p.eL = p.eR = 2.3;
      p.spY = 0.5 * s(t * 0.3 + sd);
      break;
    case 'phone':
      p.aRx = 0.4;
      p.aRz = 0.5;
      p.eR = 2.5;
      break;
    case 'pickup':
      p.spX = 1.0;
      p.aLx = p.aRx = 0.9;
      p.eL = p.eR = 0.2;
      p.kL = p.kR = 0.5;
      p.lLx = p.lRx = 0.5;
      p.hdX = 0.2;
      break;
  }
}

const SHARED: Record<string, THREE.Material> = {};
function sharedMat(name: string, color: number, metal = 0.2): THREE.Material {
  return (SHARED[name] ??= new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: metal }));
}

export class Figure {
  readonly group = new THREE.Group();
  readonly mesh: THREE.SkinnedMesh;
  readonly headMesh: THREE.SkinnedMesh | null = null;
  readonly material: THREE.MeshStandardMaterial;
  private bones: THREE.Bone[] = [];
  private pose = zeroPose();
  private target = zeroPose();
  private rifleBack: THREE.Mesh | null = null;
  private rifleHand: THREE.Mesh | null = null;
  private crate: THREE.Mesh;
  private shell: THREE.Mesh;
  private papers: THREE.Mesh;
  private tool: THREE.Mesh;
  phase = 0;
  seed = Math.random() * 10;
  private qa = new THREE.Quaternion();
  private qb = new THREE.Quaternion();
  private ea = new THREE.Euler();

  constructor(look: Look, black1: THREE.Texture, armed: boolean) {
    const P = new Parts();
    buildBody(P, look);
    const HP = look.splitHead ? new Parts() : P;
    buildHead(HP, look);

    const mk = (x: number, y: number, z: number, parent: THREE.Bone | null): THREE.Bone => {
      const b = new THREE.Bone();
      b.position.set(x, y, z);
      parent?.add(b);
      this.bones.push(b);
      return b;
    };
    const root = mk(0, 0, 0, null);
    const hips = mk(0, HIP_Y, 0, root);
    const spine = mk(0, 1.05 - HIP_Y, 0, hips);
    mk(0, 1.5 - 1.05, 0, spine);
    const ax = look.female ? 0.195 : 0.215;
    const armL = mk(ax, 1.42 - 1.05, 0, spine);
    mk(0, -0.29, 0, armL);
    const armR = mk(-ax, 1.42 - 1.05, 0, spine);
    mk(0, -0.29, 0, armR);
    const legL = mk(0.095, 0.92 - HIP_Y, 0, hips);
    mk(0, -0.44, 0, legL);
    const legR = mk(-0.095, 0.92 - HIP_Y, 0, hips);
    mk(0, -0.44, 0, legR);

    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, aoMap: black1, aoMapIntensity: 0 });
    const skeleton = new THREE.Skeleton(this.bones);
    this.mesh = new THREE.SkinnedMesh(P.geometry(), this.material);
    this.mesh.add(root);
    this.mesh.bind(skeleton);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = true;
    this.group.add(this.mesh);
    if (look.splitHead) {
      this.headMesh = new THREE.SkinnedMesh(HP.geometry(), this.material);
      this.headMesh.bind(skeleton, this.mesh.bindMatrix);
      this.headMesh.layers.set(1);
      this.headMesh.frustumCulled = false;
      this.group.add(this.headMesh);
    }
    if (look.scale) this.group.scale.setScalar(look.scale);

    // предметы в руках и за спиной
    const wood = sharedMat('rifleWood', 0x3a2a1c, 0);
    const makeRifle = (): THREE.Mesh => {
      const g = new THREE.BoxGeometry(0.04, 1.05, 0.06);
      const m = new THREE.Mesh(g, wood);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.5, 5), sharedMat('gunMetal', 0x18191a, 0.6));
      barrel.position.set(0, 0.6, 0.012);
      m.add(barrel);
      return m;
    };
    if (armed) {
      this.rifleBack = makeRifle();
      this.rifleBack.position.set(-0.08, 0.2, -0.14);
      this.rifleBack.rotation.set(0.1, 0, 0.5);
      spine.add(this.rifleBack);
      this.rifleHand = makeRifle();
      this.rifleHand.position.set(0, -0.2, 0.12);
      this.rifleHand.rotation.set(1.45, 0, 0);
      this.rifleHand.visible = false;
      this.bones[B.foreR].add(this.rifleHand);
    }
    this.crate = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.26, 0.3), sharedMat('crate', 0x5a4630, 0));
    this.crate.position.set(0, 0.12, 0.3);
    this.crate.visible = false;
    spine.add(this.crate);
    this.shell = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.55, 8), sharedMat('shell', 0x3f4239, 0.5));
    this.shell.rotation.z = Math.PI / 2;
    this.shell.position.set(0, 0.14, 0.27);
    this.shell.visible = false;
    spine.add(this.shell);
    this.papers = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.2, 0.006), sharedMat('paper', 0xcfc8b0, 0));
    this.papers.position.set(0, -0.3, 0.06);
    this.papers.rotation.x = -0.6;
    this.papers.visible = false;
    this.bones[B.foreL].add(this.papers);
    this.tool = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.26, 0.03), sharedMat('gunMetal', 0x18191a, 0.6));
    this.tool.position.set(0, -0.36, 0.03);
    this.tool.visible = false;
    this.bones[B.foreR].add(this.tool);
  }

  /** Обновление позы. moveSpeed — скорость перемещения, м/с (для фазы шага). */
  update(dt: number, t: number, anim: AnimId, move: MoveAnim, moveSpeed: number, carry: CarryKind, weaponOut: boolean): void {
    if (move) this.phase += dt * (move === 'run' ? 2.6 : 3.3) * Math.max(0.6, moveSpeed) * (move === 'run' ? 1 : 1.25);
    computePose(this.target, anim, move, t, this.phase, this.seed);
    const k = Math.min(1, dt * 9);
    const p = this.pose;
    for (const key of KEYS) p[key] += (this.target[key] - p[key]) * k;
    const b = this.bones;
    b[B.root].rotation.x = p.pitch;
    b[B.hips].position.y = HIP_Y + p.hipY;
    b[B.spine].rotation.set(p.spX, p.spY, 0);
    b[B.head].rotation.set(p.hdX, p.hdY, 0);
    this.setArm(b[B.armL], p.aLx, p.aLy, p.aLz, 1);
    this.setArm(b[B.armR], p.aRx, p.aRy, p.aRz, -1);
    b[B.foreL].rotation.x = -p.eL;
    b[B.foreR].rotation.x = -p.eR;
    b[B.legL].rotation.x = -p.lLx;
    b[B.legR].rotation.x = -p.lRx;
    b[B.shinL].rotation.x = p.kL;
    b[B.shinR].rotation.x = p.kR;
    const aiming = anim === 'aim' || anim === 'kneel_aim';
    if (this.rifleBack && this.rifleHand) {
      this.rifleHand.visible = weaponOut || aiming;
      this.rifleBack.visible = !this.rifleHand.visible;
    }
    this.crate.visible = carry === 'crate' || carry === 'box' || carry === 'canister';
    this.shell.visible = carry === 'shell';
    this.papers.visible = anim === 'check_docs' || anim === 'write' || anim === 'show_papers';
    this.tool.visible = anim === 'repair' || anim === 'repair_low' || anim === 'work';
  }

  private setArm(bone: THREE.Bone, fwd: number, twist: number, abduct: number, side: number): void {
    // сначала отведение в сторону и мах вперёд, затем поворот поднятой руки вокруг вертикали
    this.ea.set(-fwd, 0, side * abduct, 'ZXY');
    this.qa.setFromEuler(this.ea);
    this.ea.set(0, side * -twist, 0);
    this.qb.setFromEuler(this.ea);
    bone.quaternion.copy(this.qb).multiply(this.qa);
    if (twist) {
      // локальный разворот предплечья внутрь (для приветствия)
      this.ea.set(0, side * -twist * 1.2, 0);
      bone.quaternion.multiply(this.qb.setFromEuler(this.ea));
    }
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.headMesh?.geometry.dispose();
    this.material.dispose();
  }
}
