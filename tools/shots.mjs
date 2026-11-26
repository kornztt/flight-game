// Screenshot runner for SKYLINE RUNNER (headed Firefox + Xvfb).
// Run under: xvfb-run -a -s "-screen 0 1280x720x24" node tools/shots.mjs
// Serve game/ at 127.0.0.1:8123 first (python3 -m http.server 8123 --directory game).
import { createRequire } from 'node:module';
const require = createRequire('/home/hatch/workspace/pw-test/package.json');
const { firefox } = require('playwright');
import { writeFileSync } from 'node:fs';

const SHOTS = [
  { name: '1-takeoff.jpg', query: '?shot=title' },
  { name: '2-cruise.jpg', query: '?shot=cruise' },
  { name: '3-landing.jpg', query: '?shot=landing' },
  { name: '4-win.jpg', query: '?shot=win' },
];

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
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const requests = [];
page.on('request', (r) => {
  if (!r.url().startsWith('http://127.0.0.1:8123')) requests.push(r.url());
});
for (const shot of SHOTS) {
  await page.goto(`http://127.0.0.1:8123/index.html${shot.query}`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(3000);
  const state = await page.evaluate(() => ({
    state: window.__game?.state,
    score: window.__game?.score,
    webgl: !!document.querySelector('#gl'),
  }));
  console.log('shot', shot.name, JSON.stringify(state));
  const out = '/home/hatch/workspace/makefun-flight-game/entry/screenshots/' + shot.name;
  await page.screenshot({ path: out, type: 'jpeg', quality: 82 });
}
console.log('console errors:', errors.length ? errors : 'none');
console.log('external requests:', requests.length ? requests : 'none');
await browser.close();
if (errors.length || requests.length) process.exit(1);
