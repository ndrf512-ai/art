export const TAU = Math.PI * 2;

export interface Vec2 {
  x: number;
  z: number;
}

export function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

export function dist(ax: number, az: number, bx: number, bz: number): number {
  return Math.hypot(bx - ax, bz - az);
}

export function dist2(ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  return dx * dx + dz * dz;
}

/** Приводит угол к диапазону (-PI, PI]. */
export function wrapAngle(a: number): number {
  a = a % TAU;
  if (a > Math.PI) a -= TAU;
  if (a <= -Math.PI) a += TAU;
  return a;
}

/** Курс (yaw) на точку: 0 — на юг (+z), PI/2 — на восток (+x). */
export function yawTo(dx: number, dz: number): number {
  return Math.atan2(dx, dz);
}

export function approachAngle(cur: number, target: number, maxStep: number): number {
  const d = wrapAngle(target - cur);
  if (Math.abs(d) <= maxStep) return target;
  return wrapAngle(cur + Math.sign(d) * maxStep);
}

export function approach(cur: number, target: number, maxStep: number): number {
  if (Math.abs(target - cur) <= maxStep) return target;
  return cur + Math.sign(target - cur) * maxStep;
}

export function pad2(n: number): string {
  return n < 10 ? '0' + n : '' + n;
}

/** Плавное экспоненциальное приближение, не зависящее от частоты кадров. */
export function damp(cur: number, target: number, rate: number, dt: number): number {
  return lerp(cur, target, 1 - Math.exp(-rate * dt));
}
