/**
 * Связь с Android-оболочкой и защита от сбоев видеочипа.
 * Android WebView после сбоя графики блокирует WebGL до полного перезапуска
 * приложения, поэтому восстанавливаемся перезапуском процесса, а не перезагрузкой страницы.
 */
import { loadUserSettings, saveUserSettings } from './view/Quality';

interface Bridge {
  platform?: () => string;
  exitApp?: () => void;
  restartApp?: () => void;
}

export function bridge(): Bridge | null {
  return ((window as any).AndroidBridge as Bridge) ?? null;
}

export function isAndroidApp(): boolean {
  return !!bridge()?.restartApp;
}

/** Полный перезапуск: в приложении — новый процесс (снимает блокировку WebGL), в браузере — перезагрузка. */
export function restartApp(): void {
  const b = bridge();
  if (b?.restartApp) b.restartApp();
  else location.reload();
}

const CRASH_KEY = 'granit.crashes';

/** Учёт сбоев графики за последние 15 минут — чтобы не перезапускаться по кругу. */
export function recordCrash(): number {
  try {
    const now = Date.now();
    const list: number[] = JSON.parse(localStorage.getItem(CRASH_KEY) ?? '[]').filter((t: number) => now - t < 15 * 60 * 1000);
    list.push(now);
    localStorage.setItem(CRASH_KEY, JSON.stringify(list));
    return list.length;
  } catch {
    return 1;
  }
}

export function recentCrashes(): number {
  try {
    const now = Date.now();
    return (JSON.parse(localStorage.getItem(CRASH_KEY) ?? '[]') as number[]).filter((t) => now - t < 15 * 60 * 1000).length;
  } catch {
    return 0;
  }
}

/** Принудительно перейти на минимальное качество (для следующего запуска). */
export function forceMinimalQuality(): void {
  const s = loadUserSettings();
  if (s.quality !== 'minimal') {
    s.quality = 'minimal';
    saveUserSettings(s);
  }
}

/**
 * Пробный контекст до запуска игры: есть ли WebGL 2 и что за видеочип.
 * Контекст сразу освобождается.
 */
export function probeGpu(): { ok: boolean; name: string } {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2', { powerPreference: 'default', failIfMajorPerformanceCaveat: false }) as WebGL2RenderingContext | null;
    if (!gl) return { ok: false, name: '' };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return { ok: true, name };
  } catch {
    return { ok: false, name: '' };
  }
}

/** Слабые мобильные видеочипы, на которых безопаснее сразу минимальное качество. */
export function isWeakGpu(name: string): boolean {
  return /PowerVR|Mali-[4T]\d|Mali-G(31|51|52|57|68)\b|Adreno \(TM\) (3|4|50|51)\d|Adreno \(TM\) 6[01]\d|IMG|SGX|Vivante|VideoCore/i.test(name);
}

export function deviceMemoryGb(): number {
  return Number((navigator as any).deviceMemory ?? 4);
}
