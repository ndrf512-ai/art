/**
 * Процедурные текстуры: бетон со следами опалубки и потёками, грязь, ржавый металл,
 * мешковина, доски. Внешних файлов нет — всё генерируется при запуске.
 */
import * as THREE from 'three';
import { hash2 } from '../core/Rng';

export interface TexSet {
  map: THREE.Texture;
  normalMap?: THREE.Texture;
}

function wrap(v: number, p: number): number {
  return ((v % p) + p) % p;
}

/** Бесшовный value-noise с периодом p. */
function tnoise(x: number, y: number, p: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(wrap(xi, p), wrap(yi, p), seed);
  const b = hash2(wrap(xi + 1, p), wrap(yi, p), seed);
  const c = hash2(wrap(xi, p), wrap(yi + 1, p), seed);
  const d = hash2(wrap(xi + 1, p), wrap(yi + 1, p), seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function tfbm(u: number, v: number, period: number, octaves: number, seed: number): number {
  let amp = 0.5;
  let sum = 0;
  let norm = 0;
  let p = period;
  for (let i = 0; i < octaves; i++) {
    sum += amp * tnoise(u * p, v * p, p, seed + i * 31);
    norm += amp;
    amp *= 0.5;
    p *= 2;
  }
  return sum / norm;
}

type PixelFn = (u: number, v: number, x: number, y: number) => [number, number, number, number];

/** Строит карту цвета и (по высоте) карту нормалей. PixelFn возвращает [r, g, b, height]. */
function build(size: number, fn: PixelFn, normalStrength = 0, repeat = 1): TexSet {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b, h] = fn(x / size, y / size, x, y);
      const i = (y * size + x) * 4;
      img.data[i] = Math.max(0, Math.min(255, r * 255));
      img.data[i + 1] = Math.max(0, Math.min(255, g * 255));
      img.data[i + 2] = Math.max(0, Math.min(255, b * 255));
      img.data[i + 3] = 255;
      height[y * size + x] = h;
    }
  }
  ctx.putImageData(img, 0, 0);
  const map = new THREE.CanvasTexture(canvas);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  map.repeat.set(repeat, repeat);
  const set: TexSet = { map };
  if (normalStrength > 0) {
    const nc = document.createElement('canvas');
    nc.width = nc.height = size;
    const nctx = nc.getContext('2d')!;
    const nimg = nctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const hl = height[y * size + wrap(x - 1, size)];
        const hr = height[y * size + wrap(x + 1, size)];
        const hu = height[wrap(y - 1, size) * size + x];
        const hd = height[wrap(y + 1, size) * size + x];
        let nx = (hl - hr) * normalStrength;
        let ny = (hu - hd) * normalStrength;
        const nz = 1;
        const len = Math.hypot(nx, ny, nz);
        nx /= len;
        ny /= len;
        const i = (y * size + x) * 4;
        nimg.data[i] = (nx * 0.5 + 0.5) * 255;
        nimg.data[i + 1] = (-ny * 0.5 + 0.5) * 255;
        nimg.data[i + 2] = (nz / len) * 0.5 * 255 + 127;
        nimg.data[i + 3] = 255;
      }
    }
    nctx.putImageData(nimg, 0, 0);
    const normalMap = new THREE.CanvasTexture(nc);
    normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
    normalMap.anisotropy = 4;
    normalMap.repeat.set(repeat, repeat);
    set.normalMap = normalMap;
  }
  return set;
}

