import type { Grid } from './Grid';

const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DZ = [0, 0, 1, -1, 1, -1, 1, -1];
const COST = [1, 1, 1, 1, 1.4142, 1.4142, 1.4142, 1.4142];

/**
 * A* по клеточной карте с учётом «стоимости зон»: NPC избегают идти через зоны,
 * куда у них нет допуска, но могут туда попасть, если цель внутри.
 */
export class Pathfinder {
  private g: Float32Array;
  private f: Float32Array;
  private parent: Int32Array;
  private stamp: Uint32Array;
  private closed: Uint32Array;
  private heap: Int32Array;
  private heapN = 0;
  private searchId = 0;
  /** Штраф за клетки у стен: NPC держатся середины проходов. */
  private wallPenalty: Float32Array;
  searches = 0;

  constructor(private grid: Grid) {
    const n = grid.w * grid.h;
    this.g = new Float32Array(n);
    this.f = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.heap = new Int32Array(n);
    this.wallPenalty = new Float32Array(n);
    this.rebuildPenalty();
  }

  rebuildPenalty(): void {
    const { grid } = this;
    for (let z = 0; z < grid.h; z++) {
      for (let x = 0; x < grid.w; x++) {
        let p = 0;
        if (grid.walkable(x, z)) {
          for (let k = 0; k < 8; k++) {
            if (!grid.walkable(x + DX[k], z + DZ[k])) {
              p = 0.5;
              break;
            }
          }
        }
        this.wallPenalty[z * grid.w + x] = p;
      }
    }
  }

  private push(node: number): void {
    const { heap, f } = this;
    let i = this.heapN++;
    heap[i] = node;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (f[heap[p]] <= f[heap[i]]) break;
      const t = heap[p];
      heap[p] = heap[i];
      heap[i] = t;
      i = p;
    }
  }

  private pop(): number {
    const { heap, f } = this;
    const top = heap[0];
    const last = heap[--this.heapN];
    if (this.heapN > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.heapN && f[heap[l]] < f[heap[m]]) m = l;
        if (r < this.heapN && f[heap[r]] < f[heap[m]]) m = r;
        if (m === i) break;
        const t = heap[m];
        heap[m] = heap[i];
        heap[i] = t;
        i = m;
      }
    }
    return top;
  }

  /**
   * Возвращает сглаженный путь в виде плоского массива [x0, z0, x1, z1, ...] либо null.
   * zoneCost — множитель стоимости по индексу зоны (необязателен).
   */
  find(sx: number, sz: number, tx: number, tz: number, zoneCost?: Float32Array | null): number[] | null {
    const { grid } = this;
    this.searches++;
    let scx = Math.floor(sx);
    let scz = Math.floor(sz);
    let tcx = Math.floor(tx);
    let tcz = Math.floor(tz);
    if (!grid.walkable(scx, scz)) {
      const n = grid.nearestWalkable(sx, sz, 4);
      if (!n) return null;
      scx = Math.floor(n.x);
      scz = Math.floor(n.z);
    }
    if (!grid.walkable(tcx, tcz)) {
      const n = grid.nearestWalkable(tx, tz, 4);
      if (!n) return null;
      tx = n.x;
      tz = n.z;
      tcx = Math.floor(tx);
      tcz = Math.floor(tz);
    }
    const w = grid.w;
    const start = scz * w + scx;
    const goal = tcz * w + tcx;
    if (start === goal) return [tx, tz];

    const id = ++this.searchId;
    const { g, f, parent, stamp, closed, wallPenalty } = this;
    this.heapN = 0;
    g[start] = 0;
    f[start] = 0;
    parent[start] = -1;
    stamp[start] = id;
    this.push(start);
    let found = false;
    let iter = 0;
    while (this.heapN > 0) {
      const cur = this.pop();
      if (closed[cur] === id) continue;
      closed[cur] = id;
      if (cur === goal) {
        found = true;
        break;
      }
      if (++iter > 60000) break;
      const cx = cur % w;
      const cz = (cur - cx) / w;
      for (let k = 0; k < 8; k++) {
        const nx = cx + DX[k];
        const nz = cz + DZ[k];
        if (!grid.walkable(nx, nz)) continue;
        if (k >= 4) {
          // по диагонали нельзя срезать углы
          if (!grid.walkable(cx + DX[k], cz) || !grid.walkable(cx, cz + DZ[k])) continue;
        }
        const ni = nz * w + nx;
        if (closed[ni] === id) continue;
        let step = COST[k] + wallPenalty[ni];
        if (zoneCost) step *= zoneCost[grid.zone[ni]];
        const ng = g[cur] + step;
        if (stamp[ni] !== id || ng < g[ni]) {
          g[ni] = ng;
          const hx = Math.abs(nx - tcx);
          const hz = Math.abs(nz - tcz);
          f[ni] = ng + (hx + hz) + (1.4142 - 2) * Math.min(hx, hz);
          parent[ni] = cur;
          stamp[ni] = id;
          this.push(ni);
        }
      }
    }
    if (!found) return null;

    // восстановление пути
    const cells: number[] = [];
    let c = goal;
    while (c !== -1) {
      cells.push(c);
      c = parent[c];
    }
    cells.reverse();
    const pts: number[] = [];
    for (const cell of cells) {
      const cx = cell % w;
      pts.push(cx + 0.5, (cell - cx) / w + 0.5);
    }
    pts[0] = sx;
    pts[1] = sz;
    pts[pts.length - 2] = tx;
    pts[pts.length - 1] = tz;
    return this.smooth(pts);
  }

  /** «Натягивание нити»: убираем лишние узлы там, где можно пройти по прямой. */
  private smooth(pts: number[]): number[] {
    const { grid } = this;
    const n = pts.length / 2;
    const out: number[] = [];
    let i = 0;
    while (i < n - 1) {
      let j = Math.min(n - 1, i + 24);
      for (; j > i + 1; j--) {
        if (grid.walkLine(pts[i * 2], pts[i * 2 + 1], pts[j * 2], pts[j * 2 + 1])) break;
      }
      out.push(pts[j * 2], pts[j * 2 + 1]);
      i = j;
    }
    return out;
  }

  /** Достижима ли точка (для проверок планировки). */
  reachable(sx: number, sz: number, tx: number, tz: number): boolean {
    return this.find(sx, sz, tx, tz) !== null;
  }
}
