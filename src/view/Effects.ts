/**
 * Эффекты: дульное пламя и пороховой дым, разрывы, пожары, трассеры, выхлоп
 * генератора, дождь и снег. Частицы — пул спрайтов без выделения памяти в кадре.
 */
import * as THREE from 'three';
import { smokeTex, softDot } from './Textures';

interface Particle {
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  life: number;
  max: number;
  vx: number;
  vy: number;
  vz: number;
  s0: number;
  s1: number;
  a: number;
  drag: number;
  grav: number;
}

interface Fire {
  id: string;
  x: number;
  z: number;
  light: THREE.PointLight;
  t: number;
}

export class Effects {
  private pool: Particle[] = [];
  private live: Particle[] = [];
  private smokeMap: THREE.Texture;
  private glowMap: THREE.Texture;
  private flashes: { light: THREE.PointLight; t: number; max: number; i: number }[] = [];
  private fires: Fire[] = [];
  private tracers: { line: THREE.Line; t: number }[] = [];
  private craters: THREE.Mesh[] = [];
  private craterI = 0;
  private rain: THREE.LineSegments;
  private snow: THREE.Points;
  private rainPos: Float32Array;
  private snowPos: Float32Array;
  private exhaustT = 0;
  private readonly RAIN = 900;
  private readonly SNOW = 700;
  wind = { x: 1, z: 0 };

