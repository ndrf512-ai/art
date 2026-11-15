import { MONTHS_GEN, START_DAY_OF_MONTH, START_MINUTE } from '../core/constants';
import { clamp01, pad2 } from '../core/math';
import type { Sim } from './Sim';

/** Игровое время: минуты от полуночи первого дня кампании (16 октября 1944 г.). */
export class WorldTimeSystem {
  state = { t: START_MINUTE };

  constructor(private sim: Sim) {}

  reset(): void {
    this.state = { t: START_MINUTE };
  }

  get t(): number {
    return this.state.t;
  }

  get minuteOfDay(): number {
    return this.state.t % 1440;
  }

  get hour(): number {
    return this.minuteOfDay / 60;
  }

  get day(): number {
    return Math.floor(this.state.t / 1440) + 1;
  }

  update(_dt: number, gdt: number): void {
    const prevHour = Math.floor(this.state.t / 60);
    const prevDay = this.day;
    this.state.t += gdt;
    const hour = Math.floor(this.state.t / 60);
    if (hour !== prevHour) this.sim.bus.emit('time:hour', { hour: hour % 24, day: this.day });
    if (this.day !== prevDay) this.sim.bus.emit('time:day', { day: this.day });
  }

  /** 0 — день, 1 — ночь (с сумерками). Восход около 06:40, закат около 17:20. */
  darkness(): number {
    const m = this.minuteOfDay;
    if (m < 350) return 1;
    if (m < 425) return 1 - clamp01((m - 350) / 75);
    if (m < 1010) return 0;
    if (m < 1085) return clamp01((m - 1010) / 75);
    return 1;
  }

  isNight(): boolean {
    const m = this.minuteOfDay;
    return m >= 21 * 60 + 30 || m < 5 * 60 + 30;
  }

  static clock(t: number): string {
    const m = Math.floor(((t % 1440) + 1440) % 1440);
    return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
  }

  clockString(): string {
    return WorldTimeSystem.clock(this.state.t);
  }

  static date(t: number): string {
    const d = START_DAY_OF_MONTH + Math.floor(t / 1440);
    // октябрь 1944 — 31 день
    return d <= 31 ? `${d} ${MONTHS_GEN[9]} 1944` : `${d - 31} ${MONTHS_GEN[10]} 1944`;
  }

  dateString(): string {
    return WorldTimeSystem.date(this.state.t);
  }

  /** Короткая отметка времени для журналов: «2-й день, 14:05». */
  stamp(t = this.state.t): string {
    return `${Math.floor(t / 1440) + 1}-й день, ${WorldTimeSystem.clock(t)}`;
  }

  save(): unknown {
    return this.state;
  }

  load(d: any): void {
    this.state = d;
  }
}