/** Бетон: пятна, зерно, швы опалубки и потёки сверху. */
export function concreteTex(base: [number, number, number], seed: number, opts: { formwork?: boolean; drips?: boolean; dirt?: number } = {}): TexSet {
  const size = 512;
  const drips: { x: number; w: number; len: number; a: number }[] = [];
  if (opts.drips) {
    for (let i = 0; i < 9; i++) {
      drips.push({ x: hash2(i, 3, seed), w: 0.004 + hash2(i, 5, seed) * 0.02, len: 0.25 + hash2(i, 7, seed) * 0.7, a: 0.1 + hash2(i, 9, seed) * 0.22 });
    }
  }
  const dirt = opts.dirt ?? 0;
  return build(
    size,
    (u, v) => {
      const blot = tfbm(u, v, 3, 5, seed);
      const grain = tfbm(u, v, 48, 3, seed + 7);
      const pits = tnoise(u * 128, v * 128, 128, seed + 3);
      let l = 0.78 + 0.34 * (blot - 0.5) + 0.2 * (grain - 0.5);
      let h = grain * 0.6 + blot * 0.4;
      if (pits > 0.93) {
        l -= 0.18;
        h -= 0.5;
      }
      if (opts.formwork) {
        const fv = (v * 6) % 1;
        const edge = Math.min(fv, 1 - fv);
        if (edge < 0.018) {
          l -= 0.16 * (1 - edge / 0.018);
          h -= 0.6 * (1 - edge / 0.018);
        }
        const fu = (u * 2 + Math.floor(v * 6) * 0.37) % 1;
        const eu = Math.min(fu, 1 - fu);
        if (eu < 0.006) {
          l -= 0.1;
          h -= 0.4;
        }
      }
      for (const d of drips) {
        let dx = Math.abs(u - d.x);
        dx = Math.min(dx, 1 - dx);
        if (dx < d.w && v < d.len) {
          const k = (1 - dx / d.w) * (1 - v / d.len);
          l -= d.a * k;
        }
      }
      const grime = dirt > 0 ? dirt * Math.max(0, tfbm(u, v, 2, 4, seed + 99) - 0.45) * 2.2 : 0;
      const r = base[0] * l - grime * 0.12;
      const g = base[1] * l - grime * 0.13;
      const b = base[2] * l - grime * 0.15;
      return [r, g, b, h];
    },
    2.2,
  );
}

/** Утоптанная земля двора. */
export function dirtTex(seed: number): TexSet {
  return build(
    512,
    (u, v) => {
      const a = tfbm(u, v, 4, 5, seed);
      const b = tfbm(u, v, 40, 3, seed + 5);
      const stones = tnoise(u * 96, v * 96, 96, seed + 11);
      let l = 0.72 + 0.4 * (a - 0.5) + 0.28 * (b - 0.5);
      let h = a * 0.5 + b * 0.5;
      if (stones > 0.9) {
        l += 0.22;
        h += 0.6;
      }
      return [l, l, l, h];
    },
    2.6,
  );
}

/** Доски. */
export function woodTex(base: [number, number, number], seed: number): TexSet {
  return build(
    256,
    (u, v) => {
      const plank = Math.floor(u * 6);
      const pu = (u * 6) % 1;
      const tone = 0.82 + 0.28 * hash2(plank, 1, seed);
      const grain = tnoise(u * 6 * 3 + plank * 7.3, v * 48, 48, seed + plank);
      const fine = tnoise(u * 180, v * 14, 180, seed + 3);
      let l = tone * (0.86 + 0.2 * (grain - 0.5) + 0.12 * (fine - 0.5));
      let h = 0.5 + grain * 0.3;
      const edge = Math.min(pu, 1 - pu);
      if (edge < 0.035) {
        l *= 0.55;
        h = 0;
      }
      return [base[0] * l, base[1] * l, base[2] * l, h];
    },
    1.6,
  );
}

/** Окрашенный металл с потёртостями и ржавчиной. */
export function metalTex(base: [number, number, number], seed: number, rust = 0.35): TexSet {
  return build(
    256,
    (u, v) => {
      const a = tfbm(u, v, 4, 4, seed);
      const s = tnoise(u * 90, v * 12, 90, seed + 2);
      const r = tfbm(u, v, 6, 5, seed + 40);
      let l = 0.88 + 0.2 * (a - 0.5) + (s > 0.86 ? 0.14 : 0);
      let cr = base[0] * l;
      let cg = base[1] * l;
      let cb = base[2] * l;
      const rk = Math.max(0, (r - (1 - rust * 0.9)) * 5);
      if (rk > 0) {
        const k = Math.min(1, rk);
        cr = cr * (1 - k) + 0.36 * k * (0.8 + a * 0.4);
        cg = cg * (1 - k) + 0.19 * k * (0.8 + a * 0.4);
        cb = cb * (1 - k) + 0.1 * k;
      }
      return [cr, cg, cb, a * 0.5 + (rk > 0 ? 0.3 : 0)];
    },
    1.2,
  );
}

