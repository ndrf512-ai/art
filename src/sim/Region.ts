/** Карта района боевых действий (30×30 км). Ось Y направлена на север. */
export interface RegionNode {
  id: number;
  name: string;
  x: number;
  y: number;
  town: boolean;
  /** 1 — наш тыл, 2 — наш передний край, 3 — переправа, 4 — тыл противника. */
  tier: 1 | 2 | 3 | 4;
}

export const NODES: RegionNode[] = [
  { id: 0, name: 'Объект «Гранит»', x: 15200, y: 26800, town: false, tier: 1 },
  { id: 1, name: 'Вальдхоф', x: 14800, y: 23300, town: true, tier: 1 },
  { id: 2, name: 'Эйхенау', x: 8500, y: 21500, town: true, tier: 1 },
  { id: 3, name: 'Розенталь', x: 21800, y: 21800, town: true, tier: 1 },
  { id: 4, name: 'Альтдорф', x: 6200, y: 16000, town: true, tier: 2 },
  { id: 5, name: 'Нойкирх', x: 13600, y: 16600, town: true, tier: 2 },
  { id: 6, name: 'Штайнбрюк', x: 20500, y: 15900, town: true, tier: 2 },
  { id: 7, name: 'Лангенфельд', x: 26200, y: 17100, town: true, tier: 2 },
  { id: 8, name: 'Западный мост', x: 7600, y: 12300, town: false, tier: 3 },
  { id: 9, name: 'Центральный мост', x: 14500, y: 11900, town: false, tier: 3 },
  { id: 10, name: 'Восточный мост', x: 21900, y: 12400, town: false, tier: 3 },
  { id: 11, name: 'Мюленбах', x: 6500, y: 8600, town: true, tier: 4 },
  { id: 12, name: 'Граувальд', x: 14000, y: 7600, town: true, tier: 4 },
  { id: 13, name: 'Хоэнфельс', x: 22500, y: 8300, town: true, tier: 4 },
  { id: 14, name: 'Тифенау', x: 10200, y: 3600, town: true, tier: 4 },
  { id: 15, name: 'Кроненберг', x: 18600, y: 3100, town: true, tier: 4 },
];

export const EDGES: [number, number][] = [
  [0, 1], [1, 2], [1, 3], [1, 5], [2, 4], [2, 5], [3, 6], [3, 7], [4, 5], [5, 6], [6, 7],
  [4, 8], [5, 9], [6, 10], [8, 11], [9, 12], [10, 13], [11, 12], [12, 13], [11, 14], [12, 14], [12, 15], [13, 15], [14, 15],
];

export const BRIDGE_NODES = [8, 9, 10];
export const FRONT_NODES = [4, 5, 6, 7];

/** Русло реки Ильц с запада на восток. */
export const RIVER: [number, number][] = [
  [0, 12900], [2500, 12300], [5200, 12700], [7600, 12300], [10000, 11500], [12500, 12200], [14500, 11900], [17000, 11200],
  [19500, 12100], [21900, 12400], [24500, 11600], [27500, 12300], [30000, 11800],
];

export const FORESTS: { x: number; y: number; rx: number; ry: number; rot: number }[] = [
  { x: 15200, y: 26500, rx: 4200, ry: 2600, rot: 0.1 },
  { x: 10500, y: 24500, rx: 2800, ry: 1800, rot: -0.3 },
  { x: 20500, y: 25000, rx: 3000, ry: 1700, rot: 0.4 },
  { x: 3500, y: 19500, rx: 2200, ry: 2600, rot: 0.2 },
  { x: 17200, y: 19000, rx: 2600, ry: 1500, rot: -0.2 },
  { x: 27000, y: 21000, rx: 2000, ry: 2800, rot: 0 },
  { x: 10500, y: 14200, rx: 1800, ry: 1100, rot: 0.5 },
  { x: 24500, y: 14200, rx: 2100, ry: 1300, rot: -0.4 },
  { x: 3200, y: 9000, rx: 2200, ry: 1900, rot: 0.3 },
  { x: 10500, y: 9200, rx: 1700, ry: 1300, rot: -0.2 },
  { x: 18000, y: 9000, rx: 2300, ry: 1500, rot: 0.2 },
  { x: 26500, y: 6500, rx: 2400, ry: 2300, rot: 0.1 },
  { x: 14500, y: 4200, rx: 2000, ry: 1300, rot: -0.5 },
  { x: 5500, y: 3500, rx: 2500, ry: 1800, rot: 0.3 },
];

export const HEIGHTS: { x: number; y: number; h: number }[] = [
  { x: 10500, y: 17300, h: 214 },
  { x: 21600, y: 17500, h: 187 },
  { x: 15000, y: 20600, h: 233 },
  { x: 16200, y: 9600, h: 201 },
  { x: 4000, y: 11000, h: 176 },
  { x: 26500, y: 10300, h: 192 },
  { x: 9000, y: 6000, h: 168 },
  { x: 20500, y: 5600, h: 209 },
];

export interface ObservationPost {
  id: string;
  name: string;
  x: number;
  y: number;
  range: number;
  /** Узел, с потерей которого НП приходится оставить. */
  node: number;
}

export const OPS: ObservationPost[] = [
  { id: 'op1', name: 'НП-1 (выс. 214)', x: 10500, y: 17300, range: 7600, node: 5 },
  { id: 'op2', name: 'НП-2 (выс. 187)', x: 21600, y: 17500, range: 7200, node: 6 },
];

/** Квадрат километровой сетки: «кв. 14-11». */
export function square(x: number, y: number): string {
  const a = Math.floor(x / 1000);
  const b = Math.floor(y / 1000);
  return `кв. ${a < 10 ? '0' + a : a}-${b < 10 ? '0' + b : b}`;
}

export function nearestNode(x: number, y: number): RegionNode {
  let best = NODES[0];
  let bd = Infinity;
  for (const n of NODES) {
    const d = Math.hypot(n.x - x, n.y - y);
    if (d < bd) {
      bd = d;
      best = n;
    }
  }
  return best;
}

/** Словесная привязка точки к местности: «2 км южнее Нойкирха». */
export function describePlace(x: number, y: number): string {
  const n = nearestNode(x, y);
  const dx = x - n.x;
  const dy = y - n.y;
  const d = Math.hypot(dx, dy);
  if (d < 500) return `район ${n.name}`;
  const a = (Math.atan2(dx, dy) * 180) / Math.PI;
  const dirs = ['севернее', 'северо-восточнее', 'восточнее', 'юго-восточнее', 'южнее', 'юго-западнее', 'западнее', 'северо-западнее'];
  const dir = dirs[Math.round((((a % 360) + 360) % 360) / 45) % 8];
  return `${(d / 1000).toFixed(1)} км ${dir} пункта ${n.name}`;
}
