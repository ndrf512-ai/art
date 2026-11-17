type Kid = Node | string | number | null | undefined | false;

/** Небольшой помощник для построения DOM без фреймворков. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Record<string, any> | null, ...kids: (Kid | Kid[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') el.setAttribute('style', v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'disabled' || k === 'checked' || k === 'selected') (el as any)[k] = !!v;
      else if (k === 'value') (el as any).value = v;
      else el.setAttribute(k, String(v));
    }
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(typeof kid === 'object' ? kid : String(kid));
  }
  return el;
}

export function clear(el: HTMLElement): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** Полоса показателя 0..100 с подписью. */
export function bar(v: number, label?: string): HTMLElement {
  const cls = v < 35 ? 'bar low' : v < 60 ? 'bar mid' : 'bar';
  const b = h('span', { class: cls }, h('i', { style: `width:${Math.max(0, Math.min(100, v))}%` }));
  return h('span', null, b, label ?? '');
}

/** Счётчик с кнопками «−» и «+». */
export function stepper(get: () => number, set: (v: number) => void, step: number, fmt: (v: number) => string = String, bigStep?: number): HTMLElement {
  const val = h('span', null, fmt(get()));
  const mk = (d: number, label: string) =>
    h('button', {
      onclick: () => {
        set(get() + d);
        val.textContent = fmt(get());
      },
    }, label);
  return h('span', { class: 'stepper' }, bigStep ? mk(-bigStep, '«') : null, mk(-step, '−'), val, mk(step, '+'), bigStep ? mk(bigStep, '»') : null);
}

/**
 * Мягкое обновление: содержимое строится заново в отдельном элементе и подставляется,
 * только если текст изменился; прокрутка сохраняется. Так кнопки не пересоздаются под пальцем.
 */
export function softRefresh(container: HTMLElement, build: (target: HTMLElement) => void): void {
  const tmp = document.createElement('div');
  build(tmp);
  if (tmp.textContent === container.textContent) return;
  const top = container.scrollTop;
  container.replaceChildren(...Array.from(tmp.childNodes));
  container.scrollTop = top;
}
