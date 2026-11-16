/**
 * Геометрия человека. Торс, юбка шинели и каска строятся как гладкие поверхности
 * (профиль по высоте + эллипс в сечении + анатомические смещения), конечности,
 * лицо, кисти и снаряжение — из примитивов. У каждой вершины есть кость (с плавным
 * смешиванием на поясе), цвет, шероховатость и «металличность»: кожа, ткань,
 * пуговицы и сапоги блестят по-разному при одном материале на всю фигуру.
 */
import * as THREE from 'three';

export type HeadGear = 'helmet' | 'cap' | 'sidecap' | 'none' | 'headphones' | 'flatcap';
export type Kit = 'none' | 'rifleman' | 'gunner' | 'officer' | 'worker';

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
  /** Снаряжение на ремне. */
  kit?: Kit;
  /** Кожаный плащ (блестит), иначе суконная шинель. */
  leather?: boolean;
  gloves?: number;
  /** Цвет кантов, петлиц и погон. */
  trim?: number;
  /** Унтер-офицерский галун по воротнику. */
  nco?: boolean;
  glasses?: boolean;
  mustache?: boolean;
  eyes?: number;
  /** 0..1 — индивидуальные черты лица. */
  face?: number;
  /** Комбинезон механика. */
  overall?: boolean;
  /** Маскировочная куртка. */
  camo?: boolean;
}

export const B = { root: 0, hips: 1, spine: 2, head: 3, armL: 4, foreL: 5, armR: 6, foreR: 7, legL: 8, shinL: 9, legR: 10, shinR: 11 } as const;
export const HIP_Y = 0.93;

/** Тип поверхности: шероховатость и металличность. */
type Surf = 'cloth' | 'wool' | 'leather' | 'boot' | 'skin' | 'hair' | 'metal' | 'paint' | 'eye' | 'glass';
const SURF: Record<Surf, [number, number]> = {
  cloth: [0.9, 0],
  wool: [0.96, 0],
  leather: [0.42, 0.05],
  boot: [0.46, 0],
  skin: [0.62, 0],
  hair: [0.72, 0],
  metal: [0.38, 0.7],
  paint: [0.62, 0.25],
  eye: [0.15, 0],
  glass: [0.1, 0.5],
};

export class Parts {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  skinI: number[] = [];
  skinW: number[] = [];
  rough: number[] = [];
  metal: number[] = [];
  idx: number[] = [];
  surf: Surf = 'cloth';
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private c = new THREE.Color();
  private nm = new THREE.Matrix3();
  private v = new THREE.Vector3();

  k(s: Surf): this {
    this.surf = s;
    return this;
  }

  /** Добавить примитив, жёстко привязанный к кости. */
  add(geo: THREE.BufferGeometry, bone: number, color: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0): void {
    this.e.set(rx, ry, rz);
    this.m.compose(new THREE.Vector3(x, y, z), this.q.setFromEuler(this.e), new THREE.Vector3(sx, sy, sz));
    this.nm.getNormalMatrix(this.m);
    const p = geo.attributes.position as THREE.BufferAttribute;
    const n = geo.attributes.normal as THREE.BufferAttribute;
    const base = this.pos.length / 3;
    this.c.set(color);
    const [r, mt] = SURF[this.surf];
    for (let i = 0; i < p.count; i++) {
      this.v.fromBufferAttribute(p, i).applyMatrix4(this.m);
      this.pos.push(this.v.x, this.v.y, this.v.z);
      this.v.fromBufferAttribute(n, i).applyMatrix3(this.nm).normalize();
      this.nor.push(this.v.x, this.v.y, this.v.z);
      this.col.push(this.c.r, this.c.g, this.c.b);
      this.skinI.push(bone, 0, 0, 0);
      this.skinW.push(1, 0, 0, 0);
      this.rough.push(r);
      this.metal.push(mt);
    }
    if (geo.index) for (let i = 0; i < geo.index.count; i++) this.idx.push(base + geo.index.getX(i));
    else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
    geo.dispose();
  }

  cyl(bone: number, color: number, rTop: number, rBot: number, h: number, x: number, y: number, z: number, seg: number, sx = 1, sz = 1, rx = 0, rz = 0, open = false): void {
    this.add(new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, open), bone, color, x, y, z, sx, 1, sz, rx, 0, rz);
  }

  sphere(bone: number, color: number, r: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, seg: number): void {
    this.add(new THREE.SphereGeometry(r, seg, Math.max(4, Math.round(seg * 0.7))), bone, color, x, y, z, sx, sy, sz);
  }

  box(bone: number, color: number, w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): void {
    this.add(new THREE.BoxGeometry(w, h, d), bone, color, x, y, z, 1, 1, 1, rx, ry, rz);
  }

  /** Сырые вершины с плавной привязкой к двум костям. */
  raw(pos: number[], nor: number[], col: number[], bones: [number, number, number][], idx: number[], surfs: Surf[]): void {
    const base = this.pos.length / 3;
    const n = pos.length / 3;
    for (let i = 0; i < n; i++) {
      this.pos.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
      this.nor.push(nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2]);
      this.col.push(col[i * 3], col[i * 3 + 1], col[i * 3 + 2]);
      const [b0, b1, w] = bones[i];
      this.skinI.push(b0, b1, 0, 0);
      this.skinW.push(1 - w, w, 0, 0);
      const [r, mt] = SURF[surfs[i]];
      this.rough.push(r);
      this.metal.push(mt);
    }
    for (const i of idx) this.idx.push(base + i);
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((this.pos.length / 3) * 2), 2));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.skinI, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.skinW, 4));
    g.setAttribute('rough', new THREE.Float32BufferAttribute(this.rough, 1));
    g.setAttribute('metal', new THREE.Float32BufferAttribute(this.metal, 1));
    g.setIndex(this.idx);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.7);
    g.boundingBox = new THREE.Box3(new THREE.Vector3(-1.2, -0.3, -1.2), new THREE.Vector3(1.2, 2.2, 1.2));
    return g;
  }
}

