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
import { isTouchDevice, loadUserSettings, lowerQuality, QUALITY_NAMES, resolveQuality, saveUserSettings, type QualityLevel, type QualitySettings, type UserSettings } from './view/Quality';
import { setCheapFigures } from './view/Humanoid';
import { recordCrash, restartApp } from './platform';
import { setTextureScale } from './view/Textures';
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
  /** Шейдеры скомпилированы — можно рисовать (до этого экран чёрный). */
  private ready = false;
  private lost = false;
  gpuName = 'неизвестен';
  frames = 0;

  get qualityLevel(): QualityLevel {
    return this.quality.level;
  }

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    const params = new URLSearchParams(location.search);
    this.touch = isTouchDevice() || params.has('touch') || (typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches);
    this.sr = new SceneRenderer(canvas, this.quality);
    try {
      const gl = this.sr.renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      this.gpuName = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    } catch {
      /* сведения о видеочипе недоступны */
    }
    // потеря графического контекста (видеочип не справился): сохраняемся и перезапускаемся проще
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.onContextLost();
    });
    // на минимальном качестве не перезапускаемся по кругу, а ждём, пока система вернёт видеоконтекст
    canvas.addEventListener('webglcontextrestored', () => {
      if (!this.lost || this.quality.level !== 'minimal') return;
      this.lost = false;
      this.ui.fade.classList.remove('on');
      this.ui.fade.textContent = '';
      requestAnimationFrame(this.frame);
    });
    setTextureScale(this.quality.texScale);
    setCheapFigures(this.quality.cheapMaterials, this.quality.level === 'high' ? 2 : this.quality.level === 'medium' ? 1 : 0);
    this.M = new Materials(this.quality.cheapMaterials);
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
    this.chars.gait = () => ({ phase: this.player.stepPhase, speed: this.player.speed });
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
    else if (this.takeResumeFlag()) this.continueGame();
    // Шейдеры и текстуры готовятся понемногу, по нескольку за кадр. Если скомпилировать всё
    // разом, слабый видеочип надолго «зависает», и система сбрасывает графику.
    this.chars.update(0);
    this.ui.fade.classList.add('on');
    this.ui.fade.textContent = 'Подготовка графики…';
    this.prepareQueue();
    requestAnimationFrame(this.frame);
  }

  private prepQueue: (THREE.Object3D | THREE.Texture)[] = [];
  private prepTotal = 1;

  private prepareQueue(): void {
    const seenMat = new Set<THREE.Material>();
    const seenTex = new Set<THREE.Texture>();
    const objs: THREE.Object3D[] = [];
    const texs: THREE.Texture[] = [];
    this.sr.scene.traverse((o) => {
      const mats = (o as THREE.Mesh).material;
      if (!mats) return;
      const list = Array.isArray(mats) ? mats : [mats];
      let fresh = false;
      for (const m of list) {
        // одинаковый материал на разных типах объектов (сетка, скелетная сетка, экземпляры) — разные программы
        const key = m;
        if (!seenMat.has(key) || (o as THREE.SkinnedMesh).isSkinnedMesh || (o as THREE.InstancedMesh).isInstancedMesh) fresh = true;
        seenMat.add(key);
        for (const v of Object.values(m)) if (v instanceof THREE.Texture && !seenTex.has(v)) {
          seenTex.add(v);
          texs.push(v);
        }
      }
      if (fresh) objs.push(o);
    });
    this.prepQueue = [...texs, ...objs];
    this.prepTotal = Math.max(1, this.prepQueue.length);
  }

  /** Один шаг подготовки графики. Возвращает true, когда всё готово. */
  private prepareStep(): boolean {
    const r = this.sr.renderer;
    const budget = this.quality.level === 'high' ? 8 : this.quality.level === 'medium' ? 4 : 2;
    const t0 = performance.now();
    let n = 0;
    while (this.prepQueue.length && n < budget && performance.now() - t0 < 40) {
      const item = this.prepQueue.shift()!;
      try {
        if (item instanceof THREE.Texture) r.initTexture(item);
        else r.compile(item, this.sr.camera, this.sr.scene);
      } catch (e) {
        console.warn('Подготовка графики:', e);
      }
      n++;
    }
    const pct = Math.round(100 * (1 - this.prepQueue.length / this.prepTotal));
    this.ui.fade.textContent = `Подготовка графики… ${pct}%`;
    return this.prepQueue.length === 0;
  }

  private takeResumeFlag(): boolean {
    try {
      const v = localStorage.getItem('granit.resume');
      localStorage.removeItem('granit.resume');
      return v === '1';
    } catch {
      return false;
    }
  }

  private onContextLost(): void {
    if (this.lost) return;
    this.lost = true;
    const crashes = recordCrash();
    const playing = this.state === 'playing' || this.state === 'paused';
    if (playing) this.save.save('auto');
    try {
      if (playing) localStorage.setItem('granit.resume', '1');
    } catch {
      /* нет хранилища */
    }
    // повторный сбой — сразу минимальное качество
    const next: QualityLevel = crashes >= 2 ? 'minimal' : (lowerQuality(this.quality.level) ?? 'minimal');
    this.settings.quality = next;
    saveUserSettings(this.settings);
    this.ui.fade.classList.add('on');
    if (this.quality.level === 'minimal' && crashes >= 3) {
      // по кругу не перезапускаемся: решение за игроком
      this.ui.showCrashHelp();
      return;
    }
    this.ui.fade.textContent = `Видеочип не справился с нагрузкой. Игра сохранена, перезапуск с качеством «${QUALITY_NAMES[next]}»…`;
    // Android WebView после сбоя блокирует графику до перезапуска приложения целиком
    setTimeout(() => restartApp(), 1500);
  }

  /** Применить новое качество графики: сохранение и перезапуск страницы. */
  restartGraphics(): void {
    if (this.state === 'playing' || this.state === 'paused') {
      this.save.save('auto');
      try {
        localStorage.setItem('granit.resume', '1');
      } catch {
        /* нет хранилища */
      }
    }
    saveUserSettings(this.settings);
    location.reload();
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
    bus.on('player:knockout', ({ hours }) => {
      this.ui.closePanel();
      this.ui.closeDialogue();
      this.sleep(hours * 60, true);
      this.ui.fade.textContent = 'Вы ранены…';
    });
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
  sleep(minutes: number, unconscious = false): void {
    if (this.state !== 'playing') return;
    // без сознания командира не будят ни тревоги, ни донесения
    this.sleeping = { until: this.sim.now + minutes, alert: unconscious ? 9 : this.sim.alert.level, msgs: unconscious ? 1e9 : this.sim.radio.messages.filter((m) => m.priority !== 'routine').length };
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
    if (this.lost) return;
    if (!this.ready) {
      if (this.prepareStep()) {
        this.ready = true;
        if (!this.sleeping) {
          this.ui.fade.classList.remove('on');
          this.ui.fade.textContent = '';
        }
      }
      requestAnimationFrame(this.frame);
      return;
    }
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
        if (this.sleeping) this.ui.fade.textContent = `${this.sleeping.alert === 9 ? 'Без сознания' : 'Отдых'}… ${WorldTimeSystem.clock(sim.now)}`;
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
      // в меню — всегда предрассветные сумерки, чтобы объект был виден
      hour: menu ? 7.1 : sim.time.hour,
      darkness: menu ? 0.42 : sim.time.darkness(),
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
    const gateBusy = sim.supply.vehicles.some((v) => v.state === 'driving' && dist(v.x, v.z, 57.5, 121) < 16) || (!menu && dist(p.x, p.z, 57.5, 121) < 9);
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
