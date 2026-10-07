/* UNHALLOWED — small synthesized sound set (WebAudio). No audio files needed. */
'use strict';
(function (U) {
  const A = {
    ctx: null,
    master: null,
    sfx: null,
    noiseBuf: null,
    lastPlay: Object.create(null),
    enabled: true,
    ambient: null,
  };
  U.audio = A;

  A.unlock = function () {
    try {
      if (!A.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) { A.enabled = false; return; }
        A.ctx = new AC();
        const comp = A.ctx.createDynamicsCompressor();
        comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 5;
        comp.attack.value = 0.003; comp.release.value = 0.18;
        A.master = A.ctx.createGain();
        A.master.gain.value = 0.8;
        A.sfx = A.ctx.createGain();
        A.sfx.gain.value = 1.0;
        A.sfx.connect(comp); comp.connect(A.master); A.master.connect(A.ctx.destination);
        // 2 s of white noise, reused by every noise voice
        const len = A.ctx.sampleRate * 2;
        A.noiseBuf = A.ctx.createBuffer(1, len, A.ctx.sampleRate);
        const d = A.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      if (A.ctx.state === 'suspended') A.ctx.resume();
    } catch (e) { console.warn('audio unavailable', e); A.enabled = false; }
  };

  function env(g, t0, attack, hold, decay, peak) {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + attack);
    g.gain.setValueAtTime(peak, t0 + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + hold + decay);
  }

  // filtered noise voice
  function noise(o) {
    const c = A.ctx, t0 = c.currentTime + (o.delay || 0);
    const src = c.createBufferSource();
    src.buffer = A.noiseBuf;
    src.playbackRate.value = o.rate || 1;
    const f = c.createBiquadFilter();
    f.type = o.type || 'bandpass';
    f.Q.value = o.q || 1;
    f.frequency.setValueAtTime(o.f0 || 1000, t0);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t0 + (o.sweep || o.dur || 0.2));
    const g = c.createGain();
    const dur = (o.attack || 0.005) + (o.hold || 0) + (o.dur || 0.2);
    env(g, t0, o.attack || 0.005, o.hold || 0, o.dur || 0.2, o.gain || 0.3);
    src.connect(f); f.connect(g); g.connect(o.out || A.sfx);
    src.start(t0, Math.random() * 1.5);
    src.stop(t0 + dur + 0.05);
  }

  // oscillator voice with pitch glide
  function tone(o) {
    const c = A.ctx, t0 = c.currentTime + (o.delay || 0);
    const osc = c.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f0 || 440, t0);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(o.f1, t0 + (o.sweep || o.dur || 0.2));
    if (o.detune) osc.detune.value = o.detune;
    const g = c.createGain();
    const dur = (o.attack || 0.005) + (o.hold || 0) + (o.dur || 0.2);
    env(g, t0, o.attack || 0.005, o.hold || 0, o.dur || 0.2, o.gain || 0.2);
    let node = osc;
    if (o.lp) {
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; f.Q.value = o.lpq || 0.7;
      if (o.lp1) f.frequency.exponentialRampToValueAtTime(o.lp1, t0 + dur);
      osc.connect(f); node = f;
    }
    node.connect(g); g.connect(o.out || A.sfx);
    osc.start(t0); osc.stop(t0 + dur + 0.05);
  }

  // short metallic ping built from inharmonic partials
  function ping(f, gain, dur, delay) {
    const ratios = [1, 2.76, 5.4];
    ratios.forEach((r, i) => tone({ type: 'sine', f0: f * r, dur: dur * (1 - i * 0.25), gain: gain / (i + 1.4), attack: 0.002, delay }));
  }

  const R = {
    swing1() {
      noise({ type: 'bandpass', f0: 700, f1: 2600, q: 1.4, attack: 0.03, dur: 0.16, gain: 0.32 });
      noise({ type: 'highpass', f0: 4000, q: 0.7, attack: 0.02, dur: 0.07, gain: 0.08 });
    },
    swing2() {
      noise({ type: 'bandpass', f0: 420, f1: 2200, q: 1.2, attack: 0.05, dur: 0.24, gain: 0.42 });
      tone({ type: 'sine', f0: 160, f1: 70, attack: 0.03, dur: 0.18, gain: 0.18 });
      noise({ type: 'highpass', f0: 3000, q: 0.8, attack: 0.04, dur: 0.12, gain: 0.08, delay: 0.03 });
    },
    hit(o) {
      const heavy = o && o.heavy;
      noise({ type: 'bandpass', f0: heavy ? 1600 : 2400, q: 0.9, dur: heavy ? 0.12 : 0.07, gain: heavy ? 0.5 : 0.36 });
      tone({ type: 'sine', f0: heavy ? 150 : 200, f1: 45, dur: heavy ? 0.22 : 0.12, gain: heavy ? 0.55 : 0.32 });
      ping(heavy ? 1250 : 1750 + Math.random() * 300, heavy ? 0.1 : 0.06, heavy ? 0.5 : 0.28);
    },
    dodge() {
      noise({ type: 'highpass', f0: 1600, f1: 7000, q: 0.8, attack: 0.008, dur: 0.17, gain: 0.34 });
      noise({ type: 'bandpass', f0: 900, f1: 300, q: 2, attack: 0.01, dur: 0.14, gain: 0.12 });
      tone({ type: 'sine', f0: 1800, f1: 3200, attack: 0.003, dur: 0.12, gain: 0.035 });
    },
    q() {
      tone({ type: 'sine', f0: 3400, f1: 1100, attack: 0.002, dur: 0.28, gain: 0.07 });
      tone({ type: 'triangle', f0: 1700, f1: 2600, attack: 0.003, dur: 0.08, gain: 0.05 });
      noise({ type: 'bandpass', f0: 6000, f1: 1500, q: 3, attack: 0.002, dur: 0.18, gain: 0.22, delay: 0.14 });
      noise({ type: 'highpass', f0: 2500, q: 0.7, attack: 0.002, dur: 0.06, gain: 0.18, delay: 0.16 });
    },
    qhit() {
      ping(2600 + Math.random() * 400, 0.05, 0.35);
      noise({ type: 'highpass', f0: 5000, q: 0.7, dur: 0.05, gain: 0.18 });
    },
    eRise() {
      noise({ type: 'lowpass', f0: 180, f1: 1400, q: 3, attack: 0.3, dur: 0.25, gain: 0.32 });
      tone({ type: 'sine', f0: 70, f1: 120, attack: 0.25, dur: 0.3, gain: 0.22 });
      tone({ type: 'sine', f0: 900, f1: 1400, attack: 0.3, dur: 0.2, gain: 0.025 });
    },
    eGrasp() {
      noise({ type: 'lowpass', f0: 600, f1: 120, q: 1, dur: 0.2, gain: 0.5 });
      tone({ type: 'sine', f0: 130, f1: 42, dur: 0.25, gain: 0.45 });
      noise({ type: 'bandpass', f0: 2500, q: 2, dur: 0.06, gain: 0.12 });
    },
    rWind() {
      noise({ type: 'bandpass', f0: 160, f1: 1300, q: 2, attack: 0.45, dur: 0.12, gain: 0.3 });
      tone({ type: 'sawtooth', f0: 55, f1: 82, attack: 0.4, dur: 0.15, gain: 0.08, lp: 300 });
      tone({ type: 'sine', f0: 600, f1: 1800, attack: 0.45, dur: 0.1, gain: 0.03 });
    },
    rSlash() {
      noise({ type: 'bandpass', f0: 4200, f1: 500, q: 1.1, attack: 0.004, dur: 0.32, gain: 0.7 });
      noise({ type: 'lowpass', f0: 900, f1: 80, q: 1, attack: 0.004, dur: 0.5, gain: 0.45 });
      tone({ type: 'sawtooth', f0: 120, f1: 32, attack: 0.004, dur: 0.55, gain: 0.22, lp: 900, lp1: 120 });
      ping(980, 0.09, 0.9, 0.02);
    },
    t() {
      tone({ type: 'sine', f0: 520, f1: 260, attack: 0.15, dur: 0.9, gain: 0.08 });
      tone({ type: 'sine', f0: 523 * 1.5, f1: 390, attack: 0.18, dur: 0.9, gain: 0.04, detune: 7 });
      for (let i = 0; i < 6; i++) noise({ type: 'bandpass', f0: 3200, q: 8, dur: 0.03, gain: 0.16 - i * 0.02, delay: 0.12 + i * 0.22 });
    },
    yCharge() {
      tone({ type: 'sawtooth', f0: 46, f1: 62, attack: 0.85, dur: 0.15, gain: 0.16, lp: 180, lp1: 1800, lpq: 4 });
      tone({ type: 'sawtooth', f0: 69, f1: 93, attack: 0.85, dur: 0.15, gain: 0.08, lp: 180, lp1: 2200, lpq: 3 });
      noise({ type: 'bandpass', f0: 300, f1: 3500, q: 3, attack: 0.9, dur: 0.1, gain: 0.22 });
      tone({ type: 'sine', f0: 1320, f1: 2640, attack: 0.9, dur: 0.1, gain: 0.03 });
    },
    yBurst() {
      noise({ type: 'lowpass', f0: 9000, f1: 160, q: 0.7, attack: 0.004, dur: 1.3, gain: 0.85 });
      tone({ type: 'sine', f0: 80, f1: 28, attack: 0.004, dur: 0.9, gain: 0.8 });
      tone({ type: 'sawtooth', f0: 160, f1: 40, attack: 0.004, dur: 0.6, gain: 0.18, lp: 1200, lp1: 100 });
      ping(660, 0.1, 1.4, 0.0);
      ping(990, 0.07, 1.2, 0.05);
    },
    // the fold: space snapping shut between the blade and something far away
    fold() {
      tone({ type: 'sine', f0: 2400, f1: 300, attack: 0.002, dur: 0.12, gain: 0.05 });
      noise({ type: 'bandpass', f0: 5200, f1: 900, q: 4, attack: 0.002, dur: 0.1, gain: 0.14 });
      tone({ type: 'sine', f0: 90, f1: 140, attack: 0.002, dur: 0.08, gain: 0.12 });
    },
    // pinned in time / snapping back into place
    pin() {
      tone({ type: 'triangle', f0: 1900, f1: 2100, attack: 0.002, dur: 0.06, gain: 0.05 });
      noise({ type: 'highpass', f0: 6000, q: 0.7, dur: 0.04, gain: 0.12 });
    },
    tick() {
      noise({ type: 'bandpass', f0: 2600, q: 9, dur: 0.035, gain: 0.14 });
      tone({ type: 'sine', f0: 180, f1: 90, attack: 0.002, dur: 0.12, gain: 0.08 });
    },
    // The Missing Second: a pitched-down drone for the life of the field
    tDrone() {
      tone({ type: 'sawtooth', f0: 98, f1: 49, attack: 0.3, hold: 3.2, dur: 0.6, sweep: 4, gain: 0.05, lp: 420, lpq: 2 });
      tone({ type: 'sine', f0: 196, f1: 92, attack: 0.3, hold: 3.2, dur: 0.6, sweep: 4, gain: 0.05, detune: -12 });
      noise({ type: 'bandpass', f0: 900, f1: 220, q: 5, attack: 0.5, hold: 2.8, dur: 0.8, sweep: 4, gain: 0.06, rate: 0.5 });
    },
    // reversed swell: the collapse plays time backwards
    rewind() {
      noise({ type: 'bandpass', f0: 300, f1: 4800, q: 2, attack: 0.38, dur: 0.04, gain: 0.3 });
      tone({ type: 'sine', f0: 60, f1: 420, attack: 0.36, dur: 0.06, gain: 0.16 });
      ping(1600, 0.06, 0.5, 0.4);
    },
    swallow() {
      noise({ type: 'lowpass', f0: 2400, f1: 90, q: 3, attack: 0.002, dur: 0.2, gain: 0.22 });
      tone({ type: 'sine', f0: 600, f1: 60, attack: 0.002, dur: 0.18, gain: 0.08 });
    },
    // a wound in the air that stays open
    tear() {
      noise({ type: 'bandpass', f0: 140, f1: 60, q: 6, attack: 0.1, hold: 0.4, dur: 2.2, gain: 0.3, rate: 0.3 });
      tone({ type: 'sine', f0: 41, f1: 38, attack: 0.2, hold: 1.4, dur: 1.4, gain: 0.25 });
      tone({ type: 'sine', f0: 1244, f1: 1230, attack: 0.6, hold: 0.8, dur: 1.2, gain: 0.018, detune: 9 });
    },
    // the seal objects: everything inverts; then silence where things were
    negative() {
      tone({ type: 'sine', f0: 3520, f1: 3400, attack: 0.002, hold: 0.8, dur: 0.2, gain: 0.03 });
      tone({ type: 'sine', f0: 3527, f1: 3410, attack: 0.002, hold: 0.8, dur: 0.2, gain: 0.03 });
      tone({ type: 'sine', f0: 35, f1: 30, attack: 0.05, hold: 0.7, dur: 0.3, gain: 0.35 });
    },
    erase() {
      noise({ type: 'highpass', f0: 7000, q: 0.7, attack: 0.002, dur: 0.6, gain: 0.12, delay: 0.05 });
      ping(220, 0.08, 2.4, 0.15);
      tone({ type: 'sine', f0: 110, f1: 104, attack: 0.3, hold: 0.6, dur: 1.6, gain: 0.08, delay: 0.1 });
    },
    // ---- the keepers ----
    bossIntro() {
      tone({ type: 'sawtooth', f0: 41, f1: 55, attack: 0.6, hold: 0.8, dur: 1.4, gain: 0.14, lp: 220, lp1: 900, lpq: 3 });
      tone({ type: 'sine', f0: 82, f1: 78, attack: 0.4, hold: 1.0, dur: 1.5, gain: 0.14 });
      noise({ type: 'bandpass', f0: 120, f1: 600, q: 3, attack: 0.8, hold: 0.4, dur: 1.2, gain: 0.25 });
      ping(220, 0.08, 2.5, 0.5); ping(233, 0.05, 2.5, 0.55);
    },
    roar() {
      noise({ type: 'bandpass', f0: 260, f1: 140, q: 1.5, attack: 0.08, hold: 0.5, dur: 0.6, gain: 0.5 });
      tone({ type: 'sawtooth', f0: 70, f1: 46, attack: 0.08, hold: 0.5, dur: 0.6, gain: 0.16, lp: 500 });
      tone({ type: 'square', f0: 140, f1: 92, attack: 0.1, hold: 0.4, dur: 0.5, gain: 0.04, lp: 900 });
    },
    chain() {
      for (let i = 0; i < 7; i++) ping(1800 + Math.random() * 1600, 0.025, 0.15, i * 0.035);
      noise({ type: 'highpass', f0: 3000, q: 0.7, dur: 0.25, gain: 0.12 });
    },
    chainHit() {
      ping(900, 0.08, 0.5); ping(1340, 0.05, 0.4, 0.02);
      noise({ type: 'bandpass', f0: 1800, q: 2, dur: 0.1, gain: 0.25 });
      tone({ type: 'sine', f0: 120, f1: 60, dur: 0.2, gain: 0.3 });
    },
    tetherBreak() {
      for (let i = 0; i < 10; i++) ping(1500 + Math.random() * 3000, 0.03, 0.3, Math.random() * 0.1);
      noise({ type: 'highpass', f0: 2500, q: 0.7, dur: 0.3, gain: 0.25 });
    },
    slamLand() {
      noise({ type: 'lowpass', f0: 900, f1: 60, q: 1, dur: 0.6, gain: 0.7 });
      tone({ type: 'sine', f0: 70, f1: 26, dur: 0.6, gain: 0.7 });
      noise({ type: 'bandpass', f0: 2200, q: 1.5, dur: 0.08, gain: 0.2 });
    },
    poiseBreak() {
      ping(520, 0.1, 1.0); ping(780, 0.07, 0.8, 0.03);
      noise({ type: 'bandpass', f0: 3000, f1: 800, q: 2, dur: 0.3, gain: 0.25 });
      tone({ type: 'sine', f0: 150, f1: 50, dur: 0.4, gain: 0.35 });
    },
    bossDeath() {
      tone({ type: 'sawtooth', f0: 110, f1: 27, attack: 0.02, hold: 0.6, dur: 2.2, gain: 0.18, lp: 1200, lp1: 90 });
      tone({ type: 'sine', f0: 55, f1: 30, attack: 0.02, hold: 0.8, dur: 2.0, gain: 0.5 });
      noise({ type: 'lowpass', f0: 5000, f1: 120, q: 0.7, attack: 0.01, hold: 0.4, dur: 2.0, gain: 0.5 });
      ping(440, 0.08, 3, 0.4); ping(660, 0.06, 3, 0.5); ping(330, 0.07, 3.2, 0.6);
    },
    sentence() {
      tone({ type: 'sine', f0: 2600, f1: 2500, attack: 0.002, hold: 0.3, dur: 0.6, gain: 0.05 });
      tone({ type: 'sine', f0: 2610, f1: 2505, attack: 0.002, hold: 0.3, dur: 0.6, gain: 0.05 });
      noise({ type: 'highpass', f0: 4000, q: 0.7, dur: 0.5, gain: 0.2 });
      tone({ type: 'sine', f0: 60, f1: 40, dur: 0.5, gain: 0.4 });
    },
    hurt() {
      noise({ type: 'lowpass', f0: 1400, f1: 200, q: 1, dur: 0.18, gain: 0.45 });
      tone({ type: 'square', f0: 140, f1: 70, dur: 0.16, gain: 0.08, lp: 700 });
    },
    windup() {
      noise({ type: 'bandpass', f0: 900, f1: 2600, q: 5, attack: 0.3, dur: 0.08, gain: 0.07 });
      tone({ type: 'triangle', f0: 180, f1: 230, attack: 0.28, dur: 0.1, gain: 0.035 });
    },
    pslash() {
      noise({ type: 'bandpass', f0: 1800, f1: 600, q: 1.5, attack: 0.01, dur: 0.12, gain: 0.26 });
    },
    idolCharge() {
      tone({ type: 'sine', f0: 220, f1: 440, attack: 0.6, dur: 0.1, gain: 0.05 });
      tone({ type: 'sine', f0: 233, f1: 466, attack: 0.6, dur: 0.1, gain: 0.035 });
    },
    idolFire() {
      tone({ type: 'triangle', f0: 760, f1: 210, dur: 0.16, gain: 0.08 });
      noise({ type: 'bandpass', f0: 2000, f1: 700, q: 2, dur: 0.1, gain: 0.12 });
    },
    eruptMark() {
      tone({ type: 'sine', f0: 140, f1: 190, attack: 0.05, dur: 0.4, gain: 0.08 });
    },
    erupt() {
      noise({ type: 'lowpass', f0: 700, f1: 90, q: 1, dur: 0.38, gain: 0.42 });
      tone({ type: 'sine', f0: 95, f1: 38, dur: 0.3, gain: 0.32 });
      noise({ type: 'bandpass', f0: 2600, q: 2, dur: 0.06, gain: 0.1 });
    },
    shatter() {
      for (let i = 0; i < 5; i++) tone({ type: 'sine', f0: 1800 + Math.random() * 3200, dur: 0.15 + Math.random() * 0.25, gain: 0.03, delay: Math.random() * 0.08 });
      noise({ type: 'highpass', f0: 3000, q: 0.7, dur: 0.25, gain: 0.22 });
      noise({ type: 'lowpass', f0: 500, f1: 100, dur: 0.25, gain: 0.25 });
    },
    spawn() {
      noise({ type: 'bandpass', f0: 250, f1: 1400, q: 2, attack: 0.55, dur: 0.15, gain: 0.16 });
      tone({ type: 'sine', f0: 98, f1: 73, attack: 0.4, dur: 0.4, gain: 0.08 });
    },
    ui() { tone({ type: 'sine', f0: 1500, f1: 1200, attack: 0.002, dur: 0.07, gain: 0.05 }); },
    choose() {
      ping(880, 0.07, 0.9);
      tone({ type: 'sine', f0: 440, attack: 0.02, dur: 0.8, gain: 0.05 });
    },
    wave() {
      tone({ type: 'sine', f0: 110, attack: 0.4, dur: 1.4, gain: 0.12 });
      tone({ type: 'sine', f0: 164.8, attack: 0.5, dur: 1.3, gain: 0.07 });
      ping(440, 0.05, 1.5, 0.1);
    },
    ready() { ping(1320, 0.035, 0.5); },
    death() {
      tone({ type: 'sine', f0: 220, f1: 55, attack: 0.02, dur: 1.8, gain: 0.2 });
      noise({ type: 'lowpass', f0: 1200, f1: 80, dur: 1.4, gain: 0.3 });
    },
    victory() {
      [220, 277.2, 329.6, 440].forEach((f, i) => tone({ type: 'sine', f0: f, attack: 0.3, dur: 2.4, gain: 0.06, delay: i * 0.12 }));
      ping(880, 0.05, 2, 0.5);
    },
  };

  A.play = function (name, opts) {
    if (!A.enabled || !A.ctx || A.ctx.state !== 'running') return;
    const now = A.ctx.currentTime;
    const minGap = (opts && opts.gap) || 0.035;
    if (A.lastPlay[name] && now - A.lastPlay[name] < minGap) return;
    A.lastPlay[name] = now;
    const r = R[name];
    if (r) {
      try { r(opts); } catch (e) { /* never let audio break the game */ }
    }
  };

  // Low wind + drone bed. Very quiet.
  A.startAmbient = function () {
    if (!A.ctx || A.ambient) return;
    const c = A.ctx;
    const out = c.createGain(); out.gain.value = 0.0001; out.connect(A.master);
    out.gain.linearRampToValueAtTime(1, c.currentTime + 3);
    const src = c.createBufferSource(); src.buffer = A.noiseBuf; src.loop = true;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 380; f.Q.value = 0.5;
    const g = c.createGain(); g.gain.value = 0.05;
    const lfo = c.createOscillator(); lfo.frequency.value = 0.07;
    const lfoG = c.createGain(); lfoG.gain.value = 0.03;
    lfo.connect(lfoG); lfoG.connect(g.gain);
    const lfo2 = c.createOscillator(); lfo2.frequency.value = 0.045;
    const lfo2G = c.createGain(); lfo2G.gain.value = 160;
    lfo2.connect(lfo2G); lfo2G.connect(f.frequency);
    src.connect(f); f.connect(g); g.connect(out);
    const drones = [];
    [55, 55.3, 82.4].forEach((fr, i) => {
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = fr;
      const og = c.createGain(); og.gain.value = i === 2 ? 0.012 : 0.022;
      o.connect(og); og.connect(out); o.start(); drones.push(o);
    });
    src.start(); lfo.start(); lfo2.start();
    // whispering, held at zero until he strains himself (S.strain)
    const wg = c.createGain(); wg.gain.value = 0; wg.connect(A.master);
    const ws = c.createBufferSource(); ws.buffer = A.noiseBuf; ws.loop = true; ws.playbackRate.value = 0.9;
    const wl = [];
    [[700, 0.31], [1250, 0.43], [2300, 0.57]].forEach(([fr, rate]) => {
      const bf = c.createBiquadFilter(); bf.type = 'bandpass'; bf.frequency.value = fr; bf.Q.value = 9;
      const lf = c.createOscillator(); lf.frequency.value = rate; const lg = c.createGain(); lg.gain.value = fr * 0.35;
      lf.connect(lg); lg.connect(bf.frequency); lf.start(); wl.push(lf);
      ws.connect(bf); bf.connect(wg);
    });
    // syllable-like chopping
    const am = c.createGain(); am.gain.value = 0; wg.disconnect(); wg.connect(am); am.connect(A.master);
    const ch = c.createOscillator(); ch.type = 'square'; ch.frequency.value = 5.3; const chg = c.createGain(); chg.gain.value = 0.5;
    const ch2 = c.createOscillator(); ch2.frequency.value = 1.7; const ch2g = c.createGain(); ch2g.gain.value = 0.35;
    ch.connect(chg); chg.connect(am.gain); ch2.connect(ch2g); ch2g.connect(am.gain); ch.start(); ch2.start(); wl.push(ch, ch2);
    am.gain.value = 0.5;
    ws.start();
    A.ambient = { out, src, lfo, lfo2, drones, whisper: wg, wl };
  };

  A.setStrain = function (s) {
    if (!A.ambient || !A.ambient.whisper) return;
    const v = Math.max(0, s - 0.25) * 0.5;
    if (Math.abs(v - (A._strainV || 0)) < 0.01) return;
    A._strainV = v;
    A.ambient.whisper.gain.setTargetAtTime(v, A.ctx.currentTime, 0.4);
  };

  A.setAmbient = function (level) {
    if (!A.ambient) return;
    A.ambient.out.gain.setTargetAtTime(level, A.ctx.currentTime, 0.5);
  };
})(window.U);