// ------------------------------------------------------------------ гладкие поверхности

interface Ring {
  y: number;
  rx: number;
  rz: number;
  cz: number;
}

/** Интерполяция профиля Катмулла — Рома по ключевым сечениям. */
function profileAt(keys: Ring[], y: number): Ring {
  if (y <= keys[0].y) return keys[0];
  if (y >= keys[keys.length - 1].y) return keys[keys.length - 1];
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1].y < y) i++;
  const p0 = keys[Math.max(0, i - 1)];
  const p1 = keys[i];
  const p2 = keys[i + 1];
  const p3 = keys[Math.min(keys.length - 1, i + 2)];
  const t = (y - p1.y) / (p2.y - p1.y);
  const cr = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
  return { y, rx: cr(p0.rx, p1.rx, p2.rx, p3.rx), rz: cr(p0.rz, p1.rz, p2.rz, p3.rz), cz: cr(p0.cz, p1.cz, p2.cz, p3.cz) };
}

interface TubeOpts {
  keys: Ring[];
  y0: number;
  y1: number;
  step: number;
  seg: number;
  /** Дополнительное смещение по нормали (анатомия). theta = 0 — вперёд (+z). */
  bulge?: (theta: number, y: number) => number;
  color: (theta: number, y: number) => number;
  surf: (theta: number, y: number) => Surf;
  bones: (y: number) => [number, number, number];
  capTop?: boolean;
  capBottom?: boolean;
  /** Внутренняя сторона (подкладка): обратный порядок обхода. */
  inside?: boolean;
  scale?: number;
}

function tube(P: Parts, o: TubeOpts): void {
  const ys: number[] = [];
  for (let y = o.y0; y < o.y1 - 1e-6; y += o.step) ys.push(y);
  ys.push(o.y1);
  const seg = o.seg;
  const s = o.scale ?? 1;
  const pos: number[] = [];
  const col: number[] = [];
  const bones: [number, number, number][] = [];
  const surfs: Surf[] = [];
  const c = new THREE.Color();
  for (const y of ys) {
    const r = profileAt(o.keys, y);
    for (let j = 0; j < seg; j++) {
      const th = (j / seg) * Math.PI * 2;
      const sx = Math.sin(th);
      const cz = Math.cos(th);
      // нормаль эллипса для смещения
      let nx = sx / r.rx;
      let nz = cz / r.rz;
      const nl = Math.hypot(nx, nz) || 1;
      nx /= nl;
      nz /= nl;
      const b = o.bulge ? o.bulge(th > Math.PI ? th - Math.PI * 2 : th, y) : 0;
      pos.push((sx * r.rx + nx * b) * s, y, (cz * r.rz + r.cz + nz * b) * s);
      c.set(o.color(th > Math.PI ? th - Math.PI * 2 : th, y));
      col.push(c.r, c.g, c.b);
      bones.push(o.bones(y));
      surfs.push(o.surf(th, y));
    }
  }
  const idx: number[] = [];
  const rows = ys.length;
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * seg + j;
      const b = i * seg + ((j + 1) % seg);
      const d = (i + 1) * seg + j;
      const e = (i + 1) * seg + ((j + 1) % seg);
      if (o.inside) idx.push(a, b, d, b, e, d);
      else idx.push(a, d, b, b, d, e);
    }
  }
  const capCenter = (row: number, top: boolean): void => {
    const y = ys[row];
    const r = profileAt(o.keys, y);
    const ci = pos.length / 3;
    pos.push(0, y + (top ? 0.004 : -0.004), r.cz * s);
    const cc = new THREE.Color(o.color(0, y));
    col.push(cc.r, cc.g, cc.b);
    bones.push(o.bones(y));
    surfs.push(o.surf(0, y));
    for (let j = 0; j < seg; j++) {
      const a = row * seg + j;
      const b = row * seg + ((j + 1) % seg);
      if (top) idx.push(a, b, ci);
      else idx.push(a, ci, b);
    }
  };
  if (o.capTop) capCenter(rows - 1, true);
  if (o.capBottom) capCenter(0, false);
  // гладкие нормали по сетке
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const nor = Array.from((g.attributes.normal as THREE.BufferAttribute).array as Float32Array);
  g.dispose();
  P.raw(pos, nor, col, bones, idx, surfs);
}

/** Тело вращения по профилю (r, y) — каска, тулья фуражки. */
function lathe(P: Parts, bone: number, color: number, pts: [number, number][], seg: number, x: number, y: number, z: number, sx = 1, sz = 1, rx = 0): void {
  const g = new THREE.LatheGeometry(
    pts.map(([r, h]) => new THREE.Vector2(r, h)),
    seg,
  );
  P.add(g, bone, color, x, y, z, sx, 1, sz, rx);
}

// ------------------------------------------------------------------ фигура

const SPINE_BLEND: [number, number] = [0.97, 1.1];

