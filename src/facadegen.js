// Генератор фасада по параметрам (снятым с фото в tools/facade.html). Общий для инструмента и игры.
// Рисует чистый пиксельный фасад и маску: R — стекло окон, G — проёмы первого этажа, B — номер окна
// (чтобы ночью окно горело целиком). Размеры в метрах, y — от низа стены.
//
// params: {
//   wall, trim: '#rrggbb'           — цвет стены и отделки (наличники, тяги, карниз)
//   floors: [y...]                  — линии этажей снизу вверх; первая — верх первого этажа, последняя — карниз
//   win: { w, h, dy, crown }        — окно верхних этажей: ширина, высота, отступ от пола, сандрик
//   floorWin: { [этаж]: { w, h, dy } } — своё окно у этажа (номер — индекс линии пола в floors)
//   cols: [u...]                    — центры окон вдоль стены (м от левого края)
//   ground: { type, w, h, cols }    — проёмы первого этажа: 'arch' | 'shop' | 'door'
//   dividers: [u...], tops: { [секция]: y } — фасад из корпусов разной высоты: границы
//                                     и верх карниза каждой секции (без tops — высота дома)
// }

// Секции фасада: [{ u0, u1, top, own }] — own: высота задана вручную.
export function facadeSections(p, L, h) {
  const cuts = [0, ...[...(p.dividers || [])].filter((u) => u > 0 && u < L).sort((a, b) => a - b), L];
  return cuts.slice(1).map((u1, i) => {
    const t = p.tops?.[i];
    return { u0: cuts[i], u1, top: t ?? h, own: t != null };
  });
}

export const PX_PER_M = 8;

