// Спидометр, название улицы, мини-карта, автор фото рядом стоящего фасада.

import { distToPolyline } from './geom.js';

export class Hud {
  constructor(map, maskCanvas, facades = []) {
    this.map = map;
    this.facades = facades.filter((f) => f.credit);
    this.creditEl = document.getElementById('credit');
    this.speedEl = document.getElementById('speed');
    this.streetEl = document.getElementById('street');
    this.redEl = document.getElementById('redlights');
    this.mini = document.getElementById('minimap');
    this.mctx = this.mini.getContext('2d');
    this.mask = maskCanvas;
    this.timer = 0;
    this.named = map.roads.filter((r) => r.kind === 'drive' && r.name);
    this.reds = 0;
  }

  toggleMap() {
    this.mini.classList.toggle('off');
  }

  redLight() {
    this.reds++;
    this.redEl.hidden = false;
    this.redEl.textContent = `Проезд на красный: ${this.reds}`;
  }

  update(dt, car) {
    this.speedEl.textContent = Math.round(car.speed * 3.6);
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.25;

    let best = null;
    let bd = 14;
    for (const r of this.named) {
      const d = distToPolyline(car.x, car.z, r.p);
      if (d < bd) {
        bd = d;
        best = r.name;
      }
    }
    if (best !== null || bd >= 14) this.streetEl.textContent = best ?? '';
    const near = this.facades.find((f) => Math.hypot(f.mid[0] - car.x, f.mid[1] - car.z) < 45);
    this.creditEl.textContent = near ? `Фасад по фото: ${near.credit}` : '';
    this.drawMini(car);
  }

  drawMini(car) {
    const c = this.mctx;
    const S = this.mini.width;
    const [x0, z0, x1, z1] = this.map.ext;
    const scale = 1.4; // крупнее = ближе
    const mw = this.mask.width;
    const px = ((car.x - x0) / (x1 - x0)) * mw;
    const pz = ((car.z - z0) / (z1 - z0)) * mw;
    const view = 140 / ((x1 - x0) / mw) / scale; // ~140 м в поперечнике
    c.save();
    c.clearRect(0, 0, S, S);
    c.beginPath();
    c.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
    c.clip();
    c.fillStyle = '#e9e8f0';
    c.fillRect(0, 0, S, S);
    c.translate(S / 2, S / 2);
    c.rotate(car.h);
    c.globalAlpha = 0.55;
    c.filter = 'invert(1)';
    c.drawImage(this.mask, px - view / 2, pz - view / 2, view, view, -S / 2, -S / 2, S, S);
    c.restore();
    // Стрелка игрока.
    c.fillStyle = '#d23b3b';
    c.beginPath();
    c.moveTo(S / 2, S / 2 - 9);
    c.lineTo(S / 2 + 6, S / 2 + 7);
    c.lineTo(S / 2, S / 2 + 3);
    c.lineTo(S / 2 - 6, S / 2 + 7);
    c.closePath();
    c.fill();
  }
}