function torsoBones(y: number): [number, number, number] {
  const [a, b] = SPINE_BLEND;
  if (y <= a) return [B.hips, B.spine, 0];
  if (y >= b) return [B.spine, B.hips, 0];
  const t = (y - a) / (b - a);
  return [B.hips, B.spine, t * t * (3 - 2 * t)];
}

function torsoKeys(f: boolean): Ring[] {
  return f
    ? [
        { y: 0.83, rx: 0.15, rz: 0.104, cz: -0.005 },
        { y: 0.92, rx: 0.178, rz: 0.118, cz: -0.012 },
        { y: 1.0, rx: 0.138, rz: 0.096, cz: -0.004 },
        { y: 1.08, rx: 0.14, rz: 0.095, cz: 0 },
        { y: 1.18, rx: 0.15, rz: 0.098, cz: 0.002 },
        { y: 1.28, rx: 0.158, rz: 0.102, cz: 0 },
        { y: 1.36, rx: 0.162, rz: 0.098, cz: -0.004 },
        { y: 1.415, rx: 0.158, rz: 0.088, cz: -0.008 },
        { y: 1.445, rx: 0.115, rz: 0.07, cz: -0.012 },
        { y: 1.47, rx: 0.056, rz: 0.052, cz: -0.006 },
      ]
    : [
        { y: 0.83, rx: 0.148, rz: 0.104, cz: -0.004 },
        { y: 0.92, rx: 0.17, rz: 0.114, cz: -0.008 },
        { y: 1.0, rx: 0.162, rz: 0.104, cz: 0 },
        { y: 1.08, rx: 0.168, rz: 0.106, cz: 0.002 },
        { y: 1.18, rx: 0.182, rz: 0.114, cz: 0.004 },
        { y: 1.28, rx: 0.195, rz: 0.12, cz: 0.004 },
        { y: 1.36, rx: 0.2, rz: 0.116, cz: 0 },
        { y: 1.415, rx: 0.192, rz: 0.1, cz: -0.008 },
        { y: 1.448, rx: 0.13, rz: 0.076, cz: -0.012 },
        { y: 1.475, rx: 0.06, rz: 0.055, cz: -0.006 },
      ];
}

/**
 * Анатомия под тканью. У женской фигуры — мягкий естественный объём груди;
 * ткань формы (особенно плаща) перекрывает ложбинку, поэтому две доли сливаются.
 */
function torsoBulge(f: boolean): (th: number, y: number) => number {
  const g = (a: number, b: number) => Math.exp(-(a * a) - b * b);
  if (!f) {
    return (th, y) => {
      const pec = 0.012 * g((Math.abs(th) - 0.45) / 0.45, (y - 1.3) / 0.06);
      const blade = 0.01 * g((Math.abs(Math.abs(th) - Math.PI) - 0.55) / 0.4, (y - 1.33) / 0.07);
      return pec + blade;
    };
  }
  return (th, y) => {
    const lobe = (c: number) => g((th - c) / 0.4, (y - 1.285) / (y < 1.285 ? 0.05 : 0.075));
    const l = Math.max(lobe(0.44), lobe(-0.44), 0.82 * g(th / 0.55, (y - 1.29) / 0.055));
    const seat = 0.014 * g((Math.abs(Math.abs(th) - Math.PI) - 0.55) / 0.5, (y - 0.86) / 0.06);
    return 0.046 * l + seat;
  };
}

/** Положение точки на передней поверхности торса (для пуговиц, карманов). */
function frontZ(f: boolean, x: number, y: number): number {
  const r = profileAt(torsoKeys(f), y);
  const sx = Math.max(-0.98, Math.min(0.98, x / r.rx));
  const th = Math.asin(sx);
  const z = Math.cos(th) * r.rz + r.cz;
  let nz = Math.cos(th) / r.rz;
  const nx = sx / r.rx;
  nz /= Math.hypot(nx, nz) || 1;
  return z + nz * torsoBulge(f)(th, y);
}

export interface Detail {
  seg: number;
  segS: number;
  step: number;
  fine: boolean;
}

export function detailFor(level: 0 | 1 | 2): Detail {
  return [
    { seg: 8, segS: 8, step: 0.06, fine: false },
    { seg: 12, segS: 10, step: 0.035, fine: true },
    { seg: 18, segS: 14, step: 0.022, fine: true },
  ][level];
}

function shade(c: number, k: number): number {
  const col = new THREE.Color(c);
  col.multiplyScalar(k);
  return col.getHex();
}

