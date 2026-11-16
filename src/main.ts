import './style.css';
import { Game } from './Game';
import { deviceMemoryGb, forceMinimalQuality, isAndroidApp, isWeakGpu, probeGpu, recentCrashes, restartApp } from './platform';
import { setAutoMinimal } from './view/Quality';

const canvas = document.getElementById('view') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;
const params = new URLSearchParams(location.search);

/** Экран, когда 3D-графику включить не удалось. */
function showGlError(detail: string): void {
  // в следующий раз — сразу минимальное качество
  forceMinimalQuality();
  const blocked = recentCrashes() > 0;
  const wrap = document.createElement('div');
  wrap.className = 'menu';
  wrap.style.pointerEvents = 'auto';
  const box = document.createElement('div');
  box.className = 'intro';
  const title = document.createElement('h2');
  title.textContent = blocked ? 'Графика временно заблокирована' : 'Не удалось включить 3D-графику';
  const p1 = document.createElement('p');
  p1.textContent = blocked
    ? 'После сбоя видеочипа система Android блокирует 3D-графику, пока приложение не будет полностью перезапущено. Игра сохранена.'
    : 'Телефон не дал игре доступ к 3D-графике (WebGL 2).';
  const p2 = document.createElement('p');
  p2.textContent = isAndroidApp()
    ? 'Нажмите «Перезапустить игру» — она закроется полностью и откроется снова с минимальным качеством графики. Если не поможет — обновите «Android System WebView» и «Chrome» в Google Play.'
    : 'Закройте вкладку и откройте игру снова. Если не поможет — обновите браузер.';
  const p3 = document.createElement('p');
  p3.className = 'muted';
  const chrome = /Chrome\/([\d.]+)/.exec(navigator.userAgent)?.[1] ?? 'неизвестна';
  p3.textContent = `Подробности: ${detail}. Версия WebView: ${chrome}. Сбоев графики за 15 минут: ${recentCrashes()}.`;
  const row = document.createElement('div');
  row.className = 'row';
  const btn = document.createElement('button');
  btn.className = 'primary';
  btn.textContent = 'Перезапустить игру';
  btn.onclick = () => restartApp();
  row.append(btn);
  if (isAndroidApp()) {
    const exit = document.createElement('button');
    exit.textContent = 'Выйти';
    exit.onclick = () => (window as any).AndroidBridge?.exitApp?.();
    row.append(exit);
  }
  box.append(title, p1, p2, p3, row);
  wrap.append(box);
  ui.innerHTML = '';
  ui.append(wrap);
}

const probe = params.has('nogl') ? { ok: false, name: '' } : probeGpu();
if (!probe.ok) {
  showGlError('WebGL 2 недоступен');
} else {
  // режим «Авто»: на слабом видеочипе, при малой памяти или после недавнего сбоя — минимальное качество
  setAutoMinimal(isWeakGpu(probe.name) || deviceMemoryGb() <= 3 || recentCrashes() > 0);
  try {
    new Game(canvas, ui);
  } catch (e) {
    console.error(e);
    showGlError((e as Error).message);
  }
}
