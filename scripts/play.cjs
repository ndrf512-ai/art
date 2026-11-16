// Прогон игры в headless Chromium: node scripts/play.cjs <сценарий>
// Переменные окружения: W, H — размер окна; TOUCH=1 — эмуляция сенсорного экрана.
const { chromium } = require('playwright');

const W = +(process.env.W || 1280);
const H = +(process.env.H || 720);
const OUT = 'scripts/out/';

async function boot(query) {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: !!process.env.TOUCH });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
  await page.goto(`http://localhost:4173/?${query}`);
  await page.waitForFunction(() => window.__game && window.__game.frames > 1, null, { timeout: 240000 });
  // дальше кадры считаем вручную
  await page.evaluate(() => { window.__stop = true; });
  await page.waitForTimeout(300);
  const h = {
    page, logs, browser,
    frames: (n = 1) => page.evaluate((n) => { for (let i = 0; i < n; i++) window.__game.frame(); }, n),
    sim: (minutes, dt = 0.1) => page.evaluate(([m, dt]) => { const g = window.__game; const steps = Math.round(m * 2 / dt); for (let i = 0; i < steps; i++) g.sim.update(dt); }, [minutes, dt]),
    ev: (fn, arg) => page.evaluate(fn, arg),
    place: (x, z, yawDeg, pitchDeg = 0) => page.evaluate(([x, z, yaw, pitch]) => { const p = window.__game.sim.player; p.x = x; p.z = z; p.yaw = yaw * Math.PI / 180; p.pitch = pitch * Math.PI / 180; }, [x, z, yawDeg, pitchDeg]),
    shot: async (name) => { for (let i = 0; i < 6; i++) { await h.frames(1); await page.waitForTimeout(130); } await page.screenshot({ path: OUT + name + '.png', timeout: 180000 }); console.log('shot', name); },
    clickText: async (text) => { const el = page.locator(`button:has-text("${text}")`).first(); await el.click({ timeout: 5000 }); },
    info: () => page.evaluate(() => { const g = window.__game; const r = g.sr.renderer.info.render; return JSON.stringify({ calls: r.calls, tris: r.triangles, state: g.state, t: g.sim.time.clockString(), drawn: g.chars.drawn }); }),
  };
  return h;
}

const scenarios = {
  async boot() {
    const h = await boot('');
    await h.shot('01_menu');
    await h.clickText('Новая кампания');
    await h.shot('02_choice');
    await h.clickText('Принять командование');
    await h.shot('03_chapter');
    await h.clickText('Продолжить');
    await h.frames(3);
    await h.shot('04_gate');
    console.log(await h.info());
    return h;
  },
  async tour() {
    const h = await boot('autostart=f');
    await h.clickText('Продолжить');
    await h.sim(14);
    await h.place(57.5, 64.5, 0, -4);
    await h.shot('10_formation');
    console.log(await h.info());
    await h.sim(40);
    await h.place(41.5, 36.5, 205, -8);
    await h.shot('11_mess');
    await h.sim(150);
    await h.place(66, 35, 150, -10);
    await h.shot('12_cc');
    await h.place(61.8, 15.6, -90, -6);
    await h.shot('13_mirror');
    await h.place(61.8, 15.6, -90, -75);
    await h.shot('14_lookdown');
    await h.place(86, 78, 215, 2);
    await h.shot('15_gunpit');
    await h.place(124.5, 52, 180, 6);
    await h.shot('16_hangar');
    console.log(await h.info());
    return h;
  },
};

(async () => {
  const name = process.argv[2] || 'boot';
  const h = await scenarios[name]();
  if (h.logs.length) console.log('LOGS:\n' + h.logs.slice(0, 20).join('\n'));
  await h.browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