export function buildBody(P: Parts, L: Look, D: Detail): void {
  const f = !!L.female;
  const tun = L.tunic;
  const trim = L.trim ?? (L.officer ? 0xa9a99c : 0x4c5444);
  const beltY = 1.0;
  const seg = D.seg;
  const coatSurf: Surf = L.leather ? 'leather' : L.coat ? 'wool' : 'cloth';
  const kit = L.kit ?? 'none';

  // ---- торс: одна гладкая поверхность от бёдер до шеи
  tube(P, {
    keys: torsoKeys(f),
    y0: 0.83,
    y1: f ? 1.47 : 1.475,
    step: D.step,
    seg: seg + 4,
    bulge: torsoBulge(f),
    color: (_th, y) => (Math.abs(y - beltY) < 0.024 && !L.overall ? L.belt : L.overall && y < 0.93 ? L.trousers : y < 0.88 && !L.coat ? L.trousers : tun),
    surf: (_th, y) => (Math.abs(y - beltY) < 0.024 && !L.overall ? 'leather' : coatSurf),
    bones: torsoBones,
    capTop: true,
    capBottom: true,
  });

  // ---- пола шинели/плаща либо френча
  if (L.coat) {
    const hem = f ? 0.36 : 0.4;
    const skirt: Ring[] = f
      ? [
          { y: hem, rx: 0.265, rz: 0.2, cz: -0.03 },
          { y: 0.62, rx: 0.225, rz: 0.165, cz: -0.022 },
          { y: 0.84, rx: 0.185, rz: 0.13, cz: -0.014 },
          { y: 0.97, rx: 0.146, rz: 0.104, cz: -0.006 },
        ]
      : [
          { y: hem, rx: 0.255, rz: 0.195, cz: -0.03 },
          { y: 0.62, rx: 0.222, rz: 0.165, cz: -0.022 },
          { y: 0.84, rx: 0.185, rz: 0.13, cz: -0.012 },
          { y: 0.97, rx: 0.168, rz: 0.112, cz: -0.004 },
        ];
    const body = { keys: skirt, y0: hem, y1: 0.97, step: D.step * 1.5, seg: seg + 4, bones: (): [number, number, number] => [B.hips, B.spine, 0] };
    tube(P, { ...body, color: () => tun, surf: () => coatSurf });
    if (D.fine) tube(P, { ...body, color: () => shade(tun, 0.55), surf: () => 'cloth', inside: true, scale: 0.985 });
    // кромка запаха спереди и шлица сзади
    P.k(coatSurf).box(B.hips, shade(tun, 0.7), 0.012, 0.96 - hem, 0.012, f ? 0.045 : 0.05, (hem + 0.96) / 2, f ? 0.17 : 0.17, -0.2, 0, 0);
    P.k(coatSurf).box(B.hips, shade(tun, 0.7), 0.006, 0.6 - hem, 0.01, 0, (hem + 0.6) / 2, -0.205 + (0.6 - hem) * 0.1, 0.18, 0, 0);
  } else if (!L.overall) {
    // полы френча поверх брюк
    tube(P, {
      keys: [
        { y: 0.84, rx: f ? 0.188 : 0.182, rz: 0.126, cz: -0.006 },
        { y: 0.94, rx: f ? 0.176 : 0.172, rz: 0.118, cz: -0.006 },
        { y: 0.98, rx: f ? 0.144 : 0.166, rz: 0.108, cz: -0.002 },
      ],
      y0: 0.84,
      y1: 0.98,
      step: 0.035,
      seg: seg + 4,
      color: () => tun,
      surf: () => 'cloth',
      bones: () => [B.hips, B.spine, 0],
    });
  }

  // ---- погоны (шея и воротник — в buildCollar)
  for (const sx of [-1, 1]) {
    // погон
    const shx = sx * (f ? 0.112 : 0.128);
    P.k(L.officer ? 'metal' : coatSurf).box(B.spine, L.officer ? shade(trim, 0.75) : shade(tun, 0.92), 0.1, 0.006, 0.04, shx, f ? 1.43 : 1.435, -0.006, 0, 0, sx * -0.3);
    if (!L.officer) P.k('cloth').box(B.spine, trim, 0.102, 0.004, 0.044, shx, f ? 1.427 : 1.432, -0.006, 0, 0, sx * -0.3);
  }

  // ---- застёжка, лацканы, карманы
  if (L.coat) {
    // двубортная застёжка и широкие отвороты
    for (let i = 0; i < 4; i++) {
      const y = 1.34 - i * 0.085;
      for (const sx of [-1, 1]) {
        const x = sx * (f ? 0.052 : 0.06);
        P.k('metal').sphere(B.spine, L.officer || L.leather ? 0x77756d : 0x55554e, 0.0075, x, y, frontZ(f, x, y) + 0.003, 1, 1, 0.55, D.segS);
      }
    }
    if (D.fine) {
      for (const sx of [-1, 1]) {
        const x0 = sx * 0.05;
        const y0 = 1.42;
        P.k(coatSurf).box(B.spine, shade(tun, 1.08), 0.07, 0.15, 0.012, sx * 0.075, y0 - 0.06, frontZ(f, sx * 0.075, y0 - 0.06) + 0.002, -0.12, sx * 0.22, sx * -0.42);
        P.k(coatSurf).box(B.spine, shade(tun, 0.6), 0.004, 0.15, 0.013, x0 + sx * 0.034, y0 - 0.06, frontZ(f, x0, y0 - 0.06) + 0.004, -0.12, sx * 0.22, sx * -0.42);
      }
      // карманы с клапанами на полах
      for (const sx of [-1, 1]) P.k(coatSurf).box(B.hips, shade(tun, 0.8), 0.13, 0.014, 0.03, sx * 0.13, 0.86, 0.12, 0, sx * -0.55, sx * -0.1);
    }
  } else if (!L.overall) {
    for (let i = 0; i < 5; i++) {
      const y = 1.4 - i * 0.085;
      P.k('metal').sphere(B.spine, 0x6e6e64, 0.008, 0, y, frontZ(f, 0, y) + 0.003, 1, 1, 0.6, D.segS - 2);
    }
    if (!f) {
      for (const sx of [-1, 1]) {
        const x = sx * 0.085;
        P.k('cloth').box(B.spine, shade(tun, 0.95), 0.08, 0.09, 0.014, x, 1.27, frontZ(f, x, 1.27) + 0.002);
        P.k('cloth').box(B.spine, shade(tun, 0.85), 0.085, 0.03, 0.018, x, 1.315, frontZ(f, x, 1.31) + 0.004);
        P.k('metal').sphere(B.spine, 0x6e6e64, 0.006, x, 1.305, frontZ(f, x, 1.305) + 0.014, 1, 1, 0.6, 6);
      }
      for (const sx of [-1, 1]) P.k('cloth').box(B.hips, shade(tun, 0.88), 0.11, 0.028, 0.016, sx * 0.1, 0.93, frontZ(f, sx * 0.1, 0.93) + 0.008, 0, sx * -0.3, 0);
    }
  } else {
    // комбинезон: нагрудный карман и пуговицы
    P.k('cloth').box(B.spine, shade(tun, 0.9), 0.1, 0.1, 0.012, 0.07, 1.27, frontZ(f, 0.07, 1.27) + 0.002);
    for (let i = 0; i < 5; i++) P.k('metal').sphere(B.spine, 0x555550, 0.007, 0, 1.4 - i * 0.09, frontZ(f, 0, 1.4 - i * 0.09) + 0.003, 1, 1, 0.6, 6);
  }

  // ---- ремень, пряжка, снаряжение
  if (!L.overall) {
    P.k('metal').box(B.spine, L.officer || L.leather ? 0xb8b6aa : 0x8c8a74, 0.05, 0.04, 0.01, 0, beltY, frontZ(f, 0, beltY) + 0.006);
  }
  if (L.officer && !L.coat) {
    P.k('leather').box(B.spine, L.belt, 0.03, 0.46, 0.008, 0.02, 1.2, frontZ(f, 0.02, 1.2) + 0.006, 0, 0, -0.38);
  }
  if (L.officer) {
    P.k('leather').box(B.hips, 0x2c1e15, 0.06, 0.13, 0.12, 0.19, 0.95, 0.02, 0, 0, 0.08);
    P.k('metal').box(B.hips, 0x9c9a90, 0.012, 0.016, 0.03, 0.222, 1.0, 0.04);
  }
  if (kit === 'rifleman' || kit === 'gunner') {
    // ременно-плечевая система
    for (const sx of [-1, 1]) {
      const x = sx * 0.075;
      P.k('leather').box(B.spine, L.belt, 0.026, 0.42, 0.008, x, 1.21, frontZ(f, x, 1.21) + 0.004, 0, 0, sx * 0.08);
      P.k('leather').box(B.spine, L.belt, 0.026, 0.42, 0.008, x * 0.7, 1.21, -0.115, 0, 0, sx * -0.1);
    }
    if (kit === 'rifleman') {
      // подсумки по три с каждой стороны пряжки
      for (const sx of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
          const x = sx * (0.05 + i * 0.036);
          P.k('leather').box(B.hips, L.belt, 0.032, 0.06, 0.03, x, beltY - 0.04, frontZ(f, x, beltY) + 0.012, 0, sx * -0.35 * (i / 2), 0);
          if (D.fine) P.k('leather').box(B.hips, shade(L.belt, 0.8), 0.034, 0.014, 0.034, x, beltY - 0.012, frontZ(f, x, beltY) + 0.014, 0, sx * -0.35 * (i / 2), 0);
        }
      }
    }
    // сухарная сумка, фляга, противогазная коробка, лопатка
    P.k('cloth').box(B.hips, 0x5a5940, 0.12, 0.13, 0.055, -0.16, 0.93, -0.06, 0, 0.5, 0);
    P.k('paint').cyl(B.hips, 0x3c4232, 0.042, 0.045, 0.15, -0.12, 0.9, -0.12, D.segS, 1, 0.75);
    P.k('paint').cyl(B.spine, 0x5c6252, 0.052, 0.052, 0.26, 0.07, 1.0, -0.17, D.segS, 1, 1, 0, 0.12);
    if (D.fine) for (let i = 0; i < 3; i++) P.k('paint').cyl(B.spine, 0x4c5244, 0.055, 0.055, 0.012, 0.07 + 0.012 * (i - 1) * 0.12, 0.92 + i * 0.08, -0.17, D.segS, 1, 1, 0, 0.12);
    P.k('paint').box(B.hips, 0x3a3a30, 0.07, 0.16, 0.02, 0.13, 0.9, -0.12, 0, -0.4, 0);
  }
  if (kit === 'worker') {
    P.k('leather').box(B.hips, 0x3a2c20, 0.1, 0.12, 0.04, 0.16, 0.93, 0.02, 0, 0.4, 0);
    P.k('metal').box(B.hips, 0x707070, 0.012, 0.14, 0.01, 0.15, 0.97, 0.05, 0, 0.4, 0.1);
  }
  if (L.apron) P.k('cloth').box(B.spine, 0xc4c0b2, 0.3, 0.5, 0.012, 0, 1.05, frontZ(f, 0, 1.05) + 0.012);
  if (L.camo) {
    // пятнистая куртка: пятна поверх ткани
    for (let i = 0; i < 9; i++) {
      const x = ((i * 37) % 9) / 9 - 0.45;
      const y = 1.0 + ((i * 53) % 7) * 0.06;
      P.k('cloth').sphere(B.spine, i % 2 ? 0x5b4c32 : 0x2f3a22, 0.03, x * 0.3, y, frontZ(f, x * 0.3, y) - 0.012, 1.4, 0.8, 0.5, 6);
    }
  }

  // ---- руки
  for (const s of [1, -1]) {
    const arm = s > 0 ? B.armL : B.armR;
    const fore = s > 0 ? B.foreL : B.foreR;
    const x = s * (f ? 0.195 : 0.215);
    const sleeve = L.overall ? tun : tun;
    P.k(coatSurf).sphere(arm, sleeve, f ? 0.043 : 0.05, x - s * 0.014, 1.388, -0.004, 1, 0.85, 1, D.segS);
    P.k(coatSurf).cyl(arm, sleeve, f ? 0.046 : 0.053, f ? 0.042 : 0.047, 0.27, x, 1.265, -0.004, seg);
    P.k(coatSurf).sphere(fore, sleeve, f ? 0.043 : 0.048, x, 1.125, -0.004, 1, 1, 1, D.segS);
    P.k(coatSurf).cyl(fore, sleeve, f ? 0.042 : 0.047, f ? 0.036 : 0.04, 0.24, x, 1.0, -0.002, seg);
    // обшлаг
    P.k(coatSurf).cyl(fore, shade(sleeve, L.coat ? 0.92 : 1), f ? 0.041 : 0.045, f ? 0.04 : 0.044, 0.05, x, 0.9, 0, seg);
    if (L.armband && s > 0) {
      P.k('cloth').cyl(arm, 0xd8d4c8, 0.059, 0.057, 0.07, x, 1.3, -0.004, seg);
      P.k('cloth').box(arm, 0xa82a20, 0.008, 0.045, 0.012, x + 0.058, 1.3, 0);
      P.k('cloth').box(arm, 0xa82a20, 0.008, 0.012, 0.045, x + 0.058, 1.3, 0);
    }
    // кисть: ладонь, пальцы, большой палец; у офицеров — перчатки
    const hand = L.gloves ?? L.skin;
    P.k(L.gloves !== undefined ? 'leather' : 'skin').box(fore, hand, 0.03, 0.08, f ? 0.068 : 0.075, x - s * 0.002, 0.842, 0.004);
    P.k(L.gloves !== undefined ? 'leather' : 'skin').box(fore, hand, 0.026, 0.075, f ? 0.064 : 0.07, x - s * 0.006, 0.775, 0.014, 0.28, 0, s * 0.12);
    if (D.fine) for (let i = 1; i < 4; i++) P.k(L.gloves !== undefined ? 'leather' : 'skin').box(fore, shade(hand, 0.82), 0.027, 0.06, 0.002, x - s * 0.006, 0.77, -0.02 + i * (f ? 0.016 : 0.0175), 0.28, 0, s * 0.12);
    P.k(L.gloves !== undefined ? 'leather' : 'skin').cyl(fore, hand, 0.011, 0.013, 0.055, x - s * 0.018, 0.825, 0.045, D.segS - 2, 1, 1, -0.55, s * 0.5);
  }

  // ---- ноги: бриджи/брюки, колено, сапоги
  for (const s of [1, -1]) {
    const leg = s > 0 ? B.legL : B.legR;
    const shin = s > 0 ? B.shinL : B.shinR;
    const x = s * 0.093;
    const breeches = !!L.officer && !L.coat;
    P.k(L.overall ? 'cloth' : 'wool').cyl(leg, L.trousers, f ? 0.088 : 0.086, f ? 0.06 : 0.064, 0.44, x, 0.7, 0, seg);
    if (breeches) P.k('wool').sphere(leg, L.trousers, 0.07, x + s * 0.03, 0.73, 0, 0.9, 1.6, 0.9, D.segS);
    P.k('wool').sphere(shin, L.trousers, f ? 0.058 : 0.062, x, 0.485, 0.004, 1, 1, 1, D.segS);
    // сапог: голенище с раструбом, стопа, каблук, подошва
    const bootTop = L.officer || L.leather ? 0.5 : 0.44;
    P.k('boot').cyl(shin, L.boots, f ? 0.06 : 0.063, f ? 0.05 : 0.054, bootTop - 0.06, x, (bootTop + 0.06) / 2, 0, seg);
    P.k('boot').cyl(shin, L.boots, f ? 0.064 : 0.067, f ? 0.06 : 0.063, 0.03, x, bootTop - 0.01, 0, seg, 1, 1, 0, 0, true);
    P.k('boot').sphere(shin, L.boots, 0.05, x, 0.055, 0.075, f ? 0.85 : 0.95, 0.8, 1.6, D.segS);
    P.k('boot').box(shin, L.boots, f ? 0.08 : 0.088, 0.07, 0.17, x, 0.05, 0.02);
    P.k('cloth').box(shin, 0x0b0a09, f ? 0.082 : 0.09, 0.018, 0.25, x, 0.009, 0.04);
    P.k('cloth').box(shin, 0x0b0a09, f ? 0.06 : 0.07, 0.04, 0.06, x, 0.03, -0.055);
    if (L.overall) P.k('cloth').cyl(shin, L.trousers, 0.066, 0.07, 0.12, x, 0.46, 0, seg);
  }
}

