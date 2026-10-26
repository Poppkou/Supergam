'use strict';
/* Персонажи: скиннинг-модели со скелетом и процедурная анимация. */
(function (SA) {
  const THREE = window.THREE, U = SA.U, V3 = THREE.Vector3;
  const R = (SA.rig = {});

  // ---------- Скелет ----------
  const BDEF = [
    ['root', null, 0, 0, 0], ['hips', 'root', 0, 0.98, 0], ['spine', 'hips', 0, 0.1, 0], ['chest', 'spine', 0, 0.2, 0],
    ['neck', 'chest', 0, 0.24, 0], ['head', 'neck', 0, 0.08, 0],
    ['clavL', 'chest', 0.06, 0.17, 0], ['uarmL', 'clavL', 0.14, 0, 0], ['farmL', 'uarmL', 0, -0.28, 0], ['handL', 'farmL', 0, -0.25, 0],
    ['clavR', 'chest', -0.06, 0.17, 0], ['uarmR', 'clavR', -0.14, 0, 0], ['farmR', 'uarmR', 0, -0.28, 0], ['handR', 'farmR', 0, -0.25, 0],
    ['thighL', 'hips', 0.1, -0.04, 0], ['shinL', 'thighL', 0, -0.42, 0], ['footL', 'shinL', 0, -0.44, 0],
    ['thighR', 'hips', -0.1, -0.04, 0], ['shinR', 'thighR', 0, -0.42, 0], ['footR', 'shinR', 0, -0.44, 0],
    ['tailB1', 'hips', 0, -0.02, -0.13], ['tailB2', 'tailB1', 0, -0.34, 0],
    ['tailFL', 'hips', 0.09, -0.02, 0.12], ['tailFR', 'hips', -0.09, -0.02, 0.12],
    ['blade', 'handR', 0, -0.03, 0], ['weapon', 'handR', 0, -0.04, 0], ['offhand', 'handL', 0, -0.04, 0],
  ];
  const BI = {}; BDEF.forEach((b, i) => (BI[b[0]] = i));
  const JP = {};
  for (const [n, p, x, y, z] of BDEF) { const pp = p ? JP[p] : [0, 0, 0]; JP[n] = [pp[0] + x, pp[1] + y, pp[2] + z]; }

  // ---------- Сборщик скиннинг-геометрии ----------
  class RB {
    constructor() { this.p = []; this.n = []; this.u = []; this.c = []; this.si = []; this.sw = []; this.idx = [[], [], []]; }
    add(g, m, col, wfn, grp, uvs) {
      const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
      const nm = new THREE.Matrix3().getNormalMatrix(m);
      const base = this.p.length / 3, v = new V3(), nn = new V3(), s = uvs || 1;
      for (let j = 0; j < pos.count; j++) {
        v.fromBufferAttribute(pos, j).applyMatrix4(m);
        nn.fromBufferAttribute(nor, j).applyMatrix3(nm).normalize();
        this.p.push(v.x, v.y, v.z); this.n.push(nn.x, nn.y, nn.z);
        this.u.push(uv ? uv.getX(j) * s : 0, uv ? uv.getY(j) * s : 0);
        const cc = typeof col === 'function' ? col(v) : col;
        this.c.push(cc.r, cc.g, cc.b);
        const w = wfn(v);
        let tot = 0;
        for (let k = 0; k < 4; k++) tot += w[k] ? w[k][1] : 0;
        for (let k = 0; k < 4; k++) { this.si.push(w[k] ? w[k][0] : 0); this.sw.push(w[k] ? w[k][1] / (tot || 1) : 0); }
      }
      const out = this.idx[grp || 0];
      if (g.index) for (let j = 0; j < g.index.count; j++) out.push(base + g.index.getX(j));
      else for (let j = 0; j < pos.count; j++) out.push(base + j);
    }
    build() {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
      g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
      const all = [];
      let start = 0;
      this.idx.forEach((list, k) => { for (const i of list) all.push(i); g.addGroup(start, list.length, k); start += list.length; });
      g.setIndex(all);
      g.boundingSphere = new THREE.Sphere(new V3(0, 1, 0), 2.2);
      return g;
    }
  }

  // ---------- Геометрические заготовки ----------
  const ID = new THREE.Matrix4();
  const M = (x, y, z, rx, ry, rz, sx, sy, sz) => new THREE.Matrix4().compose(new V3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx || 0, ry || 0, rz || 0)), new V3(sx || 1, sy === undefined ? sx || 1 : sy, sz === undefined ? sx || 1 : sz));
  // Лофт по эллиптическим сечениям: rings [{y, rx, rz, x, z}], угол θ=0 смотрит вперёд (+z)
  function loft(rings, seg, a0, a1) {
    seg = seg || 12; a0 = a0 === undefined ? 0 : a0; a1 = a1 === undefined ? Math.PI * 2 : a1;
    const pos = [], uv = [], idx = [];
    for (let r = 0; r < rings.length; r++) {
      const R0 = rings[r];
      for (let s = 0; s <= seg; s++) {
        const a = a0 + (a1 - a0) * (s / seg);
        pos.push((R0.x || 0) + Math.sin(a) * R0.rx, R0.y, (R0.z || 0) + Math.cos(a) * R0.rz);
        uv.push(a * 0.6, R0.y * 3);
      }
    }
    for (let r = 0; r < rings.length - 1; r++) for (let s = 0; s < seg; s++) {
      const a = r * (seg + 1) + s, b = a + seg + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }
  const SPH = new THREE.SphereGeometry(1, 14, 10);
  const SPH_S = new THREE.SphereGeometry(1, 8, 6);
  const BOX = new THREE.BoxGeometry(1, 1, 1);
  const CYL = new THREE.CylinderGeometry(1, 1, 1, 10);

  // ---------- Веса ----------
  const rig = (n) => { const i = BI[n]; const w = [[i, 1]]; return () => w; };
  const blendY = (lo, hi, y0, y1) => { const a = BI[lo], b = BI[hi]; return (v) => { const t = U.smooth(y0, y1, v.y); return [[a, 1 - t], [b, t]]; }; };
  const torsoW = (v) => {
    const ax = Math.abs(v.x), sideArm = v.x > 0 ? BI.uarmL : BI.uarmR;
    if (v.y < 1.1) { const t = U.smooth(0.98, 1.1, v.y); return [[BI.hips, 1 - t], [BI.spine, t]]; }
    const t = U.smooth(1.12, 1.3, v.y), arm = U.smooth(0.15, 0.21, ax) * U.smooth(1.36, 1.45, v.y) * 0.45, nk = U.smooth(1.5, 1.58, v.y) * 0.6;
    return [[BI.spine, (1 - t) * (1 - arm)], [BI.chest, t * (1 - arm) * (1 - nk)], [sideArm, arm], [BI.neck, t * nk]];
  };
  const armW = (side) => (v) => { const t = U.smooth(1.23, 1.11, v.y), h = U.smooth(0.95, 0.9, v.y); return [[BI['uarm' + side], 1 - t], [BI['farm' + side], t * (1 - h)], [BI['hand' + side], h]]; };
  const legW = (side) => (v) => {
    if (v.y > 0.9) { const t = U.smooth(1.0, 0.9, v.y); return [[BI.hips, 1 - t], [BI['thigh' + side], t]]; }
    if (v.y > 0.12) { const t = U.smooth(0.6, 0.46, v.y); return [[BI['thigh' + side], 1 - t], [BI['shin' + side], t]]; }
    const t = U.smooth(0.13, 0.09, v.y); return [[BI['shin' + side], 1 - t], [BI['foot' + side], t]];
  };
  // Подол: по бокам тянется за бёдрами, сзади — за хвостами
  const skirtW = (v) => {
    const back = v.z < -0.06 && Math.abs(v.x) < 0.17;
    if (back) {
      if (v.y > 0.64) { const t = U.smooth(0.98, 0.7, v.y); return [[BI.hips, 1 - t], [BI.tailB1, t]]; }
      const t = U.smooth(0.64, 0.42, v.y); return [[BI.tailB1, 1 - t], [BI.tailB2, t]];
    }
    const t = U.smooth(1.0, 0.55, v.y) * 0.85, side = v.x >= 0 ? 'L' : 'R';
    const front = v.z > 0.08 ? U.smooth(0.08, 0.16, v.z) * 0.5 : 0;
    const thigh = t * (1 - front), flap = t * front;
    return [[BI.hips, 1 - t], [BI['thigh' + side], thigh], [BI['tailF' + side], flap]];
  };
  const longSkirtW = (v) => {
    const t = U.smooth(0.98, 0.3, v.y), side = v.x >= 0 ? 'L' : 'R', ax = U.smooth(0.0, 0.12, Math.abs(v.x));
    const lowLeg = U.smooth(0.5, 0.1, v.y) * 0.4;
    const th = t * 0.75 * ax;
    return [[BI.hips, 1 - th - lowLeg * ax], [BI['thigh' + side], th], [BI['shin' + side], lowLeg * ax]];
  };

  // ---------- Внешность ----------
  const C = (h) => new THREE.Color(h);
  const SKINS = ['#c6966c', '#b07f58', '#d2a57c', '#9c6b48', '#c08a62'];
  const HAIRS = ['#1f1611', '#2b1d14', '#3a2a1c', '#151010', '#5a4a3a', '#8a8378'];
  const ROBES_M = ['#7a5c3e', '#8b7d6b', '#5d6b4a', '#9a7b5a', '#6b4f3a', '#a08a6a', '#4e5d6c', '#7b3f3f', '#c2b49a', '#d9cdb4', '#5a4a6a'];
  const ROBES_F = ['#7b2f3f', '#2f4f6f', '#5a3a5f', '#8a5a2a', '#3f5a4a', '#a0522d', '#4a3a6a', '#6a2a2a'];
  const HATS = ['#e8e2d4', '#c9b08e', '#6b4f3a', '#a3162b', '#2f5f8a', '#ffffff', '#3a3a3a'];
  R.looks = {
    assassin: { skin: '#b5865e', robe: '#ece6d8', low: '#e4dccb', pants: '#d6cdb9', boots: '#3b2b1f', sash: '#9e1626', belt: '#3b2b1f', head: 'hood', skirt: 'assassin', mantle: true, bracers: true, hiddenBlade: true, sword: 'hip', faceShadow: true, knives: true },
    guard: { robe: '#6b4a32', low: '#6b4a32', pants: '#4a3a2c', boots: '#2b2018', belt: '#3b2b1f', head: 'helmet', skirt: 'tunic', chain: true, tabard: '#e3dccb', cross: true, sword: 'hand' },
    elite: { robe: '#e8e2d4', low: '#e8e2d4', pants: '#5a5f66', boots: '#2b2018', belt: '#2b2018', head: 'helmet', skirt: 'tunic', chain: true, tabard: '#f1ebdd', cross: true, sword: 'hand', cape: '#e8e2d4' },
    archer: { robe: '#4b5a3a', low: '#4b5a3a', pants: '#3d3026', boots: '#2b2018', belt: '#3b2b1f', head: 'helmet', skirt: 'tunic', leather: '#6b5338', bow: true, quiver: true },
    captain: { robe: '#2a2a33', low: '#2a2a33', pants: '#2a2a33', boots: '#1a1a1a', belt: '#c9a24a', head: 'helmet', skirt: 'tunic', chain: true, tabard: '#1f2a44', cross: false, sword: 'hand', cape: '#7a1620', beard: true },
    master: { robe: '#efe9dc', low: '#efe9dc', pants: '#5a5f66', boots: '#2b2018', belt: '#c9a24a', head: 'hair', hair: '#9a948a', beard: true, skirt: 'tunic', chain: true, tabard: '#f6f1e6', cross: true, sword: 'hand', cape: '#efe9dc' },
    collector: { robe: '#6b1f2a', low: '#6b1f2a', pants: '#3a2a1c', boots: '#2b2018', belt: '#c9a24a', sash: '#c9a24a', head: 'turban', hat: '#e8e2d4', skirt: 'long', beard: true, gold: true, fat: true },
    courier: { robe: '#8a6a2a', low: '#8a6a2a', pants: '#3d3026', boots: '#2b2018', belt: '#3b2b1f', sash: '#a3162b', head: 'hair', skirt: 'tunic', satchel: true },
    traitor: { robe: '#3d2b4a', low: '#3d2b4a', pants: '#2a1f17', boots: '#2b2018', belt: '#c79a2a', sash: '#c79a2a', head: 'turban', hat: '#c79a2a', skirt: 'long', beard: true },
  };
  R.randomCiv = function (rnd) {
    const female = rnd() < 0.4;
    const p = (a) => a[Math.floor(rnd() * a.length)];
    if (female) return { female: true, skin: p(SKINS), robe: p(ROBES_F), low: p(ROBES_F), pants: '#3a2a1c', boots: '#2b2018', belt: p(['#c9a24a', '#3b2b1f', '#e8e2d4']), head: 'veil', hat: p(['#e8e2d4', '#2a2a2a', '#7b2f3f', '#c9b08e', '#2f4f6f']), skirt: 'dress', jar: rnd() < 0.25 };
    const head = p(['turban', 'turban', 'kufiya', 'hair', 'cap']);
    return { skin: p(SKINS), hair: p(HAIRS), robe: p(ROBES_M), low: p(ROBES_M), pants: '#4a3a2c', boots: '#2b2018', belt: p(['#3b2b1f', '#5a4030', '#a3162b', '#c9a24a']), sash: rnd() < 0.4 ? p(HATS) : null, head, hat: p(HATS), beard: rnd() < 0.6, skirt: rnd() < 0.7 ? 'long' : 'tunic', vest: rnd() < 0.3 ? p(['#3a2a1c', '#5a3a2a', '#2a3a4a']) : null, basket: rnd() < 0.12 };
  };

  // ---------- Материалы персонажей ----------
  let MAT = null;
  function mats() {
    if (MAT) return MAT;
    const T = SA.tex;
    MAT = {
      cloth: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, map: T.fabric.map, normalMap: T.fabric.normal, normalScale: new THREE.Vector2(0.6, 0.6), side: THREE.DoubleSide }),
      chain: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.8, normalMap: T.chain.normal, normalScale: new THREE.Vector2(1.2, 1.2) }),
      steel: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25, metalness: 0.95 }),
      glowRed: new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0.55, depthTest: false, depthWrite: false }),
      glowGold: new THREE.MeshBasicMaterial({ color: 0xffc83a, transparent: true, opacity: 0.75, depthTest: false, depthWrite: false }),
      glowBlue: new THREE.MeshBasicMaterial({ color: 0x6aa8ff, transparent: true, opacity: 0.22, depthTest: false, depthWrite: false }),
      glowWhite: new THREE.MeshBasicMaterial({ color: 0xbfe0ff, transparent: true, opacity: 0.35, depthTest: false, depthWrite: false }),
    };
    return MAT;
  }

  // ---------- Сборка персонажа ----------
  function buildGeometry(L) {
    const rb = new RB();
    const skin = C(L.skin || '#c6966c'), robe = C(L.robe), low = C(L.low || L.robe), pants = C(L.pants || '#4a3a2c');
    const boots = C(L.boots || '#2b2018'), belt = C(L.belt || '#3b2b1f'), hair = C(L.hair || '#2b1d14');
    const metal = C('#9aa0a8'), steel = C('#d8dde3'), gold = C('#c9a24a'), leather = C(L.leather || '#5a4030');
    const fat = L.fat ? 1.18 : 1, fem = L.female;
    const W = (k) => (fem ? 0.9 : 1) * k;
    // торс
    const torsoRings = [
      { y: 0.96, rx: W(0.155) * fat, rz: 0.11 * fat }, { y: 1.08, rx: W(0.145) * fat, rz: 0.105 * fat }, { y: 1.2, rx: W(0.158) * fat, rz: 0.115 * fat },
      { y: 1.32, rx: W(0.178), rz: fem ? 0.125 : 0.12 }, { y: 1.43, rx: W(0.19), rz: 0.112 }, { y: 1.49, rx: W(0.135), rz: 0.09 }, { y: 1.54, rx: 0.06, rz: 0.055 },
    ];
    const torsoCol = L.chain ? metal : L.leather ? leather : robe;
    rb.add(loft(torsoRings, 14), ID, torsoCol, torsoW, L.chain ? 1 : 0);
    if (L.vest) rb.add(loft(torsoRings.slice(1, 5).map((r) => ({ y: r.y, rx: r.rx + 0.008, rz: r.rz + 0.008 })), 14, 0.5, Math.PI * 2 - 0.5), ID, C(L.vest), torsoW);
    // шея и голова
    rb.add(loft([{ y: 1.5, rx: 0.052, rz: 0.05 }, { y: 1.63, rx: 0.048, rz: 0.048 }], 8), ID, skin, blendY('neck', 'head', 1.53, 1.6));
    const faceC = L.faceShadow ? skin.clone().multiplyScalar(0.55) : skin;
    rb.add(SPH, M(0, 1.685, 0, 0, 0, 0, 0.092, 0.108, 0.1), faceC, rig('head'));
    rb.add(SPH_S, M(0, 1.625, 0.03, 0, 0, 0, 0.068, 0.05, 0.065), faceC, rig('head'));
    rb.add(BOX, M(0, 1.668, 0.1, 0.25, 0, 0, 0.026, 0.045, 0.03), faceC, rig('head'));
    for (const s of [1, -1]) {
      rb.add(SPH_S, M(s * 0.034, 1.698, 0.087, 0, 0, 0, 0.014, 0.01, 0.008), C('#1a120e'), rig('head'));
      rb.add(SPH_S, M(s * 0.09, 1.68, 0, 0, 0, 0, 0.016, 0.03, 0.022), faceC, rig('head'));
      if (!L.faceShadow) rb.add(BOX, M(s * 0.034, 1.722, 0.093, 0, 0, s * -0.1, 0.03, 0.007, 0.01), hair, rig('head'));
    }
    if (L.beard) rb.add(SPH, M(0, 1.6, 0.055, 0.2, 0, 0, 0.072, 0.06, 0.055), hair, rig('head'));
    // голова: капюшон / шлем / тюрбан / платок
    if (L.head === 'hood') {
      const g = new THREE.SphereGeometry(0.14, 18, 12, Math.PI / 2 + 0.7, Math.PI * 2 - 1.4, 0, Math.PI * 0.8);
      const p = g.attributes.position;
      for (let j = 0; j < p.count; j++) {
        let x = p.getX(j), y = p.getY(j), z = p.getZ(j);
        z += y > 0 ? y * y * 3.2 * U.smooth(-0.08, 0.12, z) : 0;
        y *= 1.12; z = z * 1.12 - 0.012;
        if (y < -0.05) { const k = U.smooth(-0.05, -0.12, y); x *= 1 + k * 0.4; z *= 1 + k * 0.25; }
        p.setXYZ(j, x, y, z);
      }
      g.computeVertexNormals();
      rb.add(g, M(0, 1.69, -0.005), robe, (v) => (v.y > 1.6 ? [[BI.head, 1]] : [[BI.head, 0.5], [BI.neck, 0.5]]));
    } else if (L.head === 'helmet') {
      rb.add(new THREE.SphereGeometry(0.115, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), M(0, 1.7, 0, 0, 0, 0, 1, 1.18, 1.06), steel, rig('head'), 2);
      rb.add(new THREE.CylinderGeometry(0.118, 0.12, 0.03, 14), M(0, 1.7, 0), metal, rig('head'), 2);
      rb.add(BOX, M(0, 1.665, 0.112, 0, 0, 0, 0.016, 0.08, 0.012), steel, rig('head'), 2);
      if (L.chain) rb.add(loft([{ y: 1.7, rx: 0.112, rz: 0.115 }, { y: 1.6, rx: 0.12, rz: 0.12 }, { y: 1.5, rx: 0.16, rz: 0.13 }], 14, 0.9, Math.PI * 2 - 0.9), ID, metal, (v) => (v.y > 1.6 ? [[BI.head, 1]] : [[BI.neck, 0.6], [BI.chest, 0.4]]), 1);
    } else if (L.head === 'turban' || L.head === 'kufiya' || L.head === 'cap') {
      const hc = C(L.hat || '#e8e2d4');
      if (L.head === 'turban') {
        for (let k = 0; k < 3; k++) rb.add(new THREE.TorusGeometry(0.095 - k * 0.012, 0.036, 6, 16), M(0, 1.73 + k * 0.035, -0.005, Math.PI / 2, 0, k * 0.3), hc.clone().multiplyScalar(1 - k * 0.06), rig('head'));
        rb.add(SPH, M(0, 1.76, -0.005, 0, 0, 0, 0.09, 0.06, 0.09), hc, rig('head'));
      } else if (L.head === 'kufiya') {
        rb.add(new THREE.SphereGeometry(0.112, 14, 10, Math.PI / 2 + 0.85, Math.PI * 2 - 1.7, 0, Math.PI * 0.62), M(0, 1.69, -0.01, 0, 0, 0, 1, 1.1, 1.08), hc, rig('head'));
        rb.add(loft([{ y: 1.66, rx: 0.115, rz: 0.11, z: -0.01 }, { y: 1.5, rx: 0.16, rz: 0.13, z: -0.03 }], 12, 1.0, Math.PI * 2 - 1.0), ID, hc, (v) => (v.y > 1.6 ? [[BI.head, 1]] : [[BI.neck, 0.5], [BI.chest, 0.5]]));
        rb.add(new THREE.TorusGeometry(0.105, 0.012, 5, 16), M(0, 1.755, -0.01, Math.PI / 2), C('#1a1a1a'), rig('head'));
      } else {
        rb.add(new THREE.SphereGeometry(0.105, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.45), M(0, 1.7, -0.005, 0, 0, 0, 1, 1.05, 1.05), hc, rig('head'));
      }
      if (L.head === 'cap') rb.add(new THREE.SphereGeometry(0.105, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), M(0, 1.69, -0.01, -0.4, 0, 0, 0.98, 1.0, 1.02), hair, rig('head'));
    } else if (L.head === 'veil') {
      const hc = C(L.hat);
      rb.add(new THREE.SphereGeometry(0.118, 16, 12, Math.PI / 2 + 0.75, Math.PI * 2 - 1.5, 0, Math.PI * 0.75), M(0, 1.69, -0.008, 0, 0, 0, 1, 1.1, 1.08), hc, (v) => (v.y > 1.6 ? [[BI.head, 1]] : [[BI.head, 0.5], [BI.neck, 0.5]]));
      rb.add(loft([{ y: 1.62, rx: 0.12, rz: 0.11, z: -0.01 }, { y: 1.5, rx: 0.18, rz: 0.14, z: -0.02 }, { y: 1.34, rx: 0.23, rz: 0.15, z: -0.02 }], 14, 0.95, Math.PI * 2 - 0.95), ID, hc, (v) => (v.y > 1.6 ? [[BI.head, 1]] : v.y > 1.45 ? [[BI.neck, 0.5], [BI.chest, 0.5]] : [[BI.chest, 1]]));
    } else {
      rb.add(new THREE.SphereGeometry(0.104, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.58), M(0, 1.69, -0.012, -0.45, 0, 0, 0.98, 1.06, 1.04), hair, rig('head'));
    }
    // накидка на плечах (ассасин)
    if (L.mantle) rb.add(loft([{ y: 1.6, rx: 0.1, rz: 0.1 }, { y: 1.5, rx: 0.17, rz: 0.13 }, { y: 1.42, rx: 0.235, rz: 0.15 }, { y: 1.33, rx: 0.25, rz: 0.16 }], 16, 0.55, Math.PI * 2 - 0.55), ID, robe, torsoW);
    // руки
    for (const s of [1, -1]) {
      const side = s > 0 ? 'L' : 'R', x = s * 0.205;
      const sleeve = L.chain ? metal : L.leather ? leather : robe;
      const wide = L.skirt === 'long' || L.female ? 0.012 : 0;
      rb.add(loft([{ y: 1.49, rx: 0.066, rz: 0.066, x }, { y: 1.34, rx: 0.058, rz: 0.058, x }, { y: 1.18, rx: 0.05, rz: 0.05, x }, { y: 1.05, rx: 0.047 + wide, rz: 0.047 + wide, x }, { y: 0.95, rx: 0.04 + wide * 1.5, rz: 0.04 + wide * 1.5, x }], 10), ID, sleeve, armW(side), L.chain ? 1 : 0);
      rb.add(SPH, M(x, 1.45, 0, 0, 0, 0, 0.075, 0.07, 0.072), sleeve, (v) => [[BI['uarm' + side], 0.6], [BI.chest, 0.4]], L.chain ? 1 : 0);
      if (L.bracers || L.chain) rb.add(loft([{ y: 1.1, rx: 0.052, rz: 0.052, x }, { y: 0.95, rx: 0.045, rz: 0.045, x }], 10), ID, L.chain ? C('#4a3a2c') : C('#3b2b1f'), armW(side));
      rb.add(BOX, M(x, 0.885, 0.005, 0, 0, 0, 0.065, 0.1, 0.035), skin, rig('hand' + side));
      rb.add(BOX, M(x - s * 0.035, 0.9, 0.02, 0, 0, s * 0.4, 0.022, 0.05, 0.022), skin, rig('hand' + side));
    }
    // таз и ноги
    rb.add(loft([{ y: 1.06, rx: 0.15 * fat, rz: 0.11 * fat }, { y: 0.96, rx: 0.162 * fat, rz: 0.118 * fat }, { y: 0.87, rx: 0.14, rz: 0.105 }], 14), ID, pants, (v) => {
      if (v.y > 0.95) return [[BI.hips, 1]];
      const t = U.smooth(0.95, 0.87, v.y) * U.smooth(0.0, 0.08, Math.abs(v.x)) * 0.6;
      return [[BI.hips, 1 - t], [BI[v.x >= 0 ? 'thighL' : 'thighR'], t]];
    });
    for (const s of [1, -1]) {
      const side = s > 0 ? 'L' : 'R', x = s * 0.1;
      rb.add(loft([{ y: 0.98, rx: 0.088, rz: 0.09, x }, { y: 0.8, rx: 0.077, rz: 0.08, x }, { y: 0.6, rx: 0.06, rz: 0.062, x }, { y: 0.5, rx: 0.054, rz: 0.058, x }, { y: 0.38, rx: 0.053, rz: 0.056, x }, { y: 0.2, rx: 0.043, rz: 0.046, x }, { y: 0.1, rx: 0.04, rz: 0.042, x }], 10), ID, pants, legW(side));
      rb.add(loft([{ y: 0.4, rx: 0.058, rz: 0.062, x }, { y: 0.2, rx: 0.05, rz: 0.054, x }, { y: 0.08, rx: 0.048, rz: 0.06, x, z: 0.01 }], 10), ID, boots, legW(side));
      rb.add(BOX, M(x, 0.04, 0.045, 0, 0, 0, 0.095, 0.08, 0.25), boots, (v) => [[BI['foot' + side], 1]]);
    }
    // пояс и кушак
    rb.add(loft([{ y: 1.07, rx: 0.162 * fat, rz: 0.122 * fat }, { y: 1.0, rx: 0.168 * fat, rz: 0.127 * fat }], 14), ID, belt, blendY('hips', 'spine', 1.0, 1.1));
    if (L.sash) {
      rb.add(loft([{ y: 1.13, rx: 0.155 * fat, rz: 0.115 * fat }, { y: 1.06, rx: 0.165 * fat, rz: 0.124 * fat }], 14), ID, C(L.sash), blendY('hips', 'spine', 1.0, 1.1));
      rb.add(BOX, M(0.07, 0.86, 0.125, 0, 0, 0.05, 0.075, 0.32, 0.012), C(L.sash), (v) => [[BI.hips, 0.4], [BI.tailFL, 0.6]]);
    }
    rb.add(BOX, M(0, 1.035, 0.13 * fat, 0, 0, 0, 0.05, 0.045, 0.012), L.gold ? gold : C('#8a8a8a'), rig('hips'), 2);
    // подол
    if (L.skirt === 'assassin') {
      const rings = [{ y: 1.02, rx: 0.168, rz: 0.128 }, { y: 0.86, rx: 0.2, rz: 0.15 }, { y: 0.68, rx: 0.24, rz: 0.18 }, { y: 0.5, rx: 0.27, rz: 0.2 }];
      rb.add(loft(rings, 8, 0.38, 2.5), ID, low, skirtW);
      rb.add(loft(rings, 8, -2.5, -0.38), ID, low, skirtW);
      const back = [{ y: 1.0, rx: 0.17, rz: 0.13 }, { y: 0.8, rx: 0.2, rz: 0.17 }, { y: 0.6, rx: 0.21, rz: 0.2 }, { y: 0.4, rx: 0.21, rz: 0.22 }];
      rb.add(loft(back, 8, 2.5, Math.PI * 2 - 2.5), ID, low, skirtW);
      rb.add(loft(rings.slice(0, 1).concat([{ y: 0.95, rx: 0.18, rz: 0.142 }]), 14, 0, Math.PI * 2), ID, C('#9e1626'), blendY('hips', 'spine', 1.0, 1.1));
    } else if (L.skirt === 'tunic') {
      const rings = [{ y: 1.02, rx: 0.17, rz: 0.13 }, { y: 0.82, rx: 0.21, rz: 0.165 }, { y: 0.6, rx: 0.245, rz: 0.195 }];
      rb.add(loft(rings, 18), ID, L.chain ? metal : low, skirtW, L.chain ? 1 : 0);
    } else if (L.skirt === 'long' || L.skirt === 'dress') {
      const wide = L.skirt === 'dress' ? 1.15 : 1;
      const rings = [{ y: 1.03, rx: 0.17 * fat, rz: 0.13 * fat }, { y: 0.8, rx: 0.21 * wide * fat, rz: 0.17 * wide * fat }, { y: 0.5, rx: 0.25 * wide, rz: 0.21 * wide }, { y: 0.12, rx: 0.28 * wide, rz: 0.24 * wide }];
      rb.add(loft(rings, 18), ID, low, longSkirtW);
    }
    // гербовое сюрко
    if (L.tabard) {
      const tc = C(L.tabard);
      const tr = [{ y: 1.47, rx: 0.2, rz: 0.13 }, { y: 1.2, rx: 0.175, rz: 0.13 }, { y: 1.0, rx: 0.18, rz: 0.14 }, { y: 0.78, rx: 0.22, rz: 0.17 }, { y: 0.56, rx: 0.25, rz: 0.2 }];
      const tw = (v) => (v.y > 1.0 ? torsoW(v) : skirtW(v));
      rb.add(loft(tr, 8, -0.85, 0.85), ID, tc, tw);
      rb.add(loft(tr, 8, Math.PI - 0.85, Math.PI + 0.85), ID, tc, tw);
      if (L.cross) {
        const red = C('#9a1524');
        for (const zs of [1, -1]) {
          rb.add(BOX, M(0, 1.2, zs * 0.142, 0, 0, 0, 0.055, 0.34, 0.006), red, torsoW);
          rb.add(BOX, M(0, 1.27, zs * 0.142, 0, 0, 0, 0.22, 0.055, 0.006), red, torsoW);
        }
      }
    }
    if (L.cape) {
      const cc = C(L.cape);
      rb.add(loft([{ y: 1.5, rx: 0.17, rz: 0.12 }, { y: 1.2, rx: 0.24, rz: 0.17 }, { y: 0.8, rx: 0.28, rz: 0.2 }, { y: 0.35, rx: 0.3, rz: 0.22 }], 10, Math.PI - 1.2, Math.PI + 1.2), ID, cc, (v) => {
        if (v.y > 1.0) return [[BI.chest, 1]];
        if (v.y > 0.64) { const t = U.smooth(1.0, 0.7, v.y); return [[BI.chest, 1 - t], [BI.tailB1, t]]; }
        const t = U.smooth(0.64, 0.42, v.y); return [[BI.tailB1, 1 - t], [BI.tailB2, t]];
      });
    }
    // оружие и снаряжение
    if (L.hiddenBlade) rb.add(BOX, M(-0.205, 0.78, 0.0, 0, 0, 0, 0.012, 0.24, 0.022), steel, rig('blade'), 2);
    const swordAt = (wfn, mtx) => {
      rb.add(BOX, mtx.clone().multiply(M(0, 0.42, 0, 0, 0, 0, 0.045, 0.78, 0.008)), steel, wfn, 2);
      rb.add(BOX, mtx.clone().multiply(M(0, 0.02, 0, 0, 0, 0, 0.17, 0.025, 0.03)), gold, wfn, 2);
      rb.add(CYL, mtx.clone().multiply(M(0, -0.07, 0, 0, 0, 0, 0.016, 0.16, 0.016)), C('#3b2b1f'), wfn);
      rb.add(SPH_S, mtx.clone().multiply(M(0, -0.16, 0, 0, 0, 0, 0.025)), gold, wfn, 2);
    };
    if (L.sword === 'hand') swordAt(rig('weapon'), M(-0.205, 0.87, 0.04, Math.PI / 2 - 0.35, 0, 0));
    if (L.sword === 'hip' || L.sword === 'hand') {
      const sm = M(0.19, 0.83, -0.02, 0.35, 0, 0.15);
      rb.add(BOX, sm.clone().multiply(M(0, -0.32, 0, 0, 0, 0, 0.06, 0.74, 0.03)), C('#2b1d14'), rig('hips'));
      if (L.sword === 'hip') { rb.add(CYL, sm.clone().multiply(M(0, 0.12, 0, 0, 0, 0, 0.016, 0.16, 0.016)), C('#3b2b1f'), rig('hips')); rb.add(BOX, sm.clone().multiply(M(0, 0.05, 0, 0, 0, 0, 0.15, 0.025, 0.03)), metal, rig('hips'), 2); }
    }
    if (L.knives) for (let k = 0; k < 4; k++) rb.add(BOX, M(-0.06 + k * 0.035, 1.34, -0.125, 0.2, 0, -0.5, 0.018, 0.12, 0.012), metal, rig('chest'), 2);
    if (L.knives) rb.add(BOX, M(0, 1.3, -0.118, 0, 0, -0.55, 0.06, 0.42, 0.012), C('#3b2b1f'), rig('chest'));
    if (L.bow) {
      rb.add(new THREE.TorusGeometry(0.55, 0.013, 4, 22, Math.PI * 0.85), M(0.205, 0.87, 0.05, 0, Math.PI / 2, Math.PI / 2 + Math.PI * 0.075), C('#5a3a20'), rig('offhand'));
      rb.add(BOX, M(0.205, 0.87, -0.04, 0, 0, 0, 0.004, 1.08, 0.004), C('#d8d0c0'), rig('offhand'));
    }
    if (L.quiver) {
      rb.add(CYL, M(0.08, 1.25, -0.16, 0.25, 0, -0.35, 0.055, 0.5, 0.055), C('#5a4030'), rig('chest'));
      for (let k = 0; k < 5; k++) rb.add(BOX, M(0.13 + k * 0.012, 1.52, -0.22, 0.25, 0, -0.35, 0.008, 0.18, 0.03), C('#d8d0c0'), rig('chest'));
    }
    if (L.satchel) rb.add(BOX, M(0.2, 0.95, 0.02, 0, 0, 0, 0.07, 0.2, 0.22), C('#6b5338'), rig('hips'));
    if (L.jar) rb.add(new THREE.LatheGeometry([[0, 0], [0.1, 0.01], [0.16, 0.1], [0.15, 0.22], [0.07, 0.3], [0.08, 0.34]].map(([a, b]) => new THREE.Vector2(a, b)), 10), M(0, 1.79, 0), C('#b8643c'), rig('head'));
    if (L.basket) rb.add(new THREE.CylinderGeometry(0.17, 0.13, 0.16, 12, 1, true), M(0.25, 0.88, 0.08), C('#b38a35'), rig('handL'));
    if (L.gold) rb.add(new THREE.TorusGeometry(0.1, 0.012, 5, 14), M(0, 1.45, 0.05, Math.PI / 2 - 0.4), gold, rig('chest'), 2);
    return rb.build();
  }

  R.create = function (look) {
    const L = typeof look === 'string' ? R.looks[look] : look;
    const m = mats();
    const geo = buildGeometry(L);
    const bones = {}, list = [];
    for (const [n, p, x, y, z] of BDEF) {
      const b = new THREE.Bone(); b.name = n; b.position.set(x, y, z);
      if (p) bones[p].add(b);
      bones[n] = b; list.push(b);
    }
    const mesh = new THREE.SkinnedMesh(geo, [m.cloth, m.chain, m.steel]);
    mesh.add(bones.root);
    mesh.updateMatrixWorld(true);
    const skel = new THREE.Skeleton(list);
    mesh.bind(skel);
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
    const glow = new THREE.SkinnedMesh(geo, m.glowRed);
    glow.bind(skel, mesh.bindMatrix);
    glow.visible = false; glow.renderOrder = 5; glow.frustumCulled = false;
    const root = new THREE.Group();
    root.add(mesh, glow);
    bones.blade.scale.setScalar(0.001);
    if (L.sword === 'hand') bones.weapon.scale.setScalar(0.001);
    const ch = { root, mesh, glow, bones, look: L, ph: Math.random() * 6, t: Math.random() * 10, hipsY: 0.98, stepSide: 0, tail: 0, hipRot: new V3(), drawn: false };
    return ch;
  };
  R.setGlow = function (ch, kind) {
    const m = mats();
    if (!kind) { ch.glow.visible = false; return; }
    ch.glow.material = kind === 'gold' ? m.glowGold : kind === 'blue' ? m.glowBlue : kind === 'white' ? m.glowWhite : m.glowRed;
    ch.glow.visible = true;
  };
  R.setBlade = (ch, on) => ch.bones.blade.scale.setScalar(on ? 1 : 0.001);
  R.setSword = (ch, on) => { if (ch.look.sword === 'hand') { ch.bones.weapon.scale.setScalar(on ? 1 : 0.001); ch.drawn = on; } };
  R.dispose = function (ch) { ch.mesh.geometry.dispose(); ch.mesh.skeleton.dispose(); };

  // ---------- Процедурная анимация ----------
  const TG = {};
  for (const [n] of BDEF) TG[n] = [0, 0, 0];
  function zero() { for (const n in TG) { TG[n][0] = 0; TG[n][1] = 0; TG[n][2] = 0; } }
  const GAITS = {
    walk: { stride: 1.45, A: 0.42, B: 0.8, arm: 0.32, eb: 0.22, ea: 0.3, lean: 0.04, bob: 0.025, tw: 0.06 },
    run: { stride: 2.5, A: 0.75, B: 1.4, arm: 0.65, eb: 1.25, ea: 0.3, lean: 0.17, bob: 0.05, tw: 0.1 },
    sprint: { stride: 3.4, A: 0.95, B: 1.75, arm: 0.9, eb: 1.45, ea: 0.2, lean: 0.3, bob: 0.06, tw: 0.12 },
    sneak: { stride: 1.05, A: 0.3, B: 0.55, arm: 0, eb: 0, ea: 0, lean: 0.12, bob: 0.015, tw: 0.03 },
  };
  // st: { mode, speed, p (прогресс 0..1), vy, look, carry, combat, gesture, fwd }
  R.animate = function (ch, dt, st) {
    zero();
    const b = ch.bones, mode = st.mode;
    ch.t += dt;
    const t = ch.t;
    let hipsY = 0.98, hx = 0, hz = 0, stepped = false, rate = 14;
    const gait = GAITS[mode];
    if (gait) {
      const prev = Math.sin(ch.ph);
      ch.ph += (dt * st.speed / gait.stride) * Math.PI * 2;
      const s = Math.sin(ch.ph), c = Math.cos(ch.ph);
      if ((prev < 0) !== (s < 0)) stepped = true;
      TG.thighL[0] = -gait.A * s; TG.thighR[0] = gait.A * s;
      TG.shinL[0] = gait.B * Math.max(0, c) + 0.06; TG.shinR[0] = gait.B * Math.max(0, -c) + 0.06;
      TG.footL[0] = -(TG.thighL[0] + TG.shinL[0]) * 0.7 + (s > 0.6 ? 0.2 : 0);
      TG.footR[0] = -(TG.thighR[0] + TG.shinR[0]) * 0.7 + (s < -0.6 ? 0.2 : 0);
      TG.spine[0] = gait.lean; TG.chest[0] = gait.lean * 0.3; TG.head[0] = -gait.lean * 0.7;
      TG.spine[1] = gait.tw * s; TG.chest[1] = -gait.tw * 1.6 * s;
      hipsY = 0.98 - gait.bob * (1 - Math.abs(c)) - (mode === 'sprint' ? 0.06 : mode === 'run' ? 0.03 : 0);
      hz = 0.04 * s;
      if (mode === 'sneak') {
        TG.uarmL[0] = -0.55; TG.uarmR[0] = -0.55; TG.uarmL[2] = -0.32; TG.uarmR[2] = 0.32;
        TG.farmL[0] = -1.25; TG.farmR[0] = -1.25; TG.farmL[1] = -0.5; TG.farmR[1] = 0.5;
        TG.head[0] = 0.35; TG.neck[0] = 0.1;
      } else if (st.panic) {
        TG.uarmL[0] = -2.3 + 0.4 * s; TG.uarmR[0] = -2.3 - 0.4 * s; TG.farmL[0] = -0.9; TG.farmR[0] = -0.9;
      } else {
        TG.uarmL[0] = gait.arm * s; TG.uarmR[0] = -gait.arm * s;
        TG.uarmL[2] = 0.07; TG.uarmR[2] = -0.07;
        TG.farmL[0] = -(gait.eb + gait.ea * Math.max(0, -s)); TG.farmR[0] = -(gait.eb + gait.ea * Math.max(0, s));
      }
      if (st.carry) { TG.uarmL[0] = -2.6; TG.uarmL[2] = 0.55; TG.farmL[0] = -1.9; }
      if (st.combat && mode !== 'sprint') { TG.uarmR[0] = -0.55 + gait.arm * 0.3 * s; TG.farmR[0] = -0.7; }
      if (st.armsLow) { TG.uarmL[0] *= 0.4; TG.uarmR[0] *= 0.4; }
    } else {
      switch (mode) {
        case 'idle': case 'stand': {
          const br = Math.sin(t * 1.6);
          TG.chest[0] = 0.025 * br; TG.uarmL[2] = 0.08; TG.uarmR[2] = -0.08;
          TG.farmL[0] = -0.12; TG.farmR[0] = -0.12;
          hz = Math.sin(t * 0.4) * 0.025;
          TG.thighL[0] = -0.04; TG.thighR[0] = 0.05; TG.shinL[0] = 0.08; TG.shinR[0] = 0.06;
          hipsY = 0.975 + br * 0.003;
          if (st.combat) {
            TG.thighL[0] = -0.35; TG.thighR[0] = 0.25; TG.shinL[0] = 0.45; TG.shinR[0] = 0.35; hipsY = 0.92;
            TG.uarmR[0] = -0.6; TG.farmR[0] = -0.75; TG.uarmL[0] = -0.3; TG.farmL[0] = -0.9; TG.spine[1] = 0.25; TG.spine[0] = 0.08;
          }
          if (st.blend) { TG.uarmL[0] = -0.55; TG.uarmR[0] = -0.55; TG.uarmL[2] = -0.32; TG.uarmR[2] = 0.32; TG.farmL[0] = -1.25; TG.farmR[0] = -1.25; TG.farmL[1] = -0.5; TG.farmR[1] = 0.5; TG.head[0] = 0.35; }
          if (st.carry) { TG.uarmL[0] = -2.6; TG.uarmL[2] = 0.55; TG.farmL[0] = -1.9; }
          if (st.gesture) { const g = Math.sin(t * 2.6); TG.uarmR[0] = -0.75 + g * 0.25; TG.farmR[0] = -1.2 - g * 0.2; TG.uarmR[2] = -0.3; TG.head[1] = Math.sin(t * 0.7) * 0.3; }
          if (st.guardIdle) { TG.uarmR[0] = -0.2; TG.uarmR[2] = -0.25; TG.farmR[0] = -1.1; TG.farmR[1] = 0.6; }
          break;
        }
        case 'sit':
          TG.thighL[0] = -1.55; TG.thighR[0] = -1.5; TG.shinL[0] = 1.5; TG.shinR[0] = 1.6; TG.footL[0] = 0.05; TG.footR[0] = -0.05;
          TG.uarmL[0] = -0.4; TG.uarmR[0] = -0.4; TG.farmL[0] = -0.9; TG.farmR[0] = -0.9; TG.spine[0] = 0.08;
          hipsY = 0.47 + 0.02;
          if (st.gesture) { TG.uarmR[0] = -0.9 + Math.sin(t * 2.4) * 0.25; TG.farmR[0] = -1.3; TG.head[1] = Math.sin(t * 0.6) * 0.4; }
          break;
        case 'climb': case 'hang': {
          const moving = mode === 'climb';
          if (moving) ch.ph += dt * st.speed * 4.2;
          const s = moving ? Math.sin(ch.ph) : 0, c = moving ? Math.cos(ch.ph) : 1;
          if (moving && Math.abs(s) > 0.98 && !ch.grabbed) { stepped = true; ch.grabbed = true; } else if (Math.abs(s) < 0.9) ch.grabbed = false;
          TG.uarmL[0] = -2.75 + 0.4 * s; TG.uarmR[0] = -2.75 - 0.4 * s; TG.uarmL[2] = 0.22; TG.uarmR[2] = -0.22;
          TG.farmL[0] = -0.35 - 0.5 * Math.max(0, -s); TG.farmR[0] = -0.35 - 0.5 * Math.max(0, s);
          TG.thighL[0] = -1.05 - 0.45 * s; TG.thighR[0] = -1.05 + 0.45 * s; TG.shinL[0] = 1.45 + 0.35 * s; TG.shinR[0] = 1.45 - 0.35 * s;
          TG.thighL[2] = 0.15; TG.thighR[2] = -0.15;
          TG.footL[0] = 0.35; TG.footR[0] = 0.35;
          TG.spine[0] = 0.12; TG.head[0] = -0.45; hipsY = 0.98 + 0.04 * c;
          if (st.side) { TG.uarmL[2] += st.side * 0.25 * Math.sin(t * 9); TG.uarmR[2] += st.side * 0.25 * Math.sin(t * 9 + 3); }
          break;
        }
        case 'mantle': {
          const p = st.p;
          TG.uarmL[0] = U.lerp(-2.6, 0.2, p); TG.uarmR[0] = TG.uarmL[0]; TG.farmL[0] = -1.4 * Math.sin(p * Math.PI); TG.farmR[0] = TG.farmL[0];
          TG.thighL[0] = -1.7 * Math.sin(p * Math.PI) - 0.3 * (1 - p); TG.shinL[0] = 2.0 * Math.sin(p * Math.PI) + 0.3;
          TG.thighR[0] = -1.0 * Math.sin(p * Math.PI) + 0.2 * p; TG.shinR[0] = 1.5 * Math.sin(p * Math.PI) + 0.2;
          TG.spine[0] = 0.45 * Math.sin(p * Math.PI); hipsY = 0.98 - 0.25 * Math.sin(p * Math.PI);
          rate = 30;
          break;
        }
        case 'air': {
          const up = st.vy > 0;
          TG.thighL[0] = up ? -1.2 : -0.7; TG.shinL[0] = up ? 1.6 : 0.9; TG.thighR[0] = up ? 0.35 : 0.1; TG.shinR[0] = up ? 0.7 : 0.9;
          TG.uarmL[0] = -1.3; TG.uarmR[0] = 0.5; TG.uarmL[2] = 0.35; TG.uarmR[2] = -0.5; TG.farmL[0] = -0.5; TG.farmR[0] = -0.4;
          TG.spine[0] = 0.18; rate = 10;
          if (st.vy < -9) { const w = Math.sin(t * 9); TG.uarmL[0] = -2.2 + w * 0.5; TG.uarmR[0] = -2.2 - w * 0.5; TG.uarmL[2] = 0.9; TG.uarmR[2] = -0.9; TG.thighL[0] = -0.6 + w * 0.4; TG.thighR[0] = -0.6 - w * 0.4; }
          break;
        }
        case 'leap': {
          TG.uarmL[2] = 1.45; TG.uarmR[2] = -1.45; TG.uarmL[0] = -0.25; TG.uarmR[0] = -0.25; TG.farmL[0] = -0.1; TG.farmR[0] = -0.1;
          TG.thighL[0] = 0.12; TG.thighR[0] = 0.08; TG.shinL[0] = 0.15; TG.shinR[0] = 0.1;
          TG.spine[0] = -0.3; TG.chest[0] = -0.15; TG.head[0] = -0.5;
          hx = U.lerp(0, 1.25, U.clamp(st.p, 0, 1)); rate = 8;
          break;
        }
        case 'roll': {
          const p = U.clamp(st.p, 0, 1);
          hx = p * Math.PI * 2; hipsY = 0.98 - 0.5 * Math.sin(p * Math.PI);
          TG.thighL[0] = -1.9; TG.thighR[0] = -1.8; TG.shinL[0] = 2.3; TG.shinR[0] = 2.2; TG.spine[0] = 0.7; TG.chest[0] = 0.3; TG.head[0] = 0.5;
          TG.uarmL[0] = -1.3; TG.uarmR[0] = -1.3; TG.farmL[0] = -1.6; TG.farmR[0] = -1.6;
          rate = 40;
          break;
        }
        case 'land':
          TG.thighL[0] = -1.1; TG.thighR[0] = -0.7; TG.shinL[0] = 1.6; TG.shinR[0] = 1.3; TG.spine[0] = 0.5; hipsY = 0.62;
          TG.uarmL[0] = -0.6; TG.uarmR[0] = -0.3; TG.uarmL[2] = 0.5; TG.uarmR[2] = -0.5;
          rate = 25;
          break;
        case 'attack': {
          const p = st.p;
          const wind = p < 0.3, k = wind ? p / 0.3 : 1;
          TG.uarmR[0] = wind ? U.lerp(-0.4, -0.9, k) : -1.55; TG.farmR[0] = wind ? -1.4 : -0.05; TG.uarmR[2] = wind ? -0.6 : -0.1;
          TG.uarmL[0] = 0.4; TG.farmL[0] = -0.6;
          TG.spine[1] = wind ? -0.45 : 0.35; TG.spine[0] = 0.25; TG.chest[1] = wind ? -0.2 : 0.2;
          TG.thighL[0] = -0.75; TG.shinL[0] = 0.7; TG.thighR[0] = 0.45; TG.shinR[0] = 0.35; hipsY = 0.9;
          rate = 28;
          break;
        }
        case 'assassinate': {
          const p = st.p, grab = p < 0.38;
          TG.uarmL[0] = -1.35; TG.farmL[0] = -0.7; TG.uarmL[2] = -0.2;
          TG.uarmR[0] = grab ? -2.5 : -1.25; TG.farmR[0] = grab ? -1.3 : -0.15; TG.uarmR[2] = grab ? -0.3 : 0.1;
          TG.spine[0] = grab ? 0.1 : 0.42; TG.chest[0] = grab ? -0.1 : 0.2; TG.spine[1] = grab ? -0.25 : 0.15;
          TG.thighL[0] = -0.8; TG.shinL[0] = 0.9; TG.thighR[0] = 0.5; TG.shinR[0] = 0.5; hipsY = grab ? 0.93 : 0.84;
          rate = 26;
          break;
        }
        case 'airkill': {
          const p = st.p;
          TG.uarmL[0] = p < 0.3 ? -2.8 : -1.0; TG.uarmR[0] = p < 0.3 ? -2.8 : -1.0; TG.farmL[0] = -0.3; TG.farmR[0] = -0.3;
          TG.thighL[0] = -1.4; TG.thighR[0] = -0.4; TG.shinL[0] = 2.0; TG.shinR[0] = 2.1; TG.spine[0] = 0.6; hipsY = 0.55;
          rate = 26;
          break;
        }
        case 'counter': {
          const p = st.p, a = U.smooth(0.15, 0.6, p);
          TG.uarmR[0] = U.lerp(-1.6, -1.2, a); TG.uarmR[2] = U.lerp(-1.3, 0.6, a); TG.farmR[0] = -0.2;
          TG.spine[1] = U.lerp(-0.7, 0.7, a); TG.chest[1] = U.lerp(-0.3, 0.3, a);
          TG.thighL[0] = -0.6; TG.shinL[0] = 0.7; TG.thighR[0] = 0.4; TG.shinR[0] = 0.4; hipsY = 0.9;
          rate = 30;
          break;
        }
        case 'block':
          TG.uarmR[0] = -1.3; TG.farmR[0] = -1.5; TG.farmR[1] = 0.6; TG.uarmL[0] = -0.9; TG.farmL[0] = -1.3;
          TG.thighL[0] = -0.35; TG.shinL[0] = 0.5; TG.thighR[0] = 0.3; TG.shinR[0] = 0.4; hipsY = 0.92; TG.spine[0] = 0.1;
          rate = 30;
          break;
        case 'throw': {
          const p = st.p;
          TG.uarmR[0] = p < 0.4 ? -2.9 : -1.3; TG.farmR[0] = p < 0.4 ? -1.2 : -0.1; TG.spine[1] = p < 0.4 ? -0.4 : 0.3; TG.uarmL[0] = -0.9;
          rate = 30;
          break;
        }
        case 'windup':
          TG.uarmR[0] = -2.9; TG.farmR[0] = -0.8; TG.uarmR[2] = -0.3; TG.spine[1] = -0.45; TG.spine[0] = -0.05;
          TG.uarmL[0] = -0.5; TG.farmL[0] = -1.0; TG.thighL[0] = -0.4; TG.shinL[0] = 0.5; TG.thighR[0] = 0.35; TG.shinR[0] = 0.3; hipsY = 0.93;
          rate = 12;
          break;
        case 'strike':
          TG.uarmR[0] = -0.8; TG.farmR[0] = -0.1; TG.uarmR[2] = 0.3; TG.spine[1] = 0.4; TG.spine[0] = 0.3;
          TG.thighL[0] = -0.8; TG.shinL[0] = 0.8; TG.thighR[0] = 0.5; TG.shinR[0] = 0.3; hipsY = 0.88;
          rate = 30;
          break;
        case 'hurt':
          TG.spine[0] = -0.35; TG.head[0] = -0.3; TG.uarmL[0] = 0.5; TG.uarmR[0] = 0.5; TG.uarmL[2] = 0.4; TG.uarmR[2] = -0.4;
          TG.thighL[0] = 0.2; TG.shinL[0] = 0.4; rate = 30;
          break;
        case 'sync':
          TG.uarmL[2] = 1.2; TG.uarmR[2] = -1.2; TG.uarmL[0] = -0.2; TG.uarmR[0] = -0.2; TG.head[0] = -0.3; TG.spine[0] = -0.1;
          TG.thighL[0] = -0.1; TG.shinL[0] = 0.1; rate = 4;
          break;
        case 'hidden':
          TG.thighL[0] = -1.7; TG.thighR[0] = -1.6; TG.shinL[0] = 2.3; TG.shinR[0] = 2.2; hipsY = 0.45; TG.spine[0] = 0.5; TG.head[0] = 0.2;
          TG.uarmL[0] = -0.8; TG.uarmR[0] = -0.8; TG.farmL[0] = -1.4; TG.farmR[0] = -1.4;
          break;
        case 'dead': {
          const p = U.clamp(st.p, 0, 1), dir = st.dir || -1;
          hx = dir * (Math.PI / 2) * U.smooth(0.05, 0.8, p);
          hipsY = U.lerp(0.98, 0.14, U.smooth(0.1, 0.85, p));
          TG.thighL[0] = -0.3 * p; TG.thighR[0] = 0.15 * p; TG.shinL[0] = 0.6 * p; TG.shinR[0] = 0.2 * p;
          TG.uarmL[2] = 1.0 * p; TG.uarmR[2] = -0.7 * p; TG.uarmL[0] = -0.4 * p * dir; TG.farmL[0] = -0.5 * p;
          TG.head[1] = 0.5 * p; TG.spine[0] = -0.1 * dir * p;
          rate = 10;
          break;
        }
      }
    }
    // взгляд
    if (st.look) {
      TG.neck[1] += U.clamp(st.look, -1.1, 1.1) * 0.4; TG.head[1] += U.clamp(st.look, -1.1, 1.1) * 0.55;
    }
    // ткань: хвосты робы отстают и развеваются
    const fwd = st.fwd || 0, vy = st.vy || 0;
    const flutter = Math.sin(t * (6 + fwd * 1.5)) * Math.min(1, fwd / 5) * 0.12;
    TG.tailB1[0] = U.clamp(0.06 + fwd * 0.12 + Math.max(0, -vy) * 0.09 - Math.max(0, vy) * 0.03, -0.2, 1.3) + flutter;
    TG.tailB2[0] = TG.tailB1[0] * 0.45 + flutter * 1.4;
    TG.tailFL[0] = U.clamp(TG.thighL[0] * 0.8 + fwd * 0.04 + Math.max(0, -vy) * 0.05, -1.4, 0.8);
    TG.tailFR[0] = U.clamp(TG.thighR[0] * 0.8 + fwd * 0.04 + Math.max(0, -vy) * 0.05, -1.4, 0.8);
    if (mode === 'climb' || mode === 'hang') { TG.tailB1[0] = 0.15; TG.tailB2[0] = 0.1; TG.tailFL[0] = -0.2; TG.tailFR[0] = -0.2; }
    // применение с плавным сглаживанием
    const k = U.damp(rate, dt), kc = U.damp(9, dt);
    for (const n in TG) {
      const bn = b[n], tg = TG[n], kk = n.startsWith('tail') ? kc : k;
      if (!bn) continue;
      bn.rotation.x += (tg[0] - bn.rotation.x) * kk;
      bn.rotation.y += (tg[1] - bn.rotation.y) * kk;
      bn.rotation.z += (tg[2] - bn.rotation.z) * kk;
    }
    // вращение таза через полный оборот (кувырок) не сглаживаем по кратчайшему пути
    if (mode === 'roll') b.hips.rotation.x = hx;
    else {
      let hr = b.hips.rotation.x;
      if (hr > Math.PI || hr < -Math.PI) hr = ((((hr + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
      b.hips.rotation.x = hr + (hx - hr) * U.damp(mode === 'dead' ? 6 : rate, dt);
    }
    b.hips.rotation.z += (hz - b.hips.rotation.z) * k;
    b.hips.position.y += (hipsY - b.hips.position.y) * U.damp(mode === 'roll' ? 40 : 16, dt);
    return stepped;
  };
})(window.SA);
