// Процедурный звук без файлов: ветер с порывами, гул города, мотор, шины, хруст снега на тротуаре,
// поворотник, клаксон (H), звонки курьеров, гул проезжающего троллейбуса.
// Стартует по клику (браузеры не дают играть звук без жеста пользователя).

export class Sound {
  start() {
    if (this.ctx) return;
    const ctx = (this.ctx = new AudioContext());
    const master = ctx.createGain();
    master.gain.value = 0.7;
    master.connect(ctx.destination);
    const noise = noiseBuffer(ctx);
    const loop = () => {
      const s = ctx.createBufferSource();
      s.buffer = noise;
      s.loop = true;
      s.start(0, Math.random() * 2);
      return s;
    };

    // Ветер: полосовой шум с медленным «дыханием».
    const wind = loop();
    const wf = ctx.createBiquadFilter();
    wf.type = 'bandpass';
    wf.frequency.value = 420;
    wf.Q.value = 0.6;
    const wg = ctx.createGain();
    wg.gain.value = 0.05;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.09;
    const lfoAmp = ctx.createGain();
    lfoAmp.gain.value = 0.03;
    lfo.connect(lfoAmp).connect(wg.gain);
    lfo.start();
    wind.connect(wf).connect(wg).connect(master);

    // Гул города: низкий шум.
    const hum = loop();
    const hf = ctx.createBiquadFilter();
    hf.type = 'lowpass';
    hf.frequency.value = 160;
    const hg = ctx.createGain();
    hg.gain.value = 0.09;
    hum.connect(hf).connect(hg).connect(master);

    // Мотор: две пилы, частота от скорости и газа.
    this.eng = [ctx.createOscillator(), ctx.createOscillator()];
    const ef = ctx.createBiquadFilter();
    ef.type = 'lowpass';
    ef.frequency.value = 260;
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0.0;
    this.eng.forEach((o, i) => {
      o.type = 'sawtooth';
      o.frequency.value = 40 * (i ? 1.505 : 1);
      o.connect(ef);
      o.start();
    });
    ef.connect(this.engGain).connect(master);

    // Шины по снегу: высокий шум, громкость от скорости.
    const tire = loop();
    const tf = ctx.createBiquadFilter();
    tf.type = 'bandpass';
    tf.frequency.value = 1800;
    tf.Q.value = 0.4;
    this.tireGain = ctx.createGain();
    this.tireGain.gain.value = 0;
    tire.connect(tf).connect(this.tireGain).connect(master);
    this.windGain = wg;
    this.master = master;

    // Хруст снега под колёсами на тротуаре: шум с прерывистой громкостью.
    const crunch = loop();
    const cf = ctx.createBiquadFilter();
    cf.type = 'bandpass';
    cf.frequency.value = 900;
    cf.Q.value = 1.2;
    this.crunchGain = ctx.createGain();
    this.crunchGain.gain.value = 0;
    crunch.connect(cf).connect(this.crunchGain).connect(master);

    // Клаксон: две «квадратные» ноты через фильтр.
    this.hornGain = ctx.createGain();
    this.hornGain.gain.value = 0;
    const hf2 = ctx.createBiquadFilter();
    hf2.type = 'lowpass';
    hf2.frequency.value = 1400;
    for (const f of [392, 494]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      o.connect(hf2);
      o.start();
    }
    hf2.connect(this.hornGain).connect(master);

    // Гул троллейбуса: низкий тон с обертоном, громкость от расстояния.
    this.trolleyGain = ctx.createGain();
    this.trolleyGain.gain.value = 0;
    for (const [f, g] of [[110, 1], [330, 0.4]]) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      const og = ctx.createGain();
      og.gain.value = g;
      o.connect(og).connect(this.trolleyGain);
      o.start();
    }
    this.trolleyGain.connect(master);
    this.nextGust = ctx.currentTime + 5;
  }

  horn(on) {
    if (!this.ctx) return;
    this.hornGain.gain.setTargetAtTime(on ? 0.13 : 0, this.ctx.currentTime, 0.02);
  }

  // Короткий щелчок реле поворотника.
  tick(hi) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = hi ? 2400 : 1800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.14, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.035);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.04);
  }

  // Сигнал чужой машины: один-два коротких «бип», торопыга — длиннее и чаще.
  npcHorn(vol, aggr) {
    if (!this.ctx || vol <= 0) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const f = 330 + Math.random() * 120;
    const beeps = aggr ? [[0, 0.5]] : Math.random() < 0.5 ? [[0, 0.18]] : [[0, 0.14], [0.22, 0.14]];
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1500;
    lp.connect(this.master);
    for (const [dt, len] of beeps) {
      for (const k of [1, 1.26]) {
        const o = ctx.createOscillator();
        o.type = 'square';
        o.frequency.value = f * k;
        const g = ctx.createGain();
        const t = t0 + dt;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.07 * vol, t + 0.01);
        g.gain.setValueAtTime(0.07 * vol, t + len);
        g.gain.linearRampToValueAtTime(0, t + len + 0.03);
        o.connect(g).connect(lp);
        o.start(t);
        o.stop(t + len + 0.05);
      }
    }
  }

  // Мягкий «дзынь» — заказ забран/доставлен.
  chime() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    [[0, 880], [0.12, 1320]].forEach(([dt, f]) => {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0 + dt);
      g.gain.exponentialRampToValueAtTime(0.12, t0 + dt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.6);
      o.connect(g).connect(this.master);
      o.start(t0 + dt);
      o.stop(t0 + dt + 0.65);
    });
  }

  // Велосипедный звонок курьера: два коротких ярких «дзинь».
  bikeBell(vol) {
    if (!this.ctx || vol <= 0) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    for (const dt of [0, 0.16]) {
      for (const [k, a, d] of [[1, 1, 0.5], [2.71, 0.45, 0.25], [5.2, 0.2, 0.1]]) {
        const t = t0 + dt;
        const o = ctx.createOscillator();
        o.frequency.value = 2100 * k;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.06 * vol * a, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + d);
        o.connect(g).connect(this.master);
        o.start(t);
        o.stop(t + d + 0.02);
      }
    }
  }

  update(car, nearestTrolley = Infinity) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // Поворотник: щелчок на каждой смене фазы.
    if (car.blinkOn !== undefined && car.blinkOn !== this.lastBlink) {
      if (car.blinker) this.tick(car.blinkOn);
      this.lastBlink = car.blinkOn;
    }
    // Хруст снега — на тротуаре и вообще не на асфальте.
    const onSnow = (car.rideY ?? 0) > 0.07;
    this.crunchGain.gain.setTargetAtTime(onSnow ? Math.min(0.25, car.speed * 0.04) * (0.6 + Math.random() * 0.8) : 0, t, 0.05);
    this.trolleyGain.gain.setTargetAtTime(Math.min(0.1, 2.5 / Math.max(12, nearestTrolley)), t, 0.3);
    if (t > this.nextGust) {
      // Порыв ветра: громче на пару секунд.
      this.windGain.gain.setTargetAtTime(0.04 + Math.random() * 0.14, t, 0.8);
      this.nextGust = t + 4 + Math.random() * 8;
    }
    const sp = car.speed;
    const f = 38 + sp * 3.2 + car.throttle * 18;
    this.eng[0].frequency.setTargetAtTime(f, t, 0.1);
    this.eng[1].frequency.setTargetAtTime(f * 1.505, t, 0.1);
    this.engGain.gain.setTargetAtTime(0.025 + car.throttle * 0.035 + sp * 0.001, t, 0.15);
    this.tireGain.gain.setTargetAtTime(Math.min(0.06, sp * 0.004), t, 0.2);
  }

  // Глухой удар — заезд на бордюр.
  thump(power) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25 * power, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + 0.22);
  }
}

function noiseBuffer(ctx) {
  const len = ctx.sampleRate * 3;
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return b;
}
