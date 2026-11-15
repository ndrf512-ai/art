import { clamp, clamp01, damp } from '../core/math';
import type { MetData } from '../core/types';
import type { Sim } from './Sim';

export type WeatherKind = 'clear' | 'overcast' | 'rain' | 'fog' | 'storm' | 'snow';

const PRESET: Record<WeatherKind, { cloud: number; fog: number; rain: number; snow: number; name: string }> = {
  clear: { cloud: 0.15, fog: 0.03, rain: 0, snow: 0, name: 'ясно' },
  overcast: { cloud: 0.85, fog: 0.1, rain: 0, snow: 0, name: 'пасмурно' },
  rain: { cloud: 1, fog: 0.2, rain: 0.65, snow: 0, name: 'дождь' },
  fog: { cloud: 0.7, fog: 0.7, rain: 0, snow: 0, name: 'туман' },
  storm: { cloud: 1, fog: 0.28, rain: 1, snow: 0, name: 'ливень, сильный ветер' },
  snow: { cloud: 1, fog: 0.3, rain: 0, snow: 0.7, name: 'мокрый снег' },
};

const NEXT: Record<WeatherKind, [WeatherKind, number][]> = {
  clear: [['clear', 3], ['overcast', 4], ['fog', 1]],
  overcast: [['overcast', 4], ['rain', 3], ['clear', 2], ['fog', 2], ['snow', 0.6]],
  rain: [['rain', 3], ['overcast', 4], ['storm', 1.5], ['fog', 1]],
  fog: [['fog', 2], ['overcast', 4], ['clear', 1], ['rain', 1]],
  storm: [['rain', 4], ['overcast', 2]],
  snow: [['snow', 2], ['overcast', 3], ['rain', 1]],
};

/** Погода: влияет на видимость, баллистику, настроение и атмосферу. */
export class WeatherSystem {
  state = { kind: 'overcast' as WeatherKind, cloud: 0.85, fog: 0.4, rain: 0, snow: 0, windDir: 250, windSpeed: 4, tempC: 6, pressure: 1006, next: 0, fogBoost: 0.3 };

  constructor(private sim: Sim) {}

  reset(): void {
    this.state = { kind: 'overcast', cloud: 0.85, fog: 0.4, rain: 0, snow: 0, windDir: 250, windSpeed: 4, tempC: 6, pressure: 1006, next: this.sim.now + 150, fogBoost: 0.3 };
  }

  get name(): string {
    return PRESET[this.state.kind].name;
  }

  update(dt: number, gdt: number): void {
    const s = this.state;
    const now = this.sim.now;
    if (now >= s.next) {
      const opts = NEXT[s.kind].filter(([k]) => k !== 'snow' || this.sim.time.day >= 3);
      const pick = this.sim.rng.weighted(opts, (o) => o[1]);
      s.kind = pick ? pick[0] : 'overcast';
      s.next = now + this.sim.rng.range(120, 300);
      s.windDir = (s.windDir + this.sim.rng.range(-50, 50) + 360) % 360;
      s.windSpeed = clamp(this.sim.rng.gauss(s.kind === 'storm' ? 13 : s.kind === 'fog' ? 1.5 : 5, 2.5), 0, 20);
      s.pressure = clamp(s.pressure + this.sim.rng.range(-5, 5), 985, 1028);
      this.sim.bus.emit('weather:changed', { kind: s.kind });
    }
    const p = PRESET[s.kind];
    // утренний туман
    const m = this.sim.time.minuteOfDay;
    s.fogBoost = m > 240 && m < 480 ? 0.22 : 0;
    const rate = 0.02 * (gdt / Math.max(dt, 1e-6)) * 0.5;
    s.cloud = damp(s.cloud, p.cloud, rate, dt);
    s.fog = damp(s.fog, clamp01(p.fog + s.fogBoost), rate, dt);
    s.rain = damp(s.rain, p.rain, rate, dt);
    s.snow = damp(s.snow, p.snow, rate, dt);
    const base = 7 + 5 * Math.sin(((m - 540) / 1440) * Math.PI * 2) - (this.sim.time.day - 1) * 0.6;
    s.tempC = damp(s.tempC, base - (s.kind === 'snow' ? 6 : s.kind === 'clear' ? -1 : 0), rate, dt);
  }

  /** Множитель дальности видимости 0.1..1. */
  visibility(): number {
    const s = this.state;
    return clamp(1 - 0.8 * s.fog - 0.3 * s.rain - 0.3 * s.snow, 0.1, 1);
  }

  /** Истинные метеоусловия на траектории. */
  met(): MetData {
    const s = this.state;
    return { t: this.sim.now, windSpeed: s.windSpeed * 1.8, windDir: s.windDir, tempC: s.tempC, pressure: s.pressure };
  }

  save(): unknown {
    return this.state;
  }

  load(d: any): void {
    this.state = d;
  }
}
