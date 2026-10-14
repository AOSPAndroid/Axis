// Procedural sound effects (WebAudio). No audio files: everything is synthesised.
(function () {
  'use strict';
  let ctx = null, master = null, noiseBuf = null;
  let muted = false;

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp);
    comp.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  function out(vol, pan) {
    const g = ctx.createGain();
    g.gain.value = vol;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan || 0));
      g.connect(p); p.connect(master);
    } else g.connect(master);
    return g;
  }

  function tone(f0, f1, dur, type, vol, pan, delay = 0) {
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(1, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(out(vol, pan));
    o.start(t); o.stop(t + dur + 0.02);
  }

  function noise(dur, vol, filter, f0, f1, pan, q = 1, delay = 0) {
    const t = ctx.currentTime + delay;
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    const flt = ctx.createBiquadFilter();
    flt.type = filter;
    flt.Q.value = q;
    flt.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) flt.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(1, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(flt); flt.connect(g); g.connect(out(vol, pan));
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }

  const SFX = {
    swing: (v, p, k) => noise(k === 3 ? 0.3 : 0.14, v * 0.5, 'bandpass', k === 3 ? 600 : 2400, k === 3 ? 2600 : 900, p, 2),
    shot: (v, p) => { tone(980, 380, 0.09, 'square', v * 0.18, p); noise(0.05, v * 0.2, 'highpass', 3000, 3000, p); },
    bigshot: (v, p) => { tone(420, 90, 0.3, 'sawtooth', v * 0.25, p); noise(0.2, v * 0.3, 'lowpass', 2000, 300, p); },
    boom: (v, p) => { noise(0.7, v * 0.9, 'lowpass', 900, 60, p); tone(110, 30, 0.5, 'sine', v * 0.7, p); },
    bombDrop: (v, p) => tone(300, 260, 0.08, 'triangle', v * 0.3, p),
    hit: (v, p) => { tone(260, 120, 0.07, 'square', v * 0.22, p); noise(0.06, v * 0.3, 'bandpass', 1200, 600, p, 1.5); },
    hurt: (v) => { tone(160, 70, 0.18, 'sawtooth', v * 0.3, 0); },
    kill: (v, p) => { tone(520, 260, 0.15, 'square', v * 0.2, p); tone(390, 130, 0.3, 'square', v * 0.2, p, 0.08); },
    dash: (v, p) => noise(0.22, v * 0.5, 'bandpass', 500, 3000, p, 1.2),
    cloak: (v, p) => tone(300, 1400, 0.35, 'sine', v * 0.25, p),
    uncloak: (v, p) => tone(1200, 260, 0.3, 'sine', v * 0.25, p),
    bubbleUp: (v, p) => { tone(260, 620, 0.25, 'sine', v * 0.3, p); tone(390, 930, 0.25, 'sine', v * 0.15, p); },
    bubbleBreak: (v, p) => { noise(0.35, v * 0.5, 'highpass', 4000, 1500, p); tone(700, 120, 0.3, 'triangle', v * 0.3, p); },
    block: (v, p) => tone(1500, 1100, 0.07, 'triangle', v * 0.25, p),
    spark: (v, p) => noise(0.04, v * 0.12, 'highpass', 5000, 5000, p),
    heal: (v, p) => { [523, 659, 784].forEach((f, i) => tone(f, f, 0.14, 'sine', v * 0.25, p, i * 0.07)); },
    reload: (v, p) => { tone(1800, 1800, 0.03, 'square', v * 0.12, p); tone(1300, 1300, 0.03, 'square', v * 0.12, p, 0.5); tone(2200, 2200, 0.04, 'square', v * 0.14, p, 1.2); },
    fizzle: (v, p) => noise(0.2, v * 0.2, 'lowpass', 1500, 200, p),
    capGood: (v) => { [523, 659, 784, 1046].forEach((f, i) => tone(f, f, 0.22, 'triangle', v * 0.3, 0, i * 0.09)); },
    capBad: (v) => { [440, 415, 370, 311].forEach((f, i) => tone(f, f, 0.24, 'triangle', v * 0.3, 0, i * 0.11)); },
    neutral: (v) => { tone(600, 600, 0.12, 'triangle', v * 0.25, 0); tone(450, 450, 0.18, 'triangle', v * 0.25, 0, 0.12); },
    start: (v) => { [392, 523, 659, 784].forEach((f, i) => tone(f, f, 0.25, 'square', v * 0.15, 0, i * 0.12)); },
    win: (v) => { [523, 659, 784, 1046, 784, 1046].forEach((f, i) => tone(f, f, 0.3, 'square', v * 0.16, 0, i * 0.13)); },
    lose: (v) => { [392, 370, 349, 262].forEach((f, i) => tone(f, f, 0.35, 'square', v * 0.16, 0, i * 0.18)); },
    click: (v) => tone(900, 900, 0.03, 'square', v * 0.1, 0),
    chat: (v) => tone(1200, 1500, 0.08, 'sine', v * 0.15, 0),
  };

  window.Sound = {
    init,
    get muted() { return muted; },
    toggleMute() { muted = !muted; if (master) master.gain.value = muted ? 0 : 0.5; return muted; },
    // Play a sound, attenuated and panned relative to the listener position.
    play(name, x, y, lx, ly, extra) {
      if (!ctx || muted || !SFX[name]) return;
      let v = 1, p = 0;
      if (x != null && lx != null) {
        const dx = x - lx, dy = y - ly;
        const d = Math.hypot(dx, dy);
        v = Math.max(0, 1 - d / 1400);
        if (v <= 0.02) return;
        p = dx / 700;
      }
      SFX[name](v, p, extra);
    },
  };
})();
