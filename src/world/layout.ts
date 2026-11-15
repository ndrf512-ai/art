/**
 * Планировка объекта «Гранит».
 * Бункер врезан в холм (север карты), перед фасадом — двор с огневыми позициями,
 * автопарком, КПП и периметром. Из одного описания получаются геометрия,
 * столкновения, навигация и зоны допуска.
 */
import { FACADE_H, FACADE_Z, MAP_H, MAP_W } from '../core/constants';
import type {
  GateDef,
  GunId,
  GunSiteDef,
  Interactable,
  InteractKind,
  LampDef,
  LampKind,
  PropDef,
  Spot,
  SpotKind,
  Vec2,
  ZoneDef,
  ZoneId,
} from '../core/types';
import { Grid, INDOOR, OUTDOOR, SOLID } from './Grid';

const S = 0;
const E = Math.PI / 2;
const N = Math.PI;
const W = -Math.PI / 2;

export const ZONES: Record<ZoneId, ZoneDef> = {
  solid: { id: 'solid', name: 'Массив', level: 0, group: 'general', indoor: false, ceil: 0 },
  tunnel: { id: 'tunnel', name: 'Главный тоннель', level: 1, group: 'general', indoor: true, ceil: 2.9 },
  portal: { id: 'portal', name: 'Главный портал', level: 1, group: 'general', indoor: true, ceil: 3.2 },
  tunnel_ammo: { id: 'tunnel_ammo', name: 'Снарядный тоннель', level: 2, group: 'arty', indoor: true, ceil: 3.2 },
  tunnel_staff: { id: 'tunnel_staff', name: 'Штабной тоннель', level: 3, group: 'staff', indoor: true, ceil: 2.7 },
  secret_tunnel: { id: 'secret_tunnel', name: 'Секретный сектор', level: 4, group: 'secret', indoor: true, ceil: 2.9 },
  generator: { id: 'generator', name: 'Генераторная', level: 2, group: 'tech', indoor: true, ceil: 3.8, sign: 'MASCHINENRAUM' },
  workshop: { id: 'workshop', name: 'Мастерская', level: 2, group: 'tech', indoor: true, ceil: 3.2, sign: 'WERKSTATT' },
  repair: { id: 'repair', name: 'Ремонтный цех', level: 2, group: 'tech', indoor: true, ceil: 4.6, sign: 'INSTANDSETZUNG' },
  armory: { id: 'armory', name: 'Караульное помещение и оружейная', level: 2, group: 'guard', indoor: true, ceil: 3.0, sign: 'WACHE · WAFFENKAMMER' },
  ammo1: { id: 'ammo1', name: 'Склад боеприпасов №1', level: 2, group: 'arty', indoor: true, ceil: 3.4, sign: 'MUNITION I' },
  ammo2: { id: 'ammo2', name: 'Склад спецбоеприпасов №2', level: 4, group: 'secret', indoor: true, ceil: 3.6, sign: 'MUNITION II · SPERRGEBIET' },
  barracks: { id: 'barracks', name: 'Казармы', level: 1, group: 'general', indoor: true, ceil: 3.0, sign: 'UNTERKUNFT' },
  mess: { id: 'mess', name: 'Столовая', level: 1, group: 'general', indoor: true, ceil: 3.0, sign: 'KANTINE' },
  food: { id: 'food', name: 'Кухня и склад продовольствия', level: 2, group: 'supply', indoor: true, ceil: 3.0 },
  infirmary: { id: 'infirmary', name: 'Медицинский пункт', level: 1, group: 'general', indoor: true, ceil: 3.0, sign: 'SANITÄTSRAUM' },
  command: { id: 'command', name: 'Командный центр', level: 3, group: 'staff', indoor: true, ceil: 3.3, sign: 'GEFECHTSSTAND' },
  quarters: { id: 'quarters', name: 'Помещение командира', level: 3, group: 'staff', indoor: true, ceil: 3.0 },
  radio: { id: 'radio', name: 'Радиостанция', level: 3, group: 'staff', indoor: true, ceil: 3.0, sign: 'FUNKSTELLE' },
  officers: { id: 'officers', name: 'Офицерские помещения', level: 3, group: 'staff', indoor: true, ceil: 3.0, sign: 'OFFIZIERE' },
  archive: { id: 'archive', name: 'Архив', level: 3, group: 'staff', indoor: true, ceil: 3.0, sign: 'ARCHIV' },
  ci: { id: 'ci', name: 'Отдел контрразведки', level: 3, group: 'ci', indoor: true, ceil: 3.0, sign: 'ABWEHR' },
  cell: { id: 'cell', name: 'Камера', level: 3, group: 'ci', indoor: true, ceil: 2.7 },
  tech: { id: 'tech', name: 'Технический отдел', level: 4, group: 'secret', indoor: true, ceil: 3.0, sign: 'KONSTRUKTIONSBÜRO' },
  hangar: { id: 'hangar', name: 'Ангар установки «Конрад»', level: 4, group: 'secret', indoor: true, ceil: 6.4, sign: 'HALLE K' },
  lab: { id: 'lab', name: 'Лаборатория спецзарядов', level: 4, group: 'secret', indoor: true, ceil: 3.2, sign: 'LABOR' },
  yard: { id: 'yard', name: 'Двор', level: 1, group: 'general', indoor: false, ceil: 0 },
  parade: { id: 'parade', name: 'Плац', level: 1, group: 'general', indoor: false, ceil: 0 },
  motor: { id: 'motor', name: 'Автопарк', level: 1, group: 'general', indoor: false, ceil: 0 },
  fuel: { id: 'fuel', name: 'Склад топлива', level: 2, group: 'tech', indoor: false, ceil: 0 },
  firing_main: { id: 'firing_main', name: 'Основная огневая позиция', level: 2, group: 'arty', indoor: false, ceil: 0 },
  firing_reserve: { id: 'firing_reserve', name: 'Запасная огневая позиция', level: 2, group: 'arty', indoor: false, ceil: 0 },
  rail: { id: 'rail', name: 'Рельсовая позиция установки', level: 2, group: 'arty', indoor: false, ceil: 0 },
  kpp: { id: 'kpp', name: 'КПП', level: 1, group: 'general', indoor: false, ceil: 0 },
  kpp_house: { id: 'kpp_house', name: 'Караульная будка КПП', level: 2, group: 'guard', indoor: true, ceil: 2.6 },
  observation: { id: 'observation', name: 'Наблюдательный пост', level: 2, group: 'guard', indoor: false, ceil: 0 },
  perimeter: { id: 'perimeter', name: 'Внешний периметр', level: 2, group: 'guard', indoor: false, ceil: 0 },
  outside: { id: 'outside', name: 'За периметром', level: 0, group: 'general', indoor: false, ceil: 0 },
};

export interface SignDef {
  x: number;
  y: number;
  z: number;
  yaw: number;
  text: string;
  w: number;
}

export interface Layout {
  grid: Grid;
  spots: Spot[];
  spotById: Record<string, Spot>;
  props: PropDef[];
  lamps: LampDef[];
  interactables: Interactable[];
  gates: (GateDef & { kind: 'post' | 'lock' })[];
  routes: Record<string, Vec2[]>;
  routeNames: Record<string, string>;
  guns: Record<GunId, GunSiteDef>;
  points: Record<string, Vec2>;
  signs: SignDef[];
  byTag(tag: string): Spot[];
}

