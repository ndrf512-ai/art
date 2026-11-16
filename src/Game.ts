/**
 * Game — клиентская часть: связывает симуляцию с графикой, звуком, вводом и
 * интерфейсом. Симуляция о графике не знает; сюда приходят её события.
 */
import * as THREE from 'three';
import { AudioSystem } from './audio/AudioSystem';
import { clamp, damp, dist } from './core/math';
import { PlayerController } from './player/PlayerController';
import { SaveSystem } from './sim/SaveSystem';
import { Sim, type Gender } from './sim/Sim';
import { WorldTimeSystem } from './sim/WorldTimeSystem';
import type { GameApi } from './ui/UIManager';
import { UIManager } from './ui/UIManager';
import { CharacterView } from './view/CharacterView';
import { Effects } from './view/Effects';
import { MachineView } from './view/MachineView';
import { Materials } from './view/Materials';
import { isTouchDevice, loadUserSettings, resolveQuality, saveUserSettings, type QualitySettings, type UserSettings } from './view/Quality';
import { SceneRenderer, type EnvState } from './view/SceneRenderer';
import { buildPhone } from './view/Props';
import { Batcher } from './view/Batcher';
import { buildWorld, type WorldView } from './view/WorldBuilder';

const DEG = Math.PI / 180;

export class Game implements GameApi {
  readonly sim = new Sim(1944);
  readonly save = new SaveSystem(this.sim);
  readonly settings: UserSettings = loadUserSettings();
  readonly quality: QualitySettings = resolveQuality(this.settings);
  readonly audio = new AudioSystem();
  readonly sr: SceneRenderer;
  readonly player: PlayerController;
  readonly ui: UIManager;
  readonly touch: boolean;
  private M: Materials;
  private world: WorldView;
  private chars: CharacterView;
  private machines: MachineView;
  private fx: Effects;
  state: GameApi['state'] = 'menu';
  warp = 1;
  private last = performance.now();
  private obstacles: { x: number; z: number; r: number }[] = [];
  private sleeping: { until: number; alert: number; msgs: number } | null = null;
  private focus = new THREE.Vector3(60, 0, 80);
  private barrier = 0;
  private menuT = 0;
  frames = 0;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    const params = new URLSearchParams(location.search);
    this.touch = isTouchDevice() || params.has('touch') || (typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches);
    this.sr = new SceneRenderer(canvas, this.quality);
    this.M = new Materials();
    this.sim.newGame({ seed: 1944 });
    this.world = buildWorld(this.sim.layout, this.M, this.quality.treeDensity);
    this.sr.scene.add(this.world.group);
    // телефонные аппараты на столах и стенах
    const pb = new Batcher();
    for (const it of this.sim.layout.interactables) if (it.kind === 'phone') buildPhone(pb, this.M, it.x, it.y, it.z, this.sim.grid.indoorAt(it.x, it.z));
    for (const m of pb.build()) this.sr.scene.add(m);
    this.sr.setLamps(this.sim.layout.lamps);
    this.sr.sun.shadow.camera.layers.enable(1);
    this.chars = new CharacterView(this.sim, this.sr.scene, this.sr.camera, this.world, this.M.black1, this.quality);
    this.machines = new MachineView(this.sim, this.sr.scene, this.M);
    this.fx = new Effects(this.sr.scene, Math.round(140 * this.quality.particles));
    this.player = new PlayerController(this.sim, this.sr.camera, canvas);
    this.ui = new UIManager(uiRoot, this);
    this.player.onInteract = (t) => this.ui.interact(t);
    this.player.onStep = (indoor, run) => this.audio.step(indoor, run);
    this.player.onKey = (code) => this.ui.onKey(code);
    this.applySettings();
    this.bind();
    window.addEventListener('resize', () => this.sr.resize());
    const wake = (): void => this.audio.resume();
    window.addEventListener('pointerdown', wake);
    window.addEventListener('keydown', wake);
    window.addEventListener('touchstart', wake);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.onAppPause();
      else this.audio.resume();
    });
    const w = window as any;
    w.__granitBack = () => this.ui.back();
    w.__granitPause = () => this.onAppPause();
    w.__granitResume = () => this.audio.resume();
    w.__game = this;

    this.ui.mainMenu();
    const auto = params.get('autostart');
    if (auto) this.newGame(auto === 'f' ? 'f' : 'm');
    requestAnimationFrame(this.frame);
  }

  private onAppPause(): void {
    if (this.state === 'playing' || this.state === 'paused') this.save.save('auto');
    this.audio.suspend();
  }

  private bind(): void {
    const sim = this.sim;
    const bus = sim.bus;
    const p = () => sim.player;
    const vibrate = (ms: number): void => {
      try {
        navigator.vibrate?.(ms);
      } catch {
        /* нет вибрации */
      }
    };
    bus.on('arty:shot', ({ gun }) => {
      const g = sim.artillery.gun(gun);
      const big = gun === 'gun1';
      const m = this.machines.muzzle(gun);
      const az = g.azimuth * DEG;
      const el = g.elevation * DEG;
      this.fx.muzzle(m, Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el), big);
      const d = dist(p().x, p().z, g.x, g.z);
      const k = (big ? 70 : 28) / (d + 6) * (p().indoor ? 0.5 : 1);
      this.sr.shake = Math.max(this.sr.shake, clamp(k, 0, 1.6));
      this.audio.gun(d, big);
      if (k > 0.3) vibrate(big ? 220 : 90);
    });
    bus.on('world:explosion', ({ x, z, size }) => {
      this.fx.explosion(x, z, size);
      const d = dist(p().x, p().z, x, z);
      this.sr.shake = Math.max(this.sr.shake, clamp((30 * size) / (d + 5), 0, 1.8));
      this.audio.explosion(d, size);
      if (d < 40) vibrate(160);
    });
    bus.on('world:gunshot', ({ x, z, tx, tz }) => {
      this.fx.tracer(x, z, tx, tz);
      this.audio.rifle(dist(p().x, p().z, x, z));
    });
    bus.on('world:fire', ({ x, z, on, id }) => this.fx.setFire(id, x, z, on));
    bus.on('world:plane', () => this.audio.plane());
    bus.on('time:day', () => {
      if (this.state === 'playing') this.save.save('auto');
    });
    bus.on('radio:message', ({ msg }) => {
      if (msg.priority !== 'routine') this.audio.phone(dist(p().x, p().z, 61.5, 34.5));
    });
    bus.on('load:done', () => {
      this.chars.clear();
      this.fx.clearFires();
      for (const f of sim.sabotage.state.fires) this.fx.setFire(f.id, f.x, f.z, true);
    });
  }

  // ------------------------------------------------------------------ GameApi

  newGame(gender: Gender): void {
    this.state = 'playing';
    this.warp = 1;
    this.sleeping = null;
    this.ui.setOverlay(false);
    this.ui.showHud(true);
    this.chars.clear();
    this.fx.clearFires();
    this.sim.newGame({ gender });
    this.ui.syncWarp();
    this.audio.resume();
  }

  continueGame(): boolean {
    const l = this.save.latest();
    return l ? this.loadSlot(l.slot) : false;
  }

  loadSlot(slot: string): boolean {
    if (!this.save.load(slot)) {
      this.ui.note('Не удалось загрузить сохранение.', 'warn');
      return false;
    }
    this.state = 'playing';
    this.warp = 1;
    this.sleeping = null;
    this.ui.fade.classList.remove('on');
    this.ui.setOverlay(false);
    this.ui.showHud(true);
    this.ui.syncWarp();
    return true;
  }

  saveSlot(slot: string): boolean {
    const ok = this.save.save(slot);
    if (!ok) this.ui.note('Не удалось сохранить игру.', 'warn');
    return ok;
  }

  setWarp(w: number): void {
    this.warp = w;
  }

  setPaused(p: boolean): void {
    if (this.state === 'playing' && p) this.state = 'paused';
    else if (this.state === 'paused' && !p) this.state = 'playing';
  }

  /** Отдых командира: время идёт быстро, мир продолжает жить. */
  sleep(minutes: number): void {
    if (this.state !== 'playing') return;
    this.sleeping = { until: this.sim.now + minutes, alert: this.sim.alert.level, msgs: this.sim.radio.messages.filter((m) => m.priority !== 'routine').length };
    this.ui.fade.classList.add('on');
    this.sim.player.busy = true;
  }

  private wake(reason: string): void {
    this.sleeping = null;
    this.ui.fade.classList.remove('on');
    this.ui.fade.textContent = '';
    this.sim.player.busy = false;
    this.save.save('auto');
    if (reason) this.ui.note(reason, 'warn');
  }

  toMenu(): void {
    if (this.state === 'playing' || this.state === 'paused') this.save.save('auto');
    this.state = 'menu';
    this.warp = 1;
    this.sleeping = null;
    this.ui.fade.classList.remove('on');
    this.ui.mainMenu();
  }

  applySettings(): void {
    this.player.sensitivity = this.settings.sensitivity;
    this.player.invertY = this.settings.invertY;
    this.audio.setVolume(this.settings.volume);
    this.sr.autoRes = this.settings.autoRes;
    saveUserSettings(this.settings);
  }

  exitApp(): void {
    this.onAppPause();
    (window as any).AndroidBridge?.exitApp?.();
  }

  fps(): number {
    return this.sr.fps();
  }

  // ------------------------------------------------------------------ кадр

  private frame = (): void => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const sim = this.sim;
    if (this.state === 'playing') {
      if (this.sleeping) {
        for (let i = 0; i < 40 && this.sleeping; i++) {
          sim.update(0.1);
          const s = this.sleeping;
          const urgent = sim.radio.messages.filter((m) => m.priority !== 'routine').length;
          if (sim.now >= s.until) this.wake('');
          else if (sim.alert.level > s.alert && sim.alert.level >= 1) this.wake('Вас разбудили: тревога.');
          else if (urgent > s.msgs) this.wake('Вас разбудили: срочное донесение.');
          else if (sim.missions.state.ended) this.wake('');
        }
        if (this.sleeping) this.ui.fade.textContent = `Отдых… ${WorldTimeSystem.clock(sim.now)}`;
      } else {
        const steps = this.warp;
        const sdt = this.warp > 1 ? Math.min(dt, 0.05) : dt;
        for (let i = 0; i < steps; i++) sim.update(sdt);
      }
      this.obstacles.length = 0;
      this.machines.obstacles(this.obstacles);
      this.player.update(dt, this.obstacles);
    } else if (this.state === 'menu') {
      // фон меню: объект живёт, камера медленно облетает двор
      sim.update(dt);
      this.menuT += dt * 0.035;
      const cam = this.sr.camera;
      cam.position.set(78 + Math.sin(this.menuT) * 62, 19, 92 + Math.cos(this.menuT) * 40);
      cam.lookAt(78, 2, 74);
      sim.player.x = 57.5;
      sim.player.z = 140;
    }
    this.render(dt);
    this.frames++;
    if (!(window as any).__stop) requestAnimationFrame(this.frame);
  };

  private render(dt: number): void {
    const sim = this.sim;
    const p = sim.player;
    const w = sim.weather.state;
    const power = sim.resources.state.power;
    const menu = this.state === 'menu';
    const env: EnvState = {
      hour: sim.time.hour,
      darkness: sim.time.darkness(),
      cloud: w.cloud,
      fog: Math.min(1, w.fog + w.rain * 0.12 + w.snow * 0.15),
      power,
      yardLights: !sim.alert.state.blackout,
      alert: sim.alert.level,
      indoor: !menu && p.indoor,
      flashlight: !menu && p.flashlight,
    };
    this.chars.update(dt);
    this.machines.update(dt);
    this.world.setHangarDoor(sim.artillery.state.hangarDoor);
    const gateBusy = sim.supply.vehicles.some((v) => v.state === 'driving' && dist(v.x, v.z, 57.5, 121) < 16);
    this.barrier = damp(this.barrier, gateBusy ? 1 : 0, 3, dt);
    this.world.setBarrier(this.barrier);
    this.sr.update(dt, env);
    // лампочки и ореолы
    const yardOn = env.yardLights && power > 0 && env.darkness > 0.4;
    this.M.bulbIn.color.setRGB(power > 0 ? 1 : 0.06, power > 0 ? 0.88 : 0.06, power > 0 ? 0.66 : 0.06);
    this.M.bulbOut.color.setRGB(yardOn ? 1 : 0.07, yardOn ? 0.88 : 0.07, yardOn ? 0.66 : 0.07);
    this.world.haloIn.visible = power > 0;
    this.world.haloOut.visible = yardOn;

    if (!p.indoor || menu) this.focus.set(this.sr.camera.position.x, 0, this.sr.camera.position.z);
    const wa = ((w.windDir + 180) * Math.PI) / 180;
    this.fx.wind.x = Math.sin(wa) * w.windSpeed * 0.25;
    this.fx.wind.z = -Math.cos(wa) * w.windSpeed * 0.25;
    const gen = sim.repair.get('generator');
    this.fx.update(dt, this.sr.camera.position, { rain: w.rain, snow: w.snow, exhaust: power >= 1 && !gen.broken ? this.world.exhaust : null, outdoorFocus: this.focus });

    const dGen = dist(p.x, p.z, 17.5, 50.5);
    let workNear = false;
    for (const n of sim.npcs.list) {
      if ((n.anim === 'repair' || n.anim === 'repair_low' || n.anim === 'work') && !n.moving && n.status === 'active' && dist(n.x, n.z, p.x, p.z) < 14) {
        workNear = true;
        break;
      }
    }
    this.audio.update(dt, {
      indoor: env.indoor,
      wind: w.windSpeed,
      rain: w.rain,
      generator: power > 0 ? clamp(1 - dGen / 45, 0, 1) * (p.indoor ? 1 : 0.35) : 0,
      ventilation: p.indoor && power > 0 && !sim.repair.get('ventilation').broken ? 0.6 : 0,
      radio: sim.resources.state.radio ? clamp(1 - dist(p.x, p.z, 80, 33) / 11, 0, 1) : 0,
      alert: sim.alert.level,
      pressure: sim.enemy.state.pressure,
      workNear,
    });
    this.ui.update(dt);
    this.sr.render(dt);
  }
}
