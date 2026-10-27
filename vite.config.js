import { defineConfig } from 'vite';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';

// Только для дев-сервера: инструмент tools/facade.html сохраняет разметку фасада
// в public/facades/index.json (какая стена, размеры, параметры, автор фото).
const facadeSaver = {
  name: 'facade-saver',
  configureServer(server) {
    // Очередь авторежима: какие снимки Mapillary нашлись перед какими стенами (data/, не в игру).
    server.middlewares.use('/__facade/shots', (req, res) => {
      const file = 'data/facade-shots.json';
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'GET') { res.end(existsSync(file) ? readFileSync(file) : '[]'); return; }
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => { writeFileSync(file, JSON.stringify(JSON.parse(body), null, 1) + '\n'); res.end('{}'); });
    });
    server.middlewares.use('/__facade', (req, res) => {
      if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const { meta } = JSON.parse(body);
        const dir = 'public/facades';
        mkdirSync(dir, { recursive: true });
        const file = `f_${Math.round(meta.mid[0])}_${Math.round(meta.mid[1])}`; // id стены
        const indexPath = `${dir}/index.json`;
        const list = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, 'utf8')) : [];
        const entry = { ...meta, file };
        const i = list.findIndex((f) => f.file === file);
        if (i >= 0) list[i] = entry; else list.push(entry);
        writeFileSync(indexPath, JSON.stringify(list, null, 1) + '\n');
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ file, total: list.length }));
      });
    });
  },
};

// Только для дев-сервера: прокси к Mapillary (ключ из .mapillary-token не уходит в браузер;
// картинки отдаются со своего адреса — иначе canvas не даст прочитать пиксели).
const MLY_FIELDS = 'id,is_pano,captured_at,computed_compass_angle,compass_angle,computed_geometry,geometry,camera_type,creator';
const mapillary = {
  name: 'mapillary-proxy',
  configureServer(server) {
    const token = () => readFileSync('.mapillary-token', 'utf8').trim();
    const api = async (path) => (await fetch(`https://graph.mapillary.com/${path}${path.includes('?') ? '&' : '?'}access_token=${token()}`)).json();
    server.middlewares.use('/__mly/near', async (req, res) => {
      const q = new URL(req.url, 'http://x').searchParams;
      try {
        const d = await api(`images?fields=${MLY_FIELDS}&bbox=${q.get('bbox')}&limit=500`);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(d.data || []));
      } catch (e) { res.statusCode = 502; res.end(String(e)); }
    });
    server.middlewares.use('/__mly/img', async (req, res) => {
      const q = new URL(req.url, 'http://x').searchParams;
      const size = { 256: 'thumb_256_url', 1024: 'thumb_1024_url', 2048: 'thumb_2048_url' }[q.get('size')] || 'thumb_2048_url';
      try {
        const meta = await api(`${encodeURIComponent(q.get('id'))}?fields=${size}`);
        const img = await fetch(meta[size]);
        res.setHeader('Content-Type', img.headers.get('content-type') || 'image/jpeg');
        res.setHeader('Cache-Control', 'max-age=86400');
        res.end(Buffer.from(await img.arrayBuffer()));
      } catch (e) { res.statusCode = 502; res.end(String(e)); }
    });
  },
};

export default defineConfig({
  base: './', // чтобы сборка работала из подпапки (GitHub Pages)
  build: { target: 'es2022' }, // нужен top-level await
  plugins: [facadeSaver, mapillary],
});
