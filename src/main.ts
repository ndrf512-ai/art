import * as THREE from 'three';
import { buildLayout } from './world/layout';
import { Materials } from './view/Materials';
import { buildWorld } from './view/WorldBuilder';
import { SceneRenderer } from './view/SceneRenderer';
import { loadUserSettings, resolveQuality } from './view/Quality';

const canvas = document.getElementById('view') as HTMLCanvasElement;
const q = resolveQuality(loadUserSettings());
const sr = new SceneRenderer(canvas, q);
const layout = buildLayout();
const t0 = performance.now();
const M = new Materials();
const world = buildWorld(layout, M);
sr.scene.add(world.group);
sr.setLamps(layout.lamps);
console.log('world built in', Math.round(performance.now() - t0), 'ms');
const params = new URLSearchParams(location.search);
const cam = (params.get('cam') ?? '57.5,1.7,126,180,0').split(',').map(Number);
sr.camera.position.set(cam[0], cam[1], cam[2]);
sr.camera.rotation.set((cam[4] * Math.PI) / 180, (cam[3] * Math.PI) / 180 + Math.PI, 0);
const env = { hour: Number(params.get('hour') ?? 12), darkness: Number(params.get('dark') ?? 0), cloud: 0.7, fog: 0.15, power: 1, yardLights: true, alert: 0, indoor: params.get('indoor') === '1', flashlight: params.get('fl') === '1' };
sr.autoRes = false;
let last = performance.now();
function frame(): void {
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  sr.update(dt, env);
  sr.render(dt);
  (window as any).__frames = ((window as any).__frames ?? 0) + 1;
  if (!(window as any).__stop) requestAnimationFrame(frame);
}
window.addEventListener('resize', () => sr.resize());
frame();
(window as any).__sr = sr;
(window as any).THREE = THREE;
