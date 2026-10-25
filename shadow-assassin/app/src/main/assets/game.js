'use strict';
/* Тень Ассасина — 3D стелс-экшен от третьего лица в средневековом городе. */
(function () {
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const V3 = THREE.Vector3;
  function angDiff(a, b) { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }
  function angLerp(a, b, t) { return a + angDiff(a, b) * t; }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const dist2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

  // ================= Рендерер =================
  const canvas = $('game');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  const scene = new THREE.Scene();
  const SKY = new THREE.Color('#d9c7a5');
  const EAGLE_SKY = new THREE.Color('#0d1630');
  scene.background = SKY.clone();
  scene.fog = new THREE.Fog(SKY.clone(), 40, 175);
  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 260);
  function resize() {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  const hemi = new THREE.HemisphereLight(0xfff2dc, 0x7a6248, 0.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe7c0, 0.85);
  sun.position.set(60, 100, 30);
  scene.add(sun);

  // ================= Процедурные текстуры =================
  function canvasTex(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    return t;
  }
  const texRng = mulberry32(7);
  const wallTex = canvasTex(128, 128, (g) => {
    g.fillStyle = '#f4efe6'; g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 900; i++) {
      const v = 200 + Math.floor(texRng() * 55);
      g.fillStyle = `rgba(${v},${v - 8},${v - 20},0.35)`;
      g.fillRect(texRng() * 128, texRng() * 128, 2 + texRng() * 5, 2 + texRng() * 3);
    }
    g.strokeStyle = 'rgba(120,95,70,0.18)'; g.lineWidth = 1;
    for (let y = 0; y < 128; y += 16) {
      g.beginPath(); g.moveTo(0, y); g.lineTo(128, y); g.stroke();
      const off = (y / 16) % 2 ? 0 : 16;
      for (let x = off; x < 128; x += 32) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 16); g.stroke(); }
    }
    g.fillStyle = '#8a7358';
    g.beginPath(); g.moveTo(48, 94); g.lineTo(48, 52); g.arc(64, 52, 16, Math.PI, 0); g.lineTo(80, 94); g.closePath(); g.fill();
    g.fillStyle = '#2e231b';
    g.beginPath(); g.moveTo(52, 92); g.lineTo(52, 52); g.arc(64, 52, 12, Math.PI, 0); g.lineTo(76, 92); g.closePath(); g.fill();
    g.fillStyle = 'rgba(90,70,50,0.35)'; g.fillRect(0, 121, 128, 7);
  });
  const groundTex = canvasTex(128, 128, (g) => {
    g.fillStyle = '#8f7d63'; g.fillRect(0, 0, 128, 128);
    for (let y = 0; y < 128; y += 16) {
      for (let x = 0; x < 128; x += 16) {
        const v = 130 + Math.floor(texRng() * 50);
        g.fillStyle = `rgb(${v},${v - 14},${v - 34})`;
        g.beginPath();
        g.ellipse(x + 8 + (texRng() - 0.5) * 3, y + 8 + (texRng() - 0.5) * 3, 6.5, 6, texRng() * 3, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = 'rgba(40,30,20,0.4)'; g.stroke();
      }
    }
  });
  groundTex.repeat.set(60, 60);

  // ================= Склеенная геометрия зданий =================
  class GB {
    constructor() { this.p = []; this.n = []; this.u = []; this.c = []; this.i = []; }
    face(vs, nx, ny, nz, uvs, col, aoBottom) {
      const b = this.p.length / 3;
      for (let k = 0; k < 4; k++) {
        const v = vs[k];
        this.p.push(v[0], v[1], v[2]);
        this.n.push(nx, ny, nz);
        this.u.push(uvs[k][0], uvs[k][1]);
        const f = aoBottom && k < 2 ? 0.7 : 1;
        this.c.push(col.r * f, col.g * f, col.b * f);
      }
      this.i.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    box(x0, y0, z0, x1, y1, z1, side, top, ao) {
      const S = 0.25;
      if (side) {
        this.face([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], 1, 0, 0,
          [[-z1 * S, y0 * S], [-z0 * S, y0 * S], [-z0 * S, y1 * S], [-z1 * S, y1 * S]], side, ao);
        this.face([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], -1, 0, 0,
          [[z0 * S, y0 * S], [z1 * S, y0 * S], [z1 * S, y1 * S], [z0 * S, y1 * S]], side, ao);
        this.face([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], 0, 0, 1,
          [[x0 * S, y0 * S], [x1 * S, y0 * S], [x1 * S, y1 * S], [x0 * S, y1 * S]], side, ao);
        this.face([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], 0, 0, -1,
          [[-x1 * S, y0 * S], [-x0 * S, y0 * S], [-x0 * S, y1 * S], [-x1 * S, y1 * S]], side, ao);
      }
      if (top) {
        this.face([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], 0, 1, 0,
          [[x0 * S, -z1 * S], [x1 * S, -z1 * S], [x1 * S, -z0 * S], [x0 * S, -z0 * S]], top, false);
      }
    }
    mesh(material) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
      g.setIndex(this.i);
      g.computeBoundingSphere();
      return new THREE.Mesh(g, material);
    }
  }

  // ================= Коллизии =================
  const STEP = 0.65;
  const colliders = [];
  const GRID = 8, GOFF = 128, GN = 32;
  const buckets = new Array(GN * GN);
  const EMPTY = [];
  function addCollider(x0, y0, z0, x1, y1, z1, o) {
    o = o || {};
    const c = { x0, y0, z0, x1, y1, z1, climb: o.climb !== false, thin: !!o.thin };
    colliders.push(c);
    const i0 = Math.floor((x0 - 1 + GOFF) / GRID), i1 = Math.floor((x1 + 1 + GOFF) / GRID);
    const j0 = Math.floor((z0 - 1 + GOFF) / GRID), j1 = Math.floor((z1 + 1 + GOFF) / GRID);
    for (let i = Math.max(0, i0); i <= Math.min(GN - 1, i1); i++) {
      for (let j = Math.max(0, j0); j <= Math.min(GN - 1, j1); j++) {
        const k = i * GN + j;
        (buckets[k] || (buckets[k] = [])).push(c);
      }
    }
    return c;
  }
  function bucket(x, z) {
    const i = Math.floor((x + GOFF) / GRID), j = Math.floor((z + GOFF) / GRID);
    if (i < 0 || j < 0 || i >= GN || j >= GN) return EMPTY;
    return buckets[i * GN + j] || EMPTY;
  }
  function groundAt(x, z, y, skipThin) {
    let best = 0;
    const list = bucket(x, z);
    for (let k = 0; k < list.length; k++) {
      const c = list[k];
      if (skipThin && c.thin) continue;
      if (x >= c.x0 - 0.12 && x <= c.x1 + 0.12 && z >= c.z0 - 0.12 && z <= c.z1 + 0.12 && c.y1 <= y + STEP && c.y1 > best) best = c.y1;
    }
    return best;
  }
  function pushOut(p, r, y, h) {
    let best = null, bestPen = 0;
    const list = bucket(p.x, p.z);
    for (let k = 0; k < list.length; k++) {
      const c = list[k];
      if (c.y1 <= y + STEP || c.y0 >= y + h) continue;
      const qx = clamp(p.x, c.x0, c.x1), qz = clamp(p.z, c.z0, c.z1);
      const dx = p.x - qx, dz = p.z - qz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      let nx, nz, pen;
      if (d2 > 1e-9) {
        const d = Math.sqrt(d2); nx = dx / d; nz = dz / d; pen = r - d;
      } else {
        const l = p.x - c.x0, rr = c.x1 - p.x, b = p.z - c.z0, f = c.z1 - p.z;
        const m = Math.min(l, rr, b, f);
        if (m === l) { nx = -1; nz = 0; pen = l + r; } else if (m === rr) { nx = 1; nz = 0; pen = rr + r; } else if (m === b) { nx = 0; nz = -1; pen = b + r; } else { nx = 0; nz = 1; pen = f + r; }
      }
      p.x += nx * pen; p.z += nz * pen;
      if (pen > bestPen) { bestPen = pen; best = { c, nx, nz }; }
    }
    return best;
  }
  function slab(o, d, mn, mx, t) {
    if (Math.abs(d) < 1e-9) return o < mn || o > mx ? null : t;
    let t1 = (mn - o) / d, t2 = (mx - o) / d;
    if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
    if (t1 > t[0]) t[0] = t1;
    if (t2 < t[1]) t[1] = t2;
    return t[0] > t[1] ? null : t;
  }
  const _t = [0, 1];
  function segHit(ax, ay, az, bx, by, bz) {
    // Возвращает долю пути до первого препятствия (1 — путь свободен).
    let best = 1;
    const minx = Math.min(ax, bx), maxx = Math.max(ax, bx), minz = Math.min(az, bz), maxz = Math.max(az, bz), miny = Math.min(ay, by), maxy = Math.max(ay, by);
    for (let k = 0; k < colliders.length; k++) {
      const c = colliders[k];
      if (c.thin || c.x1 < minx || c.x0 > maxx || c.z1 < minz || c.z0 > maxz || c.y1 < miny || c.y0 > maxy) continue;
      _t[0] = 0; _t[1] = 1;
      if (!slab(ax, bx - ax, c.x0, c.x1, _t) || !slab(ay, by - ay, c.y0, c.y1, _t) || !slab(az, bz - az, c.z0, c.z1, _t)) continue;
      if (_t[0] < best) best = _t[0];
    }
    return best;
  }
  const losClear = (ax, ay, az, bx, by, bz) => segHit(ax, ay, az, bx, by, bz) >= 0.999;
  function pointInSolid(x, y, z) {
    const list = bucket(x, z);
    for (let k = 0; k < list.length; k++) {
      const c = list[k];
      if (x > c.x0 && x < c.x1 && z > c.z0 && z < c.z1 && y > c.y0 && y < c.y1) return true;
    }
    return false;
  }

  // ================= Генерация города =================
  const CELL = 26;
  const rng = mulberry32(1337);
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const WALLS = new GB(), FLAT = new GB();
  const C = (h) => new THREE.Color(h);
  const WALL_COLORS = ['#e2d2b0', '#d6c09a', '#ead9bb', '#cdb48c', '#dcc6a2', '#c9b08e'].map(C);
  const ROOF_COLORS = ['#b79a74', '#a98d69', '#bea27e', '#9f8462'].map(C);
  const lots = {};
  const roofParts = {};
  const towers = [];
  const hays = [];
  const extras = new THREE.Group();
  scene.add(extras);
  const cellCenter = (i) => (i - 3.5) * CELL;
  const SPECIAL = { '3,4': 'market', '4,4': 'fountain', '2,2': 'garden' };
  const TOWER_CELLS = [[1, 1], [5, 1], [1, 5], [4, 6]];
  const isFortressCell = (i, j) => i >= 6 && j >= 6;
  const FORT = { x0: 56, x1: 100, z0: 56, z1: 100 };
  const inRestricted = (x, z) => x > FORT.x0 + 1.6 && x < FORT.x1 - 1.6 && z > FORT.z0 + 1.6 && z < FORT.z1 - 1.6;

  function building(x0, z0, x1, z1, h, wallCol, roofCol, cellKey) {
    if (cellKey) (roofParts[cellKey] || (roofParts[cellKey] = [])).push({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, h });
    WALLS.box(x0, 0, z0, x1, h - 0.35, z1, wallCol || pick(WALL_COLORS), null, true);
    const rc = roofCol || pick(ROOF_COLORS);
    FLAT.box(x0 - 0.15, h - 0.35, z0 - 0.15, x1 + 0.15, h, z1 + 0.15, rc.clone().multiplyScalar(0.8), rc, false);
    addCollider(x0, 0, z0, x1, h, z1);
  }
  function solid(x0, y0, z0, x1, y1, z1, col, o) {
    o = o || {};
    const cc = C(col);
    FLAT.box(x0, y0, z0, x1, y1, z1, cc.clone().multiplyScalar(0.85), cc, y0 < 0.1);
    if (!o.noCollide) addCollider(x0, y0, z0, x1, y1, z1, o);
  }
  const hayMat = new THREE.MeshLambertMaterial({ color: '#d8b24a' });
  const hayGeo = new THREE.BoxGeometry(2.4, 1.1, 2.4);
  function addHay(x, z) {
    const m = new THREE.Mesh(hayGeo, hayMat);
    m.position.set(x, 0.55, z);
    extras.add(m);
    hays.push({ x, z, r: 1.2 });
  }
  function hayAt(x, z, pad) {
    pad = pad || 0;
    for (const h of hays) if (Math.abs(x - h.x) < h.r + pad && Math.abs(z - h.z) < h.r + pad) return h;
    return null;
  }
  const trunkMat = new THREE.MeshLambertMaterial({ color: '#6b4a2f' });
  const leafMat = new THREE.MeshLambertMaterial({ color: '#5d7a3a' });
  function addTree(x, z) {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, 5, 6), trunkMat);
    t.position.set(x, 2.5, z);
    const l = new THREE.Mesh(new THREE.ConeGeometry(2.2, 2.2, 7), leafMat);
    l.position.set(x, 5.4, z);
    extras.add(t, l);
    addCollider(x - 0.3, 0, z - 0.3, x + 0.3, 5, z + 0.3, { climb: false, thin: true });
  }
  function lotKey(i, j, a, b) { return i + ',' + j + ',' + a + ',' + b; }

  function genNormalLots(i, j, onlyA) {
    const cx = cellCenter(i), cz = cellCenter(j);
    for (let a = 0; a < 2; a++) {
      if (onlyA !== undefined && a !== onlyA) continue;
      for (let b = 0; b < 2; b++) {
        const x0 = cx - 9 + a * 9, z0 = cz - 9 + b * 9;
        if (rng() < 0.12) {
          if (rng() < 0.6) addHay(x0 + 4.5, z0 + 4.5);
          else addTree(x0 + 4.5, z0 + 4.5);
          continue;
        }
        const heights = [4.5, 6, 6, 7.5, 7.5, 9, 10.5, 12];
        if (rng() < 0.35) {
          const h1 = pick(heights), h2 = pick(heights);
          building(x0, z0, x0 + 9, z0 + 4.5, h1, null, null, i + ',' + j);
          building(x0, z0 + 4.5, x0 + 9, z0 + 9, h2, null, null, i + ',' + j);
          lots[lotKey(i, j, a, b)] = Math.min(h1, h2);
        } else {
          const h = pick(heights);
          building(x0, z0, x0 + 9, z0 + 9, h, null, null, i + ',' + j);
          lots[lotKey(i, j, a, b)] = h;
        }
      }
    }
  }

  let marketCenter, fountainCenter, bureau;
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      if (isFortressCell(i, j)) continue;
      const cx = cellCenter(i), cz = cellCenter(j);
      const sp = SPECIAL[i + ',' + j];
      const isTower = TOWER_CELLS.some((t) => t[0] === i && t[1] === j);
      if (sp === 'market') {
        marketCenter = new V3(cx, 0, cz);
        solid(cx - 1.8, 0, cz - 1.8, cx + 1.8, 0.6, cz + 1.8, '#8a6a48');
        const cloth = ['#a3162b', '#2f5f8a', '#c79a2a', '#4e7a3a', '#7a3f8a'];
        for (let k = 0; k < 10; k++) {
          const ang = (k / 10) * Math.PI * 2;
          const sx = cx + Math.cos(ang) * 6.8, sz = cz + Math.sin(ang) * 6.8;
          solid(sx - 0.9, 0, sz - 0.9, sx + 0.9, 1.0, sz + 0.9, '#7a5a3a');
          solid(sx - 1.3, 2.2, sz - 1.3, sx + 1.3, 2.35, sz + 1.3, cloth[k % cloth.length], { thin: true });
          const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.2, 4), trunkMat);
          pole.position.set(sx + 0.8, 1.6, sz + 0.8);
          extras.add(pole);
        }
        addHay(cx + 7.8, cz - 7.8);
      } else if (sp === 'fountain') {
        fountainCenter = new V3(cx, 0, cz);
        const f = new THREE.Mesh(new THREE.CylinderGeometry(3, 3.2, 0.8, 16), new THREE.MeshLambertMaterial({ color: '#b8ab95' }));
        f.position.set(cx, 0.4, cz);
        const w = new THREE.Mesh(new THREE.CylinderGeometry(2.7, 2.7, 0.1, 16), new THREE.MeshLambertMaterial({ color: '#4f86a8' }));
        w.position.set(cx, 0.75, cz);
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 2.4, 8), new THREE.MeshLambertMaterial({ color: '#b8ab95' }));
        col.position.set(cx, 1.6, cz);
        extras.add(f, w, col);
        addCollider(cx - 2.6, 0, cz - 2.6, cx + 2.6, 0.8, cz + 2.6);
        for (const [dx, dz] of [[-7, -7], [7, -7], [-7, 7], [7, 7]]) addTree(cx + dx, cz + dz);
        addHay(cx - 8, cz);
      } else if (sp === 'garden') {
        for (let k = 0; k < 6; k++) addTree(cx - 6 + (k % 3) * 6, cz - 4 + Math.floor(k / 3) * 8);
        solid(cx - 9, 0, cz - 9, cx + 9, 0.4, cz - 8.5, '#a8957a', { noCollide: true });
        addHay(cx, cz);
      } else if (isTower) {
        genNormalLots(i, j, 0);
        building(cx, cz - 9, cx + 5, cz - 2, 5 + Math.floor(rng() * 3) * 1.5);
        building(cx, cz + 2, cx + 5, cz + 9, 6 + Math.floor(rng() * 3) * 1.5);
        building(cx, cz - 2, cx + 5, cz + 2, 10.5);
        const H = 22;
        building(cx + 5, cz - 2, cx + 9, cz + 2, H, C('#bfae90'), C('#8d7558'));
        solid(cx + 9, H - 0.3, cz - 0.3, cx + 12.6, H, cz + 0.3, '#6b4a2f', { thin: true });
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 4, 4), trunkMat);
        pole.position.set(cx + 5.4, H + 2, cz - 1.6);
        const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1), new THREE.MeshLambertMaterial({ color: '#a3162b', side: THREE.DoubleSide }));
        flag.position.set(cx + 6.2, H + 3.4, cz - 1.6);
        extras.add(pole, flag);
        addHay(cx + 12.3, cz);
        towers.push({ x: cx + 7, z: cz, h: H, beam: new V3(cx + 12.2, H, cz), hay: hays[hays.length - 1], synced: false, flag });
        lots[lotKey(i, j, 1, 0)] = 0; lots[lotKey(i, j, 1, 1)] = 0;
      } else if (i === 0 && j === 0) {
        genNormalLots(i, j, 0);
        building(cx, cz - 9, cx + 9, cz + 9, 7.5, C('#d8c4a0'));
        lots[lotKey(i, j, 1, 0)] = 7.5; lots[lotKey(i, j, 1, 1)] = 7.5;
        const dx = cx + 4.5;
        bureau = { door: new V3(dx, 0, cz + 9.3), spawn: new V3(dx, 0, cz + 11) };
        solid(dx - 0.9, 0, cz + 9, dx + 0.9, 2.4, cz + 9.08, '#2a1d14', { noCollide: true });
        solid(dx - 0.5, 2.6, cz + 9, dx + 0.5, 3.4, cz + 9.1, '#a3162b', { noCollide: true });
      } else {
        genNormalLots(i, j);
      }
    }
  }
  // Балки-переходы через улицы
  for (let k = 1; k < 8; k++) {
    const xs = (k - 4) * CELL;
    for (let j = 0; j < 8; j++) {
      for (let b = 0; b < 2; b++) {
        const hA = lots[lotKey(k - 1, j, 1, b)], hB = lots[lotKey(k, j, 0, b)];
        if (!hA || !hB || rng() > 0.5) continue;
        const h = Math.min(hA, hB);
        const zc = cellCenter(j) - 9 + b * 9 + 2 + rng() * 5;
        solid(xs - 4.2, h - 0.25, zc - 0.3, xs + 4.2, h, zc + 0.3, '#6b4a2f', { thin: true });
      }
    }
    const zs = (k - 4) * CELL;
    for (let i = 0; i < 8; i++) {
      for (let a = 0; a < 2; a++) {
        const hA = lots[lotKey(i, k - 1, a, 1)], hB = lots[lotKey(i, k, a, 0)];
        if (!hA || !hB || rng() > 0.5) continue;
        const h = Math.min(hA, hB);
        const xc = cellCenter(i) - 9 + a * 9 + 2 + rng() * 5;
        solid(xc - 0.3, h - 0.25, zs - 4.2, xc + 0.3, h, zs + 4.2, '#6b4a2f', { thin: true });
      }
    }
  }
  // Крепость тамплиеров
  {
    const S = C('#a59a88'), R = C('#8c816f');
    const wall = (x0, z0, x1, z1, h) => { WALLS.box(x0, 0, z0, x1, h, z1, S, R, true); addCollider(x0, 0, z0, x1, h, z1); };
    const H = 9, T = 1.6;
    wall(56, 56, 75, 56 + T, H); wall(81, 56, 100, 56 + T, H);
    wall(56, 100 - T, 100, 100, H);
    wall(56, 56, 56 + T, 75, H); wall(56, 81, 56 + T, 100, H);
    wall(100 - T, 56, 100, 100, H);
    WALLS.box(75, 6, 56, 81, H, 56 + T, S, R, false); addCollider(75, 6, 56, 81, H, 56 + T);
    WALLS.box(56, 6, 75, 56 + T, H, 81, S, R, false); addCollider(56, 6, 75, 56 + T, H, 81);
    for (const [x, z] of [[56, 56], [96, 56], [56, 96], [96, 96]]) wall(x - 0.5, z - 0.5, x + 4.5, z + 4.5, 12);
    building(70, 70, 86, 86, 16, C('#b3a68f'), C('#7d6f5b'));
    building(74, 74, 82, 82, 20, C('#b3a68f'), C('#7d6f5b'));
    solid(66, 0, 67, 68, 2, 69, '#7a5a3a'); solid(66.3, 2, 67.3, 67.7, 3.4, 68.7, '#7a5a3a');
    solid(88, 0, 66, 90, 2, 68, '#7a5a3a');
    solid(67, 0, 88, 69, 1.4, 90, '#7a5a3a');
    addHay(62, 88); addHay(94, 64);
    const banner = new THREE.MeshLambertMaterial({ color: '#e8e2d4', side: THREE.DoubleSide });
    for (const [x, z, ry] of [[73, 55.9, 0], [83, 55.9, 0], [55.9, 73, Math.PI / 2], [55.9, 83, Math.PI / 2]]) {
      const b = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 3.2), banner);
      b.position.set(x, 6.5, z); b.rotation.y = ry;
      const cross = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), new THREE.MeshBasicMaterial({ color: '#a3162b', side: THREE.DoubleSide }));
      cross.position.set(x + (ry ? -0.02 : 0), 6.8, z - (ry ? 0 : 0.02)); cross.rotation.y = ry;
      extras.add(b, cross);
    }
  }
  // Городская стена
  {
    const S = C('#9d917d');
    const w = (x0, z0, x1, z1) => { WALLS.box(x0, 0, z0, x1, 16, z1, S, S, true); addCollider(x0, 0, z0, x1, 40, z1, { climb: false }); };
    w(-112, -112, 112, -108); w(-112, 108, 112, 112); w(-112, -112, -108, 112); w(108, -112, 112, 112);
  }
  const wallMesh = WALLS.mesh(new THREE.MeshLambertMaterial({ map: wallTex, vertexColors: true }));
  const flatMesh = FLAT.mesh(new THREE.MeshLambertMaterial({ vertexColors: true }));
  scene.add(wallMesh, flatMesh);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(240, 240), new THREE.MeshLambertMaterial({ map: groundTex }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  // ================= Граф улиц для навигации =================
  const nodes = [];
  const nodeGrid = [];
  function addNode(x, z, inner) { nodes.push({ x, z, inner: !!inner, adj: [] }); return nodes.length - 1; }
  function link(a, b) { if (a < 0 || b < 0) return; nodes[a].adj.push(b); nodes[b].adj.push(a); }
  for (let k = 0; k <= 8; k++) {
    nodeGrid[k] = [];
    for (let l = 0; l <= 8; l++) nodeGrid[k][l] = k === 7 && l === 7 ? -1 : addNode((k - 4) * CELL, (l - 4) * CELL);
  }
  for (let k = 0; k <= 8; k++) for (let l = 0; l <= 8; l++) {
    if (k < 8 && nodeGrid[k][l] >= 0 && nodeGrid[k + 1][l] >= 0) link(nodeGrid[k][l], nodeGrid[k + 1][l]);
    if (l < 8 && nodeGrid[k][l] >= 0 && nodeGrid[k][l + 1] >= 0) link(nodeGrid[k][l], nodeGrid[k][l + 1]);
  }
  for (const key of Object.keys(SPECIAL)) {
    const [i, j] = key.split(',').map(Number);
    const n = addNode(cellCenter(i) + 3, cellCenter(j) + 3);
    link(n, nodeGrid[i][j]); link(n, nodeGrid[i + 1][j]); link(n, nodeGrid[i][j + 1]); link(n, nodeGrid[i + 1][j + 1]);
  }
  const ring = [[63, 63], [78, 62], [93, 63], [94, 78], [93, 93], [78, 94], [63, 93], [62, 78]].map(([x, z]) => addNode(x, z, true));
  for (let k = 0; k < ring.length; k++) link(ring[k], ring[(k + 1) % ring.length]);
  link(ring[1], nodeGrid[7][6]);
  link(ring[7], nodeGrid[6][7]);

  function nearestNode(x, z, filter) {
    let best = -1, bd = 1e9;
    for (let k = 0; k < nodes.length; k++) {
      const n = nodes[k];
      if (filter === 'outer' && n.inner) continue;
      if (filter === 'inner' && !n.inner) continue;
      const d = (n.x - x) ** 2 + (n.z - z) ** 2;
      if (d < bd) { bd = d; best = k; }
    }
    return best;
  }
  function bfs(a, b) {
    if (a === b) return [b];
    const prev = new Int32Array(nodes.length).fill(-2);
    prev[a] = -1;
    const q = [a];
    while (q.length) {
      const n = q.shift();
      if (n === b) break;
      for (const m of nodes[n].adj) if (prev[m] === -2) { prev[m] = n; q.push(m); }
    }
    if (prev[b] === -2) return [];
    const path = [];
    for (let n = b; n !== -1; n = prev[n]) path.push(n);
    return path.reverse();
  }

  // ================= Миникарта =================
  const MAP_S = 2;
  const mapBase = document.createElement('canvas');
  mapBase.width = mapBase.height = 240 * MAP_S;
  {
    const g = mapBase.getContext('2d');
    g.fillStyle = '#3a3126'; g.fillRect(0, 0, mapBase.width, mapBase.height);
    const tx = (x) => (x + 120) * MAP_S;
    for (const c of colliders) {
      if (c.thin) continue;
      const v = clamp(Math.floor(110 + c.y1 * 6), 110, 220);
      g.fillStyle = `rgb(${v},${v - 18},${v - 45})`;
      g.fillRect(tx(c.x0), tx(c.z0), (c.x1 - c.x0) * MAP_S, (c.z1 - c.z0) * MAP_S);
    }
    g.fillStyle = '#d8b24a';
    for (const h of hays) g.fillRect(tx(h.x) - 2, tx(h.z) - 2, 4, 4);
  }
  const mm = $('minimap'), mmg = mm.getContext('2d');

  // ================= Персонажи =================
  const GEO = {};
  const geo = (key, fn) => GEO[key] || (GEO[key] = fn());
  const boxG = (w, h, d) => geo('b' + w + ',' + h + ',' + d, () => new THREE.BoxGeometry(w, h, d));
  const MATS = {};
  const matC = (c) => MATS[c] || (MATS[c] = new THREE.MeshLambertMaterial({ color: c }));
  const glowMats = {
    red: new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0.55, depthTest: false, depthWrite: false }),
    gold: new THREE.MeshBasicMaterial({ color: 0xffc83a, transparent: true, opacity: 0.7, depthTest: false, depthWrite: false }),
    blue: new THREE.MeshBasicMaterial({ color: 0x6aa8ff, transparent: true, opacity: 0.25, depthTest: false, depthWrite: false }),
  };
  const blobMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false });
  const blobGeo = new THREE.CircleGeometry(0.45, 12);

  function spriteTex(draw) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    draw(c.getContext('2d'));
    return new THREE.CanvasTexture(c);
  }
  const tri = (fill) => (g) => {
    g.fillStyle = fill; g.strokeStyle = '#000'; g.lineWidth = 4;
    g.beginPath(); g.moveTo(32, 54); g.lineTo(8, 12); g.lineTo(56, 12); g.closePath(); g.fill(); g.stroke();
  };
  const TEX = {
    yellow: spriteTex(tri('#ffd54a')),
    red: spriteTex(tri('#ff3030')),
    excl: spriteTex((g) => { g.fillStyle = '#fff'; g.strokeStyle = '#a00'; g.lineWidth = 5; g.font = 'bold 56px Georgia'; g.textAlign = 'center'; g.strokeText('!', 32, 54); g.fillText('!', 32, 54); }),
  };

  function makeHumanoid(look) {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    const robe = matC(look.robe), skin = matC(look.skin || '#c99b73');
    const add = (g, m, x, y, z, parent) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); (parent || body).add(o); return o; };
    add(geo('skirt', () => new THREE.CylinderGeometry(0.22, 0.33, 0.62, 8)), matC(look.low || look.robe), 0, 0.72, 0);
    add(boxG(0.42, 0.52, 0.24), matC(look.torso || look.robe), 0, 1.27, 0);
    add(boxG(0.44, 0.09, 0.26), matC(look.sash || '#5a4030'), 0, 1.04, 0);
    add(geo('head', () => new THREE.SphereGeometry(0.12, 10, 8)), skin, 0, 1.66, 0);
    if (look.hood) {
      const hood = add(geo('hood', () => new THREE.SphereGeometry(0.155, 10, 8)), robe, 0, 1.69, -0.015);
      hood.scale.set(1, 1.08, 1.12);
      const beak = add(geo('beak', () => new THREE.ConeGeometry(0.06, 0.16, 6)), robe, 0, 1.8, 0.12);
      beak.rotation.x = Math.PI / 2.4;
      add(boxG(0.14, 0.1, 0.01), matC('#17110d'), 0, 1.64, 0.172);
    } else if (look.helmet) {
      add(geo('helm', () => new THREE.ConeGeometry(0.15, 0.24, 8)), matC('#7d8288'), 0, 1.84, 0);
    } else if (look.hat) {
      add(geo('turban', () => new THREE.CylinderGeometry(0.14, 0.15, 0.13, 8)), matC(look.hat), 0, 1.77, 0);
    }
    const legs = [], arms = [];
    for (const s of [1, -1]) {
      const lp = new THREE.Group(); lp.position.set(s * 0.1, 0.92, 0); body.add(lp);
      add(boxG(0.13, 0.88, 0.15), matC(look.legs || '#3d3026'), 0, -0.44, 0, lp);
      add(boxG(0.14, 0.1, 0.22), matC('#2a1f17'), 0, -0.86, 0.03, lp);
      legs.push(lp);
      const ap = new THREE.Group(); ap.position.set(s * 0.28, 1.48, 0); body.add(ap);
      add(boxG(0.11, 0.56, 0.12), matC(look.arms || look.torso || look.robe), 0, -0.28, 0, ap);
      add(boxG(0.08, 0.09, 0.08), skin, 0, -0.6, 0, ap);
      arms.push(ap);
    }
    let blade = null;
    if (look.sword) add(boxG(0.04, 0.04, 0.8), matC('#c8ccd2'), 0, -0.62, 0.36, arms[1]);
    if (look.bow) add(boxG(0.03, 1.1, 0.05), matC('#5a3a20'), 0, -0.5, 0.08, arms[0]);
    if (look.hidden) { blade = add(boxG(0.02, 0.02, 0.32), matC('#e8ecf0'), 0, -0.62, 0.17, arms[1]); blade.visible = false; }
    const blob = new THREE.Mesh(blobGeo, blobMat);
    blob.rotation.x = -Math.PI / 2; blob.position.y = 0.03;
    root.add(blob);
    return { root, body, legL: legs[0], legR: legs[1], armL: arms[0], armR: arms[1], blade, blob, ph: Math.random() * 6 };
  }

  function animHuman(h, dt, mode, spd) {
    const k = Math.min(1, dt * 14);
    let lL = 0, lR = 0, aL = 0, aR = 0, aLz = 0, aRz = 0, by = 0, lean = 0;
    if (mode === 'walk' || mode === 'run') {
      h.ph += dt * spd * 3.0;
      const s = Math.sin(h.ph), amp = mode === 'run' ? 0.95 : 0.45;
      lL = s * amp; lR = -s * amp; aL = -s * amp * 0.8; aR = s * amp * 0.8;
      by = Math.abs(Math.cos(h.ph)) * (mode === 'run' ? 0.08 : 0.03);
      lean = mode === 'run' ? 0.2 : 0.03;
    } else if (mode === 'sneak') {
      h.ph += dt * spd * 3.4;
      const s = Math.sin(h.ph);
      lL = s * 0.35 - 0.3; lR = -s * 0.35 - 0.3; aL = -0.2; aR = -0.2; lean = 0.25; by = -0.08;
    } else if (mode === 'climb') {
      h.ph += dt * spd * 3.5;
      const s = Math.sin(h.ph);
      aL = -2.7 + s * 0.45; aR = -2.7 - s * 0.45; lL = -0.7 - s * 0.45; lR = -0.7 + s * 0.45;
    } else if (mode === 'hang') {
      aL = -2.9; aR = -2.9; lL = -0.2; lR = 0.1;
    } else if (mode === 'air') {
      lL = -0.8; lR = 0.25; aL = -1.3; aR = -0.5; lean = 0.1;
    } else if (mode === 'leap') {
      aLz = 1.5; aRz = -1.5; lL = 0.15; lR = -0.1; lean = -0.3;
    } else if (mode === 'attack') {
      aR = -1.6; aL = 0.4; lL = -0.5; lR = 0.4; lean = 0.3;
    } else if (mode === 'windup') {
      aR = -2.9; aL = -0.4; lean = -0.15; lL = 0.3; lR = -0.2;
    } else if (mode === 'block') {
      aR = -1.4; aL = -1.4; aRz = 0.5; aLz = -0.5; lL = -0.3; lR = 0.3;
    } else if (mode === 'throw') {
      aR = -2.2; aL = 0.6; lean = 0.15;
    } else if (mode === 'sit') {
      lL = -1.5; lR = -1.5; by = -0.45;
    } else {
      h.ph += dt * 1.5;
      aL = Math.sin(h.ph) * 0.04; aR = -aL;
    }
    h.legL.rotation.x = lerp(h.legL.rotation.x, lL, k);
    h.legR.rotation.x = lerp(h.legR.rotation.x, lR, k);
    h.armL.rotation.x = lerp(h.armL.rotation.x, aL, k);
    h.armR.rotation.x = lerp(h.armR.rotation.x, aR, k);
    h.armL.rotation.z = lerp(h.armL.rotation.z, aLz, k);
    h.armR.rotation.z = lerp(h.armR.rotation.z, aRz, k);
    h.body.position.y = lerp(h.body.position.y, by, k);
    h.body.rotation.x = lerp(h.body.rotation.x, lean, k);
  }

  const LOOKS = {
    player: { robe: '#efe9dc', torso: '#e6dfd0', sash: '#a3162b', legs: '#d2c9b6', hood: true, hidden: true, skin: '#b88a63' },
    guard: { robe: '#6a4630', torso: '#8a8f96', arms: '#6a4630', sash: '#a3162b', legs: '#3d3026', helmet: true, sword: true },
    elite: { robe: '#e8e2d4', torso: '#8a8f96', arms: '#e8e2d4', sash: '#a3162b', legs: '#5a5f66', helmet: true, sword: true },
    archer: { robe: '#4b5a3a', torso: '#6b5a3a', sash: '#2a1f17', legs: '#3d3026', helmet: true, bow: true },
  };
  const CIV_ROBES = ['#7a5c3e', '#8b7d6b', '#5d6b4a', '#9a7b5a', '#6b4f3a', '#a08a6a', '#4e5d6c', '#7b3f3f', '#c2b49a'];
  const CIV_HATS = ['#e8e2d4', '#c9b08e', '#6b4f3a', '#a3162b', '#2f5f8a'];

  // ================= Звук =================
  let AC = null, NB = null, ambient = null;
  function audioInit() {
    if (!AC) {
      try {
        AC = new (window.AudioContext || window.webkitAudioContext)();
        NB = AC.createBuffer(1, AC.sampleRate, AC.sampleRate);
        const d = NB.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      } catch (e) { AC = null; }
    }
    if (AC && AC.state === 'suspended') AC.resume();
  }
  function tone(t, type, f0, f1, dur, vol) {
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(AC.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(t, dur, ftype, freq, vol) {
    const s = AC.createBufferSource(); s.buffer = NB;
    const f = AC.createBiquadFilter(); f.type = ftype; f.frequency.value = freq;
    const g = AC.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(AC.destination);
    s.start(t); s.stop(t + dur + 0.02);
  }
  function sfx(name) {
    if (!AC) return;
    const t = AC.currentTime;
    switch (name) {
      case 'swing': noise(t, 0.14, 'bandpass', 3200, 0.3); break;
      case 'kill': noise(t, 0.2, 'lowpass', 900, 0.6); tone(t, 'sawtooth', 140, 45, 0.3, 0.25); break;
      case 'hit': noise(t, 0.12, 'lowpass', 1500, 0.5); break;
      case 'clang': tone(t, 'square', 1250, 1150, 0.25, 0.1); tone(t, 'triangle', 1900, 1800, 0.35, 0.12); break;
      case 'alert': tone(t, 'square', 440, 440, 0.12, 0.1); tone(t + 0.13, 'square', 660, 660, 0.18, 0.1); break;
      case 'sync': [261, 329, 392, 523, 659].forEach((f, i) => tone(t + i * 0.18, 'sine', f, f, 1.8, 0.1)); break;
      case 'land': noise(t, 0.09, 'lowpass', 400, 0.4); break;
      case 'hay': noise(t, 0.4, 'bandpass', 1800, 0.4); break;
      case 'throw': noise(t, 0.09, 'highpass', 2600, 0.35); break;
      case 'hurt': tone(t, 'sawtooth', 220, 90, 0.22, 0.2); break;
      case 'steal': tone(t, 'sine', 900, 1400, 0.15, 0.12); break;
      case 'win': [392, 494, 587, 784].forEach((f, i) => tone(t + i * 0.16, 'triangle', f, f, 0.6, 0.14)); break;
      case 'fail': [330, 262, 196].forEach((f, i) => tone(t + i * 0.25, 'sawtooth', f, f * 0.98, 0.5, 0.12)); break;
    }
  }
  function startAmbient() {
    if (!AC || ambient) return;
    const s = AC.createBufferSource(); s.buffer = NB; s.loop = true;
    const f = AC.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 500; f.Q.value = 0.6;
    const g = AC.createGain(); g.gain.value = 0.035;
    s.connect(f).connect(g).connect(AC.destination);
    s.start();
    ambient = g;
  }

  // ================= Состояние игры =================
  const Game = { mode: 'menu', paused: false, mission: null, missionIndex: -1, timeScale: 1, slowT: 0, stats: { kills: 0, alarms: 0, time: 0 }, anonT: 0, alertCD: 0, menuT: 0 };
  const agents = [];
  const projectiles = [];
  const input = { mx: 0, my: 0, free: false, jumpHeld: false, pressed: new Set(), camDX: 0, camDY: 0, keys: {}, stickActive: false };
  const took = (a) => { if (input.pressed.has(a)) { input.pressed.delete(a); return true; } return false; };
  const cam = { yaw: Math.PI, pitch: 0.35, target: new V3(), dist: 4.8, orbit: 0 };

  // ---------- Игрок ----------
  const player = {
    pos: new V3(), vel: new V3(), yaw: 0, state: 'ground', hp: 10, maxHp: 10, knives: 5,
    blend: false, eagle: false, hidden: false, dead: false, climbC: null, cn: { x: 0, z: 0 },
    airMaxY: 0, leap: false, attackT: 0, blockT: 0, violentT: 0, lockT: 0, syncT: 0, syncTower: null,
    noGrabT: 0, mantleT: 0, hurtT: 9, regenT: 0, inCrowd: false, moveSpd: 0, letter: false, throwT: 0, eagleUsed: false,
    h: makeHumanoid(LOOKS.player),
  };
  scene.add(player.h.root);
  player.h.root.remove(player.h.blob);
  const playerBlob = player.h.blob;
  scene.add(playerBlob);

  // ---------- Маркер цели ----------
  const marker = new THREE.Mesh(new THREE.OctahedronGeometry(0.4), new THREE.MeshBasicMaterial({ color: 0xffc83a, depthTest: false, transparent: true, opacity: 0.9 }));
  marker.renderOrder = 9;
  scene.add(marker);

  // ---------- Агенты (горожане, стража, цели) ----------
  class Agent {
    constructor(type, x, z, o) {
      o = o || {};
      this.type = type; this.o = o;
      this.name = o.name || '';
      this.pos = new V3(x, o.y || 0, z);
      this.home = this.pos.clone();
      this.yaw = o.yaw !== undefined ? o.yaw : rng() * 6.28;
      this.homeYaw = this.yaw;
      this.alive = true;
      this.hostile = type !== 'civ';
      this.fight = o.fight !== undefined ? o.fight : type === 'guard' || type === 'archer';
      this.hp = o.hp || (type === 'guard' ? 3 : type === 'archer' ? 2 : type === 'target' ? 3 : 1);
      this.state = o.post ? 'post' : o.idle ? 'idle' : o.route ? 'route' : 'patrol';
      this.aw = 0; this.windT = 0; this.cool = 1 + Math.random(); this.stagT = 0; this.panicT = 0;
      this.losT = Math.random() * 0.25; this.vis = false; this.lastSeenT = 99; this.lastKnown = new V3();
      this.searchT = 0; this.navT = 0; this.path = []; this.navDirect = false; this.navDirT = 0;
      this.lane = (Math.random() - 0.5) * 4.5;
      this.node = -1; this.prev = -1; this.routeI = 0;
      this.speed = type === 'civ' ? 1.0 + Math.random() * 0.5 : 1.3;
      this.curSpd = 0; this.deadT = 0;
      let look;
      if (o.look) look = o.look;
      else if (type === 'civ') look = { robe: pick(CIV_ROBES), sash: pick(CIV_ROBES), hat: pick(CIV_HATS), legs: '#4a3a2c' };
      else look = LOOKS[type] || LOOKS.guard;
      this.h = makeHumanoid(look);
      scene.add(this.h.root);
      if (this.hostile) {
        this.ind = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.yellow, transparent: true, depthWrite: false }));
        this.ind.scale.set(0.42, 0.42, 1); this.ind.position.y = 2.25; this.ind.visible = false;
        this.h.root.add(this.ind);
      }
      this.glow = new THREE.Mesh(geo('glow', () => new THREE.CylinderGeometry(0.3, 0.3, 1.8, 8)),
        type === 'target' ? glowMats.gold : this.hostile ? glowMats.red : glowMats.blue);
      this.glow.position.y = 0.9; this.glow.renderOrder = 5; this.glow.visible = false;
      this.h.root.add(this.glow);
      agents.push(this);
    }
    get fx() { return Math.sin(this.yaw); }
    get fz() { return Math.cos(this.yaw); }
    remove() { scene.remove(this.h.root); }
    moveTo(tx, tz, spd, dt, collide) {
      const dx = tx - this.pos.x, dz = tz - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.05) { this.curSpd = 0; return d; }
      const s = Math.min(d, spd * dt);
      this.pos.x += (dx / d) * s; this.pos.z += (dz / d) * s;
      this.yaw = angLerp(this.yaw, Math.atan2(dx, dz), 1 - Math.exp(-dt * 10));
      if (collide) {
        pushOut(this.pos, 0.32, this.pos.y, 1.7);
        this.pos.y = groundAt(this.pos.x, this.pos.z, this.pos.y + 0.1);
      }
      this.curSpd = spd;
      return d;
    }
    walkGraph(dt, spd, filter) {
      if (this.node < 0) { this.node = nearestNode(this.pos.x, this.pos.z, filter); this.prev = -1; }
      const n = nodes[this.node];
      let tx = n.x, tz = n.z;
      if (this.prev >= 0) {
        const p = nodes[this.prev];
        const ex = n.x - p.x, ez = n.z - p.z, el = Math.hypot(ex, ez) || 1;
        tx += (-ez / el) * this.lane; tz += (ex / el) * this.lane;
      }
      const d = this.moveTo(tx, tz, spd, dt, false);
      if (d < 0.6) {
        let opts = n.adj.filter((a) => a !== this.prev && (filter === 'any' || (filter === 'inner') === nodes[a].inner));
        if (!opts.length) opts = n.adj.filter((a) => filter === 'any' || (filter === 'inner') === nodes[a].inner);
        this.prev = this.node;
        this.node = opts.length ? opts[Math.floor(Math.random() * opts.length)] : this.prev;
      }
    }
    navTo(tx, tz, spd, dt) {
      this.navDirT -= dt;
      if (this.navDirT <= 0) {
        this.navDirT = 0.35;
        this.navDirect = dist2(tx, tz, this.pos.x, this.pos.z) < 3 || losClear(this.pos.x, this.pos.y + 0.9, this.pos.z, tx, this.pos.y + 0.9, tz);
      }
      if (this.navDirect) { this.path = []; return this.moveTo(tx, tz, spd, dt, true); }
      this.navT -= dt;
      if (this.navT <= 0 || !this.path.length) {
        this.navT = 1.5;
        this.path = bfs(nearestNode(this.pos.x, this.pos.z), nearestNode(tx, tz));
      }
      if (!this.path.length) return this.moveTo(tx, tz, spd, dt, true);
      const n = nodes[this.path[0]];
      if (this.moveTo(n.x, n.z, spd, dt, true) < 0.8) this.path.shift();
      return dist2(tx, tz, this.pos.x, this.pos.z);
    }
    sense(dt) {
      const P = player;
      this.losT -= dt;
      const dx = P.pos.x - this.pos.x, dz = P.pos.z - this.pos.z, dy = P.pos.y - this.pos.y;
      const hd = Math.hypot(dx, dz), d = Math.hypot(hd, dy);
      const range = this.state === 'combat' ? 45 : this.type === 'archer' ? 32 : 24;
      let ok = !P.dead && !P.hidden && d < range;
      if (ok && this.state !== 'combat' && hd > 2.2) {
        const cos = (dx * this.fx + dz * this.fz) / (hd || 1);
        ok = cos > 0.42;
      }
      if (!ok) { this.vis = false; return false; }
      if (this.losT <= 0) {
        this.losT = 0.22;
        this.vis = losClear(this.pos.x, this.pos.y + 1.6, this.pos.z, P.pos.x, P.pos.y + 1.3, P.pos.z);
      }
      this.dist = d; this.hdist = hd;
      return this.vis;
    }
    alarm() {
      if (!this.alive || !this.hostile) return;
      if (!this.fight) {
        if (this.state !== 'flee') { this.state = 'flee'; this.aw = 1; this.fleeT = 0; this.lastSeenT = 0; if (Game.mission && Game.mission.def.onFlee) Game.mission.def.onFlee(Game.mission, this); }
        return;
      }
      if (this.state !== 'combat') {
        this.aw = 1; this.state = 'combat'; this.lastSeenT = 0; this.lastKnown.copy(player.pos);
        if (Game.alertCD <= 0) { sfx('alert'); Game.alertCD = 3; Game.stats.alarms++; }
      }
    }
    die(how) {
      if (!this.alive) return;
      this.alive = false; this.state = 'dead'; this.windT = 0;
      if (this.ind) this.ind.visible = false;
      this.glow.visible = false;
      this.h.blob.visible = false;
      if (this.type !== 'civ') Game.stats.kills++;
      for (const a of agents) {
        if (a === this || !a.alive) continue;
        const d = a.pos.distanceTo(this.pos);
        if (a.type === 'civ' && d < 12) { a.panicT = 7; }
        else if (a.hostile && d < 16 && how !== 'silent') {
          a.losT = 0;
          if (a.sense(0)) a.alarm();
          else if (d < 9 && a.state !== 'combat') { a.aw = Math.max(a.aw, 0.6); a.state = 'suspicious'; a.lastKnown.copy(this.pos); }
        }
      }
      if (Game.mission && Game.mission.def.onKill) Game.mission.def.onKill(Game.mission, this, how);
    }
    update(dt) {
      const h = this.h;
      if (!this.alive) {
        this.deadT += dt;
        h.body.rotation.x = lerp(h.body.rotation.x, -Math.PI / 2, Math.min(1, dt * 6));
        h.body.position.y = lerp(h.body.position.y, 0.15, Math.min(1, dt * 6));
        h.root.position.copy(this.pos);
        return;
      }
      if (this.type === 'civ') this.updateCiv(dt); else this.updateHostile(dt);
      h.root.position.copy(this.pos);
      h.root.rotation.y = this.yaw;
      const camD = camera.position.distanceTo(this.pos);
      h.root.visible = camD < 100 || player.eagle;
      if (h.root.visible) {
        let mode = this.curSpd > 2.6 ? 'run' : this.curSpd > 0.2 ? 'walk' : 'idle';
        if (this.windT > 0) mode = 'windup';
        else if (this.atkAnimT > 0) mode = 'attack';
        else if (this.o.sit) mode = 'sit';
        animHuman(h, dt, mode, this.curSpd);
      }
      this.glow.visible = player.eagle && (this.hostile || camD < 30);
      if (this.ind) {
        if (this.windT > 0) { this.ind.visible = true; this.ind.material.map = TEX.excl; this.ind.material.opacity = 1; }
        else if (this.state === 'combat') { this.ind.visible = true; this.ind.material.map = TEX.red; this.ind.material.opacity = 1; }
        else if (this.aw > 0.05) { this.ind.visible = true; this.ind.material.map = TEX.yellow; this.ind.material.opacity = 0.35 + this.aw * 0.65; }
        else this.ind.visible = false;
      }
      this.curSpd = 0;
    }
    updateCiv(dt) {
      if (this.panicT > 0) {
        this.panicT -= dt;
        const dx = this.pos.x - player.pos.x, dz = this.pos.z - player.pos.z, d = Math.hypot(dx, dz) || 1;
        this.moveTo(this.pos.x + (dx / d) * 3, this.pos.z + (dz / d) * 3, 3.6, dt, true);
        if (this.panicT <= 0) this.node = -1;
        return;
      }
      if (this.state === 'idle') {
        if (this.o.face) this.yaw = angLerp(this.yaw, Math.atan2(this.o.face.x - this.pos.x, this.o.face.z - this.pos.z), dt * 3);
        return;
      }
      this.walkGraph(dt, this.speed, 'outer');
    }
    updateHostile(dt) {
      const P = player;
      if (this.atkAnimT > 0) this.atkAnimT -= dt;
      if (this.stagT > 0) { this.stagT -= dt; this.windT = 0; return; }
      this.cool -= dt;
      const seen = this.sense(dt);
      const restricted = inRestricted(P.pos.x, P.pos.z);
      if (this.state !== 'combat' && this.state !== 'flee') {
        if (seen) {
          let r = (1.35 - this.dist / 24) * 0.85;
          const moving = P.moveSpd > 3 || P.state === 'climb' || P.state === 'air';
          if (moving) r *= 2.4;
          if (P.violentT > 0) r = 50;
          if (P.blend && !restricted && !moving) r *= P.inCrowd ? 0 : 0.35;
          if (restricted) r *= 2.5;
          if (P.pos.y > this.pos.y + 3 && this.type !== 'archer') r *= 0.55;
          if (this.o.vigilance) r *= this.o.vigilance;
          this.aw = Math.min(1, this.aw + Math.max(0, r) * dt);
          this.lastKnown.copy(P.pos);
          if (this.aw >= 1) {
            if (this.fight) this.alarm();
            else { this.state = 'flee'; this.aw = 1; this.fleeT = 0; if (Game.alertCD <= 0) { sfx('alert'); Game.alertCD = 3; } if (Game.mission && Game.mission.def.onFlee) Game.mission.def.onFlee(Game.mission, this); }
            return;
          }
          if (this.aw > 0.35 && this.state !== 'suspicious') { this.prevState = this.state; this.state = 'suspicious'; }
        } else {
          this.aw = Math.max(0, this.aw - 0.15 * dt);
        }
      }
      switch (this.state) {
        case 'post':
          this.yaw = angLerp(this.yaw, this.homeYaw + Math.sin(performance.now() / 2500 + this.lane) * 0.6, dt * 2);
          break;
        case 'idle':
          break;
        case 'patrol':
          if (this.type === 'archer') { this.yaw += dt * 0.35; break; }
          this.walkGraph(dt, this.speed, this.o.inner ? 'inner' : 'outer');
          break;
        case 'route': {
          const r = this.o.route; const t = r[this.routeI];
          if (this.moveTo(t.x, t.z, this.o.speed || 1.25, dt, true) < 0.6) this.routeI = (this.routeI + 1) % r.length;
          break;
        }
        case 'follow': {
          const L = this.o.leader;
          if (!L.alive) { this.state = 'patrol'; break; }
          const bx = L.pos.x - L.fx * 2.2 + Math.cos(L.yaw) * 0.8, bz = L.pos.z - L.fz * 2.2 - Math.sin(L.yaw) * 0.8;
          if (dist2(bx, bz, this.pos.x, this.pos.z) > 0.5) this.moveTo(bx, bz, 1.6, dt, true); else this.yaw = angLerp(this.yaw, L.yaw, dt * 3);
          break;
        }
        case 'suspicious': {
          const tyaw = Math.atan2(this.lastKnown.x - this.pos.x, this.lastKnown.z - this.pos.z);
          this.yaw = angLerp(this.yaw, tyaw, dt * 4);
          if (this.aw > 0.6 && this.type !== 'archer' && !this.o.post && this.o.leader === undefined) this.navTo(this.lastKnown.x, this.lastKnown.z, 1.0, dt);
          if (this.aw < 0.15) this.state = this.prevState === 'suspicious' || !this.prevState ? this.baseState() : this.prevState;
          break;
        }
        case 'search': {
          this.searchT -= dt;
          if (this.type === 'archer' || this.navTo(this.lastKnown.x, this.lastKnown.z, 2.4, dt) < 1) this.yaw += dt * 1.5;
          if (seen) { this.alarm(); break; }
          if (this.searchT <= 0) { this.state = 'return'; this.aw = 0.4; }
          break;
        }
        case 'return': {
          if (seen && this.aw > 0.8) { this.alarm(); break; }
          if (this.o.post || this.o.idle || this.type === 'archer') {
            if (this.type === 'archer' || this.navTo(this.home.x, this.home.z, 1.4, dt) < 0.5) { this.state = this.baseState(); this.yaw = this.homeYaw; }
          } else if (this.o.route) { this.state = 'route'; }
          else { this.node = -1; this.state = this.o.leader ? 'follow' : 'patrol'; }
          break;
        }
        case 'flee': {
          this.fleeT = (this.fleeT || 0) + dt;
          const dest = this.o.fleeTo;
          if (dest) { if (this.navTo(dest.x, dest.z, 3.9, dt) < 2 && Game.mission && Game.mission.def.onEscape) Game.mission.def.onEscape(Game.mission, this); }
          else {
            const dx = this.pos.x - P.pos.x, dz = this.pos.z - P.pos.z, d = Math.hypot(dx, dz) || 1;
            this.navTo(this.pos.x + (dx / d) * 6, this.pos.z + (dz / d) * 6, 3.7, dt);
          }
          if (seen) this.lastSeenT = 0; else this.lastSeenT += dt;
          if (!dest && this.lastSeenT > 12) { this.state = 'return'; this.aw = 0.3; }
          break;
        }
        case 'combat': this.updateCombat(dt, seen); break;
      }
    }
    baseState() { return this.o.post ? 'post' : this.o.idle ? 'idle' : this.o.route ? 'route' : this.o.leader ? 'follow' : 'patrol'; }
    updateCombat(dt, seen) {
      const P = player;
      if (seen) { this.lastSeenT = 0; this.lastKnown.copy(P.pos); } else this.lastSeenT += dt;
      if (P.dead) { this.state = 'return'; return; }
      if (this.lastSeenT > 6) { this.state = 'search'; this.searchT = 7; this.windT = 0; return; }
      const dx = P.pos.x - this.pos.x, dz = P.pos.z - this.pos.z, hd = Math.hypot(dx, dz);
      const reach = Math.abs(P.pos.y - this.pos.y) < 1.4;
      if (this.windT > 0) {
        this.yaw = angLerp(this.yaw, Math.atan2(dx, dz), dt * 8);
        this.windT -= dt;
        if (this.windT <= 0) {
          this.atkAnimT = 0.3; this.cool = 1.3 + Math.random() * 1.2;
          if (hd < 2.4 && reach && !P.dead) {
            if (P.blockT > 0) { sfx('clang'); this.stagT = 0.5; }
            else P.hurt(this.o.dmg || 1);
          }
        }
        return;
      }
      if (this.type === 'archer' || (!reach && hd < 8)) {
        if (this.type !== 'archer' && hd > 5) this.navTo(P.pos.x, P.pos.z, 3.6, dt);
        this.yaw = angLerp(this.yaw, Math.atan2(dx, dz), dt * 6);
        if (hd < 2 && reach && this.cool <= 0) { this.windT = 0.75; return; }
        if (seen && this.cool <= 0) {
          this.cool = this.type === 'archer' ? 2.4 : 3;
          this.atkAnimT = 0.3;
          throwProjectile(this, this.type === 'archer' ? 'arrow' : 'stone');
        }
        return;
      }
      if (hd > 1.7) {
        this.navTo(P.pos.x, P.pos.z, hd > 6 ? 4.3 : 2.6, dt);
      } else {
        this.yaw = angLerp(this.yaw, Math.atan2(dx, dz), dt * 8);
        if (this.cool <= 0 && reach) {
          let busy = 0;
          for (const a of agents) if (a.windT > 0) busy++;
          if (busy < 2) this.windT = 0.8; else this.cool = 0.5;
        }
      }
    }
  }

  function throwProjectile(from, kind, target) {
    const P = player;
    const sx = from.pos.x + from.fx * 0.4, sy = from.pos.y + 1.6, sz = from.pos.z + from.fz * 0.4;
    let tx, ty, tz;
    if (target) { tx = target.pos.x; ty = target.pos.y + 1.2; tz = target.pos.z; }
    else { tx = P.pos.x; ty = P.pos.y + 1.1; tz = P.pos.z; }
    const speed = kind === 'knife' ? 32 : kind === 'arrow' ? 26 : 16;
    const g = kind === 'stone' ? 14 : 4;
    const dx = tx - sx, dy = ty - sy, dz = tz - sz, d = Math.hypot(dx, dy, dz) || 1;
    const t = d / speed;
    const vel = new V3((dx / d) * speed, (dy / d) * speed + 0.5 * g * t, (dz / d) * speed);
    if (kind !== 'knife') {
      vel.x += (Math.random() - 0.5) * 1.6; vel.z += (Math.random() - 0.5) * 1.6;
    }
    const m = new THREE.Mesh(kind === 'stone' ? boxG(0.15, 0.15, 0.15) : boxG(0.04, 0.04, kind === 'arrow' ? 0.8 : 0.35), matC(kind === 'stone' ? '#777' : kind === 'arrow' ? '#5a3a20' : '#e8ecf0'));
    m.position.set(sx, sy, sz);
    scene.add(m);
    projectiles.push({ kind, pos: m.position, vel, g, m, life: 3, from, target });
    sfx('throw');
  }
  function updateProjectiles(dt) {
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const p = projectiles[i];
      p.life -= dt;
      p.vel.y -= p.g * dt;
      p.pos.addScaledVector(p.vel, dt);
      p.m.lookAt(p.pos.x + p.vel.x, p.pos.y + p.vel.y, p.pos.z + p.vel.z);
      let hit = false;
      if (p.kind === 'knife') {
        for (const a of agents) {
          if (!a.alive || a.type === 'civ') continue;
          const dx = a.pos.x - p.pos.x, dy = a.pos.y + 1.1 - p.pos.y, dz = a.pos.z - p.pos.z;
          if (dx * dx + dy * dy + dz * dz < 0.7) { a.die('knife'); sfx('kill'); hit = true; break; }
        }
      } else if (!player.dead && !player.hidden) {
        const dx = player.pos.x - p.pos.x, dy = player.pos.y + 1.1 - p.pos.y, dz = player.pos.z - p.pos.z;
        if (dx * dx + dy * dy + dz * dz < 0.6) {
          hit = true;
          if (player.blockT > 0 && p.kind === 'stone') sfx('clang'); else player.hurt(1);
        }
      }
      if (hit || p.life <= 0 || p.pos.y < 0 || pointInSolid(p.pos.x, p.pos.y, p.pos.z)) {
        scene.remove(p.m);
        projectiles.splice(i, 1);
      }
    }
  }

  // ================= Логика игрока =================
  player.hurt = function (n) {
    if (this.dead || this.state === 'sync') return;
    this.hp -= n; this.hurtT = 0;
    sfx('hurt');
    const f = $('flash'); f.style.opacity = 0.45; setTimeout(() => (f.style.opacity = 0), 120);
    if (this.hp <= 0) { this.hp = 0; this.die(); }
  };
  player.die = function () {
    this.dead = true; this.state = 'dead';
    sfx('fail');
    const run = Game.runId;
    setTimeout(() => { if (Game.runId === run) endMission(false, 'Ты погиб. Так не было в воспоминаниях предка.'); }, 1600);
  };
  function moveDir() {
    const mag = Math.min(1, Math.hypot(input.mx, input.my));
    if (mag < 0.1) return { x: 0, z: 0, mag: 0 };
    const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw), rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw);
    let x = fx * input.my + rx * input.mx, z = fz * input.my + rz * input.mx;
    const l = Math.hypot(x, z) || 1;
    return { x: x / l, z: z / l, mag };
  }
  function towerAtTop() {
    for (const t of towers) if (Math.abs(player.pos.y - t.h) < 0.5 && dist2(player.pos.x, player.pos.z, t.x, t.z) < 2.6) return t;
    return null;
  }
  function leapSpot() {
    if (player.state !== 'ground') return null;
    for (const t of towers) if (Math.abs(player.pos.y - t.h) < 0.4 && dist2(player.pos.x, player.pos.z, t.beam.x, t.beam.z) < 1.6) return t;
    return null;
  }
  function startClimb(hit) {
    const P = player;
    const n = Math.abs(hit.nx) > Math.abs(hit.nz) ? { x: Math.sign(hit.nx), z: 0 } : { x: 0, z: Math.sign(hit.nz) };
    P.state = 'climb'; P.climbC = hit.c; P.cn = n; P.vel.set(0, 0, 0); P.leap = false;
    P.yaw = Math.atan2(-n.x, -n.z);
  }
  function snapToWall() {
    const P = player, c = P.climbC, n = P.cn;
    if (n.x > 0) P.pos.x = c.x1 + 0.36; else if (n.x < 0) P.pos.x = c.x0 - 0.36;
    if (n.z > 0) P.pos.z = c.z1 + 0.36; else if (n.z < 0) P.pos.z = c.z0 - 0.36;
  }
  function wallAt(x, y, z, n) {
    const px = x - n.x * 0.5, pz = z - n.z * 0.5;
    const list = bucket(px, pz);
    for (const c of list) if (c.climb && px >= c.x0 && px <= c.x1 && pz >= c.z0 && pz <= c.z1 && c.y1 > y + 0.4 && c.y0 <= y + 1.2) return c;
    return null;
  }
  function jump(vx, vz, vy) {
    const P = player;
    P.state = 'air'; P.vel.set(vx, vy, vz); P.airMaxY = P.pos.y;
  }
  function land(g) {
    const P = player;
    const fall = P.airMaxY - g;
    P.pos.y = g; P.vel.set(0, 0, 0); P.state = 'ground';
    const hay = g < 0.1 ? hayAt(P.pos.x, P.pos.z, 0.2) : null;
    if (hay) {
      P.state = 'hidden'; P.hidden = true; P.hideT = 0; P.pos.x = hay.x; P.pos.z = hay.z;
      sfx('hay');
      if (P.leap) toast('ПРЫЖОК ВЕРЫ');
      if (Game.mission && Game.mission.def.onEvent) Game.mission.def.onEvent(Game.mission, 'hay');
    } else {
      if (fall > 7.5) P.hurt(Math.ceil((fall - 7.5) / 1.6));
      if (fall > 1.5) sfx('land');
      P.mantleT = fall > 3 ? 0.2 : 0;
    }
    P.leap = false;
  }
  function hostileCandidates(maxD, filterFn) {
    const res = [];
    for (const a of agents) {
      if (!a.alive || !a.hostile) continue;
      const dx = a.pos.x - player.pos.x, dz = a.pos.z - player.pos.z, dy = a.pos.y - player.pos.y;
      const hd = Math.hypot(dx, dz);
      if (hd > maxD) continue;
      if (filterFn && !filterFn(a, hd, dy, dx, dz)) continue;
      res.push({ a, hd, dy, dx, dz });
    }
    return res;
  }
  function meleeTarget() {
    const P = player;
    const fx = Math.sin(P.yaw), fz = Math.cos(P.yaw);
    let best = null, bs = 1e9;
    for (const c of hostileCandidates(2.4, (a, hd, dy) => Math.abs(dy) < 1.3)) {
      const front = (c.dx * fx + c.dz * fz) / (c.hd || 1);
      const s = c.hd - front * 0.8;
      if (s < bs) { bs = s; best = c.a; }
    }
    return best;
  }
  function airTarget() {
    let best = null, bd = 1e9;
    for (const c of hostileCandidates(3.2, (a, hd, dy) => dy < -0.6 && dy > -7)) if (c.hd < bd) { bd = c.hd; best = c.a; }
    return best;
  }
  function canAssassinate(a) {
    if (a.state !== 'combat' && a.state !== 'flee') return true;
    if (a.stagT > 0 && a.hp <= 1) return true;
    const dx = player.pos.x - a.pos.x, dz = player.pos.z - a.pos.z, d = Math.hypot(dx, dz) || 1;
    return (dx * a.fx + dz * a.fz) / d < -0.4 && a.windT <= 0;
  }
  function assassinate(a, how) {
    const P = player;
    const dx = P.pos.x - a.pos.x, dz = P.pos.z - a.pos.z, d = Math.hypot(dx, dz) || 1;
    if (how === 'air') { P.pos.set(a.pos.x + (dx / d) * 0.5, a.pos.y, a.pos.z + (dz / d) * 0.5); P.airMaxY = P.pos.y; }
    else { P.pos.x = a.pos.x + (dx / d) * 0.75; P.pos.z = a.pos.z + (dz / d) * 0.75; }
    P.yaw = Math.atan2(-dx, -dz);
    P.state = 'assassin'; P.lockT = 0.55; P.attackT = 0.55; P.violentT = 1.2; P.vel.set(0, 0, 0);
    const witnessesQuiet = how !== 'counter';
    a.die(witnessesQuiet ? 'stealth' : 'combat');
    sfx('kill');
    Game.slowT = 0.45;
    if (how === 'air') toast('УБИЙСТВО С ВОЗДУХА', 1.2);
  }
  function bladeAction() {
    const P = player;
    if (P.attackT > 0 || P.dead) return;
    if (P.state === 'air') { const a = airTarget(); if (a) assassinate(a, 'air'); return; }
    if (P.state !== 'ground') return;
    const a = meleeTarget();
    P.attackT = 0.35; P.violentT = 0.8;
    if (P.h.blade) P.h.blade.visible = true;
    sfx('swing');
    if (!a) return;
    if (canAssassinate(a)) { assassinate(a, 'stealth'); return; }
    if (a.windT <= 0 && Math.random() < 0.3) { sfx('clang'); a.cool = Math.min(a.cool, 0.3); return; }
    a.hp -= 1; a.stagT = 0.45; a.windT = 0;
    a.pos.x += (a.pos.x - P.pos.x) * 0.25; a.pos.z += (a.pos.z - P.pos.z) * 0.25;
    sfx('hit');
    a.alarm();
    if (a.hp <= 0) { a.die('combat'); sfx('kill'); }
  }
  function blockAction() {
    const P = player;
    if (P.state !== 'ground' || P.dead) return;
    let best = null, bd = 3;
    for (const a of agents) if (a.alive && a.windT > 0 && a.windT < 0.7) { const d = a.pos.distanceTo(P.pos); if (d < bd) { bd = d; best = a; } }
    if (best) { sfx('clang'); toast('КОНТРАТАКА', 0.8); assassinate(best, 'counter'); return; }
    P.blockT = 0.6;
  }
  function knifeAction() {
    const P = player;
    if (P.knives <= 0 || P.dead || P.state === 'hidden' || P.state === 'climb' || P.throwT > 0) return;
    const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw);
    let best = null, bs = 1e9;
    for (const c of hostileCandidates(28)) {
      const front = (c.dx * fx + c.dz * fz) / (c.hd || 1);
      if (front < 0.75) continue;
      if (!losClear(P.pos.x, P.pos.y + 1.5, P.pos.z, c.a.pos.x, c.a.pos.y + 1.2, c.a.pos.z)) continue;
      const s = c.hd * (2 - front);
      if (s < bs) { bs = s; best = c.a; }
    }
    if (!best) { hint2('Нет цели для ножа — наведи камеру на врага'); return; }
    P.knives--; P.throwT = 0.35; P.violentT = 0.6;
    P.yaw = Math.atan2(best.pos.x - P.pos.x, best.pos.z - P.pos.z);
    throwProjectile({ pos: P.pos, fx: Math.sin(P.yaw), fz: Math.cos(P.yaw) }, 'knife', best);
    $('knifeCount').textContent = P.knives;
  }

  function updatePlayer(dt) {
    const P = player, h = P.h;
    P.attackT -= dt; P.blockT -= dt; P.violentT -= dt; P.noGrabT -= dt; P.mantleT -= dt; P.throwT -= dt; P.hurtT += dt;
    if (P.attackT <= 0 && h.blade) h.blade.visible = false;
    const md = moveDir();
    const free = input.free && !P.blend;
    let mode = 'idle', aspd = 0;
    P.moveSpd = 0;
    if (P.dead) {
      h.body.rotation.x = lerp(h.body.rotation.x, -Math.PI / 2, Math.min(1, dt * 5));
      h.body.position.y = lerp(h.body.position.y, 0.15, Math.min(1, dt * 5));
    } else if (P.state === 'sync') {
      P.syncT -= dt;
      mode = 'leap';
      if (P.syncT <= 0) {
        P.state = 'ground';
        P.syncTower.synced = true;
        P.hp = P.maxHp;
        toast('СИНХРОНИЗИРОВАНО', 1.6);
        if (Game.mission && Game.mission.def.onEvent) Game.mission.def.onEvent(Game.mission, 'sync');
      }
    } else if (P.state === 'hidden') {
      P.hideT = (P.hideT || 0) + dt;
      if (P.hideT > 0.6 && (md.mag > 0.6 || took('act') || took('jump'))) {
        P.state = 'ground'; P.hidden = false;
        const hy = hayAt(P.pos.x, P.pos.z);
        if (hy && md.mag > 0.1) { P.pos.x = hy.x + md.x * 1.7; P.pos.z = hy.z + md.z * 1.7; }
      }
    } else if (P.state === 'assassin') {
      P.lockT -= dt; mode = 'attack';
      if (P.lockT <= 0) P.state = P.pos.y > groundAt(P.pos.x, P.pos.z, P.pos.y) + 0.1 ? 'air' : 'ground';
      if (P.state === 'air') P.vel.set(0, 0, 0);
    } else if (P.state === 'ground') {
      let spd = md.mag < 0.1 ? 0 : P.blend ? 1.5 : free ? 7.2 : md.mag > 0.75 ? 4.6 : 2.0;
      if (P.attackT > 0 || P.blockT > 0 || P.mantleT > 0) spd *= 0.25;
      const vx = md.x * spd, vz = md.z * spd;
      if (spd > 0) P.yaw = angLerp(P.yaw, Math.atan2(md.x, md.z), 1 - Math.exp(-dt * 14));
      if (free && spd > 5) {
        const g2 = groundAt(P.pos.x + md.x * 0.75, P.pos.z + md.z * 0.75, P.pos.y);
        if (g2 < P.pos.y - 1.4) jump(vx, vz, 6.4);
      }
      if (P.state === 'ground') {
        P.pos.x += vx * dt; P.pos.z += vz * dt;
        const hit = pushOut(P.pos, 0.35, P.pos.y, 1.75);
        if (hit && spd > 0 && md.x * hit.nx + md.z * hit.nz < -0.5 && hit.c.climb && (free || input.jumpHeld)) {
          const top = hit.c.y1;
          if (top - P.pos.y <= 1.9 && hit.c.y0 <= P.pos.y + 0.5) {
            P.pos.y = top; P.pos.x -= hit.nx * 0.6; P.pos.z -= hit.nz * 0.6; P.mantleT = 0.2;
          } else if (hit.c.y0 <= P.pos.y + 1.5) startClimb(hit);
        }
        if (P.state === 'ground' && took('jump')) {
          const t = leapSpot();
          if (t) {
            P.leap = true;
            const ft = Math.sqrt((2 * t.h) / 20) + 0.15;
            jump((t.hay.x - P.pos.x) / ft, (t.hay.z - P.pos.z) / ft, 2);
          } else jump(vx * 1.05, vz * 1.05, 6.2);
        }
        if (P.state === 'ground') {
          const g = groundAt(P.pos.x, P.pos.z, P.pos.y);
          if (P.pos.y > g + 0.05) { P.state = 'air'; P.vel.set(vx, 0, vz); P.airMaxY = P.pos.y; }
          else P.pos.y = g;
        }
      }
      P.moveSpd = spd;
      aspd = spd;
      mode = P.attackT > 0 ? 'attack' : P.blockT > 0 ? 'block' : P.throwT > 0 ? 'throw' : spd > 4 ? 'run' : spd > 0 ? (P.blend ? 'sneak' : 'walk') : 'idle';
    } else if (P.state === 'air') {
      P.vel.y -= 20 * dt;
      if (md.mag > 0.1 && !P.leap) {
        P.vel.x += md.x * 5 * dt; P.vel.z += md.z * 5 * dt;
        const hs = Math.hypot(P.vel.x, P.vel.z), mx = 8;
        if (hs > mx) { P.vel.x *= mx / hs; P.vel.z *= mx / hs; }
      }
      P.pos.addScaledVector(P.vel, dt);
      P.airMaxY = Math.max(P.airMaxY, P.pos.y);
      const hit = pushOut(P.pos, 0.35, P.pos.y, 1.75);
      if (hit) {
        const into = P.vel.x * hit.nx + P.vel.z * hit.nz;
        const toward = (md.mag > 0.1 ? md.x * hit.nx + md.z * hit.nz : P.vel.x * hit.nx + P.vel.z * hit.nz) < -0.3;
        if (hit.c.climb && !P.leap && toward && P.noGrabT <= 0 && hit.c.y1 - P.pos.y > 0.4 && hit.c.y0 <= P.pos.y + 1.5 && (free || input.jumpHeld || md.mag > 0.4)) startClimb(hit);
        else if (into < 0) { P.vel.x -= into * hit.nx; P.vel.z -= into * hit.nz; }
      }
      if (P.state === 'air') {
        const g = groundAt(P.pos.x, P.pos.z, P.pos.y, P.leap);
        if (P.pos.y <= g) land(g);
        if (Math.abs(P.vel.x) + Math.abs(P.vel.z) > 0.5 && !P.leap) P.yaw = angLerp(P.yaw, Math.atan2(P.vel.x, P.vel.z), dt * 6);
      }
      mode = P.leap ? 'leap' : 'air';
    } else if (P.state === 'climb') {
      const c = P.climbC, n = P.cn, t = { x: -n.z, z: n.x };
      let vert = md.mag > 0.1 ? -(md.x * n.x + md.z * n.z) * md.mag : 0;
      let side = md.mag > 0.1 ? (md.x * t.x + md.z * t.z) * md.mag : 0;
      if (free) vert = Math.max(vert, 0.9);
      if (Math.abs(side) < 0.35) side = 0;
      P.pos.y += vert * (vert > 0 ? (free ? 4.6 : 3.4) : 3.2) * dt;
      if (side) {
        const ox = P.pos.x, oz = P.pos.z;
        P.pos.x += t.x * side * 2.6 * dt; P.pos.z += t.z * side * 2.6 * dt;
        const inside = n.x !== 0 ? P.pos.z >= c.z0 + 0.1 && P.pos.z <= c.z1 - 0.1 : P.pos.x >= c.x0 + 0.1 && P.pos.x <= c.x1 - 0.1;
        if (!inside) {
          const nc = wallAt(P.pos.x, P.pos.y, P.pos.z, n);
          if (nc) P.climbC = nc; else { P.pos.x = ox; P.pos.z = oz; }
        }
      }
      snapToWall();
      const cc = P.climbC;
      if (vert > 0 && P.pos.y + 1.0 >= cc.y1) {
        // Подтягивание на крышу
        let nx = P.pos.x - n.x * 0.75, nz = P.pos.z - n.z * 0.75;
        if (n.x !== 0) nx = cc.x1 - cc.x0 < 1.2 ? (cc.x0 + cc.x1) / 2 : clamp(nx, cc.x0 + 0.4, cc.x1 - 0.4);
        if (n.z !== 0) nz = cc.z1 - cc.z0 < 1.2 ? (cc.z0 + cc.z1) / 2 : clamp(nz, cc.z0 + 0.4, cc.z1 - 0.4);
        P.pos.set(nx, cc.y1, nz); P.state = 'ground'; P.mantleT = 0.25;
      } else {
        const g = groundAt(P.pos.x + n.x * 0.2, P.pos.z + n.z * 0.2, P.pos.y);
        if (P.pos.y <= g) { P.pos.y = g; P.state = 'ground'; }
        else if (P.pos.y < cc.y0 - 0.5) { P.state = 'air'; P.airMaxY = P.pos.y; P.vel.set(0, 0, 0); P.noGrabT = 0.3; }
        if (took('jump')) {
          P.state = 'air'; P.vel.set(n.x * 5.5, 6, n.z * 5.5); P.yaw = Math.atan2(n.x, n.z); P.airMaxY = P.pos.y; P.noGrabT = 0.35;
        }
      }
      mode = Math.abs(vert) > 0.05 || side ? 'climb' : 'hang';
      aspd = 2.5;
    }
    if (P.pos.y < -5) { P.pos.copy(bureau.spawn); }
    // В толпе ли игрок
    let near = 0;
    for (const a of agents) if (a.alive && a.type === 'civ' && a.panicT <= 0 && a.pos.distanceToSquared(P.pos) < 12) near++;
    P.inCrowd = near >= 2;
    // Регенерация
    if (!anyCombat() && P.hurtT > 5 && P.hp < P.maxHp && !P.dead) { P.regenT += dt; if (P.regenT > 2.5) { P.regenT = 0; P.hp++; } }
    h.root.position.copy(P.pos);
    h.root.rotation.y = P.yaw;
    h.root.visible = !P.hidden;
    if (!P.dead) animHuman(h, dt, mode, aspd);
    if (P.attackT > 0 && h.blade) h.blade.visible = true;
    playerBlob.position.set(P.pos.x, groundAt(P.pos.x, P.pos.z, P.pos.y) + 0.03, P.pos.z);
    playerBlob.visible = !P.hidden;
  }
  function anyCombat() { for (const a of agents) if (a.alive && a.state === 'combat') return true; return false; }
  function anyFlee() { for (const a of agents) if (a.alive && a.state === 'flee') return true; return false; }

  // ================= Камера =================
  function updateCamera(dt) {
    const P = player;
    cam.yaw -= input.camDX * 0.0065;
    cam.pitch = clamp(cam.pitch + input.camDY * 0.005, -0.4, 1.25);
    input.camDX = 0; input.camDY = 0;
    let dist = P.state === 'climb' ? 5.2 : 4.6, pitch = cam.pitch, yaw = cam.yaw;
    if (P.state === 'sync') { cam.orbit += dt * 1.1; yaw = cam.yaw + cam.orbit; dist = 10; pitch = 0.35; }
    else if (P.leap) { dist = 6; pitch = 0.9; }
    else cam.orbit = 0;
    const tgt = new V3(P.pos.x, P.pos.y + 1.55, P.pos.z);
    cam.target.lerp(tgt, 1 - Math.exp(-dt * 16));
    if (cam.target.distanceTo(tgt) > 6) cam.target.copy(tgt);
    const cx = cam.target.x + Math.sin(yaw) * Math.cos(pitch) * dist;
    const cy = cam.target.y + Math.sin(pitch) * dist;
    const cz = cam.target.z + Math.cos(yaw) * Math.cos(pitch) * dist;
    const f = segHit(cam.target.x, cam.target.y, cam.target.z, cx, cy, cz);
    const k = f < 1 ? Math.max(0.12, f - 0.06) : 1;
    camera.position.set(lerp(cam.target.x, cx, k), Math.max(0.3, lerp(cam.target.y, cy, k)), lerp(cam.target.z, cz, k));
    camera.lookAt(cam.target);
  }

  // ================= HUD =================
  let toastTimer = 0, hint2Timer = 0, lastHp = -1, lastStatus = '', lastAct = '', lastJump = '';
  function toast(text, dur) {
    const t = $('toast'); t.textContent = text; t.style.opacity = 1; toastTimer = dur || 1.8;
  }
  function hint2(text) { $('hint').textContent = text; $('hint').style.opacity = 1; hint2Timer = 2.5; }
  function setHint(text) { if (Game.mission) Game.mission.hint = text; }
  function setObj(text, target) { if (Game.mission) { Game.mission.obj = text; Game.mission.target = target || null; } }

  function contextAction() {
    const P = player;
    if (P.dead || P.state === 'sync' || P.state === 'assassin') return null;
    if (Game.mission && Game.mission.def.context) { const c = Game.mission.def.context(Game.mission); if (c) return c; }
    if (P.state === 'hidden') return { label: 'ВЫЙТИ', fn: () => { P.state = 'ground'; P.hidden = false; } };
    if (P.state !== 'ground') return null;
    const t = towerAtTop();
    if (t && !t.synced) return { label: 'СИНХРОНИЗАЦИЯ', fn: () => { P.state = 'sync'; P.syncT = 3.2; P.syncTower = t; sfx('sync'); } };
    if (P.pos.y < 0.3 && hayAt(P.pos.x, P.pos.z, 0.7)) return { label: 'СПРЯТАТЬСЯ', fn: () => { const hy = hayAt(P.pos.x, P.pos.z, 0.7); P.state = 'hidden'; P.hidden = true; P.hideT = 0; P.pos.x = hy.x; P.pos.z = hy.z; sfx('hay'); } };
    return null;
  }

  function updateHUD(dt) {
    const P = player, M = Game.mission;
    if (P.hp !== lastHp) {
      lastHp = P.hp;
      let s = '';
      for (let i = 0; i < P.maxHp; i++) s += `<div class="cell${i < P.hp ? '' : ' empty'}"></div>`;
      $('health').innerHTML = s;
    }
    let st = 'anon', label = 'АНОНИМЕН';
    if (anyCombat()) { st = 'alert'; label = 'ОБНАРУЖЕН'; }
    else if (agents.some((a) => a.alive && a.hostile && (a.aw > 0.3 || a.state === 'search' || a.state === 'flee'))) { st = 'susp'; label = 'ПОДОЗРЕНИЕ'; }
    else if (P.hidden) label = 'УКРЫТ';
    else if (P.blend && P.inCrowd) label = 'В ТОЛПЕ';
    else if (P.blend) label = 'СКРЫТНОСТЬ';
    const key = st + label;
    if (key !== lastStatus) { lastStatus = key; const el = $('status'); el.className = st; el.textContent = label; }
    if (M) {
      let txt = M.obj || '';
      let tp = null;
      if (M.target) tp = M.target.pos ? M.target.pos : M.target;
      if (tp) txt += `<div class="dist">${Math.round(P.pos.distanceTo(tp))} м</div>`;
      if ($('objective').innerHTML !== txt) $('objective').innerHTML = txt;
      if (tp && M.target.alive !== false) {
        marker.visible = true;
        marker.position.set(tp.x, tp.y + (M.target.pos ? 2.8 : 1.5) + Math.sin(performance.now() / 300) * 0.15, tp.z);
        marker.rotation.y += dt * 2;
      } else marker.visible = false;
      if (hint2Timer <= 0) {
        const hEl = $('hint');
        if (hEl.textContent !== (M.hint || '')) hEl.textContent = M.hint || '';
        hEl.style.opacity = M.hint ? 1 : 0;
      }
    }
    hint2Timer -= dt;
    toastTimer -= dt;
    if (toastTimer <= 0) $('toast').style.opacity = 0;
    // Кнопки
    const ctx = contextAction();
    Game.ctx = ctx;
    const actLabel = ctx ? ctx.label : '';
    if (actLabel !== lastAct) { lastAct = actLabel; const b = $('bAct'); b.textContent = actLabel; b.classList.toggle('hidden', !ctx); }
    const jl = leapSpot() ? 'ВЕРА' : P.state === 'climb' ? 'ОТСКОК' : 'ПРЫЖОК';
    if (jl !== lastJump) { lastJump = jl; $('bJump').innerHTML = `<div><span class="ic">⤒</span>${jl}</div>`; $('bJump').classList.toggle('ready', jl === 'ВЕРА'); }
    let bladeReady = false;
    if (P.state === 'air') bladeReady = !!airTarget();
    else if (P.state === 'ground') { const a = meleeTarget(); bladeReady = !!(a && canAssassinate(a)); }
    $('bBlade').classList.toggle('ready', bladeReady);
    $('bBlock').classList.toggle('warn', agents.some((a) => a.alive && a.windT > 0 && a.windT < 0.7 && a.pos.distanceTo(P.pos) < 3));
    $('bFree').classList.toggle('on', input.free);
    $('bBlend').classList.toggle('on', P.blend);
    $('bEagle').classList.toggle('on', P.eagle);
    drawMinimap();
  }

  function drawMinimap() {
    const P = player, g = mmg, W = 150, s = 1.3;
    g.clearRect(0, 0, W, W);
    g.save();
    g.beginPath(); g.arc(W / 2, W / 2, W / 2 - 1, 0, Math.PI * 2); g.clip();
    g.translate(W / 2, W / 2);
    g.rotate(cam.yaw);
    g.scale(s / MAP_S, s / MAP_S);
    g.drawImage(mapBase, -(P.pos.x + 120) * MAP_S, -(P.pos.z + 120) * MAP_S);
    g.restore();
    g.save();
    g.translate(W / 2, W / 2);
    g.rotate(cam.yaw);
    const dot = (x, z, col, r) => {
      let dx = (x - P.pos.x) * s, dz = (z - P.pos.z) * s;
      const l = Math.hypot(dx, dz), R = W / 2 - 6;
      if (l > R) { dx *= R / l; dz *= R / l; }
      g.fillStyle = col; g.beginPath(); g.arc(dx, dz, r, 0, Math.PI * 2); g.fill();
    };
    for (const t of towers) dot(t.x, t.z, t.synced ? '#6aa8ff' : '#fff', 3);
    for (const a of agents) {
      if (!a.alive || !a.hostile) continue;
      if (a.state === 'combat') dot(a.pos.x, a.pos.z, '#ff3030', 2.5);
      else if (P.eagle || a.aw > 0.3) dot(a.pos.x, a.pos.z, a.type === 'target' ? '#ffc83a' : '#ff8a8a', 2.2);
    }
    const M = Game.mission;
    if (M && M.target) { const tp = M.target.pos || M.target; dot(tp.x, tp.z, '#ffc83a', 4); }
    const fx = Math.sin(P.yaw), fz = Math.cos(P.yaw);
    g.fillStyle = '#fff'; g.strokeStyle = '#000';
    g.beginPath(); g.moveTo(fx * 8, fz * 8); g.lineTo(-fz * 4 - fx * 3, fx * 4 - fz * 3); g.lineTo(fz * 4 - fx * 3, -fx * 4 - fz * 3); g.closePath(); g.fill(); g.stroke();
    g.restore();
  }

  function setEagle(on) {
    player.eagle = on;
    if (on) player.eagleUsed = true;
    $('eagleTint').style.opacity = on ? 1 : 0;
    scene.background.copy(on ? EAGLE_SKY : SKY);
    scene.fog.color.copy(on ? EAGLE_SKY : SKY);
    scene.fog.far = on ? 120 : 175;
    hemi.intensity = on ? 0.32 : 0.85;
    hemi.color.set(on ? 0x5a78c0 : 0xfff2dc);
    sun.intensity = on ? 0.18 : 0.85;
  }

  // ================= Миссии =================
  function clearWorld() {
    for (const a of agents) a.remove();
    agents.length = 0;
    for (const p of projectiles) scene.remove(p.m);
    projectiles.length = 0;
    for (const t of towers) t.synced = false;
  }
  function spawnAmbient(o) {
    o = o || {};
    const outer = nodes.map((n, i) => i).filter((i) => !nodes[i].inner);
    for (let k = 0; k < (o.civs || 26); k++) {
      const n = nodes[pick(outer)];
      const a = new Agent('civ', n.x + (rng() - 0.5) * 6, n.z + (rng() - 0.5) * 6);
      a.node = -1;
    }
    for (let k = 0; k < (o.patrols !== undefined ? o.patrols : 8); k++) {
      const n = nodes[pick(outer)];
      new Agent('guard', n.x, n.z);
    }
    if (o.fortress !== false) {
      new Agent('guard', 76, 53.5, { post: true, yaw: Math.PI });
      new Agent('guard', 80, 53.5, { post: true, yaw: Math.PI });
      new Agent('guard', 53.5, 76, { post: true, yaw: -Math.PI / 2 });
      new Agent('guard', 53.5, 80, { post: true, yaw: -Math.PI / 2 });
      new Agent('guard', 63, 63, { inner: true });
      new Agent('guard', 93, 93, { inner: true });
    }
  }
  function placePlayer(p, yaw) {
    const P = player;
    P.pos.copy(p); P.vel.set(0, 0, 0); P.yaw = yaw || 0; P.state = 'ground'; P.dead = false; P.hidden = false;
    P.hp = P.maxHp; P.knives = 5; P.blend = false; P.leap = false; P.letter = false; P.eagleUsed = false;
    P.h.body.rotation.x = 0; P.h.body.position.y = 0;
    $('knifeCount').textContent = P.knives;
    setEagle(false);
    cam.yaw = P.yaw + Math.PI; cam.pitch = 0.3;
    cam.target.set(P.pos.x, P.pos.y + 1.5, P.pos.z);
  }
  function tallestLotIn(i, j) {
    let best = null;
    for (const r of roofParts[i + ',' + j] || []) if (!best || r.h > best.h) best = r;
    return best;
  }
  const nodeAt = (k, l) => nodes[nodeGrid[k][l]];

  const MISSIONS = [
    {
      title: 'Орлиный взгляд',
      desc: 'Обучение. Взберись на башню обзора, синхронизируйся, соверши прыжок веры и устрани предателя Братства.',
      start(m) {
        spawnAmbient({ civs: 22, patrols: 4 });
        placePlayer(bureau.spawn, Math.PI / 2);
        m.tower = towers[0];
        m.step = 0;
      },
      update(m) {
        const P = player, T = m.tower;
        switch (m.step) {
          case 0:
            setObj('Доберись до башни обзора', new V3(T.x + 2.5, 0, T.z + 3));
            setHint('Левая часть экрана — движение, свайп справа — камера. Удерживай ПАРКУР, чтобы бежать.');
            if (dist2(P.pos.x, P.pos.z, T.x, T.z) < 12 || P.pos.y > 3) m.step = 1;
            break;
          case 1:
            setObj('Взберись на вершину башни', new V3(T.x, T.h, T.z));
            setHint('Удерживай ПАРКУР и беги прямо в стену — ассасин полезет вверх сам. Карабкайся по крышам выше и выше.');
            if (towerAtTop()) m.step = 2;
            break;
          case 2:
            setObj('Синхронизируйся с городом', null);
            setHint('Нажми кнопку СИНХРОНИЗАЦИЯ над правыми кнопками.');
            if (T.synced) m.step = 3;
            break;
          case 3:
            setObj('Соверши прыжок веры', T.beam);
            setHint('Пройди на край деревянной балки и нажми ПРЫЖОК (ВЕРА). Внизу ждёт стог сена.');
            break;
          case 4:
            setObj('Найди предателя Харуна', null);
            setHint('Нажми ОРЁЛ — орлиное зрение подсветит цель золотым даже сквозь стены.');
            if (P.eagle) m.step = 5;
            break;
          case 5:
            setObj('Устрани предателя Харуна', m.traitor);
            setHint('Подкрадись сзади (СКРЫТ — тихий шаг). Когда КЛИНОК светится красным — бей!');
            break;
        }
      },
      onEvent(m, ev) {
        if (ev === 'hay' && m.step === 3) {
          m.step = 4;
          const n = nodeAt(3, 2);
          m.traitor = new Agent('target', n.x + 2, n.z + 1, { idle: true, name: 'Харун', yaw: 0.3, fight: true, hp: 2, look: { robe: '#3d2b4a', torso: '#3d2b4a', sash: '#c79a2a', hat: '#c79a2a', legs: '#2a1f17' } });
        }
      },
      onKill(m, a) { if (a === m.traitor) completeMission('Предатель мёртв. Братство гордится тобой, новичок.'); },
    },
    {
      title: 'Сборщик налогов',
      desc: 'Жестокий сборщик Абдулла грабит торговцев на рыночной площади. Устрани его и скройся от стражи.',
      start(m) {
        spawnAmbient({ civs: 22, patrols: 6 });
        const c = marketCenter;
        m.collector = new Agent('target', c.x, c.z, { y: 0.6, idle: true, name: 'Абдулла', fight: false, hp: 2, look: { robe: '#6b1f2a', torso: '#6b1f2a', sash: '#c79a2a', hat: '#e8e2d4', legs: '#2a1f17' } });
        m.collector.state = 'idle';
        for (const [dx, dz, y] of [[-3, -3, Math.PI * 1.25], [3, -3, Math.PI * 0.75], [3, 3, Math.PI * 0.25], [-3, 3, -Math.PI * 0.25]]) new Agent('guard', c.x + dx, c.z + dz, { post: true, yaw: y });
        for (let k = 0; k < 12; k++) {
          const ang = (k / 12) * Math.PI * 2 + 0.2, r = 4 + (k % 3) * 0.9;
          new Agent('civ', c.x + Math.cos(ang) * r, c.z + Math.sin(ang) * r, { idle: true, face: c });
        }
        placePlayer(new V3(-52, 0, -26), Math.PI * 0.75);
        m.step = 0;
      },
      update(m, dt) {
        const P = player;
        switch (m.step) {
          case 0:
            setObj('Доберись до рыночной площади', new V3(marketCenter.x, 0, marketCenter.z));
            setHint('Используй крыши — сверху тебя видят хуже. Внимание на ▲ над стражей.');
            if (P.pos.distanceTo(marketCenter) < 28) m.step = 1;
            break;
          case 1:
            setObj('Устрани сборщика налогов Абдуллу', m.collector);
            setHint('Смешайся с толпой зевак (СКРЫТ) или спрыгни сверху с навеса и ударь КЛИНКОМ в полёте.');
            break;
          case 2:
            setObj('Скройся от стражи', null);
            setHint('Разорви прямую видимость: беги по крышам, сверни за угол или нырни в стог сена.');
            if (!anyCombat() && !anyFlee()) { m.anon = (m.anon || 0) + dt; if (m.anon > 1.5) completeMission('Абдулла больше никого не ограбит. Торговцы свободны.'); } else m.anon = 0;
            break;
        }
      },
      onKill(m, a) {
        if (a === m.collector) {
          m.step = 2;
          for (const g of agents) if (g.alive && g.hostile && g.pos.distanceTo(a.pos) < 30) g.alarm();
        }
      },
    },
    {
      title: 'Письмо тамплиера',
      desc: 'Курьер ордена несёт письмо Великому Магистру. Укради его незаметно и доставь в бюро ассасинов.',
      start(m) {
        spawnAmbient({ civs: 26, patrols: 6 });
        const route = [[2, 3], [3, 3], [4, 3], [5, 3], [5, 4], [5, 5], [4, 5], [3, 5], [2, 5], [2, 4]].map(([k, l]) => new V3(nodeAt(k, l).x + 1.5, 0, nodeAt(k, l).z + 1.5));
        m.courier = new Agent('target', route[0].x, route[0].z, { route, speed: 1.2, fight: false, hp: 1, name: 'Курьер', fleeTo: new V3(78, 0, 50), vigilance: 0.8, look: { robe: '#8a6a2a', torso: '#e8e2d4', sash: '#a3162b', hat: '#e8e2d4', legs: '#3d3026' } });
        m.escort = new Agent('guard', route[0].x - 2, route[0].z, { leader: m.courier });
        m.escort.state = 'follow';
        placePlayer(new V3(-52, 0, -52), Math.PI * 0.75);
        m.step = 0;
      },
      update(m) {
        const P = player, c = m.courier;
        switch (m.step) {
          case 0:
            setObj('Найди курьера тамплиеров в центре города', P.eagleUsed ? c : new V3(0, 0, 0));
            setHint('Включи ОРЛИНОЕ ЗРЕНИЕ: курьер подсвечен золотым.');
            if ((P.eagle && P.pos.distanceTo(c.pos) < 70) || P.pos.distanceTo(c.pos) < 18) m.step = 1;
            break;
          case 1:
            setObj('Укради письмо у курьера', c);
            setHint(c.state === 'flee' ? 'Курьер бежит к крепости! Догони и останови его!' : 'Подойди вплотную в режиме СКРЫТ и нажми УКРАСТЬ. Не попадайся ему на глаза!');
            break;
          case 2:
            if (anyCombat()) { setObj('Оторвись от погони', null); setHint('С письмом в бюро нельзя привести хвост.'); }
            else {
              setObj('Доставь письмо в бюро ассасинов', bureau.door);
              setHint('');
              if (P.pos.distanceTo(bureau.door) < 3) completeMission('Письмо раскрывает место встречи ордена. Великий Магистр будет в крепости...');
            }
            break;
        }
      },
      context(m) {
        const c = m.courier, P = player;
        if (m.step !== 1 || !c.alive || P.state !== 'ground') return null;
        if (P.pos.distanceTo(c.pos) < 1.9) return { label: 'УКРАСТЬ', fn: () => {
          P.letter = true; m.step = 2; sfx('steal'); toast('ПИСЬМО У ТЕБЯ', 1.4);
          if (c.state !== 'flee') c.aw = Math.min(c.aw + 0.4, 0.9);
        } };
        return null;
      },
      onKill(m, a) { if (a === m.courier && m.step < 2) { P_letter(m); } },
      onEscape(m, a) { if (a === m.courier && m.step < 2) failMission('Курьер укрылся в крепости. Письмо потеряно.'); },
    },
    {
      title: 'Тени на крышах',
      desc: 'Лучники ордена держат крыши восточного квартала. Убери их и устрани капитана стражи Рашида у фонтана.',
      start(m) {
        spawnAmbient({ civs: 22, patrols: 6 });
        m.archers = [];
        for (const [i, j] of [[4, 2], [5, 2], [5, 3], [6, 3]]) {
          const L = tallestLotIn(i, j);
          if (L) m.archers.push(new Agent('archer', L.x, L.z, { y: L.h, post: true, yaw: rng() * 6.28 }));
        }
        m.total = m.archers.length;
        const f = fountainCenter;
        m.captain = new Agent('target', f.x + 4, f.z, { post: true, yaw: Math.PI / 2, fight: true, hp: 5, dmg: 2, name: 'Рашид', look: { robe: '#2a2a33', torso: '#8a8f96', arms: '#2a2a33', sash: '#c79a2a', helmet: true, sword: true, legs: '#2a2a33' } });
        new Agent('guard', f.x + 5, f.z - 2, { post: true, yaw: 0.5 });
        new Agent('guard', f.x + 5, f.z + 2, { post: true, yaw: 2.6 });
        placePlayer(new V3(-26, 0, -78), Math.PI / 4);
        m.step = 0;
      },
      update(m) {
        const P = player;
        switch (m.step) {
          case 0: {
            const left = m.archers.filter((a) => a.alive);
            const killed = m.total - left.length;
            let near = null, nd = 1e9;
            for (const a of left) { const d = a.pos.distanceTo(P.pos); if (d < nd) { nd = d; near = a; } }
            setObj(`Устрани лучников на крышах (${killed}/${m.total})`, near);
            setHint('Лучники видят крыши. Подкрадись сзади, спрыгни сверху или брось нож ✦ (наведи камеру).');
            if (!left.length) m.step = m.captain.alive ? 1 : 2;
            break;
          }
          case 1:
            setObj('Убей капитана стражи Рашида', m.captain);
            setHint('Рашид силён в бою (бьёт по 2). Лучше убить скрытно — или жди «!» и жми КОНТР.');
            break;
          case 2:
            setObj('Скройся от стражи', null);
            setHint('');
            if (!anyCombat()) completeMission('Крыши снова принадлежат Братству.');
            break;
        }
      },
      onKill(m, a) { if (a === m.captain && m.step === 1) m.step = 2; },
    },
    {
      title: 'Великий Магистр',
      desc: 'Финал. Проникни в крепость тамплиеров, убей Великого Магистра и уйди живым. Запретная зона — стража бдительна вдвойне.',
      start(m) {
        spawnAmbient({ civs: 20, patrols: 6 });
        for (const [x, z] of [[66, 56.8], [90, 56.8], [56.8, 66], [56.8, 90], [99.2, 70], [78, 99.2]]) new Agent('archer', x, z, { y: 9, post: true, yaw: rng() * 6.28 });
        new Agent('guard', 78, 62, { inner: true });
        new Agent('guard', 62, 78, { inner: true });
        new Agent('guard', 94, 78, { inner: true });
        m.master = new Agent('target', 78, 91, { post: true, yaw: 0, fight: true, hp: 6, dmg: 2, name: 'Великий Магистр', look: { robe: '#e8e2d4', torso: '#e8e2d4', arms: '#e8e2d4', sash: '#a3162b', legs: '#5a5f66', sword: true } });
        new Agent('guard', 76, 92.5, { post: true, yaw: -0.4, hp: 4, look: LOOKS.elite });
        new Agent('guard', 80, 92.5, { post: true, yaw: 0.4, hp: 4, look: LOOKS.elite });
        placePlayer(new V3(nodeAt(6, 5).x, 0, nodeAt(6, 5).z), Math.PI / 2);
        m.step = 0;
      },
      update(m) {
        const P = player, inside = inRestricted(P.pos.x, P.pos.z);
        switch (m.step) {
          case 0:
            setObj('Проникни в крепость тамплиеров', new V3(78, 9, 56.8));
            setHint('Ворота охраняют. Перелезь через стену — но на стенах лучники. В крепости тебя замечают быстрее!');
            if (inside) m.step = 1;
            break;
          case 1:
            setObj('Убей Великого Магистра', m.master);
            setHint('Магистр у южной стены цитадели. Удар сверху со стены или крыши — лучший способ.');
            break;
          case 2:
            setObj('Покинь крепость', null);
            setHint('Беги к стенам и перелезай наружу!');
            if (!inside) m.step = 3;
            break;
          case 3:
            setObj('Скройся от погони', null);
            setHint('');
            if (!anyCombat()) completeMission('Великий Магистр мёртв. Ничто не истинно — всё дозволено.');
            break;
        }
      },
      onKill(m, a) {
        if (a === m.master) {
          m.step = 2;
          toast('ЦЕЛЬ УСТРАНЕНА', 1.5);
          for (const g of agents) if (g.alive && g.hostile && inRestricted(g.pos.x, g.pos.z)) g.alarm();
        }
      },
    },
  ];
  function P_letter(m) { player.letter = true; m.step = 2; toast('ПИСЬМО ДОБЫТО', 1.4); }
  const FREE = {
    title: 'Свободный город',
    start(m) { spawnAmbient({ civs: 28, patrols: 10 }); placePlayer(bureau.spawn, Math.PI / 2); },
    update(m) {
      const n = towers.filter((t) => t.synced).length;
      let near = null, nd = 1e9;
      for (const t of towers) if (!t.synced) { const d = dist2(t.x, t.z, player.pos.x, player.pos.z); if (d < nd) { nd = d; near = t; } }
      setObj(`Синхронизируй башни обзора (${n}/${towers.length})`, near ? new V3(near.x, near.h, near.z) : null);
      setHint('');
      if (!near) completeMission('Весь город как на ладони. Ты — истинный мастер паркура.');
    },
  };

  // ================= Прогресс =================
  function loadProgress() { try { return parseInt(localStorage.getItem('sa_progress') || '0', 10) || 0; } catch (e) { return 0; } }
  function saveProgress(v) { try { localStorage.setItem('sa_progress', String(v)); } catch (e) { /* хранилище недоступно */ } }

  function startMission(idx) {
    audioInit(); startAmbient();
    clearWorld();
    Game.missionIndex = idx;
    Game.runId = (Game.runId || 0) + 1;
    const def = idx < 0 ? FREE : MISSIONS[idx];
    Game.mission = { def, step: 0, obj: '', hint: '', target: null };
    Game.stats = { kills: 0, alarms: 0, time: 0 };
    def.start(Game.mission);
    Game.mode = 'play'; Game.paused = false; Game.timeScale = 1; Game.slowT = 0;
    lastHp = -1;
    showScreen(null);
    $('hud').classList.remove('hidden'); $('touch').classList.remove('hidden');
    toast(def.title.toUpperCase(), 2.2);
  }
  function completeMission(text) {
    if (Game.mode !== 'play') return;
    Game.mode = 'end';
    sfx('win');
    if (Game.missionIndex >= 0) saveProgress(Math.max(loadProgress(), Game.missionIndex + 1));
    const t = Math.round(Game.stats.time);
    $('endTitle').textContent = 'ПАМЯТЬ СИНХРОНИЗИРОВАНА';
    $('endText').innerHTML = `${text}<br><br>Время: ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')} · Устранено: ${Game.stats.kills} · Тревог: ${Game.stats.alarms}`;
    $('btnEndNext').classList.toggle('hidden', !(Game.missionIndex >= 0 && Game.missionIndex < MISSIONS.length - 1));
    const run = Game.runId;
    setTimeout(() => { if (Game.runId === run && Game.mode === 'end') showScreen('endMenu'); }, 700);
  }
  function failMission(text) {
    if (Game.mode !== 'play') return;
    Game.mode = 'end';
    sfx('fail');
    $('endTitle').textContent = 'ДЕСИНХРОНИЗАЦИЯ';
    $('endText').textContent = text;
    $('btnEndNext').classList.add('hidden');
    const run = Game.runId;
    setTimeout(() => { if (Game.runId === run && Game.mode === 'end') showScreen('endMenu'); }, 500);
  }
  function endMission(win, text) { if (win) completeMission(text); else failMission(text); }

  // ================= Меню =================
  const SCREENS = ['mainMenu', 'missionMenu', 'helpMenu', 'pauseMenu', 'endMenu'];
  let menuBack = 'mainMenu';
  function showScreen(id) {
    for (const s of SCREENS) $(s).classList.toggle('hidden', s !== id);
    if (id === 'mainMenu' || id === 'missionMenu' || id === 'helpMenu') { $('hud').classList.add('hidden'); $('touch').classList.add('hidden'); }
    if (id === 'missionMenu') buildMissionList();
  }
  function buildMissionList() {
    const prog = loadProgress();
    const el = $('missionList');
    el.innerHTML = '';
    MISSIONS.forEach((m, i) => {
      const d = document.createElement('div');
      d.className = 'mcard' + (i > prog ? ' locked' : '') + (i < prog ? ' done' : '');
      d.innerHTML = `<h3>${i + 1}. ${m.title}</h3><p>${m.desc}</p>`;
      const b = document.createElement('button');
      b.textContent = i > prog ? 'ЗАКРЫТО' : 'НАЧАТЬ';
      b.disabled = i > prog;
      b.onclick = () => startMission(i);
      d.appendChild(b);
      el.appendChild(d);
    });
  }
  function goMenu() {
    Game.runId = (Game.runId || 0) + 1;
    Game.mode = 'menu'; Game.mission = null; Game.paused = false;
    clearWorld();
    spawnAmbient({ civs: 26, patrols: 6 });
    placePlayer(bureau.spawn, 0);
    player.hidden = true;
    player.h.root.visible = false;
    playerBlob.visible = false;
    marker.visible = false;
    showScreen('mainMenu');
  }
  function pause(on) {
    if (Game.mode !== 'play') return;
    Game.paused = on;
    if (on) {
      $('pauseObjective').textContent = Game.mission ? Game.mission.obj : '';
      showScreen('pauseMenu');
      if (document.exitPointerLock) document.exitPointerLock();
    } else { showScreen(null); $('hud').classList.remove('hidden'); $('touch').classList.remove('hidden'); }
  }
  $('btnPlay').onclick = () => { audioInit(); showScreen('missionMenu'); };
  $('btnFree').onclick = () => startMission(-1);
  $('btnHelp').onclick = () => { audioInit(); showScreen('helpMenu'); };
  document.querySelectorAll('[data-back]').forEach((b) => (b.onclick = () => showScreen('mainMenu')));
  $('btnResume').onclick = () => pause(false);
  $('btnRestart').onclick = () => startMission(Game.missionIndex);
  $('btnQuit').onclick = goMenu;
  $('btnEndNext').onclick = () => startMission(Game.missionIndex + 1);
  $('btnEndRetry').onclick = () => startMission(Game.missionIndex);
  $('btnEndMenu').onclick = goMenu;
  window.onAppPause = () => pause(true);
  window.onBackButton = () => {
    if (Game.mode === 'play') { pause(!Game.paused); return true; }
    if (!$('missionMenu').classList.contains('hidden') || !$('helpMenu').classList.contains('hidden')) { showScreen('mainMenu'); return true; }
    if (Game.mode === 'end') { goMenu(); return true; }
    return false;
  };

  // ================= Ввод: сенсор =================
  const touchEl = $('touch');
  const stickBase = $('stickBase'), stickKnob = $('stickKnob');
  let stickId = null, stickOX = 0, stickOY = 0;
  const camPtrs = new Map();
  const btnPtrs = new Map();
  const BTN = { bBlade: 'blade', bFree: 'free', bJump: 'jump', bBlock: 'block', bKnife: 'knife', bEagle: 'eagle', bBlend: 'blend', bAct: 'act', bPause: 'pause' };
  function btnDown(id, pid) {
    const a = BTN[id];
    if (!a) return;
    btnPtrs.set(pid, a);
    if (a === 'free') input.free = true;
    else if (a === 'jump') { input.jumpHeld = true; input.pressed.add('jump'); }
    else input.pressed.add(a);
  }
  function btnUp(pid) {
    const a = btnPtrs.get(pid);
    btnPtrs.delete(pid);
    if (a === 'free' && ![...btnPtrs.values()].includes('free')) input.free = !!input.keys.ShiftLeft || !!input.keys.ShiftRight;
    if (a === 'jump' && ![...btnPtrs.values()].includes('jump')) input.jumpHeld = !!input.keys.Space;
  }
  touchEl.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    audioInit();
    const b = e.target.closest('.tbtn');
    if (b) { btnDown(b.id, e.pointerId); return; }
    if (e.pointerType === 'mouse') {
      if (!document.pointerLockElement && touchEl.requestPointerLock) { touchEl.requestPointerLock(); return; }
      if (e.button === 0) input.pressed.add('blade');
      if (e.button === 2) input.pressed.add('block');
      return;
    }
    if (e.clientX < window.innerWidth * 0.42 && stickId === null) {
      stickId = e.pointerId; stickOX = e.clientX; stickOY = e.clientY;
      input.stickActive = true;
      stickBase.classList.remove('hidden'); stickKnob.classList.remove('hidden');
      stickBase.style.left = stickOX - 65 + 'px'; stickBase.style.top = stickOY - 65 + 'px';
      stickKnob.style.left = stickOX - 28 + 'px'; stickKnob.style.top = stickOY - 28 + 'px';
    } else camPtrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  }, { passive: false });
  touchEl.addEventListener('pointermove', (e) => {
    if (e.pointerId === stickId) {
      let dx = e.clientX - stickOX, dy = e.clientY - stickOY;
      const l = Math.hypot(dx, dy), R = 60;
      if (l > R) { dx *= R / l; dy *= R / l; }
      input.mx = dx / R; input.my = -dy / R;
      stickKnob.style.left = stickOX + dx - 28 + 'px'; stickKnob.style.top = stickOY + dy - 28 + 'px';
    } else if (camPtrs.has(e.pointerId)) {
      const p = camPtrs.get(e.pointerId);
      input.camDX += (e.clientX - p.x) * 1.1; input.camDY += (e.clientY - p.y) * 1.1;
      p.x = e.clientX; p.y = e.clientY;
    }
  });
  function ptrEnd(e) {
    if (e.pointerId === stickId) {
      stickId = null; input.mx = 0; input.my = 0; input.stickActive = false;
      stickBase.classList.add('hidden'); stickKnob.classList.add('hidden');
    }
    camPtrs.delete(e.pointerId);
    btnUp(e.pointerId);
  }
  touchEl.addEventListener('pointerup', ptrEnd);
  touchEl.addEventListener('pointercancel', ptrEnd);
  touchEl.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement === touchEl) { input.camDX += e.movementX; input.camDY += e.movementY; }
  });

  // ================= Ввод: клавиатура =================
  const KEYACT = { KeyJ: 'blade', KeyK: 'block', KeyF: 'knife', KeyQ: 'eagle', KeyC: 'blend', KeyE: 'act' };
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    input.keys[e.code] = true;
    if (e.code === 'Escape') { if (Game.mode === 'play') pause(!Game.paused); return; }
    if (e.code === 'Space') { input.jumpHeld = true; input.pressed.add('jump'); e.preventDefault(); }
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') input.free = true;
    if (KEYACT[e.code]) input.pressed.add(KEYACT[e.code]);
  });
  window.addEventListener('keyup', (e) => {
    input.keys[e.code] = false;
    if (e.code === 'Space') input.jumpHeld = false;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') input.free = [...btnPtrs.values()].includes('free');
  });
  function keyboardMove() {
    if (input.stickActive) return;
    const k = input.keys;
    const x = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0), y = (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0);
    if (x || y) { const l = Math.hypot(x, y); input.mx = x / l; input.my = y / l; input.kbMove = true; }
    else if (input.kbMove) { input.mx = 0; input.my = 0; input.kbMove = false; }
  }

  // ================= Главный цикл =================
  function update(dt) {
    keyboardMove();
    const P = player;
    Game.alertCD -= dt;
    Game.stats.time += dt;
    if (took('pause')) { pause(true); return; }
    if (took('eagle')) setEagle(!P.eagle);
    if (took('blend')) P.blend = !P.blend;
    if (took('knife')) knifeAction();
    if (took('blade')) bladeAction();
    if (took('block')) blockAction();
    if (took('act') && Game.ctx) Game.ctx.fn();
    updatePlayer(dt);
    for (let i = 0; i < agents.length; i++) agents[i].update(dt);
    for (let i = agents.length - 1; i >= 0; i--) {
      const a = agents[i];
      if (!a.alive && a.deadT > 40) { a.remove(); agents.splice(i, 1); }
    }
    updateProjectiles(dt);
    if (Game.mission && Game.mode === 'play') Game.mission.def.update(Game.mission, dt);
    for (const t of towers) t.flag.rotation.y = Math.sin(performance.now() / 400 + t.x) * 0.3;
  }

  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const rdt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (Game.mode === 'play' && !Game.paused) {
      if (Game.slowT > 0) { Game.slowT -= rdt; Game.timeScale = 0.3; } else Game.timeScale = 1;
      const dt = rdt * Game.timeScale;
      update(dt);
      updateCamera(rdt);
      updateHUD(rdt);
      input.pressed.clear();
    } else if (Game.mode === 'end') {
      for (const a of agents) a.update(rdt * 0.5);
      input.mx = input.my = 0; input.pressed.clear();
      updatePlayer(rdt);
      updateCamera(rdt);
    } else if (Game.mode === 'menu') {
      Game.menuT += rdt;
      for (const a of agents) a.update(rdt);
      const t = Game.menuT * 0.05;
      camera.position.set(Math.sin(t) * 70, 38, Math.cos(t) * 70);
      camera.lookAt(0, 5, 0);
    }
    renderer.render(scene, camera);
  }
  if (/[?&]debug/.test(location.search)) window.__dbg = { player, agents, towers, hays, Game, cam, input, startMission, groundAt, bureau, nodes, nodeAt };
  goMenu();
  requestAnimationFrame(frame);
})();
