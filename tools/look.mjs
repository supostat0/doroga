// Кадр игры у точки на стене: камера в 7 м перед ней, смотрит на неё (нужен npm run dev).
// node tools/look.mjs x z nx nz out.png — (nx, nz) — наружу от стены. Для проверки фасадов (docs/LESSONS.md).
import puppeteer from 'puppeteer-core';
const [x, z, nx, nz, out] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal'] });
const p = await b.newPage();
await p.setViewport({ width: 900, height: 500 });
await p.goto('http://localhost:5173/?autostart&debug', { waitUntil: 'networkidle0' });
await p.waitForFunction(() => window.__game);
await new Promise((r) => setTimeout(r, 1500));
await p.keyboard.press('KeyG'); // полёт
await p.evaluate((x, z, nx, nz) => {
  const g = window.__game;
  g.camera.position.set(x + nx * 7, 1.7, z + nz * 7);
  g.chase.fly.yaw = Math.atan2(nx, nz);
  g.chase.fly.pitch = 0.08;
}, +x, +z, +nx, +nz);
await new Promise((r) => setTimeout(r, 1500));
await p.screenshot({ path: out });
await b.close();
console.log(out);
