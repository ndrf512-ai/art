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
  await page.evaluate(() => { try { localStorage.removeItem('granit.settings'); } catch {} });
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
  async gameplay() {
    const h = await boot('autostart=m');
    await h.clickText('Продолжить');
    // разговор с начальником штаба у шлагбаума
    await h.sim(1);
    const adj = await h.ev(() => { const g = window.__game; const n = g.sim.npcs.first('adjutant'); g.sim.player.x = n.x; g.sim.player.z = n.z + 1.6; g.sim.player.yaw = Math.PI; g.sim.player.pitch = -0.05; return n.id; });
    await h.frames(3);
    await h.ev((id) => window.__game.ui.showDialogue(window.__game.sim.dialogue.open(id)), adj);
    await h.shot('20_dialogue');
    await h.ev(() => window.__game.ui.chooseDialogue(0));
    await h.shot('21_report');
    await h.ev(() => window.__game.ui.closeDialogue());
    // вторая глава: огневая задача
    await h.ev(() => { const g = window.__game; g.sim.missions.state.flags.inspected_gun1 = true; for (const r of ['adjutant','battery_cmd','security_chief','ci_officer']) g.sim.missions.state.flags['met_' + r] = true; g.sim.missions.state.flags.report_guard = true; g.sim.player.x = 67.5; g.sim.player.z = 35; g.sim.player.zone = 'command'; });
    await h.sim(2);
    await h.frames(2);
    const title = await h.ev(() => window.__game.sim.missions.state.title);
    console.log('глава:', title);
    if (await h.page.locator('button:has-text("Продолжить")').count()) await h.clickText('Продолжить');
    await h.sim(16);
    await h.ev(() => window.__game.ui.openPanel('fire'));
    await h.frames(2);
    // выбрать донесение о понтонном парке и открыть огонь
    await h.ev(() => { const g = window.__game; const id = g.sim.missions.state.flags.pontoon_intel; window.__pont = id; });
    await h.page.locator('.right .item:has-text("склад")').first().click();
    await h.shot('22_fire_panel');
    await h.clickText('Открыть огонь');
    await h.frames(2);
    await h.sim(6);
    await h.ev(() => window.__game.ui.closePanel());
    await h.place(86.5, 74, 200, 2);
    await h.sim(1);
    await h.shot('23_gun_crew');
    await h.sim(10);
    await h.ev(() => window.__game.ui.openPanel('fire'));
    await h.page.locator('.right .item:has-text("понтон"), .right .item:has-text("склад")').first().click().catch(() => {});
    await h.shot('24_fire_reports');
    const rep = await h.ev(() => JSON.stringify(window.__game.sim.artillery.state.missions.map((m) => ({ t: m.targetName, f: m.fired, st: m.status, r: m.reports.slice(-3) }))));
    console.log(rep);
    await h.ev(() => window.__game.ui.closePanel());
    await h.ev(() => window.__game.ui.openPanel('map'));
    await h.shot('25_map');
    await h.ev(() => window.__game.ui.closePanel());
    await h.ev(() => window.__game.ui.openPanel('journal', { tab: 'messages' }));
    await h.shot('26_journal');
    // сохранение и загрузка
    const before = await h.ev(() => { const g = window.__game; g.saveSlot('slot1'); return g.sim.time.clockString() + ' ' + g.sim.npcs.list.length; });
    await h.sim(30);
    const ok = await h.ev(() => window.__game.loadSlot('slot1'));
    const after = await h.ev(() => { const g = window.__game; return g.sim.time.clockString() + ' ' + g.sim.npcs.list.length; });
    console.log('save/load', before, '->', after, ok);
    return h;
  },
  async phone() {
    const h = await boot('autostart=f&touch=1');
    await h.clickText('Продолжить');
    await h.sim(2);
    await h.place(57.5, 112, 180, -3);
    await h.shot('30_phone_hud');
    await h.ev(() => window.__game.ui.openPanel('fire'));
    await h.shot('31_phone_fire');
    await h.ev(() => window.__game.ui.closePanel());
    const adj = await h.ev(() => window.__game.sim.npcs.first('adjutant').id);
    await h.ev((id) => window.__game.ui.showDialogue(window.__game.sim.dialogue.open(id)), adj);
    await h.shot('32_phone_dialogue');
    return h;
  },
  async lowq() {
    const h = await boot('autostart=f&touch=1&q=' + (process.env.Q || 'low'));
    await h.clickText('Продолжить');
    await h.sim(14);
    await h.place(57.5, 64.5, 0, -4);
    await h.shot('40_low_formation');
    await h.place(61.8, 15.6, -90, -6);
    await h.shot('41_low_mirror');
    console.log(await h.info());
    return h;
  },
  async contextloss() {
    const h = await boot('');
    await h.ev(() => localStorage.setItem('granit.settings', JSON.stringify({ quality: 'medium' })));
    await h.clickText('Новая кампания');
    await h.clickText('Принять командование');
    await h.clickText('Продолжить');
    await h.sim(30);
    const t = await h.ev(() => window.__game.sim.time.clockString());
    // имитация сбоя видеочипа
    await h.ev(() => { window.__stop = false; window.__game.sr.renderer.getContext().getExtension('WEBGL_lose_context').loseContext(); });
    await h.page.waitForTimeout(500);
    await h.shot('50_lost');
    await h.page.waitForNavigation({ timeout: 30000 }).catch(() => {});
    await h.page.waitForFunction(() => window.__game && window.__game.frames > 2, null, { timeout: 240000 });
    const r = await h.ev(() => JSON.stringify({ q: window.__game.quality.level, state: window.__game.state, t: window.__game.sim.time.clockString() }));
    console.log('до сбоя', t, '→ после перезапуска', r);
    await h.ev(() => { window.__stop = true; });
    await h.shot('51_after_restore');
    return h;
  },
};

(async () => {
  const name = process.argv[2] || 'boot';
  const h = await scenarios[name]();
  if (h.logs.length) console.log('LOGS:\n' + h.logs.slice(0, 20).join('\n'));
  await h.browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
