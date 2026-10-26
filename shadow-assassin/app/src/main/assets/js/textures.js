'use strict';
/* Процедурные текстуры: цвет + карта нормалей, все бесшовные. */
(function (SA) {
  const THREE = window.THREE, U = SA.U;
  const T = (SA.tex = {});
  const S = SA.settings.quality === 'low' ? 0.5 : 1;

  // ---------- Бесшовный шум ----------
  function makeNoise(seed) {
    const rnd = U.mulberry32(seed);
    const G = new Float32Array(1024 * 1024 >> 6);
    for (let i = 0; i < G.length; i++) G[i] = rnd();
    const N = 128;
    function v(ix, iy, p) { ix = ((ix % p) + p) % p; iy = ((iy % p) + p) % p; return G[(iy % N) * N + (ix % N)]; }
    function noise(x, y, p) {
      const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const a = v(ix, iy, p), b = v(ix + 1, iy, p), c = v(ix, iy + 1, p), d = v(ix + 1, iy + 1, p);
      return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    }
    // u,v в [0,1); base — число ячеек на тайл
    return function fbm(u, w, base, oct) {
      let s = 0, amp = 0.5, f = base, norm = 0;
      for (let o = 0; o < (oct || 4); o++) { s += noise(u * f, w * f, f) * amp; norm += amp; amp *= 0.5; f *= 2; }
      return s / norm;
    };
  }
  const fbmA = makeNoise(11), fbmB = makeNoise(23), fbmC = makeNoise(37);

  function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function toTexture(c, srgb, rep) {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = Math.min(8, SA.maxAniso);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    if (rep) t.repeat.set(rep, rep);
    return t;
  }
  // Строит текстуры из массивов цвета (0..1) и высоты
  function finish(w, h, col, hgt, strength) {
    const cc = canvas(w, h), cx = cc.getContext('2d'), id = cx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      id.data[i * 4] = U.clamp(col[i * 3] * 255, 0, 255);
      id.data[i * 4 + 1] = U.clamp(col[i * 3 + 1] * 255, 0, 255);
      id.data[i * 4 + 2] = U.clamp(col[i * 3 + 2] * 255, 0, 255);
      id.data[i * 4 + 3] = 255;
    }
    cx.putImageData(id, 0, 0);
    const nc = canvas(w, h), nx = nc.getContext('2d'), nd = nx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const l = hgt[y * w + ((x - 1 + w) % w)], r = hgt[y * w + ((x + 1) % w)];
        const t = hgt[((y - 1 + h) % h) * w + x], b = hgt[((y + 1) % h) * w + x];
        let dx = (l - r) * strength, dy = (b - t) * strength, dz = 1;
        const len = Math.hypot(dx, dy, dz);
        const i = (y * w + x) * 4;
        nd.data[i] = (dx / len * 0.5 + 0.5) * 255;
        nd.data[i + 1] = (dy / len * 0.5 + 0.5) * 255;
        nd.data[i + 2] = (dz / len * 0.5 + 0.5) * 255;
        nd.data[i + 3] = 255;
      }
    }
    nx.putImageData(nd, 0, 0);
    return { map: toTexture(cc, true), normal: toTexture(nc, false), canvas: cc };
  }

  // ---------- Штукатурка с трещинами и выбитыми кирпичами ----------
  function plaster(seed, size, base, dirt) {
    const w = size, h = size, rnd = U.mulberry32(seed);
    const col = new Float32Array(w * h * 3), hgt = new Float32Array(w * h), mask = new Float32Array(w * h);
    // заплаты, где штукатурка отвалилась
    const patches = [];
    for (let k = 0; k < 2; k++) patches.push({ x: rnd() * w, y: rnd() * h, rx: 18 + rnd() * 30, ry: 12 + rnd() * 18 });
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const u = x / w, v = y / h, i = y * w + x;
        const n = fbmA(u + seed * 0.13, v, 4, 5), g = fbmB(u, v + seed * 0.07, 32, 3), st = fbmC(u, v, 3, 4);
        let m = 0;
        for (const p of patches) {
          let dx = Math.abs(x - p.x); dx = Math.min(dx, w - dx);
          let dy = Math.abs(y - p.y); dy = Math.min(dy, h - dy);
          const e = (dx / p.rx) ** 2 + (dy / p.ry) ** 2 + (fbmB(u * 2, v * 2, 8, 3) - 0.5) * 1.6;
          if (e < 1) m = Math.max(m, U.smooth(1, 0.75, e));
        }
        mask[i] = m;
        let r = base[0], gg = base[1], b = base[2];
        const tone = 0.86 + n * 0.22 + (g - 0.5) * 0.06;
        r *= tone; gg *= tone; b *= tone;
        const stain = U.smooth(0.45, 0.9, st) * dirt;
        r = U.lerp(r, r * 0.86, stain); gg = U.lerp(gg, gg * 0.83, stain); b = U.lerp(b, b * 0.78, stain);
        let hh = n * 0.6 + g * 0.25;
        if (m > 0) {
          // кирпичная кладка под штукатуркой
          const bw = 24, bh = 10, row = Math.floor(y / bh), off = (row % 2) * bw / 2;
          const bx = (x + off) % bw, by = y % bh;
          const mortar = bx < 2 || by < 2;
          const bt = 0.8 + U.mulberry32(row * 977 + Math.floor((x + off) / bw))() * 0.35;
          const br = mortar ? [0.62, 0.56, 0.48] : [0.6 * bt, 0.38 * bt, 0.27 * bt];
          r = U.lerp(r, br[0], m); gg = U.lerp(gg, br[1], m); b = U.lerp(b, br[2], m);
          hh = U.lerp(hh, mortar ? -0.3 : 0.2 + g * 0.2, m) - m * 0.4;
        }
        col[i * 3] = r; col[i * 3 + 1] = gg; col[i * 3 + 2] = b;
        hgt[i] = hh;
      }
    }
    // трещины — случайные блуждания
    for (let k = 0; k < 4; k++) {
      let x = rnd() * w, y = rnd() * h, a = rnd() * 6.28;
      const len = 40 + rnd() * 120;
      for (let s = 0; s < len; s++) {
        a += (rnd() - 0.5) * 0.7;
        x = (x + Math.cos(a) + w) % w; y = (y + Math.sin(a) + h) % h;
        const i = Math.floor(y) * w + Math.floor(x);
        col[i * 3] *= 0.75; col[i * 3 + 1] *= 0.73; col[i * 3 + 2] *= 0.7;
        hgt[i] -= 0.9;
      }
    }
    return finish(w, h, col, hgt, 2.2);
  }

  // ---------- Каменная кладка ----------
  function stoneBlocks(seed, size, base) {
    const w = size, h = size, rnd = U.mulberry32(seed);
    const col = new Float32Array(w * h * 3), hgt = new Float32Array(w * h);
    const rowH = size / 8;
    const rows = [];
    for (let r = 0; r < 8; r++) {
      const cuts = [0]; let x = rnd() * 40;
      while (x < w) { cuts.push(x); x += rowH * (1.4 + rnd() * 1.4); }
      rows.push({ cuts, tones: cuts.map(() => 0.78 + rnd() * 0.3) });
    }
    for (let y = 0; y < h; y++) {
      const r = Math.floor(y / rowH), row = rows[r], yy = y - r * rowH;
      for (let x = 0; x < w; x++) {
        let k = 0; while (k + 1 < row.cuts.length && row.cuts[k + 1] <= x) k++;
        const x0 = row.cuts[k], x1 = k + 1 < row.cuts.length ? row.cuts[k + 1] : w + row.cuts[1];
        const ex = Math.min(x - x0, x1 - x), ey = Math.min(yy, rowH - yy), e = Math.min(ex, ey);
        const u = x / w, v = y / h, i = y * w + x;
        const n = fbmA(u + seed, v, 8, 4), g = fbmB(u, v, 48, 2);
        const bevel = U.smooth(0, 5, e);
        const tone = row.tones[k] * (0.85 + n * 0.25) * (0.75 + 0.25 * bevel);
        const mortar = e < 1.5;
        col[i * 3] = mortar ? 0.5 : base[0] * tone;
        col[i * 3 + 1] = mortar ? 0.46 : base[1] * tone;
        col[i * 3 + 2] = mortar ? 0.4 : base[2] * tone;
        hgt[i] = mortar ? -0.6 : bevel * 0.8 + n * 0.5 + g * 0.2;
      }
    }
    return finish(w, h, col, hgt, 2.5);
  }

  // ---------- Брусчатка (Вороной) ----------
  function cobble(seed, size, cells, base) {
    const w = size, h = size, rnd = U.mulberry32(seed);
    const N = cells, cs = size / N;
    const pts = [], tones = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      pts.push((i + 0.2 + rnd() * 0.6) * cs, (j + 0.2 + rnd() * 0.6) * cs);
      tones.push(0.7 + rnd() * 0.45, rnd());
    }
    const col = new Float32Array(w * h * 3), hgt = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const cj = Math.floor(y / cs);
      for (let x = 0; x < w; x++) {
        const ci = Math.floor(x / cs);
        let d1 = 1e9, d2 = 1e9, best = 0;
        for (let oj = -1; oj <= 1; oj++) for (let oi = -1; oi <= 1; oi++) {
          let ii = ci + oi, jj = cj + oj, ox = 0, oy = 0;
          if (ii < 0) { ii += N; ox = -w; } else if (ii >= N) { ii -= N; ox = w; }
          if (jj < 0) { jj += N; oy = -h; } else if (jj >= N) { jj -= N; oy = h; }
          const k = jj * N + ii;
          const dx = pts[k * 2] + ox - x, dy = pts[k * 2 + 1] + oy - y;
          const d = dx * dx + dy * dy;
          if (d < d1) { d2 = d1; d1 = d; best = k; } else if (d < d2) d2 = d;
        }
        const edge = Math.sqrt(d2) - Math.sqrt(d1);
        const u = x / w, v = y / h, i = y * w + x;
        const n = fbmA(u, v, 16, 3);
        const dome = U.smooth(0, cs * 0.35, edge);
        const t = tones[best * 2] * (0.82 + n * 0.3);
        const hue = tones[best * 2 + 1];
        const gap = edge < 1.8;
        const dirt = fbmC(u, v, 4, 3);
        col[i * 3] = gap ? 0.28 : base[0] * t * (0.95 + hue * 0.1);
        col[i * 3 + 1] = gap ? 0.24 : base[1] * t;
        col[i * 3 + 2] = gap ? 0.19 : base[2] * t * (1.05 - hue * 0.1);
        const dk = U.smooth(0.5, 0.8, dirt) * 0.25;
        col[i * 3] *= 1 - dk; col[i * 3 + 1] *= 1 - dk; col[i * 3 + 2] *= 1 - dk * 1.2;
        hgt[i] = gap ? -0.5 : dome * 1.2 + n * 0.3;
      }
    }
    return finish(w, h, col, hgt, 2.0);
  }

  // ---------- Плиты площади ----------
  function flagstone(seed, size, base) {
    const w = size, h = size, rnd = U.mulberry32(seed);
    const col = new Float32Array(w * h * 3), hgt = new Float32Array(w * h);
    const rows = 4, rh = size / rows, rowCuts = [];
    for (let r = 0; r < rows; r++) {
      const cuts = [0]; let x = rnd() * rh;
      while (x < w) { cuts.push(x); x += rh * (0.8 + rnd() * 0.9); }
      rowCuts.push({ cuts, tones: cuts.map(() => 0.85 + rnd() * 0.2) });
    }
    for (let y = 0; y < h; y++) {
      const r = Math.floor(y / rh), row = rowCuts[r], yy = y - r * rh;
      for (let x = 0; x < w; x++) {
        let k = 0; while (k + 1 < row.cuts.length && row.cuts[k + 1] <= x) k++;
        const x0 = row.cuts[k], x1 = k + 1 < row.cuts.length ? row.cuts[k + 1] : w + row.cuts[1];
        const e = Math.min(x - x0, x1 - x, yy, rh - yy);
        const u = x / w, v = y / h, i = y * w + x;
        const n = fbmA(u + 3, v, 8, 4), g = fbmB(u, v, 64, 2);
        const tone = row.tones[k] * (0.85 + n * 0.25) * (0.9 + g * 0.1);
        const gap = e < 1.5;
        col[i * 3] = gap ? 0.3 : base[0] * tone;
        col[i * 3 + 1] = gap ? 0.27 : base[1] * tone;
        col[i * 3 + 2] = gap ? 0.22 : base[2] * tone;
        hgt[i] = gap ? -0.5 : U.smooth(0, 3, e) * 0.4 + n * 0.4 + g * 0.15;
      }
    }
    return finish(w, h, col, hgt, 1.8);
  }

  // ---------- Песок / утоптанная земля ----------
  function dirt(seed, size, base) {
    const w = size, h = size, col = new Float32Array(w * h * 3), hgt = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = x / w, v = y / h, i = y * w + x;
      const n = fbmA(u + seed, v, 6, 5), g = fbmB(u, v, 96, 2), p = fbmC(u, v, 24, 2);
      const t = 0.8 + n * 0.3 + (g - 0.5) * 0.12;
      const pebble = p > 0.72 ? 0.75 : 1;
      col[i * 3] = base[0] * t * pebble; col[i * 3 + 1] = base[1] * t * pebble; col[i * 3 + 2] = base[2] * t * pebble;
      hgt[i] = n * 0.8 + g * 0.3 + (p > 0.72 ? 0.5 : 0);
    }
    return finish(w, h, col, hgt, 1.5);
  }

  // ---------- Дерево ----------
  function wood(seed, size) {
    const w = size, h = size, rnd = U.mulberry32(seed);
    const col = new Float32Array(w * h * 3), hgt = new Float32Array(w * h);
    const planks = 4, pw = w / planks, tones = [];
    for (let k = 0; k < planks; k++) tones.push(0.8 + rnd() * 0.35);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = x / w, v = y / h, i = y * w + x, k = Math.floor(x / pw), px = x - k * pw;
      const grain = fbmA(u * 1 + k * 0.3, v * 0.06, 32, 4);
      const ring = 0.5 + 0.5 * Math.sin((grain * 18 + u * 40) * 1.0);
      const gap = px < 1.5;
      const t = tones[k] * (0.75 + ring * 0.25);
      col[i * 3] = gap ? 0.12 : 0.52 * t; col[i * 3 + 1] = gap ? 0.09 : 0.36 * t; col[i * 3 + 2] = gap ? 0.06 : 0.22 * t;
      hgt[i] = gap ? -0.8 : ring * 0.3 + grain * 0.4;
    }
    return finish(w, h, col, hgt, 2.0);
  }

  // ---------- Ткань (детальная, для персонажей; тонируется цветом вершин) ----------
  function fabric(size) {
    const w = size, h = size, col = new Float32Array(w * h * 3), hgt = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = x / w, v = y / h, i = y * w + x;
      const weave = Math.sin(x * Math.PI / 2) * Math.sin(y * Math.PI / 2);
      const n = fbmA(u, v, 8, 4), g = fbmB(u, v, 64, 2);
      const t = 0.86 + n * 0.12 + weave * 0.03 + (g - 0.5) * 0.05;
      col[i * 3] = t; col[i * 3 + 1] = t; col[i * 3 + 2] = t;
      hgt[i] = weave * 0.3 + n * 0.5 + g * 0.2;
    }
    return finish(w, h, col, hgt, 1.2);
  }
  function chainmail(size) {
    const w = size, h = size, col = new Float32Array(w * h * 3), hgt = new Float32Array(w * h);
    const R = 4;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, row = Math.floor(y / R), off = (row % 2) * R / 2;
      const cx = ((x + off) % R) - R / 2, cy = (y % R) - R / 2;
      const d = Math.hypot(cx, cy * 1.3);
      const ring = Math.max(0, 1 - Math.abs(d - 1.4) / 0.9);
      const t = 0.55 + ring * 0.45;
      col[i * 3] = t; col[i * 3 + 1] = t; col[i * 3 + 2] = t * 1.02;
      hgt[i] = ring;
    }
    return finish(w, h, col, hgt, 2.5);
  }

  // ---------- Цветные ткани: навесы, ковры ----------
  function stripes(c1, c2, size) {
    const c = canvas(size, size), g = c.getContext('2d');
    const n = 8, sw = size / n;
    for (let k = 0; k < n; k++) { g.fillStyle = k % 2 ? c2 : c1; g.fillRect(k * sw, 0, sw, size); }
    g.globalAlpha = 0.18;
    for (let k = 0; k < 900; k++) { g.fillStyle = Math.random() < 0.5 ? '#000' : '#fff'; g.fillRect(Math.random() * size, Math.random() * size, 2, 1); }
    g.globalAlpha = 1;
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, size - 6, size, 6);
    return toTexture(c, true);
  }
  function rug(seed, colors, size) {
    const c = canvas(size, size), g = c.getContext('2d'), rnd = U.mulberry32(seed);
    g.fillStyle = colors[0]; g.fillRect(0, 0, size, size);
    g.strokeStyle = colors[1]; g.lineWidth = size * 0.06; g.strokeRect(size * 0.06, size * 0.06, size * 0.88, size * 0.88);
    g.strokeStyle = colors[2]; g.lineWidth = size * 0.015; g.strokeRect(size * 0.13, size * 0.13, size * 0.74, size * 0.74);
    g.fillStyle = colors[1];
    const cx = size / 2, cy = size / 2;
    g.beginPath();
    g.moveTo(cx, cy - size * 0.25); g.lineTo(cx + size * 0.2, cy); g.lineTo(cx, cy + size * 0.25); g.lineTo(cx - size * 0.2, cy); g.closePath(); g.fill();
    g.fillStyle = colors[2];
    g.beginPath(); g.arc(cx, cy, size * 0.07, 0, 7); g.fill();
    for (let k = 0; k < 12; k++) {
      const a = k / 12 * 6.28, r = size * 0.3;
      g.fillRect(cx + Math.cos(a) * r - 3, cy + Math.sin(a) * r - 3, 6, 6);
    }
    g.globalAlpha = 0.2;
    for (let k = 0; k < 2000; k++) { g.fillStyle = rnd() < 0.5 ? '#000' : '#fff'; g.fillRect(rnd() * size, rnd() * size, 1, 2); }
    return toTexture(c, true);
  }
  function hay(size) {
    const c = canvas(size, size), g = c.getContext('2d'), rnd = U.mulberry32(5);
    g.fillStyle = '#b38a35'; g.fillRect(0, 0, size, size);
    for (let k = 0; k < 2600; k++) {
      const x = rnd() * size, y = rnd() * size, a = rnd() * 6.28, l = 6 + rnd() * 16;
      const v = 150 + rnd() * 90;
      g.strokeStyle = `rgba(${v},${v * 0.78},${v * 0.35},0.8)`; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l * 0.4); g.stroke();
    }
    return toTexture(c, true);
  }
  function frond(size) {
    const c = canvas(size, size * 2), g = c.getContext('2d'), rnd = U.mulberry32(9);
    const H = size * 2;
    g.clearRect(0, 0, size, H);
    for (let k = 0; k < 46; k++) {
      const t = k / 46, y = H * (0.04 + t * 0.94), len = size * 0.48 * Math.sin(Math.PI * (0.15 + t * 0.85)) + 6;
      for (const s of [-1, 1]) {
        const v = 70 + rnd() * 40;
        g.strokeStyle = `rgb(${v * 0.55},${v + 30},${v * 0.35})`;
        g.lineWidth = 3 + (1 - t) * 3;
        g.beginPath(); g.moveTo(size / 2, y);
        g.quadraticCurveTo(size / 2 + s * len * 0.5, y - len * 0.15, size / 2 + s * len, y + len * 0.35);
        g.stroke();
      }
    }
    g.strokeStyle = '#5a5a2a'; g.lineWidth = 4;
    g.beginPath(); g.moveTo(size / 2, 0); g.lineTo(size / 2, H); g.stroke();
    const t = toTexture(c, true);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  }
  function foliage(size) {
    const c = canvas(size, size), g = c.getContext('2d'), rnd = U.mulberry32(13);
    for (let k = 0; k < 700; k++) {
      const x = size / 2 + (rnd() - 0.5) * size * 0.9, y = size / 2 + (rnd() - 0.5) * size * 0.9;
      if (Math.hypot(x - size / 2, y - size / 2) > size * 0.46) continue;
      const v = 50 + rnd() * 60;
      g.fillStyle = `rgb(${v * 0.6},${v + 25},${v * 0.4})`;
      g.beginPath(); g.ellipse(x, y, 4 + rnd() * 5, 2 + rnd() * 3, rnd() * 6, 0, 7); g.fill();
    }
    const t = toTexture(c, true);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  }
  function tiles(size) {
    const c = canvas(size, size), g = c.getContext('2d');
    const n = 8, s = size / n;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const v = 0.85 + Math.random() * 0.2;
      g.fillStyle = `rgb(${40 * v},${140 * v},${150 * v})`;
      g.fillRect(i * s, j * s, s - 1, s - 1);
      g.fillStyle = 'rgba(255,255,255,0.15)'; g.fillRect(i * s + 2, j * s + 2, s * 0.3, 2);
    }
    return toTexture(c, true);
  }
  function soft(size) {
    const c = canvas(size, size), g = c.getContext('2d');
    const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, size, size);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  T.build = function () {
    const s = (n) => Math.max(64, Math.round(n * S));
    T.plaster = plaster(1, s(512), [0.93, 0.89, 0.82], 1);
    T.plaster2 = plaster(2, s(512), [0.95, 0.9, 0.8], 0.6);
    T.roof = plaster(3, s(256), [0.82, 0.74, 0.62], 0.7);
    T.stone = stoneBlocks(4, s(512), [0.78, 0.72, 0.62]);
    T.cobble = cobble(5, s(1024), 20, [0.8, 0.68, 0.52]);
    T.flag = flagstone(6, s(512), [0.74, 0.67, 0.56]);
    T.dirt = dirt(7, s(512), [0.74, 0.62, 0.46]);
    T.sand = dirt(8, s(512), [0.86, 0.74, 0.55]);
    T.wood = wood(9, s(256));
    T.fabric = fabric(s(256));
    T.chain = chainmail(128);
    T.hay = hay(256);
    T.frond = frond(128);
    T.foliage = foliage(128);
    T.tiles = tiles(128);
    T.soft = soft(64);
    T.awnings = [['#9e2a2b', '#e9dcc0'], ['#2c4f7c', '#e6dcc4'], ['#4d6b33', '#d9b45a'], ['#b37a2c', '#5a3a22'], ['#6e2f63', '#e3d2b0']].map(([a, b]) => stripes(a, b, 128));
    T.rugs = [['#7a1f24', '#d6a84a', '#1f3b5a'], ['#1f3b5a', '#c9b38a', '#8a2b2b'], ['#4a2a4f', '#d9b45a', '#2f5a3a'], ['#8a4a1f', '#e3d2b0', '#2a2a2a']].map((c, i) => rug(40 + i, c, s(256)));
  };
})(window.SA);
