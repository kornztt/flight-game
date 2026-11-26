// Debug: run the win sequence and log plane state every 2 s.
import { createRequire } from 'node:module';
const require = createRequire('/home/hatch/workspace/pw-test/package.json');
const { firefox } = require('playwright');

const browser = await firefox.launch({
  headless: false,
  firefoxUserPrefs: { 'webgl.force-enabled': true, 'webgl.software-webgl': true, 'gfx.webrender.software': true },
  env: { ...process.env, LIBGL_ALWAYS_SOFTWARE: '1', GALLIUM_DRIVER: 'llvmpipe', MOZ_DISABLE_CONTENT_SANDBOX: '1' },
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto('http://127.0.0.1:8123/index.html', { waitUntil: 'load', timeout: 30000 });
await page.waitForTimeout(1500);
await page.click('button[data-mission="ringrun"]');
await page.waitForTimeout(500);
await page.evaluate(() => window.__game.debug.skipToFinal());
await page.evaluate(() => window.__game.debug.teleportFinal());
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(2000);
  const s = await page.evaluate(() => {
    const g = window.__game;
    const p = g.plane;
    const ap = g.debug.apNow();
    return { state: g.state, x: p.x.toFixed(0), y: p.y.toFixed(0), z: p.z.toFixed(0), spd: p.speed.toFixed(0), thr: p.throttle.toFixed(2), pitch: p.pitch.toFixed(2), roll: p.roll.toFixed(2), ground: p.onGround, ap: g.autopilot, mode: g.autopilotMode, fuel: g.fuel.toFixed(0), apPitch: ap.pitch.toFixed(2), apRoll: ap.roll.toFixed(2), apThr: ap.throttleSet.toFixed(2) };
  });
  console.log(i * 2 + 's', JSON.stringify(s));
  if (s.state !== 'playing') break;
}
await browser.close();
