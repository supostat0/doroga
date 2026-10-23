// Индикатор нагрузки «для обывателя»: P — показать/скрыть, ?perf — показать сразу (с тех. деталями).
// Процент — какую долю времени кадра (1/60 с) заняли процессор и видеокарта.
// Видеокарту браузер даёт измерить не везде (EXT_disjoint_timer_query_webgl2) — тогда судим по плавности.

const BUDGET = 1000 / 60;

export class PerfMeter {
  constructor(renderer, { visible = false, details = false } = {}) {
    this.r = renderer;
    this.details = details;
    renderer.info.autoReset = false; // считаем за весь кадр, включая постобработку
    this.el = document.createElement('div');
    this.el.className = 'perf';
    this.el.hidden = !visible;
    document.body.appendChild(this.el);
    addEventListener('keydown', (e) => {
      if (e.code === 'KeyP') this.el.hidden = !this.el.hidden;
    });

    const gl = renderer.getContext();
    this.gl = gl;
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.queries = [];
    this.gpuMs = [];
    this.n = 0;
    this.cpu = 0;
    this.time = 0;
    this.slow = 0;
  }

  // Обернуть отрисовку кадра — для замера видеокарты.
  begin() {
    if (!this.ext || this.el.hidden || this.active) return;
    const q = this.gl.createQuery();
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.active = q;
  }

  end() {
    if (!this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.queries.push(this.active);
    this.active = null;
  }

  frame(dt, cpuMs) {
    const i = this.r.info;
    this.pollGpu();
    this.n++;
    this.cpu += cpuMs;
    this.time += dt;
    if (dt > 1 / 45) this.slow++;
    if (this.time < 0.5) {
      i.reset();
      return;
    }
    if (!this.el.hidden) this.render(i);
    this.n = this.cpu = this.time = this.slow = 0;
    this.gpuMs = [];
    i.reset();
  }

  pollGpu() {
    const gl = this.gl;
    while (this.queries.length) {
      const q = this.queries[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      if (!gl.getParameter(this.ext.GPU_DISJOINT_EXT)) this.gpuMs.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
      gl.deleteQuery(q);
      this.queries.shift();
    }
  }

  render(info) {
    const fps = Math.round(this.n / this.time);
    const cpuPct = Math.round(((this.cpu / this.n) / BUDGET) * 100);
    const gpu = this.gpuMs.length ? this.gpuMs.reduce((a, b) => a + b, 0) / this.gpuMs.length : null;
    const gpuPct = gpu !== null ? Math.round((gpu / BUDGET) * 100) : null;
    const choppy = this.slow / this.n > 0.15 || fps < 50;
    const load = Math.max(cpuPct, gpuPct ?? 0);

    let level, text;
    if (choppy) {
      level = 'high';
      text = 'Не хватает мощности — картинка дёргается';
    } else if (load < 35) {
      level = 'low';
      text = 'Лёгкая — ноутбук не напрягается';
    } else if (load < 70) {
      level = 'mid';
      text = 'Средняя — нормально';
    } else {
      level = 'high';
      text = 'Высокая — ноутбук может греться';
    }
    const smooth = fps >= 55 ? 'отлично' : fps >= 40 ? 'терпимо' : 'дёргается';
    const bar = Math.min(100, choppy ? 100 : load);
    const gpuLine = gpuPct !== null ? `${gpuPct}%` : 'не измеряется в этом браузере';
    this.el.dataset.level = level;
    this.el.innerHTML = `
      <div class="perf-title">Нагрузка: ${text}</div>
      <div class="perf-bar"><i style="width:${Math.max(4, bar)}%"></i></div>
      <div>Плавность: ${fps} кадров/с — ${smooth}</div>
      <div>Процессор занят: ${cpuPct}%</div>
      <div>Видеокарта занята: ${gpuLine}</div>
      ${this.details ? `<div class="perf-tech">${info.render.calls} draw · ${Math.round(info.render.triangles / 1000)}k tri · ${info.memory.textures} tex</div>` : ''}
      <div class="perf-hint">P — скрыть</div>`;
  }
}
