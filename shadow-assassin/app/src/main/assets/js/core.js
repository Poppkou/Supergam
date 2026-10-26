'use strict';
/* Ядро: утилиты, настройки, рендерер, звук. Все модули делят глобальный объект SA. */
window.SA = {};
(function (SA) {
  const THREE = window.THREE;

  // ---------- Утилиты ----------
  const U = (SA.U = {});
  U.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  U.lerp = (a, b, t) => a + (b - a) * t;
  U.smooth = (a, b, x) => { const t = U.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  U.angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
  U.angLerp = (a, b, t) => a + U.angDiff(a, b) * t;
  U.dist2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
  U.damp = (k, dt) => 1 - Math.exp(-k * dt);
  U.mulberry32 = function (a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  SA.rng = U.mulberry32(1337);
  U.pick = (arr, r) => arr[Math.floor((r || SA.rng)() * arr.length)];
  U.$ = (id) => document.getElementById(id);

  // ---------- Настройки ----------
  const DEFAULTS = { quality: 'medium', sens: 1, invertY: false, vibro: true, volume: 0.8, autoCam: true };
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('sa_settings') || '{}'); } catch (e) { saved = {}; }
  SA.settings = Object.assign({}, DEFAULTS, saved);
  SA.saveSettings = () => { try { localStorage.setItem('sa_settings', JSON.stringify(SA.settings)); } catch (e) { /* нет хранилища */ } };
  const Q = {
    low: { ratio: 0.85, maxRatio: 1, shadows: false, shadowSize: 0, far: 210, props: 0.45, aa: false, lod: 45 },
    medium: { ratio: 1, maxRatio: 1.4, shadows: true, shadowSize: 1024, far: 280, props: 0.8, aa: true, lod: 60 },
    high: { ratio: 1, maxRatio: 2, shadows: true, shadowSize: 2048, far: 340, props: 1, aa: true, lod: 80 },
  };
  SA.Q = Q[SA.settings.quality] || Q.medium;

  // ---------- Рендерер ----------
  const canvas = U.$('game');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: SA.Q.aa, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = SA.Q.shadows;
  renderer.shadowMap.type = SA.settings.quality === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  SA.renderer = renderer;
  SA.maxAniso = renderer.capabilities.getMaxAnisotropy();
  const scene = (SA.scene = new THREE.Scene());
  const camera = (SA.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1600));
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, SA.Q.maxRatio) * SA.Q.ratio;
    renderer.setPixelRatio(dpr);
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- Вибрация ----------
  SA.vibrate = (ms) => { if (SA.settings.vibro && navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) { /* не поддерживается */ } } };

  // ---------- Звук (синтез, без файлов) ----------
  const A = (SA.audio = { ctx: null });
  let NB = null, master = null, ambient = null;
  A.init = function () {
    if (!A.ctx) {
      try {
        A.ctx = new (window.AudioContext || window.webkitAudioContext)();
        NB = A.ctx.createBuffer(1, A.ctx.sampleRate * 2, A.ctx.sampleRate);
        const d = NB.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        master = A.ctx.createGain();
        master.gain.value = SA.settings.volume;
        master.connect(A.ctx.destination);
      } catch (e) { A.ctx = null; }
    }
    if (A.ctx && A.ctx.state === 'suspended') A.ctx.resume();
  };
  A.setVolume = (v) => { if (master) master.gain.value = v; };
  function tone(t, type, f0, f1, dur, vol, out) {
    const c = A.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out || master);
    o.start(t); o.stop(t + dur + 0.05);
  }
  function noise(t, dur, ftype, freq, vol, q, out) {
    const c = A.ctx, s = c.createBufferSource();
    s.buffer = NB;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter(); f.type = ftype; f.frequency.value = freq; if (q) f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(out || master);
    s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
  }
  A.play = function (name, vol) {
    if (!A.ctx) return;
    const t = A.ctx.currentTime, v = vol === undefined ? 1 : vol;
    switch (name) {
      case 'step': noise(t, 0.07, 'bandpass', 900 + Math.random() * 500, 0.16 * v, 1.2); noise(t, 0.04, 'lowpass', 220, 0.2 * v); break;
      case 'stepRoof': noise(t, 0.06, 'bandpass', 1500 + Math.random() * 400, 0.12 * v, 1.5); break;
      case 'grab': noise(t, 0.08, 'bandpass', 2400, 0.18 * v, 0.8); noise(t, 0.05, 'lowpass', 300, 0.2 * v); break;
      case 'cloth': noise(t, 0.22, 'bandpass', 700, 0.12 * v, 0.6); break;
      case 'swing': noise(t, 0.16, 'bandpass', 3400, 0.28 * v, 1.4); break;
      case 'blade': tone(t, 'triangle', 2600, 1900, 0.12, 0.05 * v); noise(t, 0.08, 'highpass', 5000, 0.12 * v); break;
      case 'kill': noise(t, 0.22, 'lowpass', 700, 0.55 * v); tone(t, 'sine', 110, 45, 0.35, 0.3 * v); break;
      case 'hit': noise(t, 0.14, 'lowpass', 1300, 0.5 * v); tone(t, 'sine', 140, 60, 0.15, 0.2 * v); break;
      case 'clang':
        tone(t, 'square', 1320, 1240, 0.35, 0.05 * v); tone(t, 'triangle', 2100, 2040, 0.5, 0.08 * v); tone(t, 'sine', 3300, 3250, 0.4, 0.04 * v);
        noise(t, 0.06, 'highpass', 4000, 0.25 * v); break;
      case 'alert':
        tone(t, 'sawtooth', 220, 220, 0.25, 0.06 * v); tone(t + 0.1, 'sawtooth', 330, 330, 0.3, 0.06 * v);
        noise(t, 0.4, 'lowpass', 200, 0.3 * v); break;
      case 'bell': for (const f of [392, 784, 1176]) tone(t, 'sine', f, f * 0.995, 2.5, 0.05 * v); break;
      case 'sync':
        [196, 247, 294, 392, 494, 587].forEach((f, i) => tone(t + i * 0.16, 'sine', f, f, 2.2, 0.06 * v));
        noise(t, 2.5, 'bandpass', 600, 0.08 * v, 0.4); break;
      case 'land': noise(t, 0.12, 'lowpass', 260, 0.5 * v); noise(t, 0.05, 'bandpass', 1200, 0.12 * v); break;
      case 'roll': noise(t, 0.35, 'lowpass', 500, 0.3 * v); break;
      case 'hay': noise(t, 0.5, 'bandpass', 2200, 0.35 * v, 0.7); noise(t, 0.3, 'lowpass', 300, 0.3 * v); break;
      case 'throw': noise(t, 0.12, 'highpass', 2800, 0.3 * v); break;
      case 'arrow': noise(t, 0.25, 'bandpass', 1800, 0.12 * v, 3); break;
      case 'hurt': noise(t, 0.12, 'lowpass', 900, 0.5 * v); tone(t, 'sawtooth', 200, 90, 0.2, 0.1 * v); break;
      case 'steal': tone(t, 'sine', 880, 1320, 0.18, 0.06 * v); noise(t, 0.1, 'bandpass', 3000, 0.1 * v); break;
      case 'ui': tone(t, 'sine', 660, 880, 0.08, 0.04 * v); break;
      case 'win': [294, 370, 440, 587].forEach((f, i) => tone(t + i * 0.18, 'triangle', f, f, 1.2, 0.08 * v)); break;
      case 'fail': [220, 185, 147].forEach((f, i) => tone(t + i * 0.3, 'sawtooth', f, f * 0.97, 0.7, 0.05 * v)); noise(t, 1.2, 'lowpass', 300, 0.2 * v); break;
      case 'eagle': tone(t, 'sine', 180, 120, 0.8, 0.08 * v); noise(t, 0.6, 'bandpass', 400, 0.08 * v, 0.5); break;
    }
  };
  A.startAmbient = function () {
    if (!A.ctx || ambient) return;
    const c = A.ctx;
    const mk = (freq, q, vol) => {
      const s = c.createBufferSource(); s.buffer = NB; s.loop = true;
      const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
      const g = c.createGain(); g.gain.value = vol;
      s.connect(f).connect(g).connect(master); s.start();
      return g;
    };
    ambient = { crowd: mk(480, 0.7, 0.03), wind: mk(180, 0.4, 0.025) };
    // Редкие птичьи трели
    setInterval(() => {
      if (!A.ctx || Math.random() < 0.5) return;
      const t = c.currentTime, f = 2400 + Math.random() * 1600;
      for (let i = 0; i < 3; i++) tone(t + i * 0.09, 'sine', f, f * 1.25, 0.07, 0.012);
    }, 2500);
  };
  A.setAmbient = function (height, eagle) {
    if (!ambient) return;
    const k = U.clamp(height / 20, 0, 1);
    ambient.crowd.gain.value = 0.03 * (1 - k * 0.8) * (eagle ? 0.3 : 1);
    ambient.wind.gain.value = 0.02 + k * 0.05;
  };
})(window.SA);