/** Кладка мешков с песком. */
export function sandbagTex(seed: number): TexSet {
  return build(
    256,
    (u, v) => {
      const rows = 4;
      const row = Math.floor(v * rows);
      const cu = (u * 3 + (row % 2) * 0.5) % 1;
      const cv = (v * rows) % 1;
      const ex = Math.min(cu, 1 - cu) * 2;
      const ey = Math.min(cv, 1 - cv) * 2;
      const bulge = Math.pow(Math.min(1, ex * 2.4), 0.5) * Math.pow(Math.min(1, ey * 2.2), 0.5);
      const weave = (Math.sin(u * 420) * Math.sin(v * 420) + 1) * 0.5;
      const n = tfbm(u, v, 8, 3, seed);
      const l = (0.45 + 0.55 * bulge) * (0.85 + 0.12 * weave + 0.2 * (n - 0.5));
      return [0.56 * l, 0.5 * l, 0.38 * l, bulge];
    },
    3.0,
  );
}

/** Ткань/брезент. */
export function canvasTex(base: [number, number, number], seed: number): TexSet {
  return build(
    128,
    (u, v) => {
      const weave = (Math.sin(u * 300) * Math.sin(v * 300) + 1) * 0.5;
      const n = tfbm(u, v, 4, 4, seed);
      const l = 0.82 + 0.1 * weave + 0.3 * (n - 0.5);
      return [base[0] * l, base[1] * l, base[2] * l, weave];
    },
    0.8,
  );
}

/** Маскировочная сеть: текстура с прозрачностью. */
export function camoNetTex(seed: number): THREE.Texture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const patch = tfbm(u, v, 6, 4, seed);
      const mesh = Math.min(Math.abs(((u * 24) % 1) - 0.5), Math.abs(((v * 24) % 1) - 0.5)) < 0.06;
      const tone = tfbm(u, v, 3, 3, seed + 9);
      const i = (y * size + x) * 4;
      const solid = patch > 0.5;
      const c = tone > 0.5 ? [58, 66, 44] : [76, 70, 48];
      img.data[i] = c[0] * (solid ? 1 : 0.6);
      img.data[i + 1] = c[1] * (solid ? 1 : 0.6);
      img.data[i + 2] = c[2] * (solid ? 1 : 0.6);
      img.data[i + 3] = solid || mesh ? 255 : 0;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Мягкое пятно для частиц дыма и бликов. */
export function softDot(inner: string, outer: string): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.45, outer);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Клубящийся дым: неровное мягкое пятно. */
export function smokeTex(seed: number): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const d = Math.hypot(u - 0.5, v - 0.5) * 2;
      const n = tfbm(u, v, 4, 4, seed);
      const a = Math.max(0, 1 - d * (0.9 + (n - 0.5) * 0.9));
      const i = (y * size + x) * 4;
      const l = 200 + n * 55;
      img.data[i] = l;
      img.data[i + 1] = l;
      img.data[i + 2] = l;
      img.data[i + 3] = Math.pow(a, 1.5) * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Трафаретная надпись на бетоне. */
