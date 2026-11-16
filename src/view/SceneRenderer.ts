/**
 * Рендерер сцены: небо, солнце и луна, туман, пул ламп, фонарь командира,
 * автоподстройка разрешения под частоту кадров.
 */
import * as THREE from 'three';
import { clamp, clamp01, damp, lerp } from '../core/math';
import type { LampDef } from '../core/types';
import { lightUniforms } from './Materials';
import type { QualitySettings } from './Quality';

export interface EnvState {
  hour: number;
  darkness: number;
  cloud: number;
  fog: number;
  /** 0 — нет питания, 0.35 — резервный генератор, 1 — норма. */
  power: number;
  yardLights: boolean;
  alert: number;
  indoor: boolean;
  flashlight: boolean;
}

const C = (r: number, g: number, b: number) => new THREE.Color(r, g, b);
const DAY_CLEAR_TOP = C(0.2, 0.4, 0.7);
const DAY_CLEAR_HOR = C(0.6, 0.72, 0.84);
const DAY_OVER_TOP = C(0.4, 0.44, 0.48);
const DAY_OVER_HOR = C(0.58, 0.6, 0.61);
const NIGHT_TOP = C(0.01, 0.014, 0.028);
const NIGHT_HOR = C(0.028, 0.036, 0.055);
const TWILIGHT = C(0.82, 0.44, 0.24);
const INDOOR_FOG = C(0.016, 0.016, 0.014);

interface PoolSlot {
  light: THREE.PointLight;
  lamp: LampDef | null;
  k: number;
}

/**
 * Создание WebGL-рендерера с запасными вариантами: некоторые мобильные WebView
 * не дают контекст с запрошенными параметрами, но дают с более скромными.
 */
