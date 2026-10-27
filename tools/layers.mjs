// Снимок карты инструмента со слоями (нужен npm run dev): спутник, контуры OSM и то, что построила игра.
// node tools/layers.mjs x z [м/px-масштаб=4] [слои=sat,arch,door,fence,elem] out.png
import puppeteer from 'puppeteer-core';
const [x, z, s = '4', layers = 'sat,arch,door,fence,elem', out = 'layers.png'] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
const p = await b.newPage();
await p.setViewport({ width: 1400, height: 1000 });
await p.goto(`http://localhost:5173/tools/facade.html?view=${x},${z},${s}&layers=${layers}`, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 2500)); // плитки спутника
await (await p.$('#map')).screenshot({ path: out });
await b.close();
console.log(out);
