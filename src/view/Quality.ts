/**
 * Пресеты качества графики. На телефоне по умолчанию «среднее»; дополнительно
 * работает автоподстройка разрешения рендера под фактическую частоту кадров.
 */
export type QualityLevel = 'low' | 'medium' | 'high';

export interface QualitySettings {
  level: QualityLevel;
  pixelRatioCap: number;
  shadows: boolean;
  shadowSize: number;
  poolLights: number;
  antialias: boolean;
  treeDensity: number;
  npcShadowDist: number;
  particles: number;
  normalMaps: boolean;
}

const PRESETS: Record<QualityLevel, QualitySettings> = {
  low: { level: 'low', pixelRatioCap: 1, shadows: false, shadowSize: 512, poolLights: 3, antialias: false, treeDensity: 0.45, npcShadowDist: 0, particles: 0.5, normalMaps: false },
  medium: { level: 'medium', pixelRatioCap: 1.5, shadows: true, shadowSize: 1024, poolLights: 4, antialias: false, treeDensity: 0.7, npcShadowDist: 22, particles: 0.8, normalMaps: true },
  high: { level: 'high', pixelRatioCap: 2, shadows: true, shadowSize: 2048, poolLights: 7, antialias: true, treeDensity: 1, npcShadowDist: 45, particles: 1, normalMaps: true },
};

export function isTouchDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (navigator.maxTouchPoints ?? 0) > 0 && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
}

const KEY = 'granit.settings';

export interface UserSettings {
  quality: QualityLevel | 'auto';
  sensitivity: number;
  volume: number;
  invertY: boolean;
  autoRes: boolean;
}

export function loadUserSettings(): UserSettings {
  const def: UserSettings = { quality: 'auto', sensitivity: 1, volume: 0.8, invertY: false, autoRes: true };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...def, ...JSON.parse(raw) };
  } catch {
    /* хранилище недоступно — используем значения по умолчанию */
  }
  return def;
}

export function saveUserSettings(s: UserSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* нет хранилища */
  }
}

export function resolveQuality(s: UserSettings): QualitySettings {
  const level: QualityLevel = s.quality === 'auto' ? (isTouchDevice() ? 'medium' : 'high') : s.quality;
  return { ...PRESETS[level] };
}