export function buildLayout(): Layout {
  const grid = new Grid(MAP_W, MAP_H);
  const spots: Spot[] = [];
  const spotById: Record<string, Spot> = {};
  const props: PropDef[] = [];
  const lamps: LampDef[] = [];
  const interactables: Interactable[] = [];
  const signs: SignDef[] = [];
  const tagCount: Record<string, number> = {};

  // ------------------------------------------------------------ основа: холм и двор
  const zSolid = grid.zoneIndex('solid');
  const zYard = grid.zoneIndex('yard');
  const zOutside = grid.zoneIndex('outside');
  for (let z = 0; z < MAP_H; z++) {
    for (let x = 0; x < MAP_W; x++) {
      const i = grid.idx(x, z);
      if (z < FACADE_Z) {
        grid.type[i] = SOLID;
        grid.zone[i] = zSolid;
        grid.roof[i] = FACADE_H;
      } else {
        grid.type[i] = OUTDOOR;
        const inside = x >= 6 && x <= 143 && z <= 120;
        grid.zone[i] = inside ? zYard : zOutside;
      }
    }
  }

  function room(zone: ZoneId, x0: number, z0: number, x1: number, z1: number, ceil?: number): void {
    const zi = grid.zoneIndex(zone);
    const c = ceil ?? ZONES[zone].ceil;
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const i = grid.idx(x, z);
        grid.type[i] = INDOOR;
        grid.zone[i] = zi;
        grid.ceil[i] = c;
      }
    }
  }
  const door = (zone: ZoneId, x0: number, z0: number, x1: number, z1: number, ceil = 2.35) => room(zone, x0, z0, x1, z1, ceil);

  function outdoor(zone: ZoneId, x0: number, z0: number, x1: number, z1: number): void {
    const zi = grid.zoneIndex(zone);
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const i = grid.idx(x, z);
        if (grid.type[i] === OUTDOOR) grid.zone[i] = zi;
      }
    }
  }

  /** Предмет обстановки, занимающий прямоугольник клеток (включительно). */
  function prop(type: string, x0: number, z0: number, x1: number, z1: number, yaw = 0, h = 1, p?: PropDef['p'], block = true): void {
    props.push({ type, x: (x0 + x1 + 1) / 2, z: (z0 + z1 + 1) / 2, yaw, w: x1 - x0 + 1, d: z1 - z0 + 1, h, p });
    if (block) grid.setBlockedRect(x0, z0, x1, z1, true);
  }

  /** Декор в свободных координатах, не мешает проходу. */
  function deco(type: string, x: number, z: number, yaw = 0, w = 1, d = 1, h = 1, p?: PropDef['p']): void {
    props.push({ type, x, z, yaw, w, d, h, p });
  }

  function spot(kind: SpotKind, tag: string, x: number, z: number, yaw: number, anchor?: { x: number; z: number; y: number }): Spot {
    const n = (tagCount[tag] = (tagCount[tag] ?? 0) + 1);
    const id = `${tag}_${n}`;
    const s: Spot = { id, kind, tag, zone: grid.zoneAt(x, z), x, z, yaw };
    if (anchor) {
      s.ax = anchor.x;
      s.az = anchor.z;
      s.ay = anchor.y;
    }
    spots.push(s);
    spotById[id] = s;
    return s;
  }

  function lamp(x: number, y: number, z: number, kind: LampKind = 'ceiling', isOutdoor = false, power = 1): void {
    lamps.push({ x, y, z, kind, outdoor: isOutdoor, power });
  }

  function lampsGrid(x0: number, z0: number, x1: number, z1: number, ceil: number, spacing = 6, power = 1): void {
    const w = x1 - x0 + 1;
    const d = z1 - z0 + 1;
    const nx = Math.max(1, Math.round(w / spacing));
    const nz = Math.max(1, Math.round(d / spacing));
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        lamp(x0 + (w * (i + 0.5)) / nx, ceil - 0.12, z0 + (d * (j + 0.5)) / nz, 'ceiling', false, power);
      }
    }
  }

  function inter(kind: InteractKind, id: string, label: string, x: number, z: number, y = 1.0, ref?: string): void {
    interactables.push({ id, kind, label, x, z, y, ref });
  }

  function sign(text: string, x: number, y: number, z: number, yaw: number, w = 2.4): void {
    signs.push({ text, x, y, z, yaw, w });
  }

  // ------------------------------------------------------------ тоннели
  room('tunnel', 12, 40, 106, 42);
  room('secret_tunnel', 107, 40, 118, 42);
  room('portal', 56, 43, 58, 58);
  room('tunnel_ammo', 87, 43, 89, 58);
  room('tunnel_staff', 86, 10, 87, 39);
  for (let x = 15; x <= 117; x += 6) lamp(x + 0.5, 2.78, 41.5);
  for (let z = 46; z <= 56; z += 5) {
    lamp(57.5, 3.08, z + 0.5);
    lamp(88.5, 3.08, z + 0.5);
  }
  for (let z = 13; z <= 37; z += 6) lamp(87, 2.58, z + 0.5);
  deco('pipes', 59, 42.9, 0, 94, 0.1, 2.62, { n: 3 });
  deco('duct', 59, 40.42, 0, 94, 0.55, 2.7);

  // ------------------------------------------------------------ южный ряд
  // Генераторная
  room('generator', 12, 45, 23, 56);
  door('generator', 17, 43, 18, 44);
  sign('MASCHINENRAUM', 18, 2.62, 42.98, N);
  prop('generator', 14, 48, 18, 50, 0, 2.2);
  prop('generator2', 20, 46, 22, 47, 0, 1.5);
  prop('panel', 23, 52, 23, 54, W, 2.1);
  prop('tank', 12, 54, 13, 56, 0, 1.7, { small: true });
  prop('crates', 12, 45, 13, 46, 0, 1.0);
  spot('work', 'gen_engine', 16.5, 51.5, N);
  spot('work', 'gen_panel', 22.5, 53.5, E);
  spot('work', 'gen_fuel', 14.5, 54.5, W);
  spot('work', 'gen2', 21.5, 48.5, N);
  inter('equipment', 'eq_generator', 'Главный генератор', 16.5, 50.6, 1.2, 'generator');
  inter('equipment', 'eq_generator2', 'Резервный генератор', 21.5, 47.7, 1.0, 'generator2');
  lampsGrid(12, 45, 23, 56, 3.8, 6);

  // Мастерская
  room('workshop', 26, 45, 37, 56);
  door('workshop', 31, 43, 32, 44);
  sign('WERKSTATT', 32, 2.62, 42.98, N);
  prop('workbench', 27, 56, 36, 56, N, 0.95);
  prop('lathe', 27, 47, 28, 48, 0, 1.3);
  prop('shelf', 37, 46, 37, 49, W, 2.2, { parts: true });
  prop('crates', 26, 52, 26, 53, 0, 0.9);
  spot('work', 'ws_bench', 28.5, 55.5, S);
  spot('work', 'ws_bench', 31.5, 55.5, S);
  spot('work', 'ws_bench', 34.5, 55.5, S);
  spot('work', 'ws_lathe', 29.5, 47.5, W);
  spot('work', 'ws_parts', 36.5, 47.5, E);
  lampsGrid(26, 45, 37, 56, 3.2, 6);
  door('workshop', 38, 50, 39, 51);

  // Ремонтный цех (с воротами во двор)
  room('repair', 40, 45, 52, 56);
  room('repair', 44, 57, 48, 58, 4.0);
  door('repair', 46, 43, 47, 44);
  sign('INSTANDSETZUNG', 47, 2.62, 42.98, N, 2.8);
  prop('carriage', 45, 48, 47, 51, 0, 1.8);
  prop('cabinet', 52, 46, 52, 49, W, 2.0);
  prop('crates', 40, 54, 41, 56, 0, 1.3);
  prop('drum', 51, 55, 52, 56, 0, 1.2);
  deco('hoist', 46.5, 50, 0, 12, 1, 4.3);
  spot('work', 'rep', 43.5, 49.5, E);
  spot('work', 'rep', 48.5, 50.5, W);
  spot('work', 'rep', 46.5, 53.5, N);
  lampsGrid(40, 45, 52, 56, 4.6, 6, 1.2);

  // Караульное помещение и оружейная
  room('armory', 61, 45, 70, 56);
  door('armory', 59, 50, 60, 51);
  door('armory', 65, 43, 66, 44);
  sign('WACHE · WAFFENKAMMER', 66, 2.62, 42.98, N, 3.4);
  prop('rifle_rack', 70, 46, 70, 52, W, 1.9);
  prop('desk', 62, 46, 63, 46, S, 0.78);
  prop('bench', 64, 56, 68, 56, N, 0.45, undefined, false);
  prop('crates', 69, 54, 70, 56, 0, 1.0, { ammo: true });
  prop('cabinet', 61, 54, 61, 56, E, 1.9);
  spot('desk', 'armory_desk', 62.5, 47.5, N, { x: 62.5, z: 47.25, y: 0 });
  spot('work', 'armory_rack', 69.5, 49.5, E);
  for (let x = 64; x <= 68; x++) spot('seat', 'guard_bench', x + 0.5, 55.5, N, { x: x + 0.5, z: 56.4, y: 0 });
  deco('board', 66.5, 45.06, S, 2.2, 0.06, 1.3);
  inter('patrol_board', 'patrol_board', 'Постовая ведомость (организация патрулей)', 66.5, 45.3, 1.5);
  inter('phone', 'phone_guard', 'Телефон караульного помещения', 63.4, 46.5, 0.95);
  lampsGrid(61, 45, 70, 56, 3.0, 6);

  // Склад боеприпасов №1
  room('ammo1', 73, 45, 85, 56);
  door('ammo1', 78, 43, 79, 44);
  door('ammo1', 86, 50, 86, 51);
  sign('MUNITION I · RAUCHEN VERBOTEN', 79, 2.62, 42.98, N, 4.2);
  prop('shellrack', 74, 46, 77, 47, 0, 1.5);
  prop('shellrack', 80, 46, 84, 47, 0, 1.5);
  prop('shellrack', 74, 50, 77, 51, 0, 1.5);
  prop('shellrack', 80, 50, 83, 51, 0, 1.5);
  prop('shellrack', 74, 54, 77, 55, 0, 1.5);
  prop('crates', 80, 54, 84, 55, 0, 1.4, { ammo: true });
  spot('stack', 'ammo_pick', 78.5, 48.5, W);
  spot('stack', 'ammo_pick', 78.5, 52.5, W);
  inter('ammo', 'ammo_store_1', 'Склад боеприпасов №1 (учёт)', 79.2, 47.0, 1.2, 'ammo1');
  lampsGrid(73, 45, 85, 56, 3.4, 6, 0.9);

  // Склад спецбоеприпасов №2
  room('ammo2', 92, 45, 103, 56);
  door('ammo2', 90, 50, 91, 51);
  sign('MUNITION II · SPERRGEBIET', 91.02, 2.5, 51, W, 3.0);
  prop('shellrack', 94, 46, 96, 47, 0, 1.6, { big: true });
  prop('shellrack', 99, 46, 101, 47, 0, 1.6, { big: true });
  prop('shellrack', 94, 54, 96, 55, 0, 1.6, { big: true });
  prop('shellrack', 99, 54, 101, 55, 0, 1.6, { big: true });
  prop('cage', 102, 48, 103, 49, 0, 2.2);
  spot('stack', 'ammo2_pick', 97.5, 48.5, W);
  spot('stack', 'ammo2_pick', 97.5, 52.5, W);
  inter('ammo', 'ammo_store_2', 'Склад спецбоеприпасов №2 (учёт)', 98.2, 47.2, 1.2, 'ammo2');
  lampsGrid(92, 45, 103, 56, 3.6, 6, 0.9);
  // снарядная потерна в ангар
  room('secret_tunnel', 104, 50, 120, 51, 2.6);
  for (let x = 107; x <= 119; x += 6) lamp(x, 2.48, 51);

  // ------------------------------------------------------------ северный ряд
  // Казармы
  room('barracks', 12, 20, 29, 37);
  door('barracks', 20, 38, 21, 39);
  sign('UNTERKUNFT', 21, 2.62, 40.02, S);
  const bunkRows: [number, number][] = [
    [20, 22],
    [25, 24],
    [30, 29],
  ];
  for (const [bz, sz] of bunkRows) {
    for (let x = 13; x <= 27; x += 2) {
      prop('bunk', x, bz, x, bz + 1, 0, 1.75);
      const yaw = sz > bz ? N : S;
      spot('bed', 'bunk', x + 0.5, sz + 0.5, yaw, { x: x + 0.5, z: bz + 1, y: 0.42 });
      spot('bed', 'bunk', x + 0.5, sz + 0.5, yaw, { x: x + 0.5, z: bz + 1, y: 1.32 });
    }
  }
  prop('table', 14, 35, 17, 35, 0, 0.76);
  for (let x = 14; x <= 17; x++) spot('seat', 'barracks_table', x + 0.5, 34.5, S, { x: x + 0.5, z: 34.65, y: 0 });
  deco('bench', 16, 34.55, 0, 4, 0.35, 0.45);
  prop('stove', 28, 36, 29, 37, 0, 1.4, { heater: true });
  prop('locker', 24, 37, 27, 37, N, 1.9);
  lampsGrid(12, 20, 29, 37, 3.0, 6, 0.85);

  // Столовая
  room('mess', 32, 25, 45, 37);
  door('mess', 40, 38, 41, 39);
  sign('KANTINE', 41, 2.62, 40.02, S, 1.8);
  for (const tz of [27, 31, 35]) {
    prop('table', 33, tz, 38, tz, 0, 0.76);
    deco('bench', 36, tz - 0.42, 0, 6, 0.3, 0.45);
    deco('bench', 36, tz + 1.42, 0, 6, 0.3, 0.45);
    for (let x = 33; x <= 38; x++) {
      spot('seat', 'mess', x + 0.5, tz - 0.5, S, { x: x + 0.5, z: tz - 0.42, y: 0 });
      spot('seat', 'mess', x + 0.5, tz + 1.5, N, { x: x + 0.5, z: tz + 1.42, y: 0 });
    }
  }
  prop('counter', 42, 27, 45, 27, 0, 1.0);
  spot('work', 'kitchen_serve', 43.5, 26.5, S);
  lampsGrid(32, 25, 45, 37, 3.0, 6);

  // Кухня и склад продовольствия
  room('food', 32, 13, 45, 23);
  door('food', 42, 24, 43, 24);
  prop('stove', 44, 19, 45, 21, W, 1.0);
  prop('table', 40, 14, 41, 15, 0, 0.85);
  prop('shelf', 33, 13, 38, 13, S, 2.2, { food: true });
  prop('shelf', 32, 15, 32, 21, E, 2.2, { food: true });
  prop('sacks', 34, 17, 36, 18, 0, 1.0);
  prop('crates', 34, 21, 35, 22, 0, 1.0);
  spot('work', 'kitchen_stove', 43.5, 20.5, E);
  spot('work', 'kitchen_prep', 41.5, 16.5, N);
  spot('work', 'food_shelf', 33.5, 18.5, W);
  spot('stack', 'food_stack', 37.5, 19.5, W);
  inter('ammo', 'food_store', 'Склад продовольствия (учёт)', 36.6, 17.6, 1.0, 'food');
  lampsGrid(32, 13, 45, 23, 3.0, 6);

  // Медпункт
  room('infirmary', 48, 27, 57, 37);
  door('infirmary', 52, 38, 53, 39);
  sign('SANITÄTSRAUM', 53, 2.62, 40.02, S, 2.6);
  for (const x of [49, 51, 53, 55]) {
    prop('bed', x, 27, x, 28, 0, 0.55, { med: true });
    spot('bed', 'med_bed', x + 0.5, 29.5, N, { x: x + 0.5, z: 28, y: 0.5 });
  }
  prop('desk', 56, 33, 57, 33, S, 0.78);
  prop('medcab', 48, 31, 48, 33, E, 1.9);
  prop('exam_table', 52, 33, 53, 33, 0, 0.8);
  spot('desk', 'med_desk', 56.5, 34.5, N, { x: 56.5, z: 34.25, y: 0 });
  spot('work', 'med_cab', 49.5, 32.5, W);
  spot('treat', 'med_treat', 52.5, 34.5, N);
  inter('ammo', 'med_store', 'Аптечный шкаф (учёт медикаментов)', 48.8, 32.5, 1.3, 'medicine');
  lampsGrid(48, 27, 57, 37, 3.0, 5, 1.1);

  // Командный центр
  room('command', 60, 24, 74, 37);
  door('command', 67, 38, 68, 39);
  sign('GEFECHTSSTAND', 68, 2.62, 40.02, S, 2.8);
  prop('map_table', 65, 29, 69, 31, 0, 0.9);
  prop('fire_table', 71, 26, 73, 27, 0, 0.95);
  prop('desk', 61, 26, 62, 26, S, 0.78);
  prop('desk', 61, 35, 62, 35, N, 0.78);
  prop('switchboard', 60, 30, 60, 31, E, 1.7);
  prop('desk', 72, 36, 73, 36, N, 0.78);
  prop('cabinet', 74, 30, 74, 32, W, 1.9);
  deco('wallmap', 67.5, 24.06, S, 5, 0.05, 1.8);
  deco('wallmap', 60.06, 28, E, 0.05, 2.6, 1.4, { small: true });
  spot('desk', 'adjutant_desk', 61.5, 27.5, N, { x: 61.5, z: 27.25, y: 0 });
  spot('desk', 'duty_desk', 61.5, 34.5, S, { x: 61.5, z: 34.75, y: 0 });
  spot('desk', 'switchboard_seat', 61.5, 30.5, W, { x: 61.3, z: 30.5, y: 0 });
  spot('desk', 'qm_desk', 72.5, 35.5, S, { x: 72.5, z: 35.75, y: 0 });
  spot('stand', 'cc_map', 64.5, 30.5, E);
  spot('stand', 'cc_map', 70.5, 30.5, W);
  spot('stand', 'cc_map', 67.5, 32.5, N);
  spot('stand', 'cc_map', 67.5, 28.5, S);
  spot('stand', 'cc_fire', 72.5, 28.5, N);
  inter('map_table', 'map_table', 'Карта района', 67.5, 31.6, 1.0);
  inter('fire_table', 'fire_table_cc', 'Планшет управления огнём', 71.5, 27.9, 1.05);
  inter('phone', 'phone_cc', 'Телефон командного центра', 62.4, 34.6, 0.95);
  inter('equipment', 'eq_switchboard', 'Телефонный коммутатор', 60.8, 30.5, 1.2, 'switchboard');
  inter('siren', 'alert_panel', 'Пульт тревоги', 74.5, 28.5, 1.4);
  deco('alert_panel', 74.94, 28.5, W, 0.1, 0.8, 1.0);
  lampsGrid(60, 24, 74, 37, 3.3, 5, 1.0);

  // Помещение командира
  room('quarters', 60, 12, 74, 21);
  door('quarters', 66, 22, 67, 23);
  prop('bed', 61, 13, 62, 13, E, 0.55);
  prop('desk', 70, 12, 71, 12, S, 0.78);
  prop('safe', 74, 16, 74, 17, W, 1.3);
  prop('table', 65, 16, 66, 17, 0, 0.76);
  prop('cabinet', 60, 18, 60, 20, E, 1.9);
  deco('wallmap', 67, 12.06, S, 3, 0.05, 1.5, { small: true });
  spot('bed', 'cmd_bed', 61.5, 14.5, E, { x: 62, z: 13.5, y: 0.5 });
  spot('stand', 'quarters_guest', 68.5, 17.5, W);
  inter('bed', 'cmd_bed', 'Койка командира (отдых / сохранение)', 62, 13.9, 0.6);
  inter('phone', 'phone_quarters', 'Телефон', 71.5, 12.6, 0.95);
  inter('safe', 'cmd_safe', 'Сейф (секретные приказы)', 73.6, 17, 1.0);
  lampsGrid(60, 12, 74, 21, 3.0, 7, 0.8);

  // Радиостанция
  room('radio', 77, 30, 84, 37);
  door('radio', 75, 33, 76, 34);
  door('radio', 85, 33, 85, 34);
  sign('FUNKSTELLE', 85.98, 2.45, 34, E, 1.8);
  prop('radio_set', 78, 30, 80, 30, S, 1.5);
  prop('radio_set', 82, 30, 83, 30, S, 1.4, { small: true });
  prop('desk', 83, 36, 84, 36, N, 0.78);
  spot('desk', 'radio_seat', 79.5, 31.5, N, { x: 79.5, z: 31.25, y: 0 });
  spot('desk', 'radio_seat', 82.5, 31.5, N, { x: 82.5, z: 31.25, y: 0 });
  spot('desk', 'radio_desk', 83.5, 35.5, S, { x: 83.5, z: 35.75, y: 0 });
  inter('radio_log', 'radio_log', 'Журнал радиограмм', 83.5, 36.2, 0.95);
  inter('equipment', 'eq_radio', 'Радиостанция', 79.5, 30.8, 1.2, 'radio');
  lampsGrid(77, 30, 84, 37, 3.0, 5, 0.9);

  // Офицерские помещения
  room('officers', 77, 12, 84, 27);
  door('officers', 85, 20, 85, 21);
  sign('OFFIZIERE', 85.98, 2.45, 21, E, 1.6);
  for (const z of [13, 16, 19, 22]) {
    prop('bed', 77, z, 78, z, E, 0.55);
    spot('bed', 'officer_bed', 78.5, z + 1.5, E, { x: 78, z: z + 0.5, y: 0.5 });
  }
  for (const z of [13, 16, 19]) {
    prop('bed', 83, z, 84, z, W, 0.55);
    spot('bed', 'officer_bed', 83.5, z + 1.5, W, { x: 84, z: z + 0.5, y: 0.5 });
  }
  prop('table', 80, 24, 81, 25, 0, 0.76);
  spot('seat', 'officer_table', 79.5, 24.5, E, { x: 79.65, z: 24.5, y: 0 });
  spot('seat', 'officer_table', 82.5, 24.5, W, { x: 82.35, z: 24.5, y: 0 });
  spot('seat', 'officer_table', 80.5, 26.5, N, { x: 80.5, z: 26.35, y: 0 });
  spot('seat', 'officer_table', 81.5, 23.5, S, { x: 81.5, z: 23.65, y: 0 });
  prop('locker', 83, 26, 84, 27, W, 1.9);
  lampsGrid(77, 12, 84, 27, 3.0, 7, 0.8);

  // Архив
  room('archive', 90, 10, 99, 20);
  door('archive', 88, 15, 89, 16);
  sign('ARCHIV', 87.98, 2.45, 16, W, 1.3);
  prop('shelf', 92, 10, 98, 10, S, 2.3, { files: true });
  prop('shelf', 93, 20, 98, 20, N, 2.3, { files: true });
  prop('shelf', 99, 12, 99, 18, W, 2.3, { files: true });
  prop('cabinet', 94, 14, 96, 15, 0, 1.4, { files: true });
  prop('desk', 91, 19, 92, 19, N, 0.78);
  spot('desk', 'archive_desk', 91.5, 18.5, S, { x: 91.5, z: 18.75, y: 0 });
  spot('work', 'archive_shelf', 95.5, 11.5, N);
  spot('work', 'archive_shelf', 98.5, 15.5, E);
  spot('work', 'archive_shelf', 95.5, 16.5, N);
  inter('archive', 'archive_files', 'Картотека личного состава', 95.5, 11.0, 1.3);
  lampsGrid(90, 10, 99, 20, 3.0, 6, 0.8);

  // Контрразведка и камера
  room('ci', 90, 23, 99, 37);
  door('ci', 88, 30, 89, 31);
  sign('ABWEHR', 87.98, 2.45, 31, W, 1.3);
  prop('desk', 96, 25, 97, 25, S, 0.78);
  prop('table', 93, 34, 94, 34, 0, 0.76);
  prop('cabinet', 99, 31, 99, 33, W, 1.9, { files: true });
  prop('safe', 90, 24, 90, 24, E, 1.2);
  spot('desk', 'ci_desk', 96.5, 26.5, N, { x: 96.5, z: 26.25, y: 0 });
  spot('seat', 'interrogation', 93.5, 35.5, N, { x: 93.5, z: 35.3, y: 0 });
  spot('stand', 'ci_stand', 93.5, 32.5, S);
  spot('stand', 'ci_stand', 95.5, 33.5, W);
  inter('phone', 'phone_ci', 'Телефон отдела контрразведки', 97.4, 25.5, 0.95);
  lampsGrid(90, 23, 99, 37, 3.0, 7, 0.85);
  room('cell', 101, 23, 105, 29);
  door('cell', 100, 26, 100, 26, 2.1);
  prop('bed', 101, 23, 102, 23, E, 0.5, { plain: true });
  prop('bed', 104, 23, 105, 23, W, 0.5, { plain: true });
  deco('cellbars', 100.5, 26.5, E, 0.1, 1, 2.1);
  spot('cell', 'cell', 102.5, 26.5, S);
  spot('cell', 'cell', 104.5, 27.5, W);
  spot('cell', 'cell', 102.5, 28.5, N);
  lamp(103.5, 2.58, 26.5, 'ceiling', false, 0.5);

  // ------------------------------------------------------------ секретный сектор
  room('tech', 109, 26, 117, 37);
  door('tech', 112, 38, 113, 39);
  sign('KONSTRUKTIONSBÜRO', 113, 2.62, 40.02, S, 3.2);
  prop('drafting', 110, 28, 111, 28, 0, 1.1);
  prop('drafting', 114, 28, 115, 28, 0, 1.1);
  prop('cabinet', 117, 30, 117, 33, W, 1.5, { files: true, blueprints: true });
  prop('desk', 110, 35, 111, 35, N, 0.78);
  prop('safe', 109, 31, 109, 31, E, 1.3);
  deco('wallmap', 113, 26.06, S, 4, 0.05, 1.6, { blueprint: true });
  spot('work', 'tech_draft', 110.5, 29.5, N);
  spot('work', 'tech_draft', 114.5, 29.5, N);
  spot('desk', 'tech_desk', 110.5, 34.5, S, { x: 110.5, z: 34.75, y: 0 });
  spot('work', 'tech_cabinet', 116.5, 31.5, E);
  lampsGrid(109, 26, 117, 37, 3.0, 5, 1.0);

  room('hangar', 121, 20, 128, 58);
  door('hangar', 119, 40, 120, 42, 2.6);
  sign('HALLE K', 118.98, 2.75, 41.5, W, 1.6);
  prop('cabinet', 121, 21, 121, 24, E, 2.0);
  prop('crates', 127, 21, 128, 23, 0, 1.4);
  prop('drum', 128, 46, 128, 47, 0, 1.2);
  deco('hoist', 124.5, 30, E, 8, 1, 6.0, { rail: true });
  deco('hoist', 124.5, 44, E, 8, 1, 6.0, { rail: true });
  spot('work', 'hangar_work', 122.5, 30.5, E);
  spot('work', 'hangar_work', 126.5, 33.5, W);
  spot('work', 'hangar_work', 122.5, 40.5, E);
  spot('work', 'hangar_work', 126.5, 44.5, W);
  spot('stand', 'hangar_stand', 122.5, 47.5, E);
  inter('phone', 'phone_hangar', 'Телефон ангара', 121.3, 45.5, 1.3);
  for (let z = 23; z <= 55; z += 8) {
    lamp(122.6, 6.25, z + 0.5, 'ceiling', false, 1.5);
    lamp(126.4, 6.25, z + 0.5, 'ceiling', false, 1.5);
  }

  room('lab', 131, 30, 141, 44);
  door('lab', 129, 36, 130, 37);
  sign('LABOR', 128.98, 2.5, 37, W, 1.2);
  prop('lab_bench', 132, 30, 137, 30, S, 0.95);
  prop('table', 138, 36, 140, 37, 0, 0.85, { charges: true });
  prop('shelf', 141, 39, 141, 43, W, 2.2);
  prop('crates', 132, 42, 134, 43, 0, 1.0, { ammo: true });
  spot('work', 'lab', 133.5, 31.5, N);
  spot('work', 'lab', 136.5, 31.5, N);
  spot('work', 'lab', 139.5, 38.5, N);
  lampsGrid(131, 30, 141, 44, 3.2, 5, 1.0);

  // ------------------------------------------------------------ двор: зоны
  outdoor('perimeter', 6, FACADE_Z, 9, 120);
  outdoor('perimeter', 140, FACADE_Z, 143, 120);
  outdoor('perimeter', 6, 117, 143, 120);
  outdoor('fuel', 10, 61, 22, 76);
  outdoor('motor', 26, 61, 42, 74);
  outdoor('parade', 46, 61, 70, 76);
  outdoor('firing_main', 70, 77, 112, 96);
  outdoor('rail', 116, FACADE_Z, 133, 98);
  outdoor('firing_reserve', 14, 94, 46, 114);
  outdoor('kpp', 48, 110, 68, 120);
  outdoor('observation', 106, 104, 118, 116);

  // ограждение
  prop('fence', 5, FACADE_Z, 5, 121, 0, 2.4);
  prop('fence', 144, FACADE_Z, 144, 121, 0, 2.4);
  prop('fence', 6, 121, 54, 121, 0, 2.4);
  prop('fence', 60, 121, 143, 121, 0, 2.4);
  deco('barrier', 57.5, 120.6, 0, 5, 0.2, 1.1);

  // КПП
  for (let z = 112; z <= 118; z++) {
    for (let x = 61; x <= 67; x++) {
      const i = grid.idx(x, z);
      grid.type[i] = SOLID;
      grid.zone[i] = zSolid;
      grid.roof[i] = 3.0;
      grid.building[i] = 1;
    }
  }
  room('kpp_house', 62, 113, 66, 117);
  door('kpp_house', 61, 115, 61, 115, 2.1);
  prop('desk', 65, 113, 66, 113, S, 0.78);
  deco('bench', 64, 117.3, N, 3, 0.35, 0.45);
  spot('desk', 'kpp_desk', 65.5, 114.5, N, { x: 65.5, z: 114.25, y: 0 });
  spot('seat', 'kpp_bench', 63.5, 116.5, N, { x: 63.5, z: 117.2, y: 0 });
  inter('phone', 'phone_kpp', 'Телефон КПП', 66.4, 113.6, 0.95);
  lamp(64.5, 2.48, 115.5, 'ceiling', false, 0.8);
  sign('HALT! WACHE', 60.98, 2.5, 115.5, W, 1.6);
  prop('sandbags', 51, 117, 52, 118, 0, 1.1);
  spot('post', 'post_kpp', 60.5, 119.5, S);
  spot('post', 'post_kpp', 54.5, 119.5, S);

  // фасад: портальные фонари и пост
  lamp(57.5, 4.0, 59.4, 'wall', true, 1.3);
  lamp(88.5, 4.0, 59.4, 'wall', true, 1.0);
  lamp(46.5, 4.6, 59.4, 'wall', true, 1.0);
  lamp(124.5, 7.0, 59.5, 'wall', true, 1.2);
  for (const bx of [10, 22, 34, 52, 62, 74, 82, 94, 102, 110, 118, 131, 140]) prop('buttress', bx, 59, bx, 59, 0, FACADE_H);
  deco('exhaust', 15.5, 59.25, 0, 0.4, 0.4, 6.2);
  spot('post', 'post_portal', 59.5, 60.5, S);
  spot('post', 'post_ammo', 90.5, 60.5, S);
  spot('post', 'post_hangar', 119.5, 60.5, S);
  spot('post', 'post_secret', 104.5, 40.5, W);
  spot('post', 'post_cc', 69.5, 40.5, S);
  prop('sandbags', 54, 60, 55, 60, 0, 1.2);
  prop('sandbags', 59, 59, 59, 59, 0, 1.2);
  deco('gate_frame', 105.5, 41.5, E, 0.3, 3, 2.9);
  sign('SPERRGEBIET · ZUTRITT VERBOTEN', 105.3, 2.68, 41.5, W, 2.9);

  // плац
  for (const [lx, lz] of [
    [47, 62],
    [69, 62],
    [47, 76],
    [69, 76],
  ]) {
    prop('pole', lx, lz, lx, lz, 0, 5.5);
    lamp(lx + 0.5, 5.3, lz + 0.5, 'pole', true, 1.4);
  }
  deco('siren_pole', 71.5, 60.5, 0, 0.3, 0.3, 7);
  for (const fz of [67, 68.6, 70.2, 71.8]) {
    for (let fx = 48.5; fx <= 66.6; fx += 1.25) spot('form', 'form', fx, fz, N);
  }
  spot('form', 'form_adj', 55.5, 64.2, S);
  spot('form', 'form_officers', 59.0, 64.6, S);
  spot('form', 'form_officers', 60.3, 64.6, S);
  spot('form', 'form_officers', 61.6, 64.6, S);
  spot('form', 'form_officers', 62.9, 64.6, S);
  spot('form', 'form_officers', 64.2, 64.6, S);
  spot('form', 'form_officers', 65.5, 64.6, S);

  // автопарк
  spot('work', 'motor', 32.5, 66.5, W);
  spot('work', 'motor', 37.5, 66.5, W);
  prop('drum', 27, 73, 27, 73, 0, 1.1);
  prop('timber', 40, 72, 42, 73, 0, 0.9);
  deco('camo_net', 34, 66.5, 0, 12, 9, 3.6);
  prop('pole', 26, 62, 26, 62, 0, 5.5);
  lamp(26.5, 5.3, 62.5, 'pole', true, 1.1);

  // склад топлива
  prop('tank', 11, 64, 15, 65, 0, 2.0);
  prop('barrels', 17, 64, 20, 65, 0, 0.95);
  prop('barrels', 11, 69, 13, 70, 0, 0.95);
  prop('sandbags', 10, 62, 21, 62, 0, 1.3);
  prop('sandbags', 22, 62, 22, 68, 0, 1.3);
  deco('camo_net', 15.5, 67, 0, 12, 9, 3.2);
  spot('work', 'fuel_pump', 15.5, 67.5, N);
  spot('stack', 'fuel_stack', 17.5, 67.5, N);
  inter('fuel', 'fuel_store', 'Топливохранилище (учёт)', 15.9, 66.2, 1.2, 'fuel');
  sign('RAUCHEN VERBOTEN', 16, 0.95, 63.03, S, 2.2);

  // курилка
  deco('bench', 38.5, 79.0, 0, 3, 0.35, 0.45);
  deco('bench', 38.5, 82.0, 0, 3, 0.35, 0.45);
  prop('barrel_sand', 38, 80, 38, 80, 0, 0.8);
  spot('rest', 'smoke', 37.5, 79.5, S, { x: 37.5, z: 79.1, y: 0 });
  spot('rest', 'smoke', 38.5, 79.5, S, { x: 38.5, z: 79.1, y: 0 });
  spot('rest', 'smoke', 39.5, 79.5, S, { x: 39.5, z: 79.1, y: 0 });
  spot('rest', 'smoke', 37.5, 81.5, N, { x: 37.5, z: 81.9, y: 0 });
  spot('rest', 'smoke', 39.5, 81.5, N, { x: 39.5, z: 81.9, y: 0 });
  spot('rest', 'smoke_stand', 40.5, 80.5, W);
  spot('rest', 'smoke_stand', 36.5, 80.5, E);
  spot('rest', 'yard_idle', 62.5, 62.5, S);
  spot('rest', 'yard_idle', 50.5, 78.5, E);
  spot('rest', 'yard_idle', 93.5, 66.5, S);
  spot('rest', 'yard_idle', 74.5, 64.5, W);

  // ------------------------------------------------------------ огневые позиции
  function pit(cx: number, cz: number): void {
    const r = 6;
    for (let z = Math.floor(cz - r - 1); z <= Math.ceil(cz + r + 1); z++) {
      for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
        const d = Math.hypot(x + 0.5 - cx, z + 0.5 - cz);
        if (d >= r - 0.6 && d <= r + 0.45) {
          // проход с севера
          if (z + 0.5 < cz && Math.abs(x + 0.5 - cx) < 1.6) continue;
          grid.setBlockedRect(x, z, x, z, true);
        }
      }
    }
    deco('sandbag_ring', cx, cz, 0, r * 2, r * 2, 1.15, { r });
    deco('camo_net', cx, cz + 0.5, 0, 15, 14, 4.6, { pit: true });
  }
  pit(80.5, 84.5);
  pit(100.5, 84.5);
  pit(22.5, 102.5);
  pit(38.5, 104.5);
  prop('niche', 84, 76, 85, 76, 0, 1.0);
  prop('niche', 104, 76, 105, 76, 0, 1.0);
  prop('niche', 26, 94, 27, 94, 0, 1.0);
  prop('niche', 42, 96, 43, 96, 0, 1.0);
  prop('niche', 136, 80, 137, 81, 0, 1.2, { big: true });
  prop('bcp', 90, 71, 92, 72, 0, 2.2);
  spot('stand', 'bcp', 91.5, 73.5, N);
  spot('stand', 'bcp', 90.5, 74.5, N);
  inter('fire_table', 'fire_table_bcp', 'Планшет КП батареи', 91.5, 72.9, 1.0);
  inter('phone', 'phone_bcp', 'Полевой телефон КП батареи', 92.6, 72.9, 1.0);
  prop('pole', 94, 70, 94, 70, 0, 4.5);
  lamp(94.5, 4.3, 70.5, 'pole', true, 0.8);

  // рельсовый путь и поворотный круг
  deco('rails', 124.5, 58, 0, 1.6, 77, 0.2, { z0: 20.5, z1: 96 });
  deco('turntable', 124.5, 84.5, 0, 22, 22, 0.25);
  prop('pole', 133, 72, 133, 72, 0, 5.5);
  lamp(133.5, 5.3, 72.5, 'pole', true, 1.0);
  inter('phone', 'phone_rail', 'Полевой телефон позиции «Конрад»', 133.2, 73.4, 1.2);

  // наблюдательные вышки
  prop('tower', 112, 110, 113, 111, 0, 7.5);
  spot('post', 'post_tower', 114.5, 110.5, S, { x: 113, z: 111, y: 6.0 });
  prop('tower', 8, 114, 9, 115, 0, 7.5);
  spot('post', 'post_tower', 10.5, 114.5, S, { x: 9, z: 115, y: 6.0 });
  prop('tower', 138, 62, 139, 63, 0, 7.5);
  spot('post', 'post_tower', 137.5, 64.5, S, { x: 139, z: 63, y: 6.0 });

  // деревья внутри периметра (маскировка)
  const trees: [number, number][] = [
    [46, 100], [70, 106], [90, 108], [132, 104], [136, 110], [137, 113], [135, 114], [25, 84], [60, 94],
    [12, 88], [10, 91], [13, 93], [74, 112], [96, 114], [120, 112], [48, 88], [66, 86], [114, 66],
    [30, 116], [18, 118], [100, 100], [86, 102], [139, 96], [141, 88], [9, 104], [72, 98],
  ];
  for (const [tx, tz] of trees) prop('tree', tx, tz, tx, tz, 0, 9 + ((tx * 7 + tz * 3) % 5));

  // прочее во дворе
  prop('crates', 50, 60, 51, 60, 0, 1.2);
  prop('timber', 40, 60, 42, 60, 0, 0.8);
  prop('pole', 60, 110, 60, 110, 0, 5.5);
  lamp(60.5, 5.3, 110.5, 'pole', true, 1.2);
  prop('pole', 53, 122, 53, 122, 0, 5.5);
  lamp(53.5, 5.3, 122.5, 'pole', true, 1.2);
  prop('pole', 112, 78, 112, 78, 0, 4.5);
  lamp(112.5, 4.3, 78.5, 'pole', true, 0.7);
  prop('pole', 30, 92, 30, 92, 0, 4.5);
  lamp(30.5, 4.3, 92.5, 'pole', true, 0.6);
  prop('pole', 9, 78, 9, 78, 0, 5.0);
  lamp(9.5, 4.8, 78.5, 'pole', true, 0.8);
  prop('pole', 141, 100, 141, 100, 0, 5.0);
  lamp(141.5, 4.8, 100.5, 'pole', true, 0.8);
  prop('pole', 96, 119, 96, 119, 0, 5.0);
  lamp(96.5, 4.8, 119.5, 'pole', true, 0.8);
  prop('pole', 24, 119, 24, 119, 0, 5.0);
  lamp(24.5, 4.8, 119.5, 'pole', true, 0.8);

  // ------------------------------------------------------------ посты пропуска
  const gates: Layout['gates'] = [
    { id: 'kpp', name: 'КПП', kind: 'post', x0: 54, z0: 119, x1: 60, z1: 122, protects: 'yard', postSpot: 'post_kpp_1', inside: { x: 57.5, z: 112 } },
    { id: 'secret', name: 'Пост секретного сектора', kind: 'post', x0: 104, z0: 40, x1: 107, z1: 42, protects: 'secret_tunnel', postSpot: 'post_secret_1', inside: { x: 113, z: 41.5 } },
    { id: 'ammo2', name: 'Дверь склада №2', kind: 'lock', x0: 90, z0: 50, x1: 91, z1: 51, protects: 'ammo2', postSpot: '', inside: { x: 95, z: 50.5 } },
  ];

  // ------------------------------------------------------------ маршруты патрулей
  const routes: Record<string, Vec2[]> = {
    perimeter: [
      { x: 24.5, z: 60.5 }, { x: 24.5, z: 78.5 }, { x: 8.5, z: 80.5 }, { x: 8.5, z: 110.5 }, { x: 12.5, z: 118.5 },
      { x: 50.5, z: 118.5 }, { x: 64.5, z: 119.5 }, { x: 138.5, z: 118.5 }, { x: 141.5, z: 70.5 }, { x: 134.5, z: 62.5 },
      { x: 112.5, z: 61.5 }, { x: 72.5, z: 61.5 },
    ],
    inner: [
      { x: 57.5, z: 62.5 }, { x: 74.5, z: 68.5 }, { x: 92.5, z: 68.5 }, { x: 114.5, z: 70.5 }, { x: 114.5, z: 98.5 },
      { x: 90.5, z: 99.5 }, { x: 60.5, z: 100.5 }, { x: 44.5, z: 86.5 }, { x: 44.5, z: 76.5 },
    ],
    tunnels: [
      { x: 57.5, z: 52.5 }, { x: 57.5, z: 41.5 }, { x: 16.5, z: 41.5 }, { x: 57.5, z: 41.5 }, { x: 100.5, z: 41.5 },
      { x: 88.5, z: 41.5 }, { x: 88.5, z: 55.5 }, { x: 88.5, z: 41.5 },
    ],
    east: [
      { x: 112.5, z: 61.5 }, { x: 136.5, z: 66.5 }, { x: 141.5, z: 90.5 }, { x: 138.5, z: 116.5 }, { x: 110.5, z: 117.5 },
      { x: 114.5, z: 98.5 }, { x: 114.5, z: 72.5 },
    ],
    west: [
      { x: 24.5, z: 60.5 }, { x: 24.5, z: 80.5 }, { x: 8.5, z: 84.5 }, { x: 8.5, z: 110.5 }, { x: 30.5, z: 117.5 },
      { x: 46.5, z: 110.5 }, { x: 46.5, z: 90.5 }, { x: 44.5, z: 78.5 },
    ],
    staff: [
      { x: 86.5, z: 38.5 }, { x: 86.5, z: 12.5 }, { x: 86.5, z: 31.5 }, { x: 70.5, z: 41.5 }, { x: 98.5, z: 41.5 },
    ],
    secret: [
      { x: 110.5, z: 41.5 }, { x: 117.5, z: 41.5 }, { x: 122.5, z: 48.5 }, { x: 122.5, z: 24.5 }, { x: 126.5, z: 26.5 },
      { x: 126.5, z: 54.5 }, { x: 122.5, z: 54.5 },
    ],
    south: [
      { x: 50.5, z: 116.5 }, { x: 30.5, z: 117.5 }, { x: 12.5, z: 117.5 }, { x: 46.5, z: 112.5 }, { x: 70.5, z: 116.5 },
      { x: 100.5, z: 118.5 }, { x: 72.5, z: 108.5 },
    ],
  };
  const routeNames: Record<string, string> = {
    perimeter: 'Обход периметра',
    inner: 'Внутренний двор',
    tunnels: 'Тоннели',
    east: 'Восточный сектор',
    west: 'Западный сектор',
    staff: 'Штабной сектор',
    secret: 'Секретный сектор',
    south: 'Южный сектор и КПП',
  };

  // ------------------------------------------------------------ орудия
  const guns: Record<GunId, GunSiteDef> = {
    gun1: {
      id: 'gun1',
      name: 'Установка №1 «Конрад»',
      kind: 'rail',
      main: { x: 124.5, z: 84.5 },
      alt: { x: 124.5, z: 36.5 },
      stations: [
        { x: -3.0, z: -3.0 },
        { x: -2.3, z: 1.5 },
        { x: 0.0, z: -11.4 },
        { x: 2.3, z: -8.0 },
        { x: -2.3, z: -8.0 },
        { x: 2.4, z: -10.8 },
      ],
      niche: { x: 135.5, z: 80.5 },
      nicheAlt: { x: 135.5, z: 80.5 },
    },
    gun2: {
      id: 'gun2',
      name: 'Орудие №2',
      kind: 'howitzer',
      main: { x: 80.5, z: 84.5 },
      alt: { x: 22.5, z: 102.5 },
      stations: [
        { x: -2.8, z: -2.4 },
        { x: -1.35, z: -0.5 },
        { x: 0.2, z: -3.3 },
        { x: 1.45, z: -1.0 },
        { x: 2.6, z: -3.0 },
        { x: 2.6, z: -3.0 },
      ],
      niche: { x: 84.5, z: 77.5 },
      nicheAlt: { x: 26.5, z: 95.5 },
    },
    gun3: {
      id: 'gun3',
      name: 'Орудие №3',
      kind: 'howitzer',
      main: { x: 100.5, z: 84.5 },
      alt: { x: 38.5, z: 104.5 },
      stations: [
        { x: -2.8, z: -2.4 },
        { x: -1.35, z: -0.5 },
        { x: 0.2, z: -3.3 },
        { x: 1.45, z: -1.0 },
        { x: 2.6, z: -3.0 },
        { x: 2.6, z: -3.0 },
      ],
      niche: { x: 104.5, z: 77.5 },
      nicheAlt: { x: 42.5, z: 97.5 },
    },
  };
  inter('gun', 'gun1', 'Установка №1 «Конрад»', 124.5, 36.5, 1.4, 'gun1');
  inter('gun', 'gun2', 'Орудие №2', 80.5, 84.5, 1.2, 'gun2');
  inter('gun', 'gun3', 'Орудие №3', 100.5, 84.5, 1.2, 'gun3');

  const points: Record<string, Vec2> = {
    spawn_player: { x: 57.5, z: 126.5 },
    road_far: { x: 57.5, z: 129.2 },
    gate_out: { x: 57.5, z: 123.5 },
    gate_in: { x: 57.5, z: 116.5 },
    unload: { x: 53.5, z: 66.5 },
    truck_unload: { x: 52.5, z: 63.5 },
    form_cmd: { x: 57.5, z: 63.4 },
    shelter1: { x: 57.5, z: 50.5 },
    shelter2: { x: 88.5, z: 50.5 },
    shelter3: { x: 46.5, z: 54.5 },
    tx_1: { x: 136.5, z: 111.5 },
    tx_2: { x: 11.5, z: 90.5 },
    tx_3: { x: 33.5, z: 22.5 },
    breach_e: { x: 142.5, z: 102.5 },
    breach_w: { x: 6.5, z: 96.5 },
    breach_s: { x: 104.5, z: 119.5 },
    out_e: { x: 147.5, z: 102.5 },
    out_w: { x: 2.5, z: 96.5 },
    out_s: { x: 104.5, z: 126.5 },
    truck1: { x: 30.5, z: 66.5 },
    truck2: { x: 35.5, z: 66.5 },
    car: { x: 40.0, z: 65.5 },
    car_arrive: { x: 61.5, z: 108.5 },
    conflict: { x: 50.5, z: 80.5 },
    hangar_door: { x: 124.5, z: 58.5 },
  };

  // гарантируем проходимость ключевых точек
  for (const s of spots) {
    if (!grid.walkableAt(s.x, s.z)) {
      throw new Error(`Планировка: точка ${s.id} (${s.x}, ${s.z}) непроходима`);
    }
    s.zone = grid.zoneAt(s.x, s.z);
  }

  return {
    grid,
    spots,
    spotById,
    props,
    lamps,
    interactables,
    gates,
    routes,
    routeNames,
    guns,
    points,
    signs,
    byTag: (tag: string) => spots.filter((s) => s.tag === tag),
  };
}
