import './style.css';
import { Game } from './Game';

const canvas = document.getElementById('view') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;

try {
  new Game(canvas, ui);
} catch (e) {
  console.error(e);
  ui.innerHTML = `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#d9d3bb;font-family:monospace;padding:20px;text-align:center">Не удалось запустить игру: ${(e as Error).message}<br>Нужен браузер или WebView с поддержкой WebGL 2.</div>`;
}
