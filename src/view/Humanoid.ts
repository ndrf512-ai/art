/**
 * Фигура человека: одна скелетная (skinned) сетка на персонажа — один вызов отрисовки.
 * Геометрия собирается процедурно из примитивов, жёстко привязанных к костям;
 * позы и движения задаются аналитически и плавно смешиваются.
 */
import * as THREE from 'three';
import type { AnimId, CarryKind } from '../core/types';

import { B, buildBody, buildCollar, buildHead, detailFor, HIP_Y, Parts, type Look } from './HumanModel';

export type { HeadGear, Kit, Look } from './HumanModel';

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
  /** Таз: поворот, наклон и смещение над опорной ногой. */
  hY: number;
  hR: number;
  hX: number;
}

const KEYS: (keyof Pose)[] = ['hipY', 'pitch', 'spX', 'spY', 'hdX', 'hdY', 'aLx', 'aLy', 'aLz', 'eL', 'aRx', 'aRy', 'aRz', 'eR', 'lLx', 'kL', 'lRx', 'kR', 'hY', 'hR', 'hX'];

export function zeroPose(): Pose {
  return { hipY: 0, pitch: 0, spX: 0, spY: 0, hdX: 0, hdY: 0, aLx: 0, aLy: 0, aLz: 0, eL: 0, aRx: 0, aRy: 0, aRz: 0, eR: 0, lLx: 0, kL: 0, lRx: 0, kR: 0, hY: 0, hR: 0, hX: 0 };
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
    // Цикл шага: фаза растёт на π за шаг. Левая нога впереди (касание пяткой) при ph = π/2,
    // позади (отрыв носка) при ph = −π/2; перенос ноги — пока cos(ph) > 0.
    const run = move === 'run';
    const carry = move === 'carry';
    const A = run ? 0.72 : carry ? 0.36 : 0.44;
    const sw = s(ph);
    const cw = Math.cos(ph);
    p.lLx = A * sw + (run ? 0.12 : 0.04);
    p.lRx = -A * sw + (run ? 0.12 : 0.04);
    // колено: сильный сгиб в начале переноса ноги, небольшой — при принятии веса
    const swingK = run ? 1.75 : 0.88;
    const loadK = run ? 0.45 : 0.24;
    const knee = (q: number) => swingK * Math.pow(Math.max(0, Math.cos(q + (run ? Math.PI / 4 : Math.PI / 6))), 1.4) + loadK * Math.max(0, Math.sin(2 * (q - Math.PI / 2))) * (Math.cos(q) < 0 ? 1 : 0) + 0.05;
    p.kL = knee(ph);
    p.kR = knee(ph + Math.PI);
    // корпус ниже всего в момент касания, выше — над опорной ногой
    p.hipY = -(run ? 0.045 : 0.03) * sw * sw + (run ? -0.03 : 0);
    // таз поворачивается за ногой, плечи — навстречу; таз проседает со стороны переносимой ноги
    p.hY = -(run ? 0.12 : 0.09) * sw;
    p.hR = -(run ? 0.035 : 0.05) * cw;
    p.hX = -(run ? 0.012 : 0.022) * cw;
    p.spY = (run ? 0.22 : 0.16) * sw;
    p.hdY = -(run ? 0.1 : 0.07) * sw;
    p.hdX = run ? -0.12 : -0.02;
    if (carry) {
      p.aLx = p.aRx = 0.8;
      p.eL = p.eR = 1.05;
      p.aLz = p.aRz = -0.1;
      p.spX = -0.06;
      p.spY *= 0.3;
    } else {
      const arm = run ? 0.75 : 0.34;
      p.aLx = -arm * sw;
      p.aRx = arm * sw;
      p.eL = (run ? 1.45 : 0.2) + (run ? 0.25 : 0.28) * Math.max(0, -sw);
      p.eR = (run ? 1.45 : 0.2) + (run ? 0.25 : 0.28) * Math.max(0, sw);
      p.aLz = p.aRz = run ? 0.1 : 0.06;
      p.spX = run ? 0.26 : 0.05 + 0.015 * sw * sw;
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

let cheapFigures = false;
let figureDetail: 0 | 1 | 2 = 2;
/** На слабых устройствах фигуры рисуются упрощённым материалом и с меньшей детализацией. */
export function setCheapFigures(on: boolean, detail: 0 | 1 | 2 = on ? 0 : 2): void {
  cheapFigures = on;
  figureDetail = detail;
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
  private moveW = 0;
  seed = Math.random() * 10;
  private qa = new THREE.Quaternion();
  private qb = new THREE.Quaternion();
  private ea = new THREE.Euler();

  constructor(look: Look, black1: THREE.Texture, armed: boolean) {
    const D = detailFor(look.splitHead ? Math.max(1, figureDetail) as 1 | 2 : figureDetail);
    const P = new Parts();
    buildBody(P, look, D);
    const HP = look.splitHead ? new Parts() : P;
    buildCollar(HP, look, D);
    buildHead(HP, look, D);

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

    this.material = (cheapFigures
      ? new THREE.MeshLambertMaterial({ vertexColors: true, aoMap: black1, aoMapIntensity: 0 })
      : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, aoMap: black1, aoMapIntensity: 0 })) as THREE.MeshStandardMaterial;
    // свет ламп действует как освещение, а не как свечение: тёмная ткань остаётся тёмной;
    // шероховатость и металличность заданы по вершинам — кожа плаща, сапоги и пуговицы блестят
    const pbr = !cheapFigures;
    this.material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float rough;\nattribute float metal;\nvarying float vRough;\nvarying float vMetal;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRough = rough;\nvMetal = metal;');
      let fs = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vRough;\nvarying float vMetal;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= diffuseColor.rgb;');
      if (pbr) {
        fs = fs.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = vRough;').replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = vMetal;');
      }
      shader.fragmentShader = fs;
    };
    this.material.customProgramCacheKey = () => (pbr ? 'figure-pbr' : 'figure-lit');
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
  update(dt: number, t: number, anim: AnimId, move: MoveAnim, moveSpeed: number, carry: CarryKind, weaponOut: boolean, extPhase?: number): void {
    // фаза шага от пройденного пути: ноги не скользят по земле
    if (extPhase !== undefined) this.phase = extPhase;
    else if (move) this.phase += (dt * Math.max(0.4, moveSpeed) * Math.PI) / (move === 'run' ? 1.2 : move === 'carry' ? 0.6 : 0.72);
    computePose(this.target, anim, move, t, this.phase, this.seed);
    // походка — без сглаживания (иначе шаг «плывёт»), смена позы — плавно
    this.moveW += ((move ? 1 : 0) - this.moveW) * Math.min(1, dt * 7);
    const k = Math.min(1, dt * (move ? 9 + 26 * this.moveW : 9));
    const p = this.pose;
    for (const key of KEYS) p[key] += (this.target[key] - p[key]) * k;
    const b = this.bones;
    b[B.root].rotation.x = p.pitch;
    b[B.hips].position.y = HIP_Y + p.hipY;
    b[B.hips].position.x = p.hX;
    b[B.hips].rotation.set(0, p.hY, p.hR);
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
      // сидя, лёжа и во сне винтовка стоит в пирамиде, а не торчит из-за спины
      const seated = !move && (anim.startsWith('sit') || anim === 'sleep' || anim === 'lie' || anim === 'cover' || anim === 'repair_low');
      this.rifleBack.visible = !this.rifleHand.visible && !seated;
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
