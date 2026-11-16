/**
 * Отображение людей: фигуры NPC, тело командира от первого лица и зеркала.
 * Симуляция хранит только координаты и название анимации — всё остальное здесь.
 */
import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { damp, dist, wrapAngle } from '../core/math';
import type { AnimId, NpcState } from '../core/types';
import type { Gender, Sim } from '../sim/Sim';
import { Figure, type Look, type MoveAnim } from './Humanoid';
import { lightUniforms } from './Materials';
import type { QualitySettings } from './Quality';
import type { WorldView } from './WorldBuilder';

const SKINS = [0xc9a487, 0xbf9a7c, 0xd3ae92, 0xb89074, 0xcfa98b];
const HAIRS = [0x2a211a, 0x3b2c1e, 0x4a3a28, 0x1c1814, 0x6b5a3c, 0x55504a];
const FELDGRAU = [0x596352, 0x56604f, 0x5d6657, 0x525c4c];

function hashId(id: string): number {
  let h = 7;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Форма и снаряжение по должности. */
export function lookFor(n: NpcState): Look {
  const h = hashId(n.id + n.last);
  const L: Look = {
    tunic: FELDGRAU[h % FELDGRAU.length],
    trousers: 0x565b52,
    boots: 0x191714,
    belt: 0x231b13,
    skin: SKINS[(h >> 3) % SKINS.length],
    hair: HAIRS[(h >> 5) % HAIRS.length],
    head: 'sidecap',
    headColor: FELDGRAU[h % FELDGRAU.length],
    coat: false,
    scale: 0.96 + ((h >> 7) % 9) * 0.01,
  };
  if (n.rank >= 8) {
    L.officer = true;
    L.head = 'cap';
    L.headColor = 0x2e3a30;
    L.tunic = 0x5c6558;
    L.trousers = 0x62655e;
    L.coat = n.role === 'security_chief' || n.role === 'ci_officer' || n.role === 'inspector' || n.role === 'courier';
  }
  switch (n.role) {
    case 'guard':
    case 'patrol_leader':
    case 'guard_sgt':
      L.head = n.role === 'guard_sgt' ? 'sidecap' : 'helmet';
      L.headColor = 0x39412f;
      L.coat = n.role !== 'guard_sgt';
      break;
    case 'gun_cmd':
    case 'gunner':
    case 'loader':
    case 'assistant':
    case 'bearer':
      L.head = n.role === 'gun_cmd' ? 'sidecap' : 'helmet';
      L.headColor = n.role === 'gun_cmd' ? L.tunic : 0x3b4332;
      break;
    case 'mech_chief':
    case 'mechanic':
    case 'electrician':
    case 'driver':
      L.tunic = 0x3a3f46;
      L.trousers = 0x363b42;
      L.headColor = 0x33383e;
      L.belt = 0x2c2f33;
      break;
    case 'cook':
    case 'cook_helper':
      L.tunic = 0xa9a698;
      L.apron = true;
      L.head = 'none';
      break;
    case 'medic':
      L.armband = true;
      break;
    case 'doctor':
      L.armband = true;
      break;
    case 'radio_op':
      L.head = 'headphones';
      break;
    case 'engineer':
    case 'technician':
      L.tunic = n.role === 'engineer' ? 0x5c6558 : 0x6a6a5e;
      break;
    case 'visitor':
      L.tunic = 0x4a3c2c;
      L.trousers = 0x3a342c;
      L.head = 'flatcap';
      L.headColor = 0x3a3128;
      L.coat = true;
      L.belt = 0x4a3c2c;
      break;
    case 'intruder':
      L.tunic = 0x45462f;
      L.trousers = 0x3c3d2a;
      L.head = 'helmet';
      L.headColor = 0x30321f;
      L.belt = 0x2a2a1c;
      break;
  }
  return L;
}

/** Внешность командира. Героиня носит длинный чёрный плащ. */
export function playerLook(gender: Gender): Look {
  if (gender === 'f') {
    return { tunic: 0x1d1e21, trousers: 0x18191b, boots: 0x0d0d0d, belt: 0x0b0b0b, skin: 0xdcb9a0, hair: 0xc3a465, head: 'cap', headColor: 0x17181a, coat: true, female: true, officer: true, splitHead: true, scale: 0.97 };
  }
  return { tunic: 0x5c6558, trousers: 0x62655e, boots: 0x161412, belt: 0x231b13, skin: 0xc9a487, hair: 0x3b2c1e, head: 'cap', headColor: 0x2e3a30, coat: true, officer: true, splitHead: true, scale: 1.0 };
}

interface Entry {
  fig: Figure;
  x: number;
  z: number;
  y: number;
  yaw: number;
  lie: number;
  px: number;
  pz: number;
  lightT: number;
  visT: number;
  seen: boolean;
}

const LIE = new Set<AnimId>(['sleep', 'lie']);

export class CharacterView {
  private entries = new Map<string, Entry>();
  private playerFig: Figure | null = null;
  private playerGender: Gender | null = null;
  private mirrors: { obj: THREE.Object3D; x: number; z: number }[] = [];
  private pPrev = { x: 0, z: 0 };
  private pSpeed = 0;
  time = 0;
  drawn = 0;

  constructor(
    private sim: Sim,
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    private world: WorldView,
    private black1: THREE.Texture,
    private quality: QualitySettings,
  ) {
    this.buildMirrors();
  }

  private buildMirrors(): void {
    for (const p of this.sim.layout.props) {
      if (p.type !== 'mirror') continue;
      const swap = Math.abs(Math.sin(p.yaw)) > 0.5;
      const w = swap ? p.d : p.w;
      const geo = new THREE.PlaneGeometry(w, p.h);
      let obj: THREE.Object3D;
      if (this.quality.level === 'low') {
        obj = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x4a5250, roughness: 0.15, metalness: 0.9 }));
      } else {
        const res = this.quality.level === 'high' ? 768 : 512;
        const r = new Reflector(geo, { textureWidth: Math.round((res * w) / p.h), textureHeight: res, color: 0x9aa3a0, clipBias: 0.003, multisample: 0 });
        (r as any).getReflectionCamera?.(this.camera).layers.enable(1);
        obj = r;
      }
      obj.position.set(p.x + Math.sin(p.yaw) * 0.02, 0.25 + p.h / 2, p.z + Math.cos(p.yaw) * 0.02);
      obj.rotation.y = p.yaw;
      this.scene.add(obj);
      this.mirrors.push({ obj, x: p.x, z: p.z });
    }
  }

  private ensurePlayer(): Figure {
    const g = this.sim.player.gender;
    if (!this.playerFig || this.playerGender !== g) {
      if (this.playerFig) {
        this.scene.remove(this.playerFig.group);
        this.playerFig.dispose();
      }
      this.playerFig = new Figure(playerLook(g), this.black1, false);
      this.playerFig.mesh.frustumCulled = false;
      this.playerGender = g;
      this.scene.add(this.playerFig.group);
    }
    return this.playerFig;
  }

  private applyLight(mat: THREE.MeshStandardMaterial, x: number, z: number): void {
    const [li, lo] = this.world.sampleLight(x, z);
    const l = Math.min(1.6, li * lightUniforms.uIndoor.value + lo * lightUniforms.uOutdoor.value);
    const c = lightUniforms.uLampColor.value;
    mat.emissive.setRGB(c.r * l * 0.9, c.g * l * 0.9, c.b * l * 0.9);
    mat.aoMapIntensity = this.sim.grid.indoorAt(x, z) ? 0.9 : 0;
  }

  update(dt: number): void {
    const sim = this.sim;
    this.time += dt;
    const cam = this.camera.position;
    const alive = new Set<string>();
    let drawn = 0;
    for (const n of sim.npcs.list) {
      if (n.status === 'away' || n.status === 'leave' || n.flags.buried) continue;
      alive.add(n.id);
      let e = this.entries.get(n.id);
      if (!e) {
        const fig = new Figure(lookFor(n), this.black1, n.armed);
        this.scene.add(fig.group);
        e = { fig, x: n.x, z: n.z, y: 0, yaw: n.yaw, lie: 0, px: n.x, pz: n.z, lightT: Math.random() * 0.3, visT: Math.random() * 0.3, seen: true };
        this.entries.set(n.id, e);
      }
      // цель позиции: якорь (мебель, вышка) либо точка на земле
      const a = n.anchor && !n.moving ? n.anchor : null;
      const tx = a ? a.x : n.x;
      const tz = a ? a.z : n.z;
      const ty = a ? a.y : 0;
      const tyaw = a ? a.yaw : n.yaw;
      const far = dist(e.x, e.z, tx, tz) > 6;
      e.x = far ? tx : damp(e.x, tx, a ? 6 : 16, dt);
      e.z = far ? tz : damp(e.z, tz, a ? 6 : 16, dt);
      e.y = damp(e.y, ty, 5, dt);
      e.yaw += wrapAngle(tyaw - e.yaw) * Math.min(1, dt * 10);
      const d = dist(cam.x, cam.z, e.x, e.z);
      // видимость: дальность и стены
      e.visT -= dt;
      if (e.visT <= 0) {
        e.visT = 0.25 + Math.random() * 0.1;
        e.seen = d < 110 && (d < 6 || sim.grid.los(cam.x, cam.z, e.x, e.z) || (Math.abs(cam.y - 1.7) > 3 && d < 80));
      }
      e.fig.group.visible = e.seen;
      if (!e.seen) continue;
      drawn++;
      const anim: AnimId = n.status === 'dead' ? 'lie' : n.gesture ? n.gesture.anim : n.anim;
      const moving = n.moving && !n.gesture && n.status !== 'dead';
      const move: MoveAnim = moving ? (n.carry ? 'carry' : n.run ? 'run' : 'walk') : null;
      const lying = !moving && LIE.has(anim);
      e.lie = damp(e.lie, lying ? 1 : 0, 6, dt);
      const speed = Math.hypot(n.x - e.px, n.z - e.pz) / Math.max(dt, 1e-3);
      e.px = n.x;
      e.pz = n.z;
      const fx = Math.sin(e.yaw);
      const fz = Math.cos(e.yaw);
      e.fig.group.position.set(e.x + fx * 0.86 * e.lie, e.y + 0.11 * e.lie, e.z + fz * 0.86 * e.lie);
      e.fig.group.rotation.y = e.yaw;
      e.fig.update(dt, this.time, anim, move, Math.min(speed, 5), n.carry, n.weaponOut);
      e.fig.mesh.castShadow = d < this.quality.npcShadowDist;
      e.lightT -= dt;
      if (e.lightT <= 0) {
        e.lightT = 0.3;
        this.applyLight(e.fig.material, e.x, e.z);
      }
    }
    for (const [id, e] of this.entries) {
      if (alive.has(id)) continue;
      this.scene.remove(e.fig.group);
      e.fig.dispose();
      this.entries.delete(id);
    }
    this.drawn = drawn;

    // тело командира: видно при взгляде вниз, голова — только в зеркале
    const p = sim.player;
    const fig = this.ensurePlayer();
    const sp = Math.hypot(p.x - this.pPrev.x, p.z - this.pPrev.z) / Math.max(dt, 1e-3);
    this.pSpeed = damp(this.pSpeed, sp, 10, dt);
    this.pPrev.x = p.x;
    this.pPrev.z = p.z;
    const fx = Math.sin(p.yaw);
    const fz = Math.cos(p.yaw);
    fig.group.position.set(p.x - fx * 0.13, 0, p.z - fz * 0.13);
    fig.group.rotation.y = p.yaw;
    const move: MoveAnim = this.pSpeed > 0.4 ? (this.pSpeed > 4.4 ? 'run' : 'walk') : null;
    fig.update(dt, this.time, 'idle', move, this.pSpeed * 0.5, null, false);
    this.applyLight(fig.material, p.x, p.z);

    // зеркала рисуют отражение только когда командир рядом и видит их
    for (const m of this.mirrors) {
      m.obj.visible = dist(p.x, p.z, m.x, m.z) < 9 && sim.grid.los(p.x, p.z, m.x + Math.sin(m.obj.rotation.y) * 0.6, m.z + Math.cos(m.obj.rotation.y) * 0.6);
    }
  }

  /** Сброс при загрузке сохранения. */
  clear(): void {
    for (const e of this.entries.values()) {
      this.scene.remove(e.fig.group);
      e.fig.dispose();
    }
    this.entries.clear();
  }
}
