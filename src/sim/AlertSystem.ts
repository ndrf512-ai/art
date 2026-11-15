import { ALERT_NAMES, type AlertLevel } from '../core/types';
import type { Sim } from './Sim';

/**
 * Уровни тревоги. Сама система лишь хранит уровень и оповещает; поведение меняют
 * подписчики: охрана, расписание, артиллерия, контроль доступа.
 */
export class AlertSystem {
  state = { level: 0 as AlertLevel, since: 0, reason: '', airRaid: false, blackout: false };

  constructor(private sim: Sim) {}

  reset(): void {
    this.state = { level: 0, since: 0, reason: '', airRaid: false, blackout: false };
  }

  get level(): AlertLevel {
    return this.state.level;
  }

  set(level: AlertLevel, reason: string, silent = false): void {
    const prev = this.state.level;
    if (prev === level) return;
    this.state.level = level;
    this.state.since = this.sim.now;
    this.state.reason = reason;
    this.sim.bus.emit('alert:changed', { level, prev, reason });
    if (!silent) this.sim.notify(`Тревога: ${ALERT_NAMES[level]}. ${reason}`, level >= 2 ? 'alarm' : level === 1 ? 'warn' : 'good');
  }

  /** Повысить уровень, если он ниже указанного. */
  raise(level: AlertLevel, reason: string): void {
    if (level > this.state.level) this.set(level, reason);
  }

  setAirRaid(on: boolean): void {
    this.state.airRaid = on;
    this.state.blackout = on;
  }

  save(): unknown {
    return this.state;
  }

  load(d: any): void {
    this.state = d;
  }
}
