'use strict';
/* Город: коллизии, генерация застройки, небо, свет, растительность, навигация. */
(function (SA) {
  const THREE = window.THREE, U = SA.U, V3 = THREE.Vector3;
  const W = (SA.world = {});
  const rng = SA.rng;
  const pick = (a) => U.pick(a, rng);

  // ================= Коллизии =================
  const STEP = (W.STEP = 0.65);
  const colliders = (W.colliders = []);
  const GRID = 8, GOFF = 136, GN = 34;
  const buckets = new Array(GN * GN);
  const EMPTY = [];
  W.addCollider = function (x0, y0, z0, x1, y1, z1, o) {
    o = o || {};
    const c = { x0, y0, z0, x1, y1, z1, climb: o.climb !== false, thin: !!o.thin, kind: o.kind || '' };
    colliders.push(c);
    const i0 = Math.floor((x0 - 1 + GOFF) / GRID), i1 = Math.floor((x1 + 1 + GOFF) / GRID);
    const j0 = Math.floor((z0 - 1 + GOFF) / GRID), j1 = Math.floor((z1 + 1 + GOFF) / GRID);
    for (let i = Math.max(0, i0); i <= Math.min(GN - 1, i1); i++)
      for (let j = Math.max(0, j0); j <= Math.min(GN - 1, j1); j++) (buckets[i * GN + j] || (buckets[i * GN + j] = [])).push(c);
    return c;
  };
  const bucket = (W.bucket = function (x, z) {
    const i = Math.floor((x + GOFF) / GRID), j = Math.floor((z + GOFF) / GRID);
    if (i < 0 || j < 0 || i >= GN || j >= GN) return EMPTY;
    return buckets[i * GN + j] || EMPTY;
  });
  W.groundAt = function (x, z, y, skipThin) {
    let best = 0;
    const list = bucket(x, z);
    for (let k = 0; k < list.length; k++) {
      const c = list[k];
      if (skipThin && c.thin) continue;
      if (x >= c.x0 - 0.12 && x <= c.x1 + 0.12 && z >= c.z0 - 0.12 && z <= c.z1 + 0.12 && c.y1 <= y + STEP && c.y1 > best) best = c.y1;
    }
    return best;
  };
  W.pushOut = function (p, r, y, h) {
    let best = null, bestPen = 0;
    const list = bucket(p.x, p.z);
    for (let k = 0; k < list.length; k++) {
      const c = list[k];
      if (c.y1 <= y + STEP || c.y0 >= y + h) continue;
      const qx = U.clamp(p.x, c.x0, c.x1), qz = U.clamp(p.z, c.z0, c.z1);
      const dx = p.x - qx, dz = p.z - qz, d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      let nx, nz, pen;
      if (d2 > 1e-9) { const d = Math.sqrt(d2); nx = dx / d; nz = dz / d; pen = r - d; }
      else {
        const l = p.x - c.x0, rr = c.x1 - p.x, b = p.z - c.z0, f = c.z1 - p.z, m = Math.min(l, rr, b, f);
        if (m === l) { nx = -1; nz = 0; pen = l + r; } else if (m === rr) { nx = 1; nz = 0; pen = rr + r; } else if (m === b) { nx = 0; nz = -1; pen = b + r; } else { nx = 0; nz = 1; pen = f + r; }
      }
      p.x += nx * pen; p.z += nz * pen;
      if (pen > bestPen) { bestPen = pen; best = { c, nx, nz }; }
    }
    return best;
  };
  function slab(o, d, mn, mx, t) {
    if (Math.abs(d) < 1e-9) return o < mn || o > mx ? null : t;
    let t1 = (mn - o) / d, t2 = (mx - o) / d;
    if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
    if (t1 > t[0]) t[0] = t1;
    if (t2 < t[1]) t[1] = t2;
    return t[0] > t[1] ? null : t;
  }
  const _t = [0, 1];
  W.segHit = function (ax, ay, az, bx, by, bz) {
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
  };
  W.losClear = (ax, ay, az, bx, by, bz) => W.segHit(ax, ay, az, bx, by, bz) >= 0.999;
  W.pointInSolid = function (x, y, z) {
    const list = bucket(x, z);
    for (let k = 0; k < list.length; k++) {
      const c = list[k];
      if (x > c.x0 && x < c.x1 && z > c.z0 && z < c.z1 && y > c.y0 && y < c.y1) return true;
    }
    return false;
  };

  // ================= Склейка геометрии по чанкам =================
  const _v = new V3(), _n = new V3(), _m3 = new THREE.Matrix3();
  class GB {
    constructor(uvScale) { this.p = []; this.n = []; this.u = []; this.c = []; this.i = []; this.s = uvScale || 0.25; }
    vert(x, y, z, nx, ny, nz, u, v, col, f) {
      this.p.push(x, y, z); this.n.push(nx, ny, nz); this.u.push(u, v);
      this.c.push(col.r * f, col.g * f, col.b * f);
    }
    quad(a, b, c, d, nx, ny, nz, uv, col, fb, ft) {
      const k = this.p.length / 3;
      this.vert(a[0], a[1], a[2], nx, ny, nz, uv[0], uv[1], col, fb);
      this.vert(b[0], b[1], b[2], nx, ny, nz, uv[2], uv[3], col, fb);
      this.vert(c[0], c[1], c[2], nx, ny, nz, uv[4], uv[5], col, ft);
      this.vert(d[0], d[1], d[2], nx, ny, nz, uv[6], uv[7], col, ft);
      this.i.push(k, k + 1, k + 2, k, k + 2, k + 3);
    }
    // faces: строка из px nx pz nz py ny; по умолчанию все кроме низа
    box(x0, y0, z0, x1, y1, z1, col, o) {
      o = o || {};
      const f = o.faces || 'px nx pz nz py', S = this.s;
      const ao = o.ao ? 0.62 : 1, top = o.topCol || col;
      if (f.includes('px')) this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], 1, 0, 0, [-z1 * S, y0 * S, -z0 * S, y0 * S, -z0 * S, y1 * S, -z1 * S, y1 * S], col, ao, 1);
      if (f.includes('nx')) this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], -1, 0, 0, [z0 * S, y0 * S, z1 * S, y0 * S, z1 * S, y1 * S, z0 * S, y1 * S], col, ao, 1);
      if (f.includes('pz')) this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], 0, 0, 1, [x0 * S, y0 * S, x1 * S, y0 * S, x1 * S, y1 * S, x0 * S, y1 * S], col, ao, 1);
      if (f.includes('nz')) this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], 0, 0, -1, [-x1 * S, y0 * S, -x0 * S, y0 * S, -x0 * S, y1 * S, -x1 * S, y1 * S], col, ao, 1);
      if (f.includes('py')) this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], 0, 1, 0, [x0 * S, -z1 * S, x1 * S, -z1 * S, x1 * S, -z0 * S, x0 * S, -z0 * S], top, 1, 1);
      if (f.includes('ny')) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], 0, -1, 0, [x0 * S, z0 * S, x1 * S, z0 * S, x1 * S, z1 * S, x0 * S, z1 * S], col, 1, 1);
    }
    // Произвольная геометрия; uv: 'keep' или мировые планарные
    geo(g, m, col, uvMode) {
      const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
      _m3.getNormalMatrix(m);
      const k = this.p.length / 3, S = this.s;
      for (let j = 0; j < pos.count; j++) {
        _v.fromBufferAttribute(pos, j).applyMatrix4(m);
        _n.fromBufferAttribute(nor, j).applyMatrix3(_m3).normalize();
        let u, v;
        if (uvMode === 'keep' && uv) { u = uv.getX(j); v = uv.getY(j); }
        else {
          const ax = Math.abs(_n.x), ay = Math.abs(_n.y), az = Math.abs(_n.z);
          if (ay > ax && ay > az) { u = _v.x * S; v = _v.z * S; } else if (ax > az) { u = _v.z * S; v = _v.y * S; } else { u = _v.x * S; v = _v.y * S; }
        }
        const sh = typeof col === 'function' ? col(_v, j) : col;
        this.p.push(_v.x, _v.y, _v.z); this.n.push(_n.x, _n.y, _n.z); this.u.push(u, v); this.c.push(sh.r, sh.g, sh.b);
      }
      if (g.index) for (let j = 0; j < g.index.count; j++) this.i.push(k + g.index.getX(j));
      else for (let j = 0; j < pos.count; j++) this.i.push(k + j);
    }
    mesh(mat) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
      g.setIndex(this.i);
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat);
      m.matrixAutoUpdate = false;
      return m;
    }
  }
  W.GB = GB;
  const CH = 52;
  const builders = new Map();
  const UVS = { plaster: 0.25, plaster2: 0.25, roof: 0.25, stone: 0.25, wood: 0.5, dark: 1, hay: 0.5, tiles: 0.5, terracotta: 0.5, foliage: 1, frond: 1, water: 0.2, cloth: 1, rug: 1, metal: 1 };
  function B(mat, x, z) {
    const key = mat + '|' + Math.floor((x + 260) / CH) + '|' + Math.floor((z + 260) / CH);
    let b = builders.get(key);
    if (!b) { b = new GB(UVS[mat.split(':')[0]] || 0.25); b.mat = mat; builders.set(key, b); }
    return b;
  }
  const C = (h) => new THREE.Color(h);
  const tint = (c, f) => c.clone().multiplyScalar(f);
  const M4 = () => new THREE.Matrix4();
  const mtx = (x, y, z, ry, rx, rz, sx, sy, sz) => {
    const m = new THREE.Matrix4();
    m.compose(new V3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx || 0, ry || 0, rz || 0, 'YXZ')), new V3(sx || 1, sy || sx || 1, sz || sx || 1));
    return m;
  };

  // ---------- Общие геометрии-примитивы ----------
  const GEO = {
    arch: new THREE.CircleGeometry(1, 8, 0, Math.PI),
    cyl8: new THREE.CylinderGeometry(1, 1, 1, 8, 1),
    cyl12: new THREE.CylinderGeometry(1, 1, 1, 12, 1),
    cyl16o: new THREE.CylinderGeometry(1, 1, 1, 16, 1, true),
    sphere: new THREE.SphereGeometry(1, 10, 7),
    hemi: new THREE.SphereGeometry(1, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    ico: new THREE.IcosahedronGeometry(1, 1),
    cone8: new THREE.ConeGeometry(1, 1, 8),
    plane: new THREE.PlaneGeometry(1, 1),
    box: new THREE.BoxGeometry(1, 1, 1),
    amphora: new THREE.LatheGeometry([[0, 0], [0.12, 0.02], [0.2, 0.15], [0.22, 0.32], [0.17, 0.5], [0.08, 0.6], [0.09, 0.68], [0.11, 0.7]].map(([a, b]) => new THREE.Vector2(a, b)), 10),
    pot: new THREE.LatheGeometry([[0, 0], [0.18, 0.02], [0.25, 0.18], [0.22, 0.34], [0.24, 0.38]].map(([a, b]) => new THREE.Vector2(a, b)), 10),
    barrel: new THREE.LatheGeometry([[0, 0], [0.32, 0], [0.37, 0.2], [0.39, 0.45], [0.37, 0.7], [0.32, 0.9], [0, 0.9]].map(([a, b]) => new THREE.Vector2(a, b)), 12),
  };

  // ================= Планировка =================
  const CELL = (W.CELL = 26);
  const cellCenter = (W.cellCenter = (i) => (i - 3.5) * CELL);
  const SPECIAL = { '3,4': 'market', '4,4': 'fountain', '2,2': 'garden' };
  const TOWER_CELLS = [[1, 1], [5, 1], [1, 5], [4, 6]];
  const MOSQUE = [5, 5];
  const FORT = (W.FORT = { x0: 56, x1: 100, z0: 56, z1: 100 });
  W.inRestricted = (x, z) => x > FORT.x0 + 1.6 && x < FORT.x1 - 1.6 && z > FORT.z0 + 1.6 && z < FORT.z1 - 1.6;
  const isFortressCell = (i, j) => i >= 6 && j >= 6;
  const lots = (W.lots = {});
  const roofParts = (W.roofParts = {});
  const buildings = [];
  const towers = (W.towers = []);
  const hides = (W.hides = []);
  const benches = (W.benches = []);
  const animated = (W.animated = []);
  const PROPS = SA.Q.props;
  const lotKey = (W.lotKey = (i, j, a, b) => i + ',' + j + ',' + a + ',' + b);

  const WALL_TINTS = ['#fff6e6', '#f3e2c4', '#ffe9cc', '#efd7b4', '#f7ead6', '#e9cfa8', '#fbe3c6', '#e0c6a0'].map(C);
  const ROOF_TINTS = ['#e8d3b0', '#d9c19c', '#efdcbc', '#cfb38a'].map(C);
  const STONE = C('#f0e4d0'), WOOD = C('#a07a58'), WOOD_D = C('#6e4e34'), WHITE = C('#ffffff'), DARK = C('#ffffff');
  const TERRA = ['#b8643c', '#a85a36', '#c47a4c', '#9e6a48'].map(C);

  // ---------- Здание ----------
  function building(x0, z0, x1, z1, h, o) {
    o = o || {};
    const tintC = o.tint || pick(WALL_TINTS), mat = o.mat || (rng() < 0.5 ? 'plaster' : 'plaster2');
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const b = B(mat, cx, cz);
    b.box(x0, 0, z0, x1, h, z1, tintC, { faces: 'px nx pz nz', ao: true });
    // цоколь
    B('stone', cx, cz).box(x0 - 0.05, 0, z0 - 0.05, x1 + 0.05, 0.42, z1 + 0.05, tint(STONE, 0.85), { faces: 'px nx pz nz py' });
    // крыша, карниз и парапет
    const rc = o.roof || pick(ROOF_TINTS);
    B('roof', cx, cz).box(x0, h - 0.02, z0, x1, h, z1, rc, { faces: 'py' });
    const cor = tint(tintC, 0.92);
    b.box(x0 - 0.1, h - 0.28, z0 - 0.1, x1 + 0.1, h - 0.12, z1 + 0.1, cor, { faces: 'px nx pz nz py ny' });
    if (!o.noParapet) {
      const t = 0.2, ph = 0.45 + (rng() < 0.3 ? 0.3 : 0);
      b.box(x0, h, z0, x1, h + ph, z0 + t, cor, { faces: 'px nx pz nz py' });
      b.box(x0, h, z1 - t, x1, h + ph, z1, cor, { faces: 'px nx pz nz py' });
      b.box(x0, h, z0 + t, x0 + t, h + ph, z1 - t, cor, { faces: 'px nx py' });
      b.box(x1 - t, h, z0 + t, x1, h + ph, z1 - t, cor, { faces: 'px nx py' });
    }
    // межэтажный поясок
    if (h > 6.5 && rng() < 0.6) b.box(x0 - 0.05, 3.1, z0 - 0.05, x1 + 0.05, 3.22, z1 + 0.05, cor, { faces: 'px nx pz nz py ny' });
    W.addCollider(x0, 0, z0, x1, h, z1, { kind: 'building' });
    const bd = { x0, z0, x1, z1, h, tint: tintC, mat };
    buildings.push(bd);
    if (o.cellKey) (roofParts[o.cellKey] || (roofParts[o.cellKey] = [])).push({ x: cx, z: cz, h, w: x1 - x0, d: z1 - z0 });
    return bd;
  }

  // ---------- Детали фасада ----------
  // Сторона: ax 'x'|'z', sg ±1, pl — координата плоскости, s0..s1 — диапазон вдоль стены
  function sideMap(sd, s, out) { return sd.ax === 'x' ? [sd.pl + sd.sg * out, s] : [s, sd.pl + sd.sg * out]; }
  function fbox(b, sd, s0, s1, y0, y1, o0, o1, col, faces) {
    const [ax0, az0] = sideMap(sd, s0, o0), [ax1, az1] = sideMap(sd, s1, o1);
    const x0 = Math.min(ax0, ax1), x1 = Math.max(ax0, ax1), z0 = Math.min(az0, az1), z1 = Math.max(az0, az1);
    let f = faces;
    if (!f) {
      const back = sd.ax === 'x' ? (sd.sg > 0 ? 'nx' : 'px') : (sd.sg > 0 ? 'nz' : 'pz');
      f = ['px', 'nx', 'pz', 'nz', 'py', 'ny'].filter((k) => k !== back).join(' ');
    } else if (f === 'front') f = sd.ax === 'x' ? (sd.sg > 0 ? 'px' : 'nx') : (sd.sg > 0 ? 'pz' : 'nz');
    b.box(x0, y0, z0, x1, y1, z1, col, { faces: f });
  }
  function sideYaw(sd) { return sd.ax === 'x' ? (sd.sg > 0 ? Math.PI / 2 : -Math.PI / 2) : (sd.sg > 0 ? 0 : Math.PI); }
  function archAt(b, sd, s, y, out, r, col) {
    const [x, z] = sideMap(sd, s, out);
    b.geo(GEO.arch, mtx(x, y, z, sideYaw(sd), 0, 0, r, r, 1), col);
  }
  function neighborHeight(sd, s) {
    const [x, z] = sideMap(sd, s, 0.4);
    let h = 0;
    for (const c of bucket(x, z)) if (c.kind === 'building' && x > c.x0 && x < c.x1 && z > c.z0 && z < c.z1) h = Math.max(h, c.y1);
    return h;
  }
  function decorate(bd) {
    const { x0, z0, x1, z1, h } = bd;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const sides = [
      { ax: 'x', sg: 1, pl: x1, s0: z0, s1: z1 }, { ax: 'x', sg: -1, pl: x0, s0: z0, s1: z1 },
      { ax: 'z', sg: 1, pl: z1, s0: x0, s1: x1 }, { ax: 'z', sg: -1, pl: z0, s0: x0, s1: x1 },
    ];
    const floors = Math.max(1, Math.floor((h - 0.5) / 3.2));
    const wB = B(bd.mat, cx, cz), dk = B('dark', cx, cz), wd = B('wood', cx, cz), st = B('stone', cx, cz);
    const frame = tint(bd.tint, 0.86);
    let doors = 0;
    for (const sd of sides) {
      const L = sd.s1 - sd.s0;
      if (L < 2.5) continue;
      const n = Math.max(1, Math.floor((L - 0.8) / 2.7)), sp = L / n;
      const beams = rng() < 0.25 * PROPS;
      for (let k = 0; k < n; k++) {
        const s = sd.s0 + sp * (k + 0.5);
        const nh = neighborHeight(sd, s);
        for (let f = 0; f < floors; f++) {
          const yb = f * 3.2;
          if (yb + 1.2 < nh) continue;
          if (f === 0) {
            if (nh === 0 && doors < 2 && rng() < 0.3) {
              doors++;
              fbox(dk, sd, s - 0.6, s + 0.6, 0.15, 2.2, 0, 0.02, DARK, 'front');
              archAt(dk, sd, s, 2.2, 0.02, 0.6, DARK);
              if (rng() < 0.7) fbox(wd, sd, s - 0.55, s + 0.55, 0.15, 2.15, 0.03, 0.07, tint(WOOD, 0.8 + rng() * 0.3));
              fbox(st, sd, s - 0.78, s - 0.6, 0, 2.25, 0, 0.1, STONE);
              fbox(st, sd, s + 0.6, s + 0.78, 0, 2.25, 0, 0.1, STONE);
              fbox(st, sd, s - 0.85, s + 0.85, 0, 0.15, 0, 0.45, tint(STONE, 0.9));
              if (rng() < 0.3 * PROPS) awningAt(sd, s, 2.95, 1.8, 1.1);
            } else if (rng() < 0.35) {
              fbox(dk, sd, s - 0.3, s + 0.3, 1.6, 2.3, 0, 0.02, DARK, 'front');
              for (let g = -1; g <= 1; g++) fbox(wd, sd, s + g * 0.18 - 0.02, s + g * 0.18 + 0.02, 1.6, 2.3, 0.02, 0.05, WOOD_D, 'front');
            }
            continue;
          }
          const r = rng();
          if (r < 0.06 * PROPS && L > 3.5 && yb + 3 < h) {
            // машрабия — деревянный эркер
            fbox(wd, sd, s - 0.85, s + 0.85, yb + 0.6, yb + 2.6, 0, 0.6, tint(WOOD, 0.75));
            fbox(dk, sd, s - 0.7, s + 0.7, yb + 0.9, yb + 2.3, 0.6, 0.62, DARK, 'front');
            for (let g = -3; g <= 3; g++) fbox(wd, sd, s + g * 0.2 - 0.02, s + g * 0.2 + 0.02, yb + 0.9, yb + 2.3, 0.62, 0.65, WOOD_D, 'front');
            for (let g = 0; g < 4; g++) fbox(wd, sd, s - 0.7, s + 0.7, yb + 1.05 + g * 0.35, yb + 1.09 + g * 0.35, 0.62, 0.65, WOOD_D, 'front');
            fbox(wd, sd, s - 0.95, s + 0.95, yb + 2.6, yb + 2.75, 0, 0.75, WOOD_D);
          } else if (r < 0.62) {
            fbox(dk, sd, s - 0.36, s + 0.36, yb + 1.0, yb + 2.15, 0, 0.02, DARK, 'front');
            archAt(dk, sd, s, yb + 2.15, 0.02, 0.36, DARK);
            fbox(wB, sd, s - 0.5, s + 0.5, yb + 0.9, yb + 1.0, 0, 0.12, frame);
            fbox(wB, sd, s - 0.46, s - 0.36, yb + 1.0, yb + 2.2, 0, 0.05, frame, 'front');
            fbox(wB, sd, s + 0.36, s + 0.46, yb + 1.0, yb + 2.2, 0, 0.05, frame, 'front');
            if (rng() < 0.35) {
              const sc = tint(pick([C('#4f6b5a'), C('#3d5670'), WOOD, C('#7a4a32')]), 0.8 + rng() * 0.3);
              fbox(wd, sd, s - 0.85, s - 0.47, yb + 1.0, yb + 2.3, 0, 0.04, sc);
              fbox(wd, sd, s + 0.47, s + 0.85, yb + 1.0, yb + 2.3, 0, 0.04, sc);
            }
            if (rng() < 0.12 * PROPS) potAt(sd, s, yb + 1.0, 0.08);
            if (rng() < 0.08 * PROPS && L > 3) balconyAt(sd, s, yb + 0.85);
          }
          if (beams && f === floors - 1) for (const o of [-0.9, 0.9]) fbox(wd, sd, s + o - 0.08, s + o + 0.08, yb + 2.7, yb + 2.86, 0, 0.55, WOOD_D);
        }
        if (nh === 0 && rng() < 0.22 * PROPS) streetProps(sd, s);
      }
    }
    roofDecor(bd);
  }
  function awningAt(sd, s, y, w, depth) {
    const [x, z] = sideMap(sd, s, depth / 2);
    const tex = Math.floor(rng() * SA.tex.awnings.length);
    const m = mtx(x, y - 0.25, z, sideYaw(sd), -Math.PI / 2 + 0.45, 0, w, depth * 1.12, 1);
    B('cloth:' + tex, x, z).geo(GEO.plane, m, WHITE, 'keep');
    const [px, pz] = sideMap(sd, s, depth - 0.05);
    B('wood', px, pz).geo(GEO.box, mtx(px, y - 0.52, pz, sideYaw(sd), 0, 0, w, 0.05, 0.05), WOOD_D);
  }
  function potAt(sd, s, y, out) {
    const [x, z] = sideMap(sd, s, out + 0.12);
    B('terracotta', x, z).geo(GEO.pot, mtx(x, y, z, 0, 0, 0, 0.6, 0.6, 0.6), pick(TERRA));
    B('foliage', x, z).geo(GEO.ico, mtx(x, y + 0.32, z, rng() * 6, 0, 0, 0.2, 0.18, 0.2), C('#5f7d3a'));
  }
  function balconyAt(sd, s, y) {
    const wd = B('wood', ...sideMap(sd, s, 0));
    fbox(wd, sd, s - 0.9, s + 0.9, y - 0.12, y, 0, 0.85, tint(WOOD, 0.85));
    fbox(wd, sd, s - 0.9, s + 0.9, y + 0.8, y + 0.88, 0.8, 0.85, WOOD_D);
    for (let g = -4; g <= 4; g++) fbox(wd, sd, s + g * 0.2 - 0.02, s + g * 0.2 + 0.02, y, y + 0.8, 0.81, 0.84, WOOD_D, 'front');
    const [ax0, az0] = sideMap(sd, s - 0.9, 0), [ax1, az1] = sideMap(sd, s + 0.9, 0.85);
    W.addCollider(Math.min(ax0, ax1), y - 0.12, Math.min(az0, az1), Math.max(ax0, ax1), y, Math.max(az0, az1), { thin: true });
  }
  function crate(x, z, y, s, rot) {
    const b = B('wood', x, z);
    b.geo(GEO.box, mtx(x, y + s / 2, z, rot || 0, 0, 0, s, s, s), tint(WOOD, 0.75 + rng() * 0.3));
  }
  function streetProps(sd, s) {
    const out = 0.55 + rng() * 0.45;
    const [x, z] = sideMap(sd, s, out);
    const r = rng();
    if (r < 0.3) {
      // ящики, можно забраться
      const sz = 0.8 + rng() * 0.3;
      crate(x, z, 0, sz, rng() * 0.3);
      W.addCollider(x - sz / 2, 0, z - sz / 2, x + sz / 2, sz, z + sz / 2, { thin: true });
      if (rng() < 0.5) { crate(x, z, sz, sz * 0.75, rng()); W.addCollider(x - sz * 0.37, sz, z - sz * 0.37, x + sz * 0.37, sz * 1.75, z + sz * 0.37, { thin: true }); }
    } else if (r < 0.5) {
      B('wood', x, z).geo(GEO.barrel, mtx(x, 0, z, rng() * 6, 0, 0, 1, 1, 1), tint(WOOD, 0.9));
      W.addCollider(x - 0.38, 0, z - 0.38, x + 0.38, 0.9, z + 0.38, { thin: true });
    } else if (r < 0.75) {
      for (let k = 0; k < 2 + Math.floor(rng() * 3); k++) {
        const a = rng() * 6.28, d = rng() * 0.5;
        B('terracotta', x, z).geo(GEO.amphora, mtx(x + Math.cos(a) * d, 0, z + Math.sin(a) * d, rng() * 6, 0, 0, 0.9 + rng() * 0.5), pick(TERRA));
      }
    } else if (r < 0.88) {
      // каменная скамья: здесь сидят горожане
      const [bx, bz] = sideMap(sd, s, 0.45);
      const along = sd.ax === 'x';
      const hw = 0.9;
      B('stone', bx, bz).box(along ? bx - 0.25 : bx - hw, 0, along ? bz - hw : bz - 0.25, along ? bx + 0.25 : bx + hw, 0.45, along ? bz + hw : bz + 0.25, tint(STONE, 0.9), { faces: 'px nx pz nz py' });
      benches.push({ x: bx, z: bz, yaw: sideYaw(sd) });
    } else {
      hayPile(x + (sd.ax === 'x' ? sd.sg * 0.6 : 0), z + (sd.ax === 'z' ? sd.sg * 0.6 : 0), true);
    }
  }

  // ---------- Сено (укрытие) ----------
  function hayPile(x, z, cart) {
    const hb = B('hay', x, z);
    if (cart) {
      const wd = B('wood', x, z);
      wd.box(x - 1.3, 0.55, z - 0.9, x + 1.3, 0.7, z + 0.9, tint(WOOD, 0.8), { faces: 'px nx pz nz py ny' });
      wd.box(x - 1.3, 0.7, z - 0.9, x + 1.3, 1.0, z - 0.82, WOOD_D, { faces: 'px nx pz nz py' });
      wd.box(x - 1.3, 0.7, z + 0.82, x + 1.3, 1.0, z + 0.9, WOOD_D, { faces: 'px nx pz nz py' });
      for (const sx of [-0.8, 0.8]) for (const sz of [-0.95, 0.95]) wd.geo(GEO.cyl12, mtx(x + sx, 0.42, z + sz, 0, Math.PI / 2, 0, 0.42, 0.06, 0.42), WOOD_D);
      hb.geo(GEO.sphere, mtx(x, 0.85, z, rng(), 0, 0, 1.25, 0.6, 0.85), WHITE);
    } else {
      hb.geo(GEO.sphere, mtx(x, 0.15, z, rng(), 0, 0, 1.35, 0.95, 1.35), WHITE);
      hb.geo(GEO.sphere, mtx(x + 0.3, 0.5, z - 0.2, rng(), 0, 0, 0.9, 0.7, 0.9), WHITE);
    }
    hides.push({ x, z, y: 0, r: 1.25, type: 'hay' });
  }

  // ---------- Крыши ----------
  function roofDecor(bd) {
    const { x0, z0, x1, z1, h } = bd;
    const w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    if (bd.noDecor) return;
    const r = rng();
    if (w >= 7 && d >= 7 && h >= 6 && r < 0.09) {
      // купол
      const R = Math.min(w, d) * 0.3;
      const tiles = rng() < 0.4;
      const b = B(tiles ? 'tiles' : bd.mat, cx, cz);
      B(bd.mat, cx, cz).geo(GEO.cyl12, mtx(cx, h + 0.4, cz, 0, 0, 0, R, 0.8, R), bd.tint);
      b.geo(GEO.hemi, mtx(cx, h + 0.8, cz, 0, 0, 0, R, R * 0.9, R), tiles ? WHITE : bd.tint);
      B('stone', cx, cz).geo(GEO.cone8, mtx(cx, h + 0.8 + R * 0.9 + 0.3, cz, 0, 0, 0, 0.12, 0.6, 0.12), C('#c9a24a'));
      W.addCollider(cx - R * 0.72, h, cz - R * 0.72, cx + R * 0.72, h + 0.8 + R * 0.6, cz + R * 0.72);
      return;
    }
    if (w >= 4.5 && d >= 4.5 && r < 0.2 * PROPS + 0.09) {
      // сад на крыше: навес — укрытие
      const gx = x0 + 0.6 + rng() * (w - 4), gz = z0 + 0.6 + rng() * (d - 4), gw = 2.8, gd = 2.8;
      const wd = B('wood', gx, gz);
      for (const [px, pz] of [[0, 0], [gw, 0], [0, gd], [gw, gd]]) wd.box(gx + px - 0.06, h, gz + pz - 0.06, gx + px + 0.06, h + 2.2, gz + pz + 0.06, WOOD_D);
      wd.box(gx - 0.1, h + 2.2, gz - 0.1, gx + gw + 0.1, h + 2.3, gz + 0.04, WOOD_D);
      wd.box(gx - 0.1, h + 2.2, gz + gd - 0.04, gx + gw + 0.1, h + 2.3, gz + gd + 0.1, WOOD_D);
      const tex = Math.floor(rng() * SA.tex.awnings.length);
      B('cloth:' + tex, gx, gz).geo(GEO.plane, mtx(gx + gw / 2, h + 2.31, gz + gd / 2, 0, -Math.PI / 2, 0, gw + 0.3, gd + 0.3, 1), WHITE, 'keep');
      B('rug:' + Math.floor(rng() * 4), gx, gz).geo(GEO.plane, mtx(gx + gw / 2, h + 0.02, gz + gd / 2, rng() * 0.3, -Math.PI / 2, 0, gw * 0.8, gd * 0.8, 1), WHITE, 'keep');
      for (let k = 0; k < 3; k++) {
        const px = gx + rng() * gw, pz = gz + (rng() < 0.5 ? 0.2 : gd - 0.2);
        B('terracotta', px, pz).geo(GEO.pot, mtx(px, h, pz, 0, 0, 0, 0.9), pick(TERRA));
        B('foliage', px, pz).geo(GEO.ico, mtx(px, h + 0.55, pz, rng() * 6, 0, 0, 0.35, 0.4, 0.35), C('#5a7a34'));
      }
      W.addCollider(gx - 0.1, h + 2.2, gz - 0.1, gx + gw + 0.1, h + 2.32, gz + gd + 0.1, { thin: true });
      hides.push({ x: gx + gw / 2, z: gz + gd / 2, y: h, r: 1.3, type: 'garden' });
      return;
    }
    if (w >= 5 && d >= 5 && r < 0.42) {
      // надстройка-выход на крышу
      const sx = x0 + 0.5 + rng() * (w - 3), sz = z0 + 0.5 + rng() * (d - 3), hh = 2.3;
      building(sx, sz, sx + 2.2, sz + 2.2, h + hh, { tint: bd.tint, mat: bd.mat, noParapet: true }).noDecor = true;
      buildings.pop();
      const sd = { ax: 'z', sg: 1, pl: sz + 2.2 };
      fbox(B('dark', sx, sz), sd, sx + 0.6, sx + 1.6, h, h + 1.9, 0, 0.02, DARK, 'front');
      return;
    }
    // мелочи на крыше
    const n = Math.floor(rng() * 4 * PROPS);
    for (let k = 0; k < n; k++) {
      const px = x0 + 0.8 + rng() * (w - 1.6), pz = z0 + 0.8 + rng() * (d - 1.6), t = rng();
      if (t < 0.3) B('rug:' + Math.floor(rng() * 4), px, pz).geo(GEO.plane, mtx(px, h + 0.02, pz, rng() * 3, -Math.PI / 2, 0, 1.6, 2.4, 1), WHITE, 'keep');
      else if (t < 0.55) B('terracotta', px, pz).geo(GEO.amphora, mtx(px, h, pz, rng() * 6, 0, 0, 1), pick(TERRA));
      else if (t < 0.75) crate(px, pz, h, 0.7, rng());
      else if (t < 0.9 && w > 4) laundry(px, pz, h, rng() < 0.5);
      else B('wood', px, pz).geo(GEO.barrel, mtx(px, h, pz, 0, 0, 0, 1), tint(WOOD, 0.85));
    }
  }
  const LAUNDRY = ['#e8e0d0', '#9e2a2b', '#2c4f7c', '#d9b45a', '#ffffff', '#6e2f63', '#4d6b33'].map(C);
  function laundry(x, z, h, alongX) {
    const L = 2.2, wd = B('wood', x, z);
    const ex = alongX ? L / 2 : 0, ez = alongX ? 0 : L / 2;
    wd.box(x - ex - 0.04, h, z - ez - 0.04, x - ex + 0.04, h + 1.8, z - ez + 0.04, WOOD_D);
    wd.box(x + ex - 0.04, h, z + ez - 0.04, x + ex + 0.04, h + 1.8, z + ez + 0.04, WOOD_D);
    const nCl = 3 + Math.floor(rng() * 3);
    for (let k = 0; k < nCl; k++) {
      const t = (k + 0.5) / nCl - 0.5, px = x + ex * 2 * t, pz = z + ez * 2 * t;
      const cl = new THREE.Mesh(GEO.plane, clothMat(pick(LAUNDRY)));
      cl.scale.set(0.45 + rng() * 0.2, 0.6 + rng() * 0.3, 1);
      cl.position.set(px, h + 1.75 - cl.scale.y / 2, pz);
      cl.rotation.y = alongX ? 0 : Math.PI / 2;
      cl.castShadow = true;
      W.group.add(cl);
      animated.push({ type: 'cloth', o: cl, ph: rng() * 6 });
    }
  }
  const clothMats = {};
  function clothMat(c) {
    const k = c.getHexString();
    return clothMats[k] || (clothMats[k] = new THREE.MeshStandardMaterial({ color: c, map: SA.tex.fabric.map, roughness: 0.95, side: THREE.DoubleSide }));
  }
  // бельё над улицей между домами
  function streetLaundry(x0, z0, x1, z1, y) {
    const L = Math.hypot(x1 - x0, z1 - z0), n = Math.floor(L / 0.8);
    const line = new THREE.Mesh(GEO.cyl8, new THREE.MeshStandardMaterial({ color: '#3a2f25', roughness: 1 }));
    line.scale.set(0.01, L, 0.01);
    line.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
    line.rotation.set(Math.PI / 2, Math.atan2(x1 - x0, z1 - z0), 0, 'YXZ');
    W.group.add(line);
    for (let k = 1; k < n; k++) {
      if (rng() < 0.35) continue;
      const t = k / n;
      const cl = new THREE.Mesh(GEO.plane, clothMat(pick(LAUNDRY)));
      cl.scale.set(0.5 + rng() * 0.25, 0.5 + rng() * 0.5, 1);
      cl.position.set(U.lerp(x0, x1, t), y - cl.scale.y / 2 - 0.02 - Math.sin(t * Math.PI) * 0.3, U.lerp(z0, z1, t));
      cl.rotation.y = Math.atan2(x1 - x0, z1 - z0) + Math.PI / 2;
      cl.castShadow = true;
      W.group.add(cl);
      animated.push({ type: 'cloth', o: cl, ph: rng() * 6 });
    }
  }

  // ---------- Растительность ----------
  function palm(x, z, y, hgt) {
    y = y || 0; hgt = hgt || 6 + rng() * 3;
    const segs = 7, lean = rng() * 6.28, bend = 0.04 + rng() * 0.06;
    let px = x, py = y, pz = z, ang = 0;
    const tb = B('wood', x, z);
    for (let k = 0; k < segs; k++) {
      const len = hgt / segs, r = U.lerp(0.24, 0.15, k / segs);
      ang += bend;
      const dx = Math.sin(ang) * Math.cos(lean) * len, dz = Math.sin(ang) * Math.sin(lean) * len, dy = Math.cos(ang) * len;
      const m = new THREE.Matrix4();
      const dir = new V3(dx, dy, dz).normalize();
      m.compose(new V3(px + dx / 2, py + dy / 2, pz + dz / 2), new THREE.Quaternion().setFromUnitVectors(new V3(0, 1, 0), dir), new V3(r, len * 1.02, r));
      tb.geo(GEO.cyl8, m, tint(C('#8a7458'), 0.8 + (k % 2) * 0.12));
      px += dx; py += dy; pz += dz;
    }
    const fb = B('frond', px, pz);
    const nf = 13;
    for (let k = 0; k < nf; k++) {
      const a = (k / nf) * 6.28 + rng() * 0.3, tilt = 0.25 + rng() * 0.5 + (k % 3) * 0.15;
      const g = new THREE.PlaneGeometry(1.1, 3.4, 1, 6);
      const pos = g.attributes.position;
      for (let j = 0; j < pos.count; j++) {
        const t = (pos.getY(j) + 1.7) / 3.4;
        pos.setY(j, t * 3.0);
        pos.setZ(j, t * t * 1.7 + Math.abs(pos.getX(j)) * 0.35 * t);
        pos.setX(j, pos.getX(j) * (0.3 + Math.sin(t * Math.PI) * 0.9));
      }
      g.computeVertexNormals();
      const m = new THREE.Matrix4().compose(new V3(px, py, pz), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2 - tilt, a, 0, 'YXZ')), new V3(1, 1, 1));
      fb.geo(g, m, tint(WHITE, 0.85 + rng() * 0.2), 'keep');
    }
    for (let k = 0; k < 4; k++) B('wood', px, pz).geo(GEO.sphere, mtx(px + Math.cos(k * 1.6) * 0.22, py - 0.25, pz + Math.sin(k * 1.6) * 0.22, 0, 0, 0, 0.11), C('#5a4228'));
    W.addCollider(x - 0.25, y, z - 0.25, x + 0.25, y + hgt * 0.9, z + 0.25, { climb: false, thin: true });
  }
  function cypress(x, z) {
    const h = 6 + rng() * 3;
    const g = new THREE.LatheGeometry([[0, 0], [0.6, 0.4], [0.9, h * 0.3], [0.75, h * 0.65], [0.35, h * 0.9], [0, h]].map(([a, b]) => new THREE.Vector2(a, b)), 9, 0, Math.PI * 2);
    const pos = g.attributes.position;
    for (let j = 0; j < pos.count; j++) {
      const s = 1 + (Math.sin(pos.getY(j) * 3.1 + j) * 0.08);
      pos.setX(j, pos.getX(j) * s); pos.setZ(j, pos.getZ(j) * s);
    }
    g.computeVertexNormals();
    B('foliage', x, z).geo(g, mtx(x, 0.3, z, rng() * 6), C('#3d5a2c'));
    B('wood', x, z).geo(GEO.cyl8, mtx(x, 0.2, z, 0, 0, 0, 0.12, 0.4, 0.12), WOOD_D);
    W.addCollider(x - 0.4, 0, z - 0.4, x + 0.4, h, z + 0.4, { climb: false, thin: true });
  }
  function bush(x, z, y, s) {
    B('foliage', x, z).geo(GEO.ico, mtx(x, (y || 0) + s * 0.6, z, rng() * 6, 0, 0, s, s * 0.8, s), tint(C('#55743a'), 0.8 + rng() * 0.3));
  }

  // ---------- Обычные участки ----------
  function genLots(i, j, onlyA) {
    const cx = cellCenter(i), cz = cellCenter(j), key = i + ',' + j;
    for (let a = 0; a < 2; a++) {
      if (onlyA !== undefined && a !== onlyA) continue;
      for (let b = 0; b < 2; b++) {
        const x0 = cx - 9 + a * 9, z0 = cz - 9 + b * 9;
        if (rng() < 0.12) {
          // внутренний дворик
          groundPatch('dirt', x0 + 4.5, z0 + 4.5, 9, 9);
          if (rng() < 0.6) hayPile(x0 + 4.5, z0 + 4.5, rng() < 0.5); else palm(x0 + 4.5, z0 + 4.5);
          bush(x0 + 1.5, z0 + 1.5, 0, 0.6);
          continue;
        }
        const hs = [4.5, 6, 6, 7.5, 7.5, 9, 10.5, 12];
        if (rng() < 0.35) {
          const h1 = pick(hs), h2 = pick(hs);
          building(x0, z0, x0 + 9, z0 + 4.5, h1, { cellKey: key });
          building(x0, z0 + 4.5, x0 + 9, z0 + 9, h2, { cellKey: key });
          lots[lotKey(i, j, a, b)] = Math.min(h1, h2);
        } else {
          const h = pick(hs);
          building(x0, z0, x0 + 9, z0 + 9, h, { cellKey: key });
          lots[lotKey(i, j, a, b)] = h;
        }
      }
    }
  }
  const patches = [];
  function groundPatch(mat, x, z, w, d) { patches.push({ mat, x, z, w, d }); }

  // ---------- Сцена мира ----------
  W.build = function (progress) {
    const T = SA.tex;
    W.group = new THREE.Group();
    SA.scene.add(W.group);
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        if (isFortressCell(i, j)) continue;
        const cx = cellCenter(i), cz = cellCenter(j);
        const sp = SPECIAL[i + ',' + j];
        const isTower = TOWER_CELLS.some((t) => t[0] === i && t[1] === j);
        if (sp === 'market') buildMarket(cx, cz);
        else if (sp === 'fountain') buildFountain(cx, cz);
        else if (sp === 'garden') buildGarden(cx, cz);
        else if (isTower) buildTowerCell(i, j, cx, cz);
        else if (i === MOSQUE[0] && j === MOSQUE[1]) buildMosque(i, j, cx, cz);
        else if (i === 0 && j === 0) {
          genLots(i, j, 0);
          const bd = building(cx, cz - 9, cx + 9, cz + 9, 7.5, { tint: C('#f2dcb8') });
          lots[lotKey(i, j, 1, 0)] = 7.5; lots[lotKey(i, j, 1, 1)] = 7.5;
          const dx = cx + 4.5;
          W.bureau = { door: new V3(dx, 0, cz + 9.3), spawn: new V3(dx, 0, cz + 11) };
          const sd = { ax: 'z', sg: 1, pl: cz + 9 };
          fbox(B('dark', dx, cz), sd, dx - 0.7, dx + 0.7, 0, 2.3, 0, 0.02, DARK, 'front');
          archAt(B('dark', dx, cz), sd, dx, 2.3, 0.02, 0.7, DARK);
          fbox(B('stone', dx, cz), sd, dx - 1, dx + 1, 2.95, 3.1, 0, 0.3, STONE);
          W.bureauEmblem = new V3(dx, 3.6, cz + 9.05);
          bd.bureau = true;
        } else genLots(i, j);
      }
    }
    progress(0.35);
    buildBeams();
    buildFortress();
    buildCityWall();
    progress(0.5);
    for (const bd of buildings.slice()) decorate(bd);
    // бельё через улицы
    for (let k = 0; k < 18 * PROPS; k++) {
      const vert = rng() < 0.5, line = 1 + Math.floor(rng() * 7), along = cellCenter(Math.floor(rng() * 8)) + (rng() - 0.5) * 12;
      const xs = (line - 4) * CELL;
      if (vert) {
        if (xs > 50 && along > 50) continue;
        streetLaundry(xs - 4, along, xs + 4, along, 4 + rng() * 3);
      } else {
        if (xs > 50 && along > 50) continue;
        streetLaundry(along, xs - 4, along, xs + 4, 4 + rng() * 3);
      }
    }
    progress(0.65);
    buildGround();
    buildSky();
    buildLights();
    buildTerrain();
    finalizeMeshes();
    buildBirds();
    buildDust();
    buildNav();
    buildMinimap();
    progress(1);
  };

  // ---------- Особые клетки ----------
  function buildMarket(cx, cz) {
    W.marketCenter = new V3(cx, 0, cz);
    groundPatch('flag', cx, cz, 18, 18);
    const st = B('stone', cx, cz);
    st.box(cx - 1.8, 0, cz - 1.8, cx + 1.8, 0.6, cz + 1.8, tint(STONE, 0.9), { faces: 'px nx pz nz py' });
    st.box(cx - 2.1, 0, cz - 2.1, cx + 2.1, 0.25, cz + 2.1, tint(STONE, 0.8), { faces: 'px nx pz nz py' });
    W.addCollider(cx - 1.8, 0, cz - 1.8, cx + 1.8, 0.6, cz + 1.8);
    for (let k = 0; k < 10; k++) {
      const ang = (k / 10) * Math.PI * 2;
      const sx = cx + Math.cos(ang) * 6.8, sz = cz + Math.sin(ang) * 6.8;
      const wd = B('wood', sx, sz);
      wd.box(sx - 0.9, 0, sz - 0.9, sx + 0.9, 1.0, sz + 0.9, tint(WOOD, 0.8), { faces: 'px nx pz nz py' });
      W.addCollider(sx - 0.9, 0, sz - 0.9, sx + 0.9, 1.0, sz + 0.9);
      for (const [px, pz] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) wd.box(sx + px - 0.05, 0, sz + pz - 0.05, sx + px + 0.05, 2.3, sz + pz + 0.05, WOOD_D);
      const tex = k % SA.tex.awnings.length;
      B('cloth:' + tex, sx, sz).geo(GEO.plane, mtx(sx, 2.32, sz, ang, -Math.PI / 2 + 0.12, 0, 2.7, 2.7, 1), WHITE, 'keep');
      W.addCollider(sx - 1.3, 2.2, sz - 1.3, sx + 1.3, 2.38, sz + 1.3, { thin: true });
      // товары
      for (let g = 0; g < 7; g++) {
        const gx = sx + (rng() - 0.5) * 1.4, gz = sz + (rng() - 0.5) * 1.4, kind = (k + g) % 4;
        if (kind === 0) B('terracotta', gx, gz).geo(GEO.amphora, mtx(gx, 1.0, gz, rng() * 6, 0, 0, 0.6), pick(TERRA));
        else if (kind === 1) B('foliage', gx, gz).geo(GEO.sphere, mtx(gx, 1.08, gz, 0, 0, 0, 0.09), pick([C('#d9732a'), C('#c23a2a'), C('#d9c23a'), C('#6a8a2a')]));
        else if (kind === 2) B('hay', gx, gz).geo(GEO.cyl12, mtx(gx, 1.1, gz, 0, 0, 0, 0.18, 0.2, 0.18), WHITE);
        else B('rug:' + (g % 4), gx, gz).geo(GEO.box, mtx(gx, 1.05, gz, rng(), 0, 0, 0.5, 0.1, 0.3), WHITE, 'keep');
      }
    }
    hayPile(cx + 7.8, cz - 7.8, true);
    palm(cx - 8, cz + 8); palm(cx + 8, cz + 8);
  }
  function buildFountain(cx, cz) {
    W.fountainCenter = new V3(cx, 0, cz);
    groundPatch('flag', cx, cz, 18, 18);
    const st = B('stone', cx, cz);
    st.geo(GEO.cyl8, mtx(cx, 0.4, cz, Math.PI / 8, 0, 0, 3.2, 0.8, 3.2), tint(STONE, 0.95));
    st.geo(GEO.cyl8, mtx(cx, 0.82, cz, Math.PI / 8, 0, 0, 3.35, 0.06, 3.35), tint(STONE, 0.85));
    st.geo(GEO.cyl12, mtx(cx, 1.5, cz, 0, 0, 0, 0.35, 2.2, 0.35), tint(STONE, 0.95));
    st.geo(GEO.hemi, mtx(cx, 2.35, cz, 0, Math.PI, 0, 1.1, 0.4, 1.1), tint(STONE, 0.9));
    st.geo(GEO.sphere, mtx(cx, 2.65, cz, 0, 0, 0, 0.18), tint(STONE, 0.9));
    const water = new THREE.Mesh(new THREE.CircleGeometry(2.95, 24), new THREE.MeshStandardMaterial({ color: '#2f5c63', roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.9 }));
    water.rotation.x = -Math.PI / 2; water.position.set(cx, 0.72, cz);
    W.group.add(water);
    W.addCollider(cx - 2.8, 0, cz - 2.8, cx + 2.8, 0.8, cz + 2.8);
    // струи воды
    const N = 240, pos = new Float32Array(N * 3), seeds = new Float32Array(N);
    for (let k = 0; k < N; k++) seeds[k] = Math.random();
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: '#cfe6ea', size: 0.09, map: SA.tex.soft, transparent: true, depthWrite: false, opacity: 0.8 }));
    pts.frustumCulled = false;
    W.group.add(pts);
    animated.push({ type: 'jets', o: pts, seeds, cx, cz });
    for (const [dx, dz] of [[-7, -7], [7, -7], [-7, 7], [7, 7]]) palm(cx + dx, cz + dz);
    for (const [dx, dz, yaw] of [[-4.5, 0, Math.PI / 2], [4.5, 0, -Math.PI / 2], [0, 4.5, Math.PI], [0, -4.5, 0]]) {
      st.box(cx + dx - (dx ? 0.25 : 0.9), 0, cz + dz - (dz ? 0.25 : 0.9), cx + dx + (dx ? 0.25 : 0.9), 0.45, cz + dz + (dz ? 0.25 : 0.9), tint(STONE, 0.88), { faces: 'px nx pz nz py' });
      benches.push({ x: cx + dx, z: cz + dz, yaw });
    }
    hayPile(cx - 8, cz, true);
  }
  function buildGarden(cx, cz) {
    groundPatch('dirt', cx, cz, 18, 18);
    for (let k = 0; k < 4; k++) palm(cx - 6 + (k % 2) * 12, cz - 6 + Math.floor(k / 2) * 12);
    for (let k = 0; k < 4; k++) cypress(cx - 7 + k * 4.6, cz + 8.3);
    for (let k = 0; k < 10; k++) bush(cx + (rng() - 0.5) * 16, cz + (rng() - 0.5) * 16, 0, 0.5 + rng() * 0.5);
    const st = B('stone', cx, cz);
    st.box(cx - 2.5, 0, cz - 1.5, cx + 2.5, 0.5, cz + 1.5, tint(STONE, 0.9), { faces: 'px nx pz nz py' });
    const water = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 2.6), new THREE.MeshStandardMaterial({ color: '#2f5c63', roughness: 0.06, metalness: 0.2 }));
    water.rotation.x = -Math.PI / 2; water.position.set(cx, 0.45, cz);
    W.group.add(water);
    W.addCollider(cx - 2.5, 0, cz - 1.5, cx + 2.5, 0.5, cz + 1.5);
    hayPile(cx + 5, cz - 3, false);
  }
  function buildTowerCell(i, j, cx, cz) {
    genLots(i, j, 0);
    building(cx, cz - 9, cx + 5, cz - 2, 5 + Math.floor(rng() * 3) * 1.5, { cellKey: i + ',' + j });
    building(cx, cz + 2, cx + 5, cz + 9, 6 + Math.floor(rng() * 3) * 1.5, { cellKey: i + ',' + j });
    building(cx, cz - 2, cx + 5, cz + 2, 10.5);
    const H = 22, x0 = cx + 5, x1 = cx + 9, z0 = cz - 2, z1 = cz + 2;
    const st = B('stone', cx + 7, cz);
    st.box(x0, 0, z0, x1, H, z1, tint(STONE, 0.92), { faces: 'px nx pz nz', ao: true });
    st.box(x0 - 0.15, H - 0.3, z0 - 0.15, x1 + 0.15, H, z1 + 0.15, tint(STONE, 0.8), { faces: 'px nx pz nz py ny' });
    for (const y of [7, 14]) st.box(x0 - 0.08, y, z0 - 0.08, x1 + 0.08, y + 0.2, z1 + 0.08, tint(STONE, 0.8), { faces: 'px nx pz nz py ny' });
    // зубцы по углам
    for (const [px, pz] of [[x0, z0], [x1 - 0.6, z0], [x0, z1 - 0.6], [x1 - 0.6, z1 - 0.6]]) st.box(px, H, pz, px + 0.6, H + 0.8, pz + 0.6, tint(STONE, 0.85));
    // узкие окна-бойницы
    const dk = B('dark', cx + 7, cz);
    for (const y of [4, 10, 17]) {
      for (const sd of [{ ax: 'x', sg: -1, pl: x0 }, { ax: 'z', sg: 1, pl: z1 }, { ax: 'z', sg: -1, pl: z0 }]) {
        const s = sd.ax === 'x' ? cz : cx + 7;
        fbox(dk, sd, s - 0.18, s + 0.18, y, y + 1.4, 0, 0.02, DARK, 'front');
        archAt(dk, sd, s, y + 1.4, 0.02, 0.18, DARK);
      }
    }
    W.addCollider(x0, 0, z0, x1, H, z1);
    B('wood', cx + 11, cz).box(x1, H - 0.3, cz - 0.3, cx + 12.6, H, cz + 0.3, tint(WOOD, 0.75), { faces: 'px nx pz nz py ny' });
    B('wood', cx + 11, cz).box(x1, H - 1.4, cz - 0.08, x1 + 0.9, H - 0.3, cz + 0.08, WOOD_D);
    W.addCollider(x1, H - 0.3, cz - 0.3, cx + 12.6, H, cz + 0.3, { thin: true });
    const pole = new THREE.Mesh(GEO.cyl8, new THREE.MeshStandardMaterial({ color: '#4a3524', roughness: 0.8 }));
    pole.scale.set(0.05, 4, 0.05); pole.position.set(x0 + 0.3, H + 2, z0 + 0.3);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1, 6, 1), new THREE.MeshStandardMaterial({ color: '#8f1424', side: THREE.DoubleSide, roughness: 0.9, map: SA.tex.fabric.map }));
    flag.geometry.translate(0.8, 0, 0);
    flag.position.set(x0 + 0.33, H + 3.4, z0 + 0.3);
    pole.castShadow = flag.castShadow = true;
    W.group.add(pole, flag);
    animated.push({ type: 'flag', o: flag, ph: rng() * 6 });
    hayPile(cx + 12.3, cz, false);
    towers.push({ x: cx + 7, z: cz, h: H, beam: new V3(cx + 12.2, H, cz), hay: hides[hides.length - 1], synced: false, flag });
    lots[lotKey(i, j, 1, 0)] = 0; lots[lotKey(i, j, 1, 1)] = 0;
  }
  function buildMosque(i, j, cx, cz) {
    genLots(i, j, 1);
    const x0 = cx - 9, x1 = cx, z0 = cz - 9, z1 = cz + 9;
    const bd = building(x0, z0, x1, z1, 8, { tint: C('#fff3df'), mat: 'plaster2' });
    bd.noDecor = true;
    const tl = B('tiles', cx - 4.5, cz);
    B('plaster2', cx - 4.5, cz).geo(GEO.cyl12, mtx(cx - 4.5, 8.6, cz, 0, 0, 0, 3.6, 1.2, 3.6), C('#fff3df'));
    tl.geo(GEO.hemi, mtx(cx - 4.5, 9.2, cz, 0, 0, 0, 3.6, 3.6, 3.6), WHITE);
    B('stone', cx - 4.5, cz).geo(GEO.cone8, mtx(cx - 4.5, 13.2, cz, 0, 0, 0, 0.15, 0.9, 0.15), C('#c9a24a'));
    W.addCollider(cx - 7, 8, cz - 2.5, cx - 2, 11.5, cz + 2.5);
    // минарет
    const mx = cx - 7.2, mz = cz + 7.2, pb = B('plaster2', mx, mz);
    pb.geo(GEO.cyl12, mtx(mx, 13, mz, 0, 0, 0, 1.25, 26, 1.25), C('#fff3df'));
    pb.geo(GEO.cyl12, mtx(mx, 20.2, mz, 0, 0, 0, 2.0, 0.35, 2.0), C('#efdcbc'));
    pb.geo(GEO.cyl16o, mtx(mx, 20.8, mz, 0, 0, 0, 1.95, 0.9, 1.95), C('#efdcbc'));
    pb.geo(GEO.cyl12, mtx(mx, 27.2, mz, 0, 0, 0, 0.9, 2.4, 0.9), C('#fff3df'));
    tl.geo(GEO.sphere, mtx(mx, 28.6, mz, 0, 0, 0, 1.0, 1.3, 1.0), WHITE);
    B('stone', mx, mz).geo(GEO.cone8, mtx(mx, 30.2, mz, 0, 0, 0, 0.1, 1, 0.1), C('#c9a24a'));
    W.addCollider(mx - 1, 0, mz - 1, mx + 1, 26, mz + 1);
    W.addCollider(mx - 2, 20, mz - 2, mx + 2, 20.38, mz + 2, { thin: true });
    for (let k = 0; k < 4; k++) {
      const sd = { ax: 'x', sg: 1, pl: x1 }, s = z0 + 2.5 + k * 4.4;
      fbox(B('dark', x1, s), sd, s - 0.7, s + 0.7, 0.2, 3.6, 0, 0.02, DARK, 'front');
      archAt(B('dark', x1, s), sd, s, 3.6, 0.02, 0.7, DARK);
      fbox(B('plaster2', x1, s), sd, s - 0.95, s - 0.7, 0, 4.1, 0, 0.15, C('#efdcbc'));
      fbox(B('plaster2', x1, s), sd, s + 0.7, s + 0.95, 0, 4.1, 0, 0.15, C('#efdcbc'));
    }
    lots[lotKey(i, j, 0, 0)] = 8; lots[lotKey(i, j, 0, 1)] = 8;
  }
  function buildBeams() {
    for (let k = 1; k < 8; k++) {
      const xs = (k - 4) * CELL;
      for (let j = 0; j < 8; j++) for (let b = 0; b < 2; b++) {
        const hA = lots[lotKey(k - 1, j, 1, b)], hB = lots[lotKey(k, j, 0, b)];
        if (!hA || !hB || rng() > 0.5) continue;
        const h = Math.min(hA, hB), zc = cellCenter(j) - 9 + b * 9 + 2 + rng() * 5;
        B('wood', xs, zc).box(xs - 4.2, h - 0.25, zc - 0.3, xs + 4.2, h, zc + 0.3, tint(WOOD, 0.8), { faces: 'px nx pz nz py ny' });
        W.addCollider(xs - 4.2, h - 0.25, zc - 0.3, xs + 4.2, h, zc + 0.3, { thin: true });
      }
      const zs = (k - 4) * CELL;
      for (let i = 0; i < 8; i++) for (let a = 0; a < 2; a++) {
        const hA = lots[lotKey(i, k - 1, a, 1)], hB = lots[lotKey(i, k, a, 0)];
        if (!hA || !hB || rng() > 0.5) continue;
        const h = Math.min(hA, hB), xc = cellCenter(i) - 9 + a * 9 + 2 + rng() * 5;
        B('wood', xc, zs).box(xc - 0.3, h - 0.25, zs - 4.2, xc + 0.3, h, zs + 4.2, tint(WOOD, 0.8), { faces: 'px nx pz nz py ny' });
        W.addCollider(xc - 0.3, h - 0.25, zs - 4.2, xc + 0.3, h, zs + 4.2, { thin: true });
      }
    }
  }
  function merlons(b, x0, z0, x1, z1, y, col) {
    const alongX = x1 - x0 > z1 - z0, L = alongX ? x1 - x0 : z1 - z0, n = Math.floor(L / 1.3);
    for (let k = 0; k < n; k++) {
      const s = (alongX ? x0 : z0) + (k + 0.25) * (L / n), e = s + (L / n) * 0.5;
      if (alongX) b.box(s, y, z0, e, y + 0.9, z1, col); else b.box(x0, y, s, x1, y + 0.9, e, col);
    }
  }
  function buildFortress() {
    const S = tint(STONE, 0.82), b = (x, z) => B('stone', x, z);
    const wall = (x0, z0, x1, z1, h) => {
      b((x0 + x1) / 2, (z0 + z1) / 2).box(x0, 0, z0, x1, h, z1, S, { ao: true });
      W.addCollider(x0, 0, z0, x1, h, z1);
    };
    const H = 9, T = 1.6;
    wall(56, 56, 75, 56 + T, H); wall(81, 56, 100, 56 + T, H);
    wall(56, 100 - T, 100, 100, H);
    wall(56, 56, 56 + T, 75, H); wall(56, 81, 56 + T, 100, H);
    wall(100 - T, 56, 100, 100, H);
    b(78, 56).box(75, 6, 56, 81, H, 56 + T, S, { faces: 'px nx pz nz py ny' }); W.addCollider(75, 6, 56, 81, H, 56 + T);
    b(56, 78).box(56, 6, 75, 56 + T, H, 81, S, { faces: 'px nx pz nz py ny' }); W.addCollider(56, 6, 75, 56 + T, H, 81);
    merlons(b(78, 56), 56, 56, 75, 56.4, H, S); merlons(b(90, 56), 81, 56, 100, 56.4, H, S); merlons(b(78, 56), 75, 56, 81, 56.4, H, S);
    merlons(b(78, 100), 56, 99.6, 100, 100, H, S);
    merlons(b(56, 66), 56, 56, 56.4, 75, H, S); merlons(b(56, 90), 56, 81, 56.4, 100, H, S); merlons(b(56, 78), 56, 75, 56.4, 81, H, S);
    merlons(b(100, 78), 99.6, 56, 100, 100, H, S);
    for (const [x, z] of [[56, 56], [96, 56], [56, 96], [96, 96]]) {
      wall(x - 0.5, z - 0.5, x + 4.5, z + 4.5, 12);
      merlons(b(x, z), x - 0.5, z - 0.5, x + 4.5, z - 0.1, 12, S); merlons(b(x, z), x - 0.5, z + 4.1, x + 4.5, z + 4.5, 12, S);
      merlons(b(x, z), x - 0.5, z - 0.1, x - 0.1, z + 4.1, 12, S); merlons(b(x, z), x + 4.1, z - 0.1, x + 4.5, z + 4.1, 12, S);
    }
    // цитадель
    b(78, 78).box(70, 0, 70, 86, 16, 86, tint(STONE, 0.88), { ao: true }); W.addCollider(70, 0, 70, 86, 16, 86);
    merlons(b(78, 70), 70, 70, 86, 70.4, 16, S); merlons(b(78, 86), 70, 85.6, 86, 86, 16, S);
    merlons(b(70, 78), 70, 70.4, 70.4, 85.6, 16, S); merlons(b(86, 78), 85.6, 70.4, 86, 85.6, 16, S);
    b(78, 78).box(74, 16, 74, 82, 21, 82, tint(STONE, 0.9)); W.addCollider(74, 16, 74, 82, 21, 82);
    merlons(b(78, 74), 74, 74, 82, 74.4, 21, S); merlons(b(78, 82), 74, 81.6, 82, 82, 21, S);
    for (const sd of [{ ax: 'z', sg: 1, pl: 86, c: 78 }, { ax: 'z', sg: -1, pl: 70, c: 78 }, { ax: 'x', sg: 1, pl: 86, c: 78 }, { ax: 'x', sg: -1, pl: 70, c: 78 }]) {
      fbox(B('dark', 78, 78), sd, sd.c - 1, sd.c + 1, 0, 2.6, 0, 0.02, DARK, 'front');
      archAt(B('dark', 78, 78), sd, sd.c, 2.6, 0.02, 1, DARK);
      for (const y of [6, 11]) for (const o of [-4.5, 0, 4.5]) {
        fbox(B('dark', 78, 78), sd, sd.c + o - 0.25, sd.c + o + 0.25, y, y + 1.6, 0, 0.02, DARK, 'front');
        archAt(B('dark', 78, 78), sd, sd.c + o, y + 1.6, 0.02, 0.25, DARK);
      }
    }
    groundPatch('dirt', 78, 78, 44, 44);
    // двор: ящики, шатры, бочки
    crate(67, 68, 0, 2); crate(67, 68, 2, 1.4, 0.4); W.addCollider(66, 0, 67, 68, 2, 69, { thin: true }); W.addCollider(66.3, 2, 67.3, 67.7, 3.4, 68.7, { thin: true });
    crate(89, 67, 0, 2); W.addCollider(88, 0, 66, 90, 2, 68, { thin: true });
    crate(68, 89, 0, 1.4); W.addCollider(67.3, 0, 88.3, 68.7, 1.4, 89.7, { thin: true });
    for (const [x, z] of [[91, 91], [64, 64]]) {
      const tg = new THREE.ConeGeometry(2.4, 2.8, 8, 1, true);
      B('cloth:0', x, z).geo(tg, mtx(x, 1.4, z, rng()), WHITE, 'keep');
    }
    hayPile(62, 88, false); hayPile(94, 64, true);
    for (const [x, z] of [[72, 62], [84, 62], [62, 72], [94, 84]]) palm(x, z, 0, 7);
    // знамёна
    const bt = crossBannerTex();
    const bm = new THREE.MeshStandardMaterial({ map: bt, side: THREE.DoubleSide, roughness: 0.9 });
    for (const [x, z, ry] of [[73, 55.85, Math.PI], [83, 55.85, Math.PI], [55.85, 73, -Math.PI / 2], [55.85, 83, -Math.PI / 2], [78, 69.85, Math.PI]]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 3.6, 1, 6), bm);
      m.position.set(x, z === 69.85 ? 12 : 6.6, z); m.rotation.y = ry;
      W.group.add(m);
      animated.push({ type: 'banner', o: m, ph: rng() * 6 });
    }
  }
  function crossBannerTex() {
    const c = document.createElement('canvas'); c.width = 64; c.height = 160;
    const g = c.getContext('2d');
    g.fillStyle = '#ece4d2'; g.fillRect(0, 0, 64, 160);
    g.fillStyle = '#9a1524'; g.fillRect(26, 30, 12, 70); g.fillRect(12, 50, 40, 12);
    g.fillStyle = '#c9a24a'; g.fillRect(0, 0, 64, 6); g.fillRect(0, 154, 64, 6);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  function buildCityWall() {
    const S = tint(STONE, 0.75);
    const w = (x0, z0, x1, z1) => {
      B('stone', (x0 + x1) / 2, (z0 + z1) / 2).box(x0, 0, z0, x1, 16, z1, S, { ao: true });
      W.addCollider(x0, 0, z0, x1, 40, z1, { climb: false });
      merlons(B('stone', (x0 + x1) / 2, (z0 + z1) / 2), x0, z0, x1, z1, 16, S);
    };
    w(-112, -112, 112, -108); w(-112, 108, 112, 112); w(-112, -108, -108, 108); w(108, -108, 112, 108);
    for (const x of [-112, -56, 0, 56, 108]) for (const z of [-112, 108]) {
      B('stone', x, z).box(x - 1.5, 0, z - 1.5, x + 5.5, 19, z + 5.5, S, { ao: true });
    }
  }

  // ---------- Земля ----------
  const MATS = (W.mats = {});
  function buildGround() {
    const T = SA.tex;
    const cob = new THREE.PlaneGeometry(224, 224);
    const uv = cob.attributes.uv;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * 224 / 5, uv.getY(k) * 224 / 5);
    const g = new THREE.Mesh(cob, new THREE.MeshStandardMaterial({ map: T.cobble.map, normalMap: T.cobble.normal, normalScale: new THREE.Vector2(1.2, 1.2), roughness: 0.92 }));
    g.rotation.x = -Math.PI / 2; g.receiveShadow = true;
    W.group.add(g);
    const pm = {
      flag: new THREE.MeshStandardMaterial({ map: T.flag.map, normalMap: T.flag.normal, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
      dirt: new THREE.MeshStandardMaterial({ map: T.dirt.map, normalMap: T.dirt.normal, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
    };
    const scale = { flag: 1 / 6, dirt: 1 / 8 };
    for (const p of patches) {
      const pg = new THREE.PlaneGeometry(p.w, p.d);
      const u = pg.attributes.uv;
      for (let k = 0; k < u.count; k++) u.setXY(k, (p.x + (u.getX(k) - 0.5) * p.w) * scale[p.mat], (p.z - (u.getY(k) - 0.5) * p.d) * scale[p.mat]);
      const m = new THREE.Mesh(pg, pm[p.mat]);
      m.rotation.x = -Math.PI / 2; m.position.set(p.x, 0.01, p.z); m.receiveShadow = true;
      W.group.add(m);
    }
  }
  function buildTerrain() {
    const T = SA.tex;
    const g = new THREE.RingGeometry(112, 900, 96, 24);
    const pos = g.attributes.position, uv = g.attributes.uv, cols = [];
    const n = U.mulberry32(71);
    const grid = []; for (let k = 0; k < 64 * 64; k++) grid.push(n());
    const vn = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi; const at = (a, b) => grid[(((b % 64) + 64) % 64) * 64 + (((a % 64) + 64) % 64)]; const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy); return U.lerp(U.lerp(at(xi, yi), at(xi + 1, yi), sx), U.lerp(at(xi, yi + 1), at(xi + 1, yi + 1), sx), sy); };
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k), y = pos.getY(k), r = Math.hypot(x, y);
      const f = vn(x / 60, y / 60) * 0.6 + vn(x / 25, y / 25) * 0.3 + vn(x / 9, y / 9) * 0.1;
      const hgt = U.smooth(125, 240, r) * f * 30 + U.smooth(330, 800, r) * (f * 160 + 30);
      pos.setZ(k, hgt);
      uv.setXY(k, x / 10, y / 10);
      const rock = U.smooth(18, 60, hgt);
      const c = new THREE.Color().setRGB(U.lerp(1, 0.75, rock), U.lerp(0.95, 0.68, rock), U.lerp(0.85, 0.6, rock));
      cols.push(c.r, c.g, c.b);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: T.sand.map, normalMap: T.sand.normal, vertexColors: true, roughness: 1 }));
    m.rotation.x = -Math.PI / 2;
    m.receiveShadow = true;
    W.group.add(m);
    // пальмовые рощи и шатры за стенами
    for (let k = 0; k < 40 * PROPS; k++) {
      const a = rng() * 6.28, r = 125 + rng() * 60;
      palm(Math.cos(a) * r, Math.sin(a) * r, 0, 6 + rng() * 4);
    }
  }

  // ---------- Небо ----------
  const SUN_DIR = (W.sunDir = new V3(-0.55, 0.42, -0.72).normalize());
  W.skyColors = { horizon: new THREE.Color('#e9cfa7'), zenith: new THREE.Color('#5d88c4'), eagleH: new THREE.Color('#0d1630'), eagleZ: new THREE.Color('#050913') };
  function skyMaterial() {
    return new THREE.ShaderMaterial({
      uniforms: { sunDir: { value: SUN_DIR }, horizon: { value: W.skyColors.horizon.clone() }, zenith: { value: W.skyColors.zenith.clone() }, time: { value: 0 }, eagle: { value: 0 } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }',
      fragmentShader: `
        uniform vec3 sunDir; uniform vec3 horizon; uniform vec3 zenith; uniform float time; uniform float eagle;
        varying vec3 vDir;
        float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
        float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
        float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<5;i++){ s+=vn(p)*a; p*=2.03; a*=0.5; } return s; }
        void main(){
          vec3 d = normalize(vDir);
          float h = max(d.y, 0.0);
          vec3 col = mix(horizon, zenith, pow(h, 0.55));
          float s = max(dot(d, normalize(sunDir)), 0.0);
          col += vec3(1.0,0.72,0.42) * pow(s, 6.0) * 0.45 * (1.0 - eagle);
          col += vec3(1.0,0.92,0.75) * pow(s, 900.0) * 12.0 * (1.0 - eagle);
          if (d.y > 0.02) {
            vec2 uv = d.xz / (d.y + 0.15) * 1.6 + vec2(time * 0.006, time * 0.002);
            float c = smoothstep(0.52, 0.85, fbm(uv));
            vec3 cc = mix(vec3(1.0,0.96,0.9), vec3(1.0,0.85,0.65), pow(s,4.0));
            col = mix(col, cc * (1.0 - eagle * 0.8), c * 0.55 * smoothstep(0.02, 0.2, d.y));
          }
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      side: THREE.BackSide, depthWrite: false, fog: false,
    });
  }
  function buildSky() {
    const geo = new THREE.SphereGeometry(1000, 32, 16);
    W.sky = new THREE.Mesh(geo, skyMaterial());
    W.sky.frustumCulled = false;
    W.sky.renderOrder = -1;
    SA.scene.add(W.sky);
    SA.scene.fog = new THREE.Fog(W.skyColors.horizon.clone(), 60, SA.Q.far);
    // карта окружения для отражений и рассеянного света
    const envScene = new THREE.Scene();
    const envSky = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyMaterial());
    envScene.add(envSky);
    const groundDisk = new THREE.Mesh(new THREE.CircleGeometry(100, 16), new THREE.MeshBasicMaterial({ color: '#b39a78', side: THREE.DoubleSide }));
    groundDisk.rotation.x = -Math.PI / 2; groundDisk.position.y = -5;
    envScene.add(groundDisk);
    const pm = new THREE.PMREMGenerator(SA.renderer);
    SA.scene.environment = pm.fromScene(envScene, 0.04).texture;
    SA.scene.environmentIntensity = 0.55;
    pm.dispose();
  }
  function buildLights() {
    W.hemi = new THREE.HemisphereLight('#c9dcff', '#8a6f4e', 0.7);
    SA.scene.add(W.hemi);
    const sun = (W.sun = new THREE.DirectionalLight('#ffdcb0', 3.0));
    sun.position.copy(SUN_DIR).multiplyScalar(100);
    sun.castShadow = SA.Q.shadows;
    if (SA.Q.shadows) {
      sun.shadow.mapSize.set(SA.Q.shadowSize, SA.Q.shadowSize);
      const r = SA.settings.quality === 'high' ? 45 : 38;
      Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: 260 });
      sun.shadow.bias = -0.0005;
      sun.shadow.normalBias = 0.04;
    }
    SA.scene.add(sun, sun.target);
  }
  const _sp = new V3();
  W.updateSun = function (center) {
    const s = W.sun;
    if (!s.castShadow) return;
    const r = s.shadow.camera.right, texel = (2 * r) / SA.Q.shadowSize;
    _sp.set(Math.round(center.x / texel) * texel, 0, Math.round(center.z / texel) * texel);
    s.target.position.copy(_sp);
    s.position.copy(_sp).addScaledVector(SUN_DIR, 140);
  };
  W.setEagle = function (on) {
    const u = W.sky.material.uniforms;
    u.eagle.value = on ? 1 : 0;
    u.horizon.value.copy(on ? W.skyColors.eagleH : W.skyColors.horizon);
    u.zenith.value.copy(on ? W.skyColors.eagleZ : W.skyColors.zenith);
    SA.scene.fog.color.copy(on ? W.skyColors.eagleH : W.skyColors.horizon);
    SA.scene.fog.far = on ? 140 : SA.Q.far;
    W.sun.intensity = on ? 0.25 : 3.0;
    W.hemi.intensity = on ? 0.35 : 0.7;
    W.hemi.color.set(on ? '#4a6ad0' : '#c9dcff');
    SA.scene.environmentIntensity = on ? 0.15 : 0.55;
  };

  // ---------- Материалы и сборка мешей ----------
  function finalizeMeshes() {
    const T = SA.tex;
    const std = (o) => new THREE.MeshStandardMaterial(Object.assign({ vertexColors: true, roughness: 0.92, metalness: 0 }, o));
    const ns = (s) => new THREE.Vector2(s, s);
    MATS.plaster = std({ map: T.plaster.map, normalMap: T.plaster.normal, normalScale: ns(0.9) });
    MATS.plaster2 = std({ map: T.plaster2.map, normalMap: T.plaster2.normal, normalScale: ns(0.9) });
    MATS.roof = std({ map: T.roof.map, normalMap: T.roof.normal, roughness: 1 });
    MATS.stone = std({ map: T.stone.map, normalMap: T.stone.normal, normalScale: ns(1.2), roughness: 0.88 });
    MATS.wood = std({ map: T.wood.map, normalMap: T.wood.normal, roughness: 0.8 });
    MATS.dark = new THREE.MeshStandardMaterial({ color: '#120c08', roughness: 1 });
    MATS.hay = std({ map: T.hay, roughness: 1 });
    MATS.tiles = std({ map: T.tiles, roughness: 0.35, metalness: 0.05 });
    MATS.terracotta = std({ roughness: 0.85 });
    MATS.foliage = std({ map: T.foliage, roughness: 0.9 });
    MATS.frond = std({ map: T.frond, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85 });
    T.awnings.forEach((t, k) => (MATS['cloth:' + k] = std({ map: t, side: THREE.DoubleSide, roughness: 0.95 })));
    T.rugs.forEach((t, k) => (MATS['rug:' + k] = std({ map: t, side: THREE.DoubleSide, roughness: 1 })));
    T.foliage.wrapS = T.foliage.wrapT = THREE.RepeatWrapping;
    for (const b of builders.values()) {
      if (!b.i.length) continue;
      const m = b.mesh(MATS[b.mat]);
      m.castShadow = b.mat !== 'dark';
      m.receiveShadow = true;
      W.group.add(m);
    }
    builders.clear();
  }

  // ---------- Птицы и пыль ----------
  const birds = [];
  function makeBird(scale, col) {
    const g = new THREE.Group();
    const m = new THREE.MeshStandardMaterial({ color: col, roughness: 1, side: THREE.DoubleSide });
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.5, 5), m);
    body.rotation.x = Math.PI / 2; g.add(body);
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.12, 0.9, 0, -0.05, 0, 0, -0.15], 3));
    wg.computeVertexNormals();
    const wl = new THREE.Mesh(wg, m), wr = new THREE.Mesh(wg, m);
    wr.scale.x = -1;
    g.add(wl, wr);
    g.scale.setScalar(scale);
    g.userData = { wl, wr };
    return g;
  }
  function buildBirds() {
    for (let f = 0; f < 4; f++) {
      const cx = (rng() - 0.5) * 150, cz = (rng() - 0.5) * 150, r = 20 + rng() * 30, y = 30 + rng() * 15;
      for (let k = 0; k < 7; k++) {
        const b = makeBird(0.6, '#3a3330');
        SA.scene.add(b);
        birds.push({ o: b, cx, cz, r: r + (rng() - 0.5) * 6, y: y + (rng() - 0.5) * 4, sp: 0.25 + rng() * 0.05, ph: rng() * 6.28, flap: rng() * 6 });
      }
    }
    for (const t of towers) {
      const b = makeBird(1.6, '#4a3a2c');
      SA.scene.add(b);
      birds.push({ o: b, cx: t.x, cz: t.z, r: 9, y: t.h + 9, sp: 0.35, ph: rng() * 6.28, flap: 0, eagle: true, tower: t });
    }
  }
  let dust = null;
  function buildDust() {
    const N = SA.settings.quality === 'low' ? 120 : 320, pos = new Float32Array(N * 3);
    for (let k = 0; k < N * 3; k++) pos[k] = (Math.random() - 0.5) * 40;
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    dust = new THREE.Points(g, new THREE.PointsMaterial({ color: '#ffe8c4', size: 0.06, map: SA.tex.soft, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending }));
    dust.frustumCulled = false;
    SA.scene.add(dust);
  }
  W.update = function (dt, t, camPos) {
    W.sky.position.copy(camPos);
    W.sky.material.uniforms.time.value = t;
    for (const b of birds) {
      const a = b.ph + t * b.sp * (b.eagle ? 1 : 1);
      b.o.position.set(b.cx + Math.cos(a) * b.r, b.y + Math.sin(a * 2.3) * (b.eagle ? 0.6 : 1.5), b.cz + Math.sin(a) * b.r);
      b.o.rotation.y = -a;
      b.o.rotation.z = b.eagle ? 0.35 : 0.2;
      const fl = b.eagle ? Math.sin(t * 2) * 0.15 : Math.sin(t * 14 + b.flap) * 0.7;
      b.o.userData.wl.rotation.z = fl; b.o.userData.wr.rotation.z = -fl;
      if (b.tower) b.o.visible = !b.tower.synced;
    }
    for (const a of animated) {
      if (a.type === 'flag') {
        const p = a.o.geometry.attributes.position;
        for (let k = 0; k < p.count; k++) { const x = p.getX(k); p.setZ(k, Math.sin(x * 3 - t * 5 + a.ph) * 0.12 * x); }
        p.needsUpdate = true;
      } else if (a.type === 'banner') {
        a.o.rotation.x = Math.sin(t * 1.3 + a.ph) * 0.05;
      } else if (a.type === 'cloth') {
        a.o.rotation.x = Math.sin(t * 1.7 + a.ph) * 0.18;
      } else if (a.type === 'jets') {
        const p = a.o.geometry.attributes.position, s = a.seeds;
        for (let k = 0; k < p.count; k++) {
          const life = (t * 0.6 + s[k]) % 1, ang = s[k] * 6.28 * 7;
          const r = life * 1.9, y = 2.5 + life * 1.2 - life * life * 2.9;
          p.setXYZ(k, a.cx + Math.cos(ang) * r, y, a.cz + Math.sin(ang) * r);
        }
        p.needsUpdate = true;
      }
    }
    if (dust) {
      const p = dust.geometry.attributes.position;
      for (let k = 0; k < p.count; k++) {
        let x = p.getX(k) + Math.sin(t * 0.3 + k) * dt * 0.2, y = p.getY(k) + dt * 0.05, z = p.getZ(k) + dt * 0.15;
        if (x - camPos.x > 20) x -= 40; else if (x - camPos.x < -20) x += 40;
        if (y - camPos.y > 12) y -= 24; else if (y - camPos.y < -12) y += 24;
        if (z - camPos.z > 20) z -= 40; else if (z - camPos.z < -20) z += 40;
        p.setXYZ(k, x, y, z);
      }
      p.needsUpdate = true;
    }
  };

  // ---------- Навигация ----------
  const nodes = (W.nodes = []);
  const nodeGrid = [];
  function addNode(x, z, inner) { nodes.push({ x, z, inner: !!inner, adj: [] }); return nodes.length - 1; }
  function link(a, b) { if (a < 0 || b < 0) return; nodes[a].adj.push(b); nodes[b].adj.push(a); }
  function buildNav() {
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
  }
  W.nodeAt = (k, l) => nodes[nodeGrid[k][l]];
  W.nearestNode = function (x, z, filter) {
    let best = -1, bd = 1e9;
    for (let k = 0; k < nodes.length; k++) {
      const n = nodes[k];
      if (filter === 'outer' && n.inner) continue;
      if (filter === 'inner' && !n.inner) continue;
      const d = (n.x - x) ** 2 + (n.z - z) ** 2;
      if (d < bd) { bd = d; best = k; }
    }
    return best;
  };
  W.bfs = function (a, b) {
    if (a === b) return [b];
    const prev = new Int32Array(nodes.length).fill(-2);
    prev[a] = -1;
    const q = [a];
    for (let qi = 0; qi < q.length; qi++) {
      const n = q[qi];
      if (n === b) break;
      for (const m of nodes[n].adj) if (prev[m] === -2) { prev[m] = n; q.push(m); }
    }
    if (prev[b] === -2) return [];
    const path = [];
    for (let n = b; n !== -1; n = prev[n]) path.push(n);
    return path.reverse();
  };
  W.hideAt = function (x, z, y, pad) {
    pad = pad || 0;
    for (const h of hides) if (Math.abs(y - h.y) < 0.7 && Math.abs(x - h.x) < h.r + pad && Math.abs(z - h.z) < h.r + pad) return h;
    return null;
  };

  // ---------- Миникарта (стилизованный пергамент) ----------
  W.MAP_S = 2;
  function buildMinimap() {
    const c = (W.mapBase = document.createElement('canvas'));
    c.width = c.height = 240 * W.MAP_S;
    const g = c.getContext('2d'), tx = (x) => (x + 120) * W.MAP_S;
    g.fillStyle = '#2a241d'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#4a4033'; g.fillRect(tx(-108), tx(-108), 216 * W.MAP_S, 216 * W.MAP_S);
    for (const p of patches) { g.fillStyle = p.mat === 'flag' ? '#5c5143' : '#54493a'; g.fillRect(tx(p.x - p.w / 2), tx(p.z - p.d / 2), p.w * W.MAP_S, p.d * W.MAP_S); }
    for (const cc of colliders) {
      if (cc.thin || cc.y1 > 39) continue;
      const v = U.clamp(Math.floor(120 + cc.y1 * 5), 120, 225);
      g.fillStyle = `rgb(${v},${v - 14},${v - 40})`;
      g.fillRect(tx(cc.x0), tx(cc.z0), (cc.x1 - cc.x0) * W.MAP_S, (cc.z1 - cc.z0) * W.MAP_S);
    }
    g.fillStyle = '#7b6a52';
    g.fillRect(tx(-112), tx(-112), 224 * W.MAP_S, 4 * W.MAP_S); g.fillRect(tx(-112), tx(108), 224 * W.MAP_S, 4 * W.MAP_S);
    g.fillRect(tx(-112), tx(-112), 4 * W.MAP_S, 224 * W.MAP_S); g.fillRect(tx(108), tx(-112), 4 * W.MAP_S, 224 * W.MAP_S);
    g.fillStyle = '#d6b04c';
    for (const h of hides) g.fillRect(tx(h.x) - 2, tx(h.z) - 2, 4, 4);
  }
})(window.SA);