export function stencilTex(text: string, color = '#d8d2c0', bg: string | null = null): THREE.Texture {
  const canvas = document.createElement('canvas');
  const h = 64;
  const ctx0 = canvas.getContext('2d')!;
  ctx0.font = 'bold 44px "Arial Narrow", "DIN Condensed", Arial, sans-serif';
  const w = Math.ceil(ctx0.measureText(text).width) + 28;
  canvas.width = Math.max(64, w);
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  if (bg) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, h);
  }
  ctx.font = 'bold 44px "Arial Narrow", "DIN Condensed", Arial, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.86;
  ctx.fillText(text, 14, h / 2 + 2);
  // потёртости трафарета
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 160; i++) {
    ctx.globalAlpha = 0.25 + hash2(i, 1, text.length) * 0.4;
    ctx.fillRect(hash2(i, 2, text.length) * canvas.width, hash2(i, 3, text.length) * h, 1 + hash2(i, 4, 1) * 5, 1);
  }
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Настенная карта / чертёж. */
export function paperMapTex(kind: 'map' | 'blueprint' | 'schedule', seed: number): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 320;
  const ctx = canvas.getContext('2d')!;
  if (kind === 'blueprint') {
    ctx.fillStyle = '#21384f';
    ctx.fillRect(0, 0, 512, 320);
    ctx.strokeStyle = 'rgba(210,225,240,0.75)';
    ctx.lineWidth = 1.3;
    // силуэт длинноствольной установки
    ctx.beginPath();
    ctx.moveTo(40, 210);
    ctx.lineTo(470, 210);
    ctx.moveTo(60, 210);
    ctx.lineTo(80, 170);
    ctx.lineTo(430, 170);
    ctx.lineTo(450, 210);
    ctx.moveTo(180, 170);
    ctx.lineTo(240, 120);
    ctx.lineTo(490, 60);
    ctx.moveTo(240, 132);
    ctx.lineTo(486, 72);
    ctx.stroke();
    for (let i = 0; i < 8; i++) {
      ctx.beginPath();
      ctx.arc(90 + i * 50, 224, 13, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(210,225,240,0.8)';
    ctx.font = '12px monospace';
    ctx.fillText('GERÄT K — 38 cm — GEHEIME KOMMANDOSACHE', 24, 28);
    ctx.fillText('Bl. 4 / M 1:50', 24, 300);
  } else if (kind === 'schedule') {
    ctx.fillStyle = '#d9d2bd';
    ctx.fillRect(0, 0, 512, 320);
    ctx.strokeStyle = '#3a352c';
    ctx.lineWidth = 1;
    ctx.font = 'bold 18px monospace';
    ctx.fillStyle = '#2b2620';
    ctx.fillText('WACHPLAN', 18, 30);
    for (let r = 0; r < 9; r++) {
      ctx.strokeRect(18, 44 + r * 29, 476, 29);
      for (let c = 1; c < 6; c++) {
        ctx.beginPath();
        ctx.moveTo(18 + c * 79, 44);
        ctx.lineTo(18 + c * 79, 44 + 9 * 29);
        ctx.stroke();
      }
      ctx.font = '12px monospace';
      for (let c = 0; c < 6; c++) {
        if (hash2(r, c, seed) > 0.35) ctx.fillText(hash2(r, c, seed + 1) > 0.5 ? '06–18' : '18–06', 26 + c * 79, 63 + r * 29);
      }
    }
  } else {
    ctx.fillStyle = '#cfc6a8';
    ctx.fillRect(0, 0, 512, 320);
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = `rgba(${90 + hash2(i, 1, seed) * 40},${110 + hash2(i, 2, seed) * 30},${70},0.25)`;
      ctx.beginPath();
      ctx.ellipse(hash2(i, 3, seed) * 512, hash2(i, 4, seed) * 320, 20 + hash2(i, 5, seed) * 50, 14 + hash2(i, 6, seed) * 30, hash2(i, 7, seed) * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(40,36,30,0.25)';
    for (let x = 0; x < 512; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 320);
      ctx.stroke();
    }
    for (let y = 0; y < 320; y += 32) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(512, y);
      ctx.stroke();
    }
    ctx.strokeStyle = '#3e63a8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 190);
    for (let x = 0; x <= 512; x += 16) ctx.lineTo(x, 190 + Math.sin(x * 0.02 + seed) * 22 + hash2(x, 1, seed) * 10);
    ctx.stroke();
    ctx.strokeStyle = '#a03325';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(0, 236);
    for (let x = 0; x <= 512; x += 16) ctx.lineTo(x, 236 + Math.cos(x * 0.017 + seed) * 16);
    ctx.stroke();
    ctx.strokeStyle = '#2b2620';
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.moveTo(hash2(i, 8, seed) * 512, 0);
      ctx.quadraticCurveTo(hash2(i, 9, seed) * 512, 160, hash2(i, 10, seed) * 512, 320);
      ctx.stroke();
    }
  }
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
