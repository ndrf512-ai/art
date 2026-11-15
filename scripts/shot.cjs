// Снимки сцены: node scripts/shot.cjs имя=query [имя=query ...]  (переменные W, H — размер окна)
const { chromium } = require('playwright');
(async () => {
  const shots = process.argv.slice(2);
  const w = +(process.env.W || 1280);
  const h = +(process.env.H || 720);
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  for (const s of shots) {
    const i = s.indexOf('=');
    const name = s.slice(0, i);
    const query = s.slice(i + 1);
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    const logs = [];
    page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
    page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
    await page.goto(`http://localhost:4173/?${query}`);
    await page.waitForFunction(() => (window.__frames ?? 0) > 3, null, { timeout: 180000 }).catch((e) => logs.push('timeout ' + e.message));
    const info = await page.evaluate(() => { window.__stop = true; const r = window.__sr; return r ? JSON.stringify({ calls: r.renderer.info.render.calls, tris: r.renderer.info.render.triangles }) : 'no renderer'; });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `scripts/out/${name}.png`, timeout: 180000 });
    console.log(name, info, logs.filter((l) => !l.includes('world built')).slice(0, 8).join(' | '));
    await page.close();
  }
  await browser.close();
})();
