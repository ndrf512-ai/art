/**
 * Пресеты качества графики. На телефоне по умолчанию «низкое»; при потере
 * графического контекста игра сама переходит на уровень ниже. Дополнительно
 * работает автоподстройка разрешения рендера под фактическую частоту кадров.
 */
export type QualityLevel = 'minimal' | 'low' | 'medium' | 'high';

export const QUALITY_ORDER: QualityLevel[] = ['minimal', 'low', 'medium', 'high'];
export const QUALITY_NAMES: Record<QualityLevel | 'auto', string> = { auto: 'Авто', minimal: 'Минимальное', low: 'Низкое', medium: 'Среднее', high: 'Высокое' };

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
  /** Модель Ламберта вместо физически корректной, без карт нормалей. */
  cheapMaterials: boolean;
  texScale: number;
  /** Разрешение отражения в зеркалах (0 — зеркало без отражения). */
  mirrorRes: number;
}

const PRESETS: Record<QualityLevel, QualitySettings> = {
  minimal: { level: 'minimal', pixelRatioCap: 0.8, shadows: false, shadowSize: 512, poolLights: 1, antialias: false, treeDensity: 0.25, npcShadowDist: 0, particles: 0.3, cheapMaterials: true, texScale: 0.5, mirrorRes: 192 },
  low: { level: 'low', pixelRatioCap: 1, shadows: false, shadowSize: 512, poolLights: 2, antialias: false, treeDensity: 0.4, npcShadowDist: 0, particles: 0.5, cheapMaterials: true, texScale: 0.5, mirrorRes: 256 },
  medium: { level: 'medium', pixelRatioCap: 1.25, shadows: true, shadowSize: 1024, poolLights: 4, antialias: false, treeDensity: 0.7, npcShadowDist: 18, particles: 0.8, cheapMaterials: false, texScale: 1, mirrorRes: 384 },
  high: { level: 'high', pixelRatioCap: 2, shadows: true, shadowSize: 2048, poolLights: 7, antialias: true, treeDensity: 1, npcShadowDist: 45, particles: 1, cheapMaterials: false, texScale: 1, mirrorRes: 768 },
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
  let level: QualityLevel = s.quality === 'auto' ? (isTouchDevice() ? 'low' : 'high') : s.quality;
  // для проверки: ?q=low в адресе
  const forced = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('q') : null;
  if (forced && forced in PRESETS) level = forced as QualityLevel;
  return { ...PRESETS[level] };
}

/** Уровень ниже текущего (или null, если ниже некуда). */
export function lowerQuality(level: QualityLevel): QualityLevel | null {
  const i = QUALITY_ORDER.indexOf(level);
  return i > 0 ? QUALITY_ORDER[i - 1] : null;
}
