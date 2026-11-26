// Probe for SKYLINE RUNNER: plays the real game in headed Firefox + Xvfb
// and checks load, takeoff, ring pass, HUD changes, pause, win, crash and
// restart. Run under:
//   xvfb-run -a -s "-screen 0 1280x720x24" node tools/probe.mjs
// Serve game/ at 127.0.0.1:8123 first.
import { createRequire } from 'node:module';
const require = createRequire('/home/hatch/workspace/pw-test/package.json');
const { firefox } = require('playwright');

const URL = 'http://127.0.0.1:8123/index.html';
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}
async function waitFor(page, fn, timeoutMs, label) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await page.evaluate(fn)) return true;
    await page.waitForTimeout(250);
  }
  throw new Error('timeout waiting for ' + label);
}

const browser = await firefox.launch({
  headless: false,
  firefoxUserPrefs: {
    'webgl.force-enabled': true,
    'webgl.software-webgl': true,
    'gfx.webrender.software': true,
  },
  env: { ...process.env, LIBGL_ALWAYS_SOFTWARE: '1', GALLIUM_DRIVER: 'llvmpipe', MOZ_DISABLE_CONTENT_SANDBOX: '1' },
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
const external = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('request', (r) => {
  if (!r.url().startsWith('http://127.0.0.1:8123')) external.push(r.url());
});

try {
  await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(2000);

  // 1. loads, title screen, WebGL alive
  check('load: title screen visible', await page.evaluate(() =>
    window.__game?.state === 'title' && !document.getElementById('title-screen').classList.contains('hidden')));
  check('load: WebGL context', await page.evaluate(() => {
    const gl = document.querySelector('#gl').getContext('webgl');
    return !!gl && !gl.isContextLost();
  }));

  // 2. start the mission from the title button
  await page.click('button[data-mission="ringrun"]');
  await page.waitForTimeout(500);
  check('start: state playing', await page.evaluate(() => window.__game.state === 'playing'));

  // 3. throttle up + pitch up => takeoff, HUD numbers move
  const before = await page.evaluate(() => ({ alt: window.__game.plane.y, spd: window.__game.plane.speed }));
  await page.keyboard.down('KeyW');
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(6000);
  await page.keyboard.up('ArrowUp');
  const after = await page.evaluate(() => ({
    alt: window.__game.plane.y, spd: window.__game.plane.speed, ground: window.__game.plane.onGround,
  }));
  check('takeoff: airborne', !after.ground && after.alt > 45,
    `alt ${before.alt.toFixed(0)} -> ${after.alt.toFixed(0)} m, speed ${after.spd.toFixed(0)} m/s`);
  const hud1 = await page.evaluate(() => document.getElementById('alt').textContent);
  await page.waitForTimeout(1200);
  const hud2 = await page.evaluate(() => document.getElementById('alt').textContent);
  check('HUD: altitude text changes while flying', hud1 !== hud2, `${hud1} -> ${hud2}`);
  await page.keyboard.up('KeyW');

  // 4. fly through ring 1 with the autopilot assist
  await page.evaluate(() => window.__game.debug.teleportBeforeRing(0));
  await waitFor(page, () => window.__game.ringsPassed >= 1, 25000, 'ring 1 pass');
  const ringState = await page.evaluate(() => ({ rings: window.__game.ringsPassed, score: window.__game.score }));
  check('ring: passing a ring scores', ringState.rings >= 1 && ringState.score >= 100,
    `rings ${ringState.rings}, score ${ringState.score}`);

  // 5. pause / resume
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(300);
  check('pause: overlay shows', await page.evaluate(() =>
    window.__game.state === 'paused' && !document.getElementById('pause-screen').classList.contains('hidden')));
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(300);
  check('pause: resume works', await page.evaluate(() => window.__game.state === 'playing'));

  // 6. win flow: credit the rings, fly the real autopilot landing
  await page.evaluate(() => window.__game.debug.skipToFinal());
  await page.evaluate(() => window.__game.debug.teleportFinal());
  await waitFor(page, () => window.__game.state === 'won', 90000, 'win');
  const win = await page.evaluate(() => ({
    title: document.getElementById('end-title').textContent,
    score: window.__game.score,
  }));
  check('win: landing after all rings wins', /COMPLETE|LANDING/.test(win.title) && win.score > 1000,
    `${win.title}, score ${win.score}`);

  // 7. restart from the end screen, then crash flow
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(500);
  check('restart: R starts a fresh mission', await page.evaluate(() =>
    window.__game.state === 'playing' && window.__game.score === 0 && window.__game.ringsPassed === 0));
  await page.keyboard.down('KeyW');
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(3000);
  await page.keyboard.up('ArrowUp');
  await page.keyboard.up('KeyW');
  await page.evaluate(() => window.__game.debug.crashNow());
  await waitFor(page, () => window.__game.state === 'lost', 10000, 'crash');
  check('crash: terrain impact loses', await page.evaluate(() =>
    /CRASHED/.test(document.getElementById('end-title').textContent)));

  // 8. landing drill mission loads and starts airborne
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__game.startMission('landing'));
  await page.waitForTimeout(800);
  check('mission: landing drill starts on final', await page.evaluate(() =>
    window.__game.state === 'playing' && !window.__game.plane.onGround && window.__game.mission.id === 'landing'));

  check('no console errors', errors.length === 0, errors.join(' | ').slice(0, 300));
  check('no external requests', external.length === 0, external.join(', ').slice(0, 200));
} catch (err) {
  check('probe completed without exception', false, String(err).slice(0, 300));
  console.error(err);
} finally {
  await browser.close();
}

const passed = results.filter((r) => r.ok).length;
console.log(`\nprobe: ${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