export function drawFacade(p, L, h, P = PX_PER_M) {
  const secs = facadeSections(p, L, h);
  const Htot = Math.max(h, ...secs.map((q) => q.top)); // секции бывают выше дома
  const W = Math.max(1, Math.round(L * P)), H = Math.max(1, Math.round(Htot * P));
  const albedo = canvas(W, H), mask = canvas(W, H);
  const A = albedo.getContext('2d'), M = mask.getContext('2d');
  const wall = p.wall || '#8a9aa8', trim = p.trim || '#e8e6e0';
  const shadow = shade(wall, 0.62), dark = shade(wall, 0.82);
  const glassUp = '#1b1f27', glassDown = '#22262e';
  // Прямоугольник в метрах → в пиксели с привязкой к сетке (никакого сглаживания).
  const px = (u) => Math.round(u * P), py = (y) => H - Math.round(y * P);
  const rect = (ctx, color, u0, y0, u1, y1) => {
    const x0 = px(u0), x1 = px(u1), t = py(y1), b = py(y0);
    if (x1 <= x0 || b <= t) return;
    ctx.fillStyle = color;
    ctx.fillRect(x0, t, x1 - x0, b - t);
  };
  // Арка: прямоугольник с полукругом сверху, построчно (пиксельный край).
  const arch = (ctx, color, u0, y0, u1, y1) => {
    const r = (u1 - u0) / 2, cu = (u0 + u1) / 2, spring = y1 - r;
    rect(ctx, color, u0, y0, u1, Math.max(y0, spring));
    ctx.fillStyle = color;
    for (let row = py(y1); row < py(Math.max(y0, spring)); row++) {
      const y = (H - row - 0.5) / P - spring;
      const half = Math.sqrt(Math.max(0, r * r - y * y));
      const x0 = px(cu - half), x1 = px(cu + half);
      if (x1 > x0) ctx.fillRect(x0, row, x1 - x0, 1);
    }
  };

  A.fillStyle = wall; A.fillRect(0, 0, W, H);
  M.fillStyle = '#000'; M.fillRect(0, 0, W, H);
  const floors = [...(p.floors || [])].sort((a, b) => a - b);
  const g = floors[0] ?? Math.min(4.5, h);
  const cornice = floors.length > 1 ? floors[floors.length - 1] : h;

  // Первый этаж: руст — тонкие тёмные швы.
  A.fillStyle = dark;
  for (let y = 0.55; y < g - 0.2; y += 0.55) A.fillRect(0, py(y), W, 1);
  // Тяги между этажами: светлая полоса и тень под ней.
  for (const y of floors.slice(0, -1)) {
    rect(A, shadow, 0, y - 0.1, L, y);
    rect(A, trim, 0, y, L, y + 0.14);
  }
  // Карниз: тень, широкий выступ, над ним — аттик цвета стены.
  if (cornice < h) {
    rect(A, shadow, 0, cornice - 0.18, L, cornice);
    rect(A, trim, 0, cornice, L, Math.min(h, cornice + 0.4));
  }

  // Окна верхних этажей: наличник, стекло с переплётом, подоконник, сандрик.
  let id = 1;
  const win = p.win;
  if (win) {
    for (let f = 0; f < floors.length - 1; f++) {
      const fw = { ...win, ...(p.floorWin?.[f] || {}) }; // у этажа может быть своё окно
      const y0 = floors[f] + fw.dy, y1 = Math.min(y0 + fw.h, floors[f + 1] - 0.25);
      if (y1 - y0 < 0.4) continue;
      for (const u of p.cols || []) {
        const sec = secs.find((q) => u >= q.u0 && u < q.u1) || secs[0];
        if (sec.own && y1 > sec.top - 0.45) continue; // этажа нет — секция ниже
        const u0 = u - fw.w / 2, u1 = u + fw.w / 2;
        const n = (id++ * 97) % 251 + 4; // номер окна для маски (разброс 4…254)
        rect(A, trim, u0 - 0.12, y0 - 0.06, u1 + 0.12, y1 + 0.12);
        rect(A, glassUp, u0, y0, u1, y1);
        rect(A, trim, u - 0.04, y0, u + 0.04, y1); // импост
        rect(A, trim, u0, y0 + (y1 - y0) * 0.7, u1, y0 + (y1 - y0) * 0.7 + 0.08); // фрамуга
        rect(A, trim, u0 - 0.22, y0 - 0.14, u1 + 0.22, y0 - 0.04); // подоконник
        rect(A, shadow, u0 - 0.22, y0 - 0.2, u1 + 0.22, y0 - 0.14);
        if (win.crown !== false) {
          rect(A, shadow, u0 - 0.2, y1 + 0.12, u1 + 0.2, y1 + 0.2);
          rect(A, trim, u0 - 0.25, y1 + 0.2, u1 + 0.25, y1 + 0.38);
        }
        rect(M, `rgb(255,0,${n})`, u0, y0, u1, y1);
        rect(M, '#000', u - 0.04, y0, u + 0.04, y1); // переплёт не светится
      }
    }
  }

  // Проёмы первого этажа.
  const gr = p.ground;
  if (gr) {
    for (const u of gr.cols || []) {
      const u0 = u - gr.w / 2, u1 = u + gr.w / 2, y1 = Math.min(gr.h, g - 0.2);
      const n = (id++ * 97) % 251 + 4;
      const shape = gr.type === 'arch' ? arch : rect;
      shape(A, trim, u0 - 0.15, 0, u1 + 0.15, y1 + 0.15);
      shape(A, glassDown, u0, 0.15, u1, y1);
      if (gr.type === 'shop') rect(A, trim, u0, y1 - 0.6, u1, y1 - 0.52); // фрамуга витрины
      shape(M, `rgb(0,255,${n})`, u0, 0.15, u1, y1);
    }
  }

  // Секции своей высоты: свой карниз; ниже дома — заснеженная крыша до его верха; выше — пусто.
  const clear = (u0, y0, u1) => {
    const x0 = px(u0), x1 = px(u1), t = 0, b = py(y0);
    if (x1 > x0 && b > t) { A.clearRect(x0, t, x1 - x0, b - t); M.clearRect(x0, t, x1 - x0, b - t); }
  };
  for (const q of secs) {
    if (!q.own) { if (Htot > h) clear(q.u0, h, q.u1); continue; }
    clear(q.u0, Math.max(q.top, h), q.u1);
    if (q.top < h) {
      rect(A, '#3b3f4a', q.u0, q.top, q.u1, h);
      rect(A, '#dfe3ea', q.u0, h - 0.25, q.u1, h);
      rect(M, '#000', q.u0, q.top - 0.4, q.u1, h);
    }
    rect(A, wall, q.u0, cornice, q.u1, q.top - 0.4); // общий карниз секции не нужен
    rect(A, shadow, q.u0, q.top - 0.58, q.u1, q.top - 0.4);
    rect(A, trim, q.u0, q.top - 0.4, q.u1, q.top);
    rect(A, '#dfe3ea', q.u0, q.top - 0.06, q.u1, q.top); // снег на карнизе
  }
  return { albedo, mask, W, H, Htot };
}

function canvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * k));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