/**
 * Шея, воротник и петлицы. У командира они вместе с головой видны только в зеркале,
 * чтобы не загораживать обзор от первого лица.
 */
export function buildCollar(P: Parts, L: Look, D: Detail): void {
  const tun = L.tunic;
  const trim = L.trim ?? (L.officer ? 0xa9a99c : 0x4c5444);
  const coatSurf: Surf = L.leather ? 'leather' : L.coat ? 'wool' : 'cloth';
  P.k('skin').cyl(B.spine, L.skin, 0.044, 0.05, 0.09, 0, 1.49, 0.004, D.seg);
  P.k(coatSurf).cyl(B.spine, tun, 0.06, 0.072, 0.055, 0, 1.462, 0.0, D.seg + 2, 1, 1.02, -0.06);
  for (const sx of [-1, 1]) {
    P.k('cloth').box(B.spine, L.officer ? 0x2a3328 : shade(tun, 0.8), 0.04, 0.03, 0.01, sx * 0.04, 1.452, 0.062, -0.35, sx * 0.35, 0);
    P.k('metal').box(B.spine, trim, 0.03, 0.004, 0.011, sx * 0.04, 1.456, 0.064, -0.35, sx * 0.35, 0);
    if (L.nco) P.k('metal').box(B.spine, 0xb5b3a6, 0.07, 0.006, 0.006, sx * 0.03, 1.488, 0.05, -0.3, sx * 0.6, 0);
  }
}