  constructor(
    private scene: THREE.Scene,
    count: number,
  ) {
    this.smokeMap = smokeTex(3);
    this.glowMap = softDot('rgba(255,240,200,1)', 'rgba(255,170,70,0.35)');
    for (let i = 0; i < count; i++) {
      const mat = new THREE.SpriteMaterial({ map: this.smokeMap, transparent: true, depthWrite: false, opacity: 0 });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      scene.add(sprite);
      this.pool.push({ sprite, mat, life: 0, max: 1, vx: 0, vy: 0, vz: 0, s0: 1, s1: 1, a: 1, drag: 0, grav: 0 });
    }
    for (let i = 0; i < 3; i++) {
      const light = new THREE.PointLight(0xffc070, 0, 60, 1.6);
      scene.add(light);
      this.flashes.push({ light, t: 0, max: 0, i: 0 });
    }
    const craterGeo = new THREE.CircleGeometry(1, 14);
    craterGeo.rotateX(-Math.PI / 2);
    const craterMat = new THREE.MeshBasicMaterial({ color: 0x0c0a08, transparent: true, opacity: 0.72, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(craterGeo, craterMat);
      m.visible = false;
      scene.add(m);
      this.craters.push(m);
    }
    // дождь: отрезки, падающие в объёме вокруг камеры
    this.rainPos = new Float32Array(this.RAIN * 6);
    for (let i = 0; i < this.RAIN; i++) this.resetDrop(i, true);
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3));
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0x9aa4ae, transparent: true, opacity: 0.35, depthWrite: false }));
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    scene.add(this.rain);
    this.snowPos = new Float32Array(this.SNOW * 3);
    for (let i = 0; i < this.SNOW; i++) {
      this.snowPos[i * 3] = (Math.random() - 0.5) * 44;
      this.snowPos[i * 3 + 1] = Math.random() * 16;
      this.snowPos[i * 3 + 2] = (Math.random() - 0.5) * 44;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(this.snowPos, 3));
    this.snow = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xdfe4e8, size: 0.09, transparent: true, opacity: 0.8, depthWrite: false }));
    this.snow.frustumCulled = false;
    this.snow.visible = false;
    scene.add(this.snow);
  }

  private resetDrop(i: number, any: boolean): void {
    const x = (Math.random() - 0.5) * 44;
    const z = (Math.random() - 0.5) * 44;
    const y = any ? Math.random() * 16 : 16;
    const p = this.rainPos;
    p[i * 6] = x;
    p[i * 6 + 1] = y;
    p[i * 6 + 2] = z;
    p[i * 6 + 3] = x;
    p[i * 6 + 4] = y - 0.7;
    p[i * 6 + 5] = z;
  }

  private emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, s0: number, s1: number, color: number, a: number, additive = false, drag = 0.8, grav = 0): void {
    const p = this.pool.pop() ?? this.live.shift();
    if (!p) return;
    p.life = 0;
    p.max = life;
    p.vx = vx;
    p.vy = vy;
    p.vz = vz;
    p.s0 = s0;
    p.s1 = s1;
    p.a = a;
    p.drag = drag;
    p.grav = grav;
    p.mat.map = additive ? this.glowMap : this.smokeMap;
    p.mat.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    p.mat.color.setHex(color);
    p.mat.rotation = Math.random() * 6.28;
    p.mat.opacity = 0;
    p.sprite.position.set(x, y, z);
    p.sprite.scale.setScalar(s0);
    p.sprite.visible = true;
    this.live.push(p);
  }

  private flash(x: number, y: number, z: number, intensity: number, dur: number, color = 0xffc070): void {
    const f = this.flashes.reduce((a, b) => (a.t <= b.t ? a : b));
    f.light.position.set(x, y, z);
    f.light.color.setHex(color);
    f.t = dur;
    f.max = dur;
    f.i = intensity;
  }

  /** Выстрел орудия. */
  muzzle(pos: THREE.Vector3, dx: number, dy: number, dz: number, big: boolean): void {
    const k = big ? 2.2 : 1;
    this.flash(pos.x, pos.y, pos.z, 900 * k, 0.16);
    this.emit(pos.x + dx, pos.y + dy, pos.z + dz, 0, 0, 0, 0.14, 4 * k, 9 * k, 0xffd9a0, 1, true);
    for (let i = 0; i < 12; i++) {
      const sp = 6 + Math.random() * 16 * k;
      const j = 0.35;
      this.emit(pos.x, pos.y, pos.z, (dx + (Math.random() - 0.5) * j) * sp, (dy + (Math.random() - 0.5) * j) * sp + 0.5, (dz + (Math.random() - 0.5) * j) * sp, 3.5 + Math.random() * 3, 1.2 * k, 7 * k, 0x8d8a82, 0.55, false, 2.4);
    }
    // пыль у земли
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * 6.28;
      this.emit(pos.x - dx * 4 + Math.cos(a) * 2, 0.4, pos.z - dz * 4 + Math.sin(a) * 2, Math.cos(a) * 5 * k, 0.8, Math.sin(a) * 5 * k, 3 + Math.random() * 2, 1.5, 6 * k, 0x6e6252, 0.4, false, 2.2);
    }
  }

  explosion(x: number, z: number, size: number): void {
    this.flash(x, 2, z, 1200 * size, 0.22, 0xffb060);
    this.emit(x, 1.2, z, 0, 2, 0, 0.2, 5 * size, 11 * size, 0xffcf90, 1, true);
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * 6.28;
      const sp = 3 + Math.random() * 9 * size;
      this.emit(x, 0.5, z, Math.cos(a) * sp, 6 + Math.random() * 12 * size, Math.sin(a) * sp, 2.4 + Math.random() * 1.8, 1.2 * size, 5 * size, 0x2a2420, 0.85, false, 1.2, 9);
    }
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * 6.28;
      this.emit(x + Math.cos(a) * 2, 1.5, z + Math.sin(a) * 2, Math.cos(a) * 1.5, 2 + Math.random() * 2, Math.sin(a) * 1.5, 6 + Math.random() * 4, 3 * size, 10 * size, 0x4a4640, 0.6, false, 0.6);
    }
    const c = this.craters[this.craterI++ % this.craters.length];
    c.position.set(x, 0.03, z);
    c.scale.setScalar(2.2 * size + Math.random());
    c.visible = z > 59.5;
  }

  tracer(x: number, z: number, tx: number, tz: number): void {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, 1.4, z), new THREE.Vector3(tx, 1.2, tz)]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.7 }));
    this.scene.add(line);
    this.tracers.push({ line, t: 0.07 });
    this.flash(x, 1.5, z, 40, 0.06);
  }

  setFire(id: string, x: number, z: number, on: boolean): void {
    const i = this.fires.findIndex((f) => f.id === id);
    if (!on) {
      if (i >= 0) {
        this.scene.remove(this.fires[i].light);
        this.fires.splice(i, 1);
      }
      return;
    }
    if (i >= 0) return;
    const light = new THREE.PointLight(0xff8a3a, 60, 22, 1.5);
    light.position.set(x, 1.6, z);
    this.scene.add(light);
    this.fires.push({ id, x, z, light, t: 0 });
  }

  clearFires(): void {
    for (const f of this.fires) this.scene.remove(f.light);
    this.fires.length = 0;
  }

  update(dt: number, cam: THREE.Vector3, env: { rain: number; snow: number; exhaust: THREE.Vector3 | null; outdoorFocus: THREE.Vector3 }): void {
    const wx = this.wind.x;
    const wz = this.wind.z;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i];
      p.life += dt;
      const t = p.life / p.max;
      if (t >= 1) {
        p.sprite.visible = false;
        this.live.splice(i, 1);
        this.pool.push(p);
        continue;
      }
      const d = Math.exp(-p.drag * dt);
      p.vx = p.vx * d + wx * dt * 0.6;
      p.vz = p.vz * d + wz * dt * 0.6;
      p.vy = p.vy * d - p.grav * dt;
      const s = p.sprite;
      s.position.x += p.vx * dt;
      s.position.y = Math.max(0.1, s.position.y + p.vy * dt);
      s.position.z += p.vz * dt;
      s.scale.setScalar(p.s0 + (p.s1 - p.s0) * (1 - (1 - t) * (1 - t)));
      p.mat.opacity = p.a * Math.min(1, t * 8) * (1 - t);
    }
    for (const f of this.flashes) {
      if (f.t > 0) {
        f.t -= dt;
        f.light.intensity = f.i * Math.max(0, f.t / f.max);
      } else f.light.intensity = 0;
    }
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i];
      tr.t -= dt;
      if (tr.t <= 0) {
        this.scene.remove(tr.line);
        tr.line.geometry.dispose();
        (tr.line.material as THREE.Material).dispose();
        this.tracers.splice(i, 1);
      }
    }
    for (const f of this.fires) {
      f.t -= dt;
      f.light.intensity = 45 + Math.random() * 35;
      if (f.t <= 0) {
        f.t = 0.07;
        this.emit(f.x + (Math.random() - 0.5) * 1.6, 0.5, f.z + (Math.random() - 0.5) * 1.6, 0, 2.5 + Math.random() * 2, 0, 0.7, 1.4, 0.5, 0xff9a40, 0.9, true, 0.2);
        if (Math.random() < 0.4) this.emit(f.x, 2, f.z, 0, 2.2, 0, 5, 1.5, 6, 0x1c1a18, 0.6, false, 0.3);
      }
    }
    // выхлоп работающего генератора над фасадом
    if (env.exhaust) {
      this.exhaustT -= dt;
      if (this.exhaustT <= 0) {
        this.exhaustT = 0.35;
        this.emit(env.exhaust.x, env.exhaust.y, env.exhaust.z, 0, 1.6, 0.3, 5, 0.5, 3.2, 0x2e2c2a, 0.3, false, 0.4);
      }
    }
    // осадки привязаны к точке под открытым небом
    const f = env.outdoorFocus;
    this.rain.visible = env.rain > 0.08;
    if (this.rain.visible) {
      (this.rain.material as THREE.LineBasicMaterial).opacity = 0.12 + env.rain * 0.3;
      const p = this.rainPos;
      const fall = 22 * dt;
      const n = Math.floor(this.RAIN * Math.min(1, env.rain * 1.3));
      for (let i = 0; i < this.RAIN; i++) {
        if (i >= n) {
          p[i * 6 + 1] = p[i * 6 + 4] = -50;
          continue;
        }
        p[i * 6 + 1] -= fall;
        p[i * 6 + 4] -= fall;
        p[i * 6] += wx * dt * 0.8;
        p[i * 6 + 3] = p[i * 6] + wx * 0.03;
        if (p[i * 6 + 4] < 0) this.resetDrop(i, false);
      }
      this.rain.position.set(f.x, 0, f.z);
      (this.rain.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }
    this.snow.visible = env.snow > 0.08;
    if (this.snow.visible) {
      const p = this.snowPos;
      for (let i = 0; i < this.SNOW; i++) {
        p[i * 3 + 1] -= dt * 1.6;
        p[i * 3] += (wx * 0.5 + Math.sin(p[i * 3 + 1] * 1.7 + i) * 0.3) * dt;
        if (p[i * 3 + 1] < 0) {
          p[i * 3 + 1] = 16;
          p[i * 3] = (Math.random() - 0.5) * 44;
        }
      }
      this.snow.position.set(f.x, 0, f.z);
      (this.snow.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }
    void cam;
  }
}
