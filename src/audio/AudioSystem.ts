/**
 * AudioSystem — звук целиком синтезируется (Web Audio), файлов нет.
 * Внутри бункера всё звучит гулко и глухо, снаружи — открыто: общий тракт
 * переключает фильтр и долю реверберации по положению командира.
 */
export interface AudioEnv {
  indoor: boolean;
  wind: number;
  rain: number;
  /** Громкость гула генератора 0..1 (с учётом расстояния и питания). */
  generator: number;
  ventilation: number;
  radio: number;
  alert: number;
  pressure: number;
  workNear: boolean;
}

export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private dry!: GainNode;
  private wet!: GainNode;
  private outFilter!: BiquadFilterNode;
  private noise!: AudioBuffer;
  private wind!: GainNode;
  private rain!: GainNode;
  private gen!: GainNode;
  private vent!: GainNode;
  private staticG!: GainNode;
  private siren: { o: OscillatorNode; g: GainNode } | null = null;
  private thudT = 20;
  private clankT = 3;
  private morseT = 2;
  private sirenUntil = 0;
  private lastAlert = 0;
  volume = 0.8;
  enabled = true;

  /** Вызывать из обработчика жеста пользователя. */
  resume(): void {
    if (!this.enabled) return;
    try {
      if (!this.ctx) this.init();
      if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      this.enabled = false;
    }
  }

  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.ctx) this.master.gain.value = v;
  }

  private init(): void {
    const AC: typeof AudioContext = (window as any).AudioContext ?? (window as any).webkitAudioContext;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(ctx.destination);
    this.dry = ctx.createGain();
    this.dry.connect(this.master);
    // импульс «бетонного» помещения
    const len = Math.floor(ctx.sampleRate * 1.6);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    const conv = ctx.createConvolver();
    conv.buffer = ir;
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.1;
    this.wet.connect(conv);
    conv.connect(this.master);
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = this.noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    // уличные шумы проходят через общий фильтр: в бункере они глухие
    this.outFilter = ctx.createBiquadFilter();
    this.outFilter.type = 'lowpass';
    this.outFilter.frequency.value = 9000;
    this.outFilter.connect(this.dry);
    const loop = (type: BiquadFilterType, freq: number, q: number, dest: AudioNode): GainNode => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f);
      f.connect(g);
      g.connect(dest);
      src.start();
      return g;
    };
    this.wind = loop('bandpass', 380, 0.4, this.outFilter);
    this.rain = loop('highpass', 1800, 0.3, this.outFilter);
    this.vent = loop('lowpass', 210, 0.7, this.dry);
    this.staticG = loop('bandpass', 2300, 1.2, this.dry);
    this.gen = ctx.createGain();
    this.gen.gain.value = 0;
    const gf = ctx.createBiquadFilter();
    gf.type = 'lowpass';
    gf.frequency.value = 240;
    gf.connect(this.gen);
    this.gen.connect(this.dry);
    this.gen.connect(this.wet);
    for (const [f, type] of [
      [46, 'sawtooth'],
      [92.5, 'square'],
      [139, 'sawtooth'],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const og = ctx.createGain();
      og.gain.value = f < 60 ? 0.5 : 0.18;
      o.connect(og);
      og.connect(gf);
      o.start();
    }
  }

  private burst(dur: number, type: BiquadFilterType, f0: number, f1: number, gain: number, when = 0, reverb = 0.3, q = 0.7): void {
    const ctx = this.ctx;
    if (!ctx || gain <= 0.001) return;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loopStart = Math.random();
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + Math.min(0.02, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.dry);
    if (reverb > 0) {
      const w = ctx.createGain();
      w.gain.value = reverb;
      g.connect(w);
      w.connect(this.wet);
    }
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  private tone(freq: number, dur: number, gain: number, type: OscillatorType = 'sine', when = 0, f1?: number, reverb = 0.2): void {
    const ctx = this.ctx;
    if (!ctx || gain <= 0.001) return;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    o.connect(g);
    g.connect(this.dry);
    if (reverb > 0) {
      const w = ctx.createGain();
      w.gain.value = reverb;
      g.connect(w);
      w.connect(this.wet);
    }
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  step(indoor: boolean, run: boolean): void {
    const g = run ? 0.16 : 0.1;
    if (indoor) this.burst(0.07, 'bandpass', 900 + Math.random() * 300, 500, g, 0, 0.6, 1.5);
    else this.burst(0.09, 'lowpass', 500 + Math.random() * 200, 200, g * 0.9, 0, 0.05);
  }

  /** Выстрел своего орудия на расстоянии d метров. */
  gun(d: number, big: boolean): void {
    const k = Math.min(1, 14 / (d + 6)) * (big ? 1.5 : 1);
    const delay = d / 340;
    this.burst(big ? 1.6 : 1.0, 'lowpass', big ? 2600 : 3400, 60, 1.1 * k, delay, 0.7);
    this.tone(big ? 46 : 62, big ? 1.4 : 0.8, 0.9 * k, 'sine', delay, 28, 0.5);
    this.burst(2.5, 'lowpass', 400, 50, 0.3 * k, delay + 0.25, 0.9);
  }

  explosion(d: number, size: number): void {
    const k = Math.min(1, 16 / (d + 8)) * size;
    const delay = d / 340;
    this.burst(0.9, 'lowpass', 2200, 70, 1.0 * k, delay, 0.8);
    this.tone(55, 0.9, 0.8 * k, 'sine', delay, 30, 0.6);
    this.burst(1.8, 'bandpass', 900, 200, 0.25 * k, delay + 0.1, 0.9);
  }

  rifle(d: number): void {
    const k = Math.min(1, 9 / (d + 5));
    this.burst(0.12, 'highpass', 1400, 600, 0.55 * k, d / 340, 0.5);
    this.burst(0.5, 'lowpass', 900, 120, 0.25 * k, d / 340 + 0.03, 0.8);
  }

  phone(d: number): void {
    const k = Math.min(1, 6 / (d + 3)) * 0.25;
    for (let r = 0; r < 2; r++) {
      for (let i = 0; i < 9; i++) {
        this.tone(1320, 0.05, k, 'square', r * 0.9 + i * 0.055, undefined, 0.4);
        this.tone(1760, 0.05, k * 0.6, 'square', r * 0.9 + i * 0.055 + 0.027, undefined, 0.4);
      }
    }
  }

  beep(): void {
    this.tone(880, 0.06, 0.08, 'square', 0, undefined, 0.2);
    this.tone(660, 0.09, 0.08, 'square', 0.08, undefined, 0.2);
  }

  click(): void {
    this.burst(0.02, 'highpass', 3000, 2000, 0.06, 0, 0);
  }

  /** Неразборчивая речь: несколько «слогов». */
  murmur(d: number): void {
    const k = Math.min(1, 4 / (d + 2)) * 0.11;
    const base = 105 + Math.random() * 50;
    const n = 4 + Math.floor(Math.random() * 5);
    for (let i = 0; i < n; i++) {
      const t = i * (0.11 + Math.random() * 0.05);
      this.tone(base * (0.9 + Math.random() * 0.4), 0.09, k, 'sawtooth', t, undefined, 0.5);
      this.burst(0.06, 'bandpass', 600 + Math.random() * 900, 500, k * 0.8, t, 0.5, 3);
    }
  }

  plane(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const f of [78, 81.5, 117]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f * 1.06, t);
      o.frequency.linearRampToValueAtTime(f * 0.93, t + 22);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.09, t + 9);
      g.gain.linearRampToValueAtTime(0, t + 22);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 420;
      o.connect(lp);
      lp.connect(g);
      g.connect(this.outFilter);
      o.start(t);
      o.stop(t + 23);
    }
  }

  private startSiren(): void {
    const ctx = this.ctx;
    if (!ctx || this.siren) return;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const g = ctx.createGain();
    g.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1500;
    o.connect(lp);
    lp.connect(g);
    g.connect(this.dry);
    g.connect(this.wet);
    o.start();
    this.siren = { o, g };
  }

  update(dt: number, env: AudioEnv): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const set = (p: AudioParam, v: number, tc = 0.4) => p.setTargetAtTime(v, t, tc);
    set(this.outFilter.frequency, env.indoor ? 420 : 9000);
    set(this.wet.gain, env.indoor ? 0.5 : 0.07);
    set(this.wind.gain, (0.03 + env.wind * 0.012) * (env.indoor ? 0.5 : 1));
    set(this.rain.gain, env.rain * 0.16);
    set(this.gen.gain, env.generator * 0.22);
    set(this.vent.gain, env.ventilation * 0.1);
    set(this.staticG.gain, env.radio * 0.02);
    // сирена при объявлении тревоги
    if (env.alert >= 2 && env.alert > this.lastAlert) this.sirenUntil = t + (env.alert === 3 ? 24 : 12);
    this.lastAlert = env.alert;
    if (t < this.sirenUntil) {
      this.startSiren();
      const s = this.siren!;
      const ph = (t % 6) / 6;
      s.o.frequency.setTargetAtTime(ph < 0.55 ? 520 : 300, t, 0.9);
      set(s.g.gain, env.indoor ? 0.035 : 0.07, 0.3);
    } else if (this.siren) set(this.siren.g.gain, 0, 0.5);
    // далёкая канонада
    this.thudT -= dt;
    if (this.thudT <= 0) {
      this.thudT = 6 + Math.random() * 50 * (1.2 - env.pressure);
      const g = (0.05 + env.pressure * 0.12) * (env.indoor ? 0.4 : 1);
      this.tone(38 + Math.random() * 14, 1.6, g, 'sine', 0, 26, 0.9);
      this.burst(2.2, 'lowpass', 160, 40, g * 0.7, 0.05, 0.9);
    }
    this.clankT -= dt;
    if (env.workNear && this.clankT <= 0) {
      this.clankT = 0.5 + Math.random() * 2.5;
      const f = 1500 + Math.random() * 1900;
      this.tone(f, 0.16, 0.05, 'triangle', 0, f * 0.97, 0.7);
      this.tone(f * 2.4, 0.08, 0.025, 'sine', 0, undefined, 0.7);
    }
    this.morseT -= dt;
    if (env.radio > 0.2 && this.morseT <= 0) {
      this.morseT = 1.5 + Math.random() * 4;
      let tt = 0;
      const n = 3 + Math.floor(Math.random() * 6);
      for (let i = 0; i < n; i++) {
        const dash = Math.random() < 0.4;
        this.tone(720, dash ? 0.16 : 0.06, 0.03 * env.radio, 'sine', tt, undefined, 0.3);
        tt += dash ? 0.22 : 0.12;
      }
    }
  }
}