function createRenderer(canvas: HTMLCanvasElement, q: QualitySettings): THREE.WebGLRenderer {
  const attempts: THREE.WebGLRendererParameters[] = [
    { antialias: q.antialias, powerPreference: q.level === 'high' ? 'high-performance' : 'default', stencil: false, failIfMajorPerformanceCaveat: false },
    { antialias: false, powerPreference: 'default', stencil: false, failIfMajorPerformanceCaveat: false },
    { antialias: false, powerPreference: 'low-power', stencil: false, depth: true, alpha: false, failIfMajorPerformanceCaveat: false },
  ];
  let last: unknown = null;
  for (const a of attempts) {
    try {
      return new THREE.WebGLRenderer({ canvas, ...a });
    } catch (e) {
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error('WebGL недоступен');
}

export class SceneRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly flashlight: THREE.SpotLight;
  private sky: THREE.Mesh;
  private skyUniforms: Record<string, { value: any }>;
  private stars: THREE.Points;
  private pool: PoolSlot[] = [];
  private lamps: LampDef[] = [];
  private poolTimer = 0;
  private indoorK = 0;
  private fog: THREE.FogExp2;
  private frameMs = 16;
  private resTimer = 0;
  private pixelRatio: number;
  private tmp = new THREE.Vector3();
  private fwd = new THREE.Vector3();
  time = 0;
  autoRes = true;
  /** Сотрясение камеры (выстрел, разрыв). */
  shake = 0;

  constructor(
    canvas: HTMLCanvasElement,
    readonly quality: QualitySettings,
  ) {
    this.renderer = createRenderer(canvas, quality);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = quality.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, quality.pixelRatioCap);
    this.renderer.setPixelRatio(this.pixelRatio);

    this.camera = new THREE.PerspectiveCamera(72, 1, 0.08, 1400);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    this.fog = new THREE.FogExp2(0x8a8f92, 0.004);
    this.scene.fog = this.fog;

    this.hemi = new THREE.HemisphereLight(0xa8b4c0, 0x3a3428, 1);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff0dc, 3);
    this.sun.castShadow = quality.shadows;
    this.sun.shadow.mapSize.set(quality.shadowSize, quality.shadowSize);
    const sc = this.sun.shadow.camera;
    sc.left = -52;
    sc.right = 52;
    sc.top = 52;
    sc.bottom = -52;
    sc.near = 10;
    sc.far = 320;
    this.sun.shadow.bias = -0.0007;
    this.sun.shadow.normalBias = 0.05;
    this.scene.add(this.sun, this.sun.target);

    this.flashlight = new THREE.SpotLight(0xfff2d8, 0, 34, 0.46, 0.55, 1.3);
    // на минимальном качестве прожектор фонаря не участвует в шейдерах (каждый источник света дорог)
    if (quality.level !== 'minimal') this.scene.add(this.flashlight, this.flashlight.target);

    // небесный купол
    this.skyUniforms = {
      top: { value: DAY_OVER_TOP.clone() },
      hor: { value: DAY_OVER_HOR.clone() },
      sunDir: { value: new THREE.Vector3(0, 1, 0) },
      sunCol: { value: new THREE.Color(1, 0.9, 0.7) },
    };
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(1200, 24, 12),
      new THREE.ShaderMaterial({
        uniforms: this.skyUniforms,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `
          varying vec3 vDir; uniform vec3 top; uniform vec3 hor; uniform vec3 sunDir; uniform vec3 sunCol;
          void main(){
            vec3 d = normalize(vDir);
            float h = clamp(d.y, 0.0, 1.0);
            vec3 c = mix(hor, top, pow(h, 0.5));
            c = mix(c, hor * 0.82, clamp(-d.y * 6.0, 0.0, 1.0));
            float s = max(dot(d, sunDir), 0.0);
            c += sunCol * (pow(s, 48.0) * 0.35 + pow(s, 900.0) * 6.0);
            gl_FragColor = vec4(c, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      }),
    );
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    this.scene.add(this.sky);

    const starPos: number[] = [];
    for (let i = 0; i < 700; i++) {
      const a = Math.random() * Math.PI * 2;
      const e = Math.asin(Math.random() * 0.95 + 0.03);
      starPos.push(Math.cos(a) * Math.cos(e) * 1100, Math.sin(e) * 1100, Math.sin(a) * Math.cos(e) * 1100);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xcfd8ff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -9;
    this.scene.add(this.stars);

    for (let i = 0; i < quality.poolLights; i++) {
      const light = new THREE.PointLight(0xffc88c, 0, 13, 1.5);
      this.scene.add(light);
      this.pool.push({ light, lamp: null, k: 0 });
    }
    this.resize();
  }

  setLamps(lamps: LampDef[]): void {
    this.lamps = lamps;
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  /** Обновление окружения. Вызывается каждый кадр перед render(). */
  update(dt: number, env: EnvState): void {
    this.time += dt;
    const cam = this.camera;
    const dark = env.darkness;
    const day = 1 - dark;

    // солнце / луна
    const f = clamp01((env.hour - 6.67) / 10.67);
    const sunDir = this.tmp.set(Math.cos(Math.PI * f), Math.sin(Math.PI * f) * 0.56 + 0.04, Math.sin(Math.PI * f) * 0.75 + 0.2).normalize();
    const useMoon = dark > 0.85;
    if (useMoon) sunDir.set(-0.45, 0.72, 0.5).normalize();
    const sunI = useMoon ? 0.22 * (1 - 0.6 * env.cloud) : 3.3 * Math.pow(day, 1.4) * (1 - 0.78 * env.cloud);
    this.sun.intensity = sunI;
    if (useMoon) this.sun.color.setRGB(0.56, 0.66, 0.86);
    else this.sun.color.setRGB(1, lerp(0.72, 0.95, clamp01(sunDir.y * 2.4)), lerp(0.5, 0.86, clamp01(sunDir.y * 2.4)));
    const cx = Math.round(cam.position.x / 2) * 2;
    const cz = Math.round(cam.position.z / 2) * 2;
    this.sun.target.position.set(cx, 0, cz);
    this.sun.position.set(cx + sunDir.x * 150, sunDir.y * 150, cz + sunDir.z * 150);
    this.sun.target.updateMatrixWorld();

    // небо
    const top = this.skyUniforms.top.value as THREE.Color;
    const hor = this.skyUniforms.hor.value as THREE.Color;
    top.copy(DAY_CLEAR_TOP).lerp(DAY_OVER_TOP, env.cloud).lerp(NIGHT_TOP, dark);
    hor.copy(DAY_CLEAR_HOR).lerp(DAY_OVER_HOR, env.cloud).lerp(NIGHT_HOR, dark);
    const twilight = clamp01(1 - Math.abs(dark - 0.5) * 2.4) * (1 - env.cloud * 0.8);
    hor.lerp(TWILIGHT, twilight * 0.55);
    (this.skyUniforms.sunDir.value as THREE.Vector3).copy(sunDir);
    (this.skyUniforms.sunCol.value as THREE.Color).copy(this.sun.color).multiplyScalar(useMoon ? 0.35 * (1 - env.cloud) : (1 - env.cloud) * day);
    this.sky.position.copy(cam.position);
    this.stars.position.copy(cam.position);
    (this.stars.material as THREE.PointsMaterial).opacity = clamp01((dark - 0.6) * 2.5) * (1 - env.cloud) * 0.9;

    // рассеянный свет и туман; внутри бункера небо гасится
    this.indoorK = damp(this.indoorK, env.indoor ? 1 : 0, 3.5, dt);
    const k = this.indoorK;
    this.hemi.color.copy(top).lerp(hor, 0.5);
    this.hemi.groundColor.setRGB(0.2, 0.18, 0.14).multiplyScalar(0.3 + day * 0.7);
    this.hemi.intensity = lerp(0.16, 1.25, day) * lerp(1, 0.5, k);
    this.fog.color.copy(hor).multiplyScalar(0.92).lerp(INDOOR_FOG, k);
    this.fog.density = lerp(0.0032 + env.fog * 0.028 + dark * 0.0016, 0.011, k);
    this.renderer.toneMappingExposure = lerp(1.0, 1.25, dark * (1 - k));

    // запечённый свет ламп
    const flicker = env.power < 0.9 && env.power > 0.05 ? 0.9 + Math.sin(this.time * 31) * 0.06 : 1;
    lightUniforms.uIndoor.value = damp(lightUniforms.uIndoor.value, (0.012 + env.power * 0.99) * flicker, 6, dt);
    const yard = env.yardLights && env.power > 0.05 ? clamp01((dark - 0.35) * 3) * Math.min(1, env.power + 0.3) : 0;
    lightUniforms.uOutdoor.value = damp(lightUniforms.uOutdoor.value, yard, 4, dt);
    const lc = lightUniforms.uLampColor.value;
    if (env.alert >= 3) {
      const pulse = 0.55 + 0.45 * Math.sin(this.time * 5);
      lc.setRGB(1, 0.36 + 0.3 * (1 - pulse), 0.22 + 0.24 * (1 - pulse));
    } else if (env.alert === 2) lc.setRGB(1, 0.72, 0.44);
    else lc.setRGB(1, 0.8, 0.56);

    // пул ламп: настоящие источники света только у ближайших светильников
    this.poolTimer -= dt;
    if (this.poolTimer <= 0) {
      this.poolTimer = 0.25;
      this.assignPool(env, yard);
    }
    for (const s of this.pool) {
      const on = s.lamp ? (s.lamp.outdoor ? yard : env.power) : 0;
      s.k = damp(s.k, on, 5, dt);
      s.light.intensity = s.lamp ? s.k * s.lamp.power * (s.lamp.outdoor ? 26 : 9) * flicker : 0;
      s.light.color.copy(lc);
    }

    // фонарь
    cam.getWorldDirection(this.fwd);
    this.flashlight.position.copy(cam.position).addScaledVector(this.fwd, 0.15);
    this.flashlight.position.y -= 0.18;
    this.flashlight.target.position.copy(cam.position).addScaledVector(this.fwd, 6);
    this.flashlight.target.updateMatrixWorld();
    this.flashlight.intensity = damp(this.flashlight.intensity, env.flashlight ? 70 : 0, 14, dt);

    // автоподстройка разрешения
    this.frameMs = lerp(this.frameMs, dt * 1000, 0.05);
    this.resTimer += dt;
    if (this.autoRes && this.resTimer > 2.5) {
      this.resTimer = 0;
      const cap = Math.min(window.devicePixelRatio || 1, this.quality.pixelRatioCap);
      let pr = this.pixelRatio;
      if (this.frameMs > 38) pr = Math.max(0.6, pr - 0.15);
      else if (this.frameMs < 21) pr = Math.min(cap, pr + 0.1);
      if (Math.abs(pr - this.pixelRatio) > 0.01) {
        this.pixelRatio = pr;
        this.resize();
      }
    }
  }

  private assignPool(env: EnvState, yard: number): void {
    const cam = this.camera.position;
    const cand: { lamp: LampDef; d: number }[] = [];
    for (const l of this.lamps) {
      if (l.outdoor ? yard < 0.05 : env.power < 0.05) continue;
      const d = (l.x - cam.x) ** 2 + (l.z - cam.z) ** 2 + (l.y - cam.y) ** 2 * 0.3;
      if (d < 45 * 45) cand.push({ lamp: l, d });
    }
    cand.sort((a, b) => a.d - b.d);
    const want = cand.slice(0, this.pool.length).map((c) => c.lamp);
    for (const s of this.pool) {
      if (s.lamp && !want.includes(s.lamp)) {
        s.lamp = null;
        s.k = 0;
      }
    }
    for (const l of want) {
      if (this.pool.some((s) => s.lamp === l)) continue;
      const free = this.pool.find((s) => !s.lamp);
      if (!free) break;
      free.lamp = l;
      free.k = 0;
      free.light.position.set(l.x, l.y - 0.25, l.z);
      free.light.distance = l.outdoor ? 20 : 9 + l.y;
    }
  }

  render(dt: number): void {
    if (this.shake > 0.001) {
      const s = this.shake;
      this.camera.position.x += (Math.random() - 0.5) * s * 0.12;
      this.camera.position.y += (Math.random() - 0.5) * s * 0.12;
      this.camera.rotation.z += (Math.random() - 0.5) * s * 0.02;
      this.shake = Math.max(0, this.shake - dt * 2.2) * Math.exp(-dt * 3);
    }
    this.renderer.render(this.scene, this.camera);
  }

  fps(): number {
    return 1000 / clamp(this.frameMs, 1, 1000);
  }
}