export function buildHead(P: Parts, L: Look, D: Detail): void {
  const f = !!L.female;
  const y = 1.6;
  const fv = L.face ?? 0.5;
  const seg = D.segS + 2;
  const hb = B.head;
  // череп, лицо, подбородок, скулы
  P.k('skin').sphere(hb, L.skin, 0.098, 0, y + 0.03, -0.006, f ? 0.84 : 0.88, 1.02, 0.98, seg);
  P.k('skin').sphere(hb, L.skin, 0.074, 0, y - 0.025, 0.028, f ? 0.84 : 0.92 + fv * 0.08, f ? 0.78 : 0.82, 0.95, seg);
  P.k('skin').sphere(hb, L.skin, 0.03, 0, y - 0.075, 0.058, f ? 0.95 : 1.15, 0.8, 0.9, D.segS);
  for (const sx of [-1, 1]) P.k('skin').sphere(hb, L.skin, 0.024, sx * 0.046, y + 0.008, 0.058, 0.9, 0.75, 0.55, D.segS);
  // нос
  P.k('skin').box(hb, L.skin, f ? 0.018 : 0.02 + fv * 0.006, 0.045, 0.026, 0, y + 0.012, 0.093, -0.22);
  P.k('skin').sphere(hb, shade(L.skin, 0.98), f ? 0.012 : 0.014, 0, y - 0.008, 0.103, 1.1, 0.9, 1, D.segS);
  // уши
  for (const sx of [-1, 1]) P.k('skin').sphere(hb, shade(L.skin, 0.95), 0.022, sx * (f ? 0.08 : 0.087), y + 0.015, -0.008, 0.4, 1.05, 0.7, D.segS);
  // глаза: белок и радужка, брови
  for (const sx of [-1, 1]) {
    const ex = sx * (f ? 0.031 : 0.033);
    if (D.fine) {
      // глазница, белок, радужка, зрачок и верхнее веко
      P.k('skin').sphere(hb, shade(L.skin, 0.8), 0.016, ex, y + 0.031, 0.077, 1.25, 0.75, 0.55, D.segS);
      P.k('eye').sphere(hb, 0xcfc9bd, 0.0098, ex, y + 0.029, 0.082, 1.35, 0.62, 0.6, D.segS);
      P.k('eye').sphere(hb, L.eyes ?? 0x4a5a6a, 0.0052, ex, y + 0.029, 0.0868, 1, 1, 0.5, 8);
      P.k('eye').sphere(hb, 0x0c0c0c, 0.0024, ex, y + 0.029, 0.0889, 1, 1, 0.4, 6);
      P.k('skin').box(hb, shade(L.skin, 0.93), 0.027, f ? 0.005 : 0.007, 0.01, ex, y + 0.0365, 0.084, 0.35);
      if (f) P.k('hair').box(hb, 0x2a2420, 0.026, 0.0025, 0.004, ex, y + 0.034, 0.0895, 0.2);
    } else {
      P.k('eye').sphere(hb, 0x2a2622, 0.0065, ex, y + 0.029, 0.085, 1.3, 0.7, 0.5, 6);
    }
    P.k('hair').box(hb, shade(L.hair, f ? 0.9 : 0.85), 0.034, f ? 0.005 : 0.008, 0.012, ex + sx * 0.002, y + 0.052, 0.088, f ? -0.1 : 0, 0, sx * (f ? -0.18 : -0.08));
  }
  // надбровье и рот
  P.k('skin').box(hb, L.skin, f ? 0.074 : 0.084, 0.014, 0.016, 0, y + 0.045, 0.082, 0.25);
  P.k('skin').box(hb, f ? 0xa5675f : shade(L.skin, 0.74), f ? 0.028 : 0.032, f ? 0.008 : 0.005, 0.007, 0, y - 0.042, 0.088);
  if (f) P.k('skin').box(hb, 0x9a5c55, 0.024, 0.004, 0.006, 0, y - 0.035, 0.089);
  if (L.mustache && !f) P.k('hair').box(hb, L.hair, 0.046, 0.01, 0.012, 0, y - 0.027, 0.094);
  if (L.glasses) {
    for (const sx of [-1, 1]) P.k('metal').add(new THREE.TorusGeometry(0.017, 0.0022, 4, 12), hb, 0x2a2a28, sx * 0.033, y + 0.03, 0.094);
    P.k('metal').box(hb, 0x2a2a28, 0.03, 0.003, 0.003, 0, y + 0.033, 0.095);
  }
  // волосы
  const hairVisible = L.head === 'none' || L.head === 'sidecap' || L.head === 'headphones' || L.head === 'flatcap' || L.head === 'cap' || f;
  if (hairVisible) {
    if (f) {
      P.k('hair').add(new THREE.SphereGeometry(0.104, seg, Math.round(seg * 0.6), 0, Math.PI * 2, 0, Math.PI * 0.62), hb, L.hair, 0, y + 0.03, -0.014, 0.9, 1.04, 1.02);
      // уложенные назад волосы и низкий узел
      P.k('hair').sphere(hb, L.hair, 0.07, 0, y - 0.005, -0.06, 1.05, 1.0, 0.8, seg);
      P.k('hair').sphere(hb, shade(L.hair, 0.92), 0.042, 0, y - 0.05, -0.1, 1.25, 0.85, 0.85, seg);
      // пряди, убранные за уши, и косой пробор под фуражкой
      for (const sx of [-1, 1]) P.k('hair').sphere(hb, L.hair, 0.045, sx * 0.072, y + 0.018, -0.022, 0.42, 1.05, 1.15, seg);
      P.k('hair').sphere(hb, shade(L.hair, 1.04), 0.06, 0.012, y + 0.072, 0.045, 1.1, 0.35, 0.75, seg);
    } else {
      P.k('hair').add(new THREE.SphereGeometry(0.102, seg, Math.round(seg * 0.6), 0, Math.PI * 2, 0, Math.PI * 0.42), hb, L.hair, 0, y + 0.034, -0.016, 0.92, 1.0, 1.0);
      for (const sx of [-1, 1]) P.k('hair').box(hb, L.hair, 0.012, 0.035, 0.03, sx * 0.084, y + 0.025, 0.035);
    }
  }
  // головной убор
  switch (L.head) {
    case 'helmet':
      // стальной шлем: купол и расклёшенный назатыльник
      P.k('paint');
      lathe(P, hb, L.headColor, [[0.001, 0.158], [0.06, 0.153], [0.098, 0.134], [0.118, 0.1], [0.125, 0.066], [0.127, 0.046], [0.141, 0.014], [0.149, 0.0], [0.144, -0.004], [0.12, 0.04]], seg, 0, y + 0.036, -0.012, 1, 1.1, -0.22);
      P.k('leather').box(hb, 0x1a1712, 0.006, 0.08, 0.012, 0.096, y - 0.05, 0.03, 0, 0, 0.15);
      P.k('leather').box(hb, 0x1a1712, 0.006, 0.08, 0.012, -0.096, y - 0.05, 0.03, 0, 0, -0.15);
      break;
    case 'cap': {
      // фуражка: околыш, высокая тулья с седлом, козырёк, кокарда и орёл
      const capY = y + 0.088;
      P.k('wool').cyl(hb, shade(L.headColor, 0.85), 0.104, 0.101, 0.045, 0, capY, -0.002, seg, 0.92, 1.02);
      P.k('metal').cyl(hb, L.trim ?? 0xa9a99c, 0.1045, 0.1045, 0.004, 0, capY + 0.023, -0.002, seg, 0.92, 1.02, 0, 0, true);
      P.k('wool');
      lathe(P, hb, L.headColor, [[0.104, 0], [0.13, 0.03], [0.142, 0.048], [0.13, 0.058], [0.07, 0.064], [0.001, 0.064]], seg, 0, capY + 0.02, -0.004, 0.94, 1.05, -0.13);
      P.k('leather').add(new THREE.CylinderGeometry(0.09, 0.09, 0.006, seg, 1, false, -Math.PI / 2, Math.PI), hb, 0x0e0e0e, 0, capY - 0.016, 0.06, 0.95, 1, 0.75, 0.32);
      P.k('metal').sphere(hb, 0xc8c6bc, 0.009, 0, capY + 0.004, 0.103, 1, 1, 0.5, 8);
      P.k('metal').box(hb, 0xc8c6bc, 0.05, 0.016, 0.004, 0, capY + 0.045, 0.118, -0.35);
      P.k('metal').box(hb, 0xb4b2a8, 0.16, 0.005, 0.005, 0, capY - 0.012, 0.098);
      break;
    }
    case 'sidecap':
    case 'headphones':
      P.k('cloth').box(hb, L.headColor, 0.11, 0.06, 0.23, 0, y + 0.1, -0.005, 0, 0, 0.08);
      P.k('cloth').box(hb, shade(L.headColor, 0.85), 0.112, 0.022, 0.232, 0, y + 0.077, -0.005, 0, 0, 0.08);
      P.k('metal').sphere(hb, 0x8a8a7e, 0.006, 0.01, y + 0.09, 0.11, 1, 1, 0.5, 6);
      if (L.head === 'headphones') {
        for (const sx of [-1, 1]) P.k('leather').cyl(hb, 0x101010, 0.036, 0.036, 0.03, sx * 0.098, y + 0.01, 0, D.segS, 1, 1, 0, Math.PI / 2);
        P.k('metal').box(hb, 0x101010, 0.21, 0.012, 0.02, 0, y + 0.14, 0);
      }
      break;
    case 'flatcap':
      P.k('cloth').cyl(hb, L.headColor, 0.115, 0.108, 0.04, 0, y + 0.1, 0.005, seg, 1, 1.08);
      P.k('cloth').add(new THREE.CylinderGeometry(0.075, 0.075, 0.008, seg, 1, false, -Math.PI / 2, Math.PI), hb, shade(L.headColor, 0.9), 0, y + 0.085, 0.085, 1, 1, 0.8, 0.12);
      break;
  }
}
