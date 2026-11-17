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
  async models() {
    const h = await boot('autostart=' + (process.env.G || 'f') + (process.env.Q ? '&q=' + process.env.Q : ''));
    await h.clickText('Продолжить');
    // смотр при дневном свете: ряд людей разных должностей
    await h.ev(() => {
      const g = window.__game;
      const sim = g.sim;
      sim.time.state.t = 11 * 60 + 30;
      sim.weather.state.kind = 'clear';
      sim.weather.state.cloud = 0.25;
      sim.weather.state.fog = 0.02;
      sim.weather.state.rain = 0;
      sim.weather.state.snow = 0;
      const roles = ['guard', 'loader', 'gun_cmd', 'battery_cmd', 'ci_officer', 'mechanic', 'cook', 'medic', 'radio_op'];
      roles.forEach((r, i) => {
        const n = sim.npcs.list.find((x) => x.role === r);
        if (!n) return;
        sim.npcs.clearGoal(n);
        n.x = 54.4 + i * 0.78;
        n.z = 67.2 + (i % 2) * 0.25;
        n.yaw = Math.PI;
        n.anim = 'attention';
        n.moving = false;
        n.anchor = null;
        n.gesture = null;
        n.carry = null;
      });
      g.state = 'paused';
      const p = sim.player;
      p.x = 57.5; p.z = 63.6; p.yaw = 0; p.pitch = -0.06;
      g.player.update(0.016, []);
    });
    await h.shot('60_lineup');
    await h.ev(() => { const g = window.__game; const p = g.sim.player; p.x = 56.2; p.z = 66.1; p.yaw = 0.15; p.pitch = 0.02; g.player.update(0.016, []); });
    await h.shot('61_faces');
    await h.ev(() => { const g = window.__game; const n = g.sim.npcs.list.find((x) => x.role === 'battery_cmd'); const p = g.sim.player; p.x = n.x + 0.05; p.z = n.z - 0.75; p.yaw = 0; p.pitch = -0.02; g.player.update(0.016, []); });
    await h.shot('61b_face_close');
    await h.ev(() => { const g = window.__game; const n = g.sim.npcs.list.find((x) => x.role === 'guard'); const p = g.sim.player; p.x = n.x + 0.05; p.z = n.z - 0.9; p.yaw = 0; p.pitch = -0.05; g.player.update(0.016, []); });
    await h.shot('61c_guard_close');
    // зеркало в помещении командира и вид вниз
    await h.ev(() => { const g = window.__game; const p = g.sim.player; p.x = 61.55; p.z = 15.6; p.yaw = -Math.PI / 2; p.pitch = -0.12; g.player.update(0.016, []); });
    await h.shot('62_mirror');
    await h.ev(() => { const g = window.__game; const p = g.sim.player; p.x = 60.42; p.z = 15.6; p.yaw = -Math.PI / 2; p.pitch = 0.04; g.player.update(0.016, []); });
    await h.shot('62b_mirror_close');
    await h.ev(() => { const g = window.__game; const p = g.sim.player; p.x = 62.6; p.z = 15.6; p.yaw = -Math.PI / 2; p.pitch = -0.1; g.player.update(0.016, []); });
    await h.shot('63_mirror_far');
    await h.ev(() => { const g = window.__game; const p = g.sim.player; p.x = 61.9; p.z = 15.6; p.yaw = -Math.PI / 2; p.pitch = -1.15; g.player.update(0.016, []); });
    await h.shot('64_lookdown');
    console.log(await h.info());
    return h;
  },
  async gait() {
    const h = await boot('autostart=f');
    await h.clickText('Продолжить');
    await h.ev(() => {
      const g = window.__game;
      const sim = g.sim;
      sim.time.state.t = 11 * 60;
      sim.weather.state.fog = 0.02;
      sim.weather.state.rain = 0;
      const n = sim.npcs.list.find((x) => x.role === 'guard' && x.shift === 'day');
      n.x = 51; n.z = 69.5; n.yaw = Math.PI / 2;
      sim.command.issue('goto', n, 'проверка походки', { x: 64, z: 69.5, run: !!window.__run });
      window.__walker = n.id;
      const p = sim.player;
      p.x = 57.5; p.z = 65.2; p.yaw = 0; p.pitch = -0.05; p.busy = true;
    });
    for (const run of [false, true]) {
      await h.ev((r) => { const g = window.__game; const n = g.sim.npcs.byId(window.__walker); n.x = 51; n.z = 69.5; g.sim.command.dismiss(n); g.sim.command.issue('goto', n, 'проверка походки', { x: 64, z: 69.5, run: r }); }, run);
      // ждём, пока человек выйдет к центру кадра
      for (let i = 0; i < 400; i++) {
        await h.ev(() => { window.__game.last = performance.now() - 33; window.__game.frame(); });
        const x = await h.ev(() => window.__game.sim.npcs.byId(window.__walker).x);
        if (x > (run ? 54.5 : 55.6)) break;
      }
      for (let k = 0; k < 8; k++) {
        await h.ev(() => { for (let i = 0; i < (window.__run2 ? 2 : 4); i++) { window.__game.last = performance.now() - 33; window.__game.frame(); } });
        await h.page.screenshot({ path: `scripts/out/gait_${run ? 'run' : 'walk'}_${k}.png`, clip: { x: 340, y: 150, width: 600, height: 520 }, timeout: 180000 });
      }
      console.log(run ? 'run' : 'walk', 'кадры сняты');
    }
    // камера командира: высота глаз и шаги за 3 секунды ходьбы
    const trace = await h.ev(() => {
      const g = window.__game;
      const p = g.sim.player;
      p.busy = false; p.x = 57.5; p.z = 64; p.yaw = 0;
      const out = [];
      let steps = 0;
      g.player.onStep = () => steps++;
      const pc = g.player;
      pc.keys.add('KeyW');
      for (let i = 0; i < 180; i++) { pc.update(1 / 60, []); out.push(g.sr.camera.position.y); }
      pc.keys.delete('KeyW');
      const sp = pc.speed;
      return { minY: Math.min(...out.slice(60)).toFixed(3), maxY: Math.max(...out.slice(60)).toFixed(3), steps, speed: sp.toFixed(2), dist: (p.z - 64).toFixed(2) };
    });
    console.log('камера командира:', JSON.stringify(trace));
    return h;
  },
  async nogl() {
    const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    await page.goto('http://localhost:4173/?nogl=1');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: OUT + '70_nogl.png' });
    const q = await page.evaluate(() => localStorage.getItem('granit.settings'));
    console.log('настройки после ошибки:', q);
    return { logs: [], browser };
  },
  async crashloop() {
    const h = await boot('');
    await h.clickText('Новая кампания');
    await h.clickText('Принять командование');
    await h.clickText('Продолжить');
    await h.sim(10);
    // три сбоя подряд: high → (сбой 1) medium → (сбой 2) minimal → (сбой 3) экран помощи
    for (let k = 0; k < 3; k++) {
      await h.ev(() => { window.__stop = false; window.__game.sr.renderer.getContext().getExtension('WEBGL_lose_context').loseContext(); });
      if (k < 2) {
        await h.page.waitForNavigation({ timeout: 30000 }).catch(() => {});
        await h.page.waitForFunction(() => window.__game && window.__game.frames > 2 && window.__game.ready, null, { timeout: 240000 });
        const r = await h.ev(() => JSON.stringify({ q: window.__game.quality.level, state: window.__game.state, t: window.__game.sim.time.clockString(), crashes: JSON.parse(localStorage.getItem('granit.crashes')).length }));
        console.log('после сбоя', k + 1, r);
      } else {
        await h.page.waitForTimeout(2500);
        await h.page.screenshot({ path: OUT + '71_crash_help.png', timeout: 120000 });
        const nav = await h.ev(() => document.body.innerText.includes('Видеочип не справляется'));
        console.log('экран помощи после третьего сбоя:', nav);
      }
    }
    return h;
  },
  async firetouch() {
    const h = await boot('autostart=m&touch=1&q=' + (process.env.Q || 'minimal'));
    const cdp = await h.page.context().newCDPSession(h.page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: +(process.env.CPU || 4) });
    await h.clickText('Продолжить');
    await h.ev(() => {
      const g = window.__game;
      const f = g.sim.missions.state.flags;
      f.inspected_gun1 = true; f.report_guard = true;
      for (const r of ['adjutant', 'battery_cmd', 'security_chief', 'ci_officer']) f['met_' + r] = true;
      const p = g.sim.player; p.x = 67.5; p.z = 35; p.zone = 'command'; p.indoor = true;
    });
    await h.sim(3);
    if (await h.page.locator('button:has-text("Продолжить")').count()) await h.clickText('Продолжить');
    await h.sim(16);
    // живой цикл кадров с замером пауз между кадрами
    await h.ev(() => {
      const g = window.__game;
      window.__stop = false;
      window.__gaps = [];
      let last = performance.now();
      const mon = () => { const t = performance.now(); window.__gaps.push(t - last); last = t; if (!window.__stop) requestAnimationFrame(mon); };
      requestAnimationFrame(mon);
      g.last = performance.now();
      requestAnimationFrame(g.frame);
      g.ui.openPanel('fire');
    });
    await h.page.waitForTimeout(1500);
    await h.page.locator('.right .item:has-text("склад")').first().tap();
    await h.page.waitForTimeout(400);
    await h.page.locator('button:has-text("Открыть огонь")').first().tap();
    await h.page.waitForTimeout(300);
    const ordered = await h.ev(() => window.__game.sim.artillery.state.missions.length);
    console.log('задач после касания «Открыть огонь»:', ordered);
    await h.ev(() => { window.__game.setWarp(12); window.__gaps = []; });
    // ждём выстрела
    for (let i = 0; i < 120; i++) {
      await h.page.waitForTimeout(500);
      const f = await h.ev(() => window.__game.sim.artillery.state.missions.reduce((a, m) => a + m.fired, 0));
      if (f >= 1) break;
    }
    await h.page.waitForTimeout(1500);
    const shot = await h.ev(() => { const g = [...window.__gaps].sort((a, b) => a - b); return { fired: window.__game.sim.artillery.state.missions.reduce((a, m) => a + m.fired, 0), median: Math.round(g[g.length >> 1]), p90: Math.round(g[Math.floor(g.length * 0.9)]), max: Math.round(g[g.length - 1]), frames: g.length }; });
    console.log('выстрел:', JSON.stringify(shot));
    await h.ev(() => window.__game.setWarp(1));
    // поправка: два касания «+» по дальности и «Передать поправку»/«Поправка и ещё выстрел»
    const plus = h.page.locator('.right .stepper').filter({ hasText: 'дальше' }).or(h.page.locator('.right .stepper').filter({ hasText: /^.*0.*$/ })).first();
    const corrRow = h.page.locator('.right h3:has-text("Поправки")');
    console.log('раздел поправок виден:', await corrRow.count());
    const steppers = h.page.locator('.right .stepper');
    const n = await steppers.count();
    // последний-1 степпер — дальность в разделе поправок
    const rangeStepper = steppers.nth(n - 2);
    await rangeStepper.locator('button:has-text("+")').tap();
    await rangeStepper.locator('button:has-text("+")').tap();
    await h.page.waitForTimeout(1200);
    await h.page.locator('.right button:has-text("оправк")').first().tap();
    await h.page.waitForTimeout(500);
    const corr = await h.ev(() => window.__game.sim.artillery.state.missions.map((m) => m.corrRange + '/' + m.status + '/' + m.rounds));
    console.log('поправки в задачах:', JSON.stringify(corr));
    // прокрутка не должна сбрасываться обновлениями
    await h.ev(() => { const s = document.querySelector('.right'); s.scrollTop = 300; window.__st = s.scrollTop; });
    await h.page.waitForTimeout(3500);
    const st = await h.ev(() => [window.__st, document.querySelector('.right').scrollTop]);
    console.log('прокрутка до/после 3,5 с обновлений:', JSON.stringify(st));
    await h.page.screenshot({ path: OUT + '80_fire_touch.png', timeout: 180000 });
    await h.ev(() => { window.__stop = true; });
    return h;
  },
  async monkey() {
    const h = await boot('autostart=f&q=low');
    await h.clickText('Продолжить');
    const report = await h.ev(async () => {
      const g = window.__game;
      const sim = g.sim;
      const ui = g.ui;
      const errors = [];
      const tryit = (what, fn) => { try { fn(); } catch (e) { errors.push(what + ': ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e)); } };
      let chosen = 0;
      // все пункты диалогов у людей разных должностей (два уровня меню)
      const roles = ['adjutant', 'battery_cmd', 'security_chief', 'ci_officer', 'quartermaster', 'engineer', 'doctor', 'gun_cmd', 'guard_sgt', 'patrol_leader', 'guard', 'mech_chief', 'radio_op', 'clerk', 'cook', 'driver'];
      const skip = new Set(['close', 'p:leave', 'p:arrest', 'i:handover', 'v:deny', 'tr:gun1', 'tr:gun2', 'tr:gun3', 'tr:guard']);
      for (const role of roles) {
        const n = sim.npcs.list.find((x) => x.role === role && x.status === 'active');
        if (!n) continue;
        tryit('open ' + role, () => ui.showDialogue(sim.dialogue.open(n.id)));
        const top = sim.dialogue.view();
        if (!top) continue;
        for (const o of top.options) {
          if (skip.has(o.id) || o.disabled) continue;
          tryit(role + ' ' + o.id, () => {
            sim.dialogue.close();
            ui.showDialogue(sim.dialogue.open(n.id));
            const v = sim.dialogue.choose(o.id);
            chosen++;
            ui.showDialogue(v);
            if (v && o.id.startsWith('m:')) {
              for (const o2 of v.options) {
                if (skip.has(o2.id) || o2.disabled || o2.id === 'back') continue;
                if (o2.id.startsWith('m:')) continue;
                const v2 = sim.dialogue.choose(o2.id);
                chosen++;
                ui.showDialogue(v2);
                sim.dialogue.close();
                ui.showDialogue(sim.dialogue.open(n.id));
                sim.dialogue.choose(o.id);
              }
            }
            ui.closePanel();
          });
        }
        tryit('close ' + role, () => ui.closeDialogue());
      }
      // телефон
      tryit('phone', () => { ui.showDialogue(sim.dialogue.openPhone()); for (const o of sim.dialogue.view().options) { if (o.id === 'close') continue; ui.showDialogue(sim.dialogue.openPhone()); ui.showDialogue(sim.dialogue.choose(o.id)); } ui.closeDialogue(); });
      // все окна и вкладки
      for (const tab of ['objectives', 'messages', 'orders', 'roster', 'cases', 'resources', 'guard', 'system']) tryit('journal ' + tab, () => { ui.openPanel('journal', { tab }); ui.update(1.2); ui.closePanel(); });
      for (const p of ['map', 'fire', 'archive', 'patrols', 'supply', 'rest', 'alert']) tryit('panel ' + p, () => { ui.openPanel(p); ui.update(1.2); ui.update(1.2); });
      // кнопки внутри окон: нажимаем все, кроме выхода/перезапуска
      const badBtn = /Выйти|главное меню|Перезапуск|Применить|Загрузить|Спать|Отдохнуть/;
      for (const p of ['patrols', 'supply', 'alert', 'archive']) {
        tryit('buttons ' + p, () => {
          ui.openPanel(p);
          const btns = Array.from(document.querySelectorAll('.panel .body button')).filter((b) => !badBtn.test(b.textContent));
          for (const b of btns.slice(0, 25)) { if (b.isConnected) b.click(); }
          ui.update(1.2);
          ui.closePanel();
        });
      }
      tryit('archive items', () => { ui.openPanel('archive'); const items = Array.from(document.querySelectorAll('.panel .item')).slice(0, 6); for (const it of items) it.click(); ui.closePanel(); });
      // осмотр всех объектов
      for (const it of sim.layout.interactables) {
        if (it.kind === 'bed') continue;
        tryit('interact ' + it.id, () => {
          ui.interact({ kind: 'object', id: it.id, label: it.label, hint: '', obj: it });
          const btns = Array.from(document.querySelectorAll('.panel .body button')).filter((b) => /Осмотреть|первую очередь/.test(b.textContent));
          for (const b of btns) b.click();
          ui.closePanel();
          ui.closeDialogue();
        });
      }
      // мир живёт с открытыми окнами
      tryit('sim with panels', () => { ui.openPanel('fire'); for (let i = 0; i < 600; i++) { sim.update(0.1); if (i % 10 === 0) ui.update(1.0); } ui.closePanel(); });
      tryit('save/load', () => { g.saveSlot('slot2'); g.loadSlot('slot2'); });
      return { errors, chosen };
    });
    console.log('пунктов диалогов выбрано:', report.chosen);
    console.log('ошибок:', report.errors.length);
    for (const e of report.errors.slice(0, 30)) console.log(' -', e);
    return h;
  },
};

(async () => {
  const name = process.argv[2] || 'boot';
  const h = await scenarios[name]();
  if (h.logs.length) console.log('LOGS:\n' + h.logs.slice(0, 20).join('\n'));
  await h.browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
