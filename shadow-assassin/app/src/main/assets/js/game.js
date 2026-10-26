'use strict';
/* Игровая логика: игрок, ИИ, бой, миссии, камера, главный цикл. */
(function (SA) {
  const THREE = window.THREE, U = SA.U, V3 = THREE.Vector3, W = SA.world, A = SA.audio, R = SA.rig;
  const G = (SA.game = { mode: 'loading', paused: false, mission: null, missionIndex: -1, timeScale: 1, slowT: 0, stats: { kills: 0, alarms: 0, time: 0 }, alertCD: 0, runId: 0, time: 0 });
  const agents = (G.agents = []);
  const projectiles = [];
  const input = (SA.input = { mx: 0, my: 0, mag: 0, free: false, sprintLock: false, jumpHeld: false, pressed: new Set(), camDX: 0, camDY: 0, keys: {}, stickActive: false, camIdle: 9 });
  const took = (a) => { if (input.pressed.has(a)) { input.pressed.delete(a); return true; } return false; };
  const cam = (G.cam = { yaw: Math.PI, pitch: 0.32, target: new V3(), fov: 60, shake: 0, killCam: null, dist: 4.4 });
  const ui = () => SA.ui;
  let P = null;
  const rnd = U.mulberry32(4242);

  // ================= Индикаторы над головой =================
  function chevronTex(fill, text) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = 6;
    if (text) {
      g.fillStyle = fill; g.font = '700 52px "Roboto Condensed", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 32, 34);
    } else {
      g.fillStyle = fill;
      g.beginPath(); g.moveTo(32, 50); g.lineTo(10, 22); g.lineTo(20, 16); g.lineTo(32, 32); g.lineTo(44, 16); g.lineTo(54, 22); g.closePath(); g.fill();
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  let TEX = null;

  // ================= Агенты =================
  class Agent {
    constructor(type, x, z, o) {
      o = o || {};
      this.type = type; this.o = o; this.name = o.name || '';
      this.pos = new V3(x, o.y || 0, z);
      this.home = this.pos.clone();
      this.yaw = o.yaw !== undefined ? o.yaw : rnd() * 6.28;
      this.homeYaw = this.yaw;
      this.alive = true;
      this.hostile = type !== 'civ';
      this.fight = o.fight !== undefined ? o.fight : type === 'guard' || type === 'archer';
      this.hp = o.hp || (type === 'guard' ? 3 : type === 'archer' ? 2 : type === 'target' ? 3 : 1);
      this.state = o.post ? 'post' : o.sit ? 'sit' : o.idle ? 'idle' : o.route ? 'route' : 'patrol';
      this.aw = 0; this.windT = 0; this.cool = 1 + rnd(); this.stagT = 0; this.panicT = 0; this.atkAnimT = 0;
      this.losT = rnd() * 0.25; this.vis = false; this.lastSeenT = 99; this.lastKnown = new V3();
      this.searchT = 0; this.navT = 0; this.path = []; this.navDirect = false; this.navDirT = 0;
      this.lane = (rnd() - 0.5) * 4.4; this.node = -1; this.prev = -1; this.routeI = 0;
      this.speed = type === 'civ' ? 1.05 + rnd() * 0.4 : 1.3;
      this.curSpd = 0; this.deadT = 0; this.dieDir = -1; this.dist = 99; this.hdist = 99;
      let look = o.look;
      if (!look) look = type === 'civ' ? R.randomCiv(rnd) : type === 'archer' ? 'archer' : 'guard';
      this.ch = R.create(look);
      SA.scene.add(this.ch.root);
      if (this.hostile) {
        this.ind = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.yellow, transparent: true, depthWrite: false, depthTest: false }));
        this.ind.scale.set(0.38, 0.38, 1); this.ind.position.y = 2.2; this.ind.visible = false; this.ind.renderOrder = 7;
        this.ch.root.add(this.ind);
      }
      agents.push(this);
    }
    get fx() { return Math.sin(this.yaw); }
    get fz() { return Math.cos(this.yaw); }
    remove() { SA.scene.remove(this.ch.root); R.dispose(this.ch); }
    moveTo(tx, tz, spd, dt, collide) {
      const dx = tx - this.pos.x, dz = tz - this.pos.z, d = Math.hypot(dx, dz);
      if (d < 0.05) { this.curSpd = 0; return d; }
      const s = Math.min(d, spd * dt);
      this.pos.x += (dx / d) * s; this.pos.z += (dz / d) * s;
      this.yaw = U.angLerp(this.yaw, Math.atan2(dx, dz), U.damp(8, dt));
      if (collide) { W.pushOut(this.pos, 0.32, this.pos.y, 1.7); this.pos.y = W.groundAt(this.pos.x, this.pos.z, this.pos.y + 0.1); }
      this.curSpd = spd;
      return d;
    }
    walkGraph(dt, spd, filter) {
      if (this.node < 0) { this.node = W.nearestNode(this.pos.x, this.pos.z, filter); this.prev = -1; }
      const n = W.nodes[this.node];
      let tx = n.x, tz = n.z;
      if (this.prev >= 0) {
        const p = W.nodes[this.prev], ex = n.x - p.x, ez = n.z - p.z, el = Math.hypot(ex, ez) || 1;
        tx += (-ez / el) * this.lane; tz += (ex / el) * this.lane;
      }
      const d = this.moveTo(tx, tz, spd, dt, false);
      if (d < 0.6) {
        let opts = n.adj.filter((a) => a !== this.prev && (filter === 'any' || (filter === 'inner') === W.nodes[a].inner));
        if (!opts.length) opts = n.adj.filter((a) => filter === 'any' || (filter === 'inner') === W.nodes[a].inner);
        this.prev = this.node;
        this.node = opts.length ? opts[Math.floor(rnd() * opts.length)] : this.prev;
      }
    }
    navTo(tx, tz, spd, dt) {
      this.navDirT -= dt;
      if (this.navDirT <= 0) {
        this.navDirT = 0.35;
        this.navDirect = U.dist2(tx, tz, this.pos.x, this.pos.z) < 3 || W.losClear(this.pos.x, this.pos.y + 0.9, this.pos.z, tx, this.pos.y + 0.9, tz);
      }
      if (this.navDirect) { this.path = []; return this.moveTo(tx, tz, spd, dt, true); }
      this.navT -= dt;
      if (this.navT <= 0 || !this.path.length) { this.navT = 1.5; this.path = W.bfs(W.nearestNode(this.pos.x, this.pos.z), W.nearestNode(tx, tz)); }
      if (!this.path.length) return this.moveTo(tx, tz, spd, dt, true);
      const n = W.nodes[this.path[0]];
      if (this.moveTo(n.x, n.z, spd, dt, true) < 0.8) this.path.shift();
      return U.dist2(tx, tz, this.pos.x, this.pos.z);
    }
    sense(dt) {
      this.losT -= dt;
      const dx = P.pos.x - this.pos.x, dz = P.pos.z - this.pos.z, dy = P.pos.y - this.pos.y;
      const hd = Math.hypot(dx, dz), d = Math.hypot(hd, dy);
      this.dist = d; this.hdist = hd;
      const range = this.state === 'combat' ? 45 : this.type === 'archer' ? 32 : 24;
      let ok = !P.dead && !P.hidden && d < range && G.mode === 'play';
      if (ok && this.state !== 'combat' && hd > 2.2) ok = (dx * this.fx + dz * this.fz) / (hd || 1) > 0.42;
      if (!ok) { this.vis = false; return false; }
      if (this.losT <= 0) {
        this.losT = 0.22;
        this.vis = W.losClear(this.pos.x, this.pos.y + 1.6, this.pos.z, P.pos.x, P.pos.y + 1.3, P.pos.z);
      }
      return this.vis;
    }
    alarm() {
      if (!this.alive || !this.hostile) return;
      if (!this.fight) {
        if (this.state !== 'flee') { this.state = 'flee'; this.aw = 1; this.lastSeenT = 0; const M = G.mission; if (M && M.def.onFlee) M.def.onFlee(M, this); }
        return;
      }
      if (this.state !== 'combat') {
        this.aw = 1; this.state = 'combat'; this.lastSeenT = 0; this.lastKnown.copy(P.pos);
        R.setSword(this.ch, true);
        if (G.alertCD <= 0) { A.play('alert'); G.alertCD = 3; G.stats.alarms++; SA.vibrate(60); }
      }
    }
    die(how, dir) {
      if (!this.alive) return;
      this.alive = false; this.state = 'dead'; this.windT = 0; this.dieDir = dir || -1;
      if (this.ind) this.ind.visible = false;
      R.setGlow(this.ch, null);
      if (this.type !== 'civ') G.stats.kills++;
      for (const a of agents) {
        if (a === this || !a.alive) continue;
        const d = a.pos.distanceTo(this.pos);
        if (a.type === 'civ' && d < 12) { a.panicT = 7; a.state = a.state === 'sit' ? 'patrol' : a.state; }
        else if (a.hostile && d < 16) {
          a.losT = 0;
          if (a.sense(0)) a.alarm();
          else if (d < 9 && a.state !== 'combat') { a.aw = Math.max(a.aw, 0.6); a.state = 'suspicious'; a.lastKnown.copy(this.pos); }
        }
      }
      const M = G.mission;
      if (M && M.def.onKill) M.def.onKill(M, this, how);
    }
    update(dt) {
      const ch = this.ch;
      const camD = SA.camera.position.distanceTo(this.pos);
      if (!this.alive) {
        this.deadT += dt;
        if (camD < SA.Q.lod + 20) R.animate(ch, dt, { mode: 'dead', p: this.deadT / 1.1, dir: this.dieDir });
        ch.root.position.copy(this.pos);
        return;
      }
      if (this.type === 'civ') this.updateCiv(dt); else this.updateHostile(dt);
      ch.root.position.copy(this.pos);
      ch.root.rotation.y = this.yaw;
      ch.root.visible = camD < SA.Q.far * 0.75 || P.eagle;
      ch.mesh.castShadow = camD < 32;
      if (ch.root.visible && (camD < SA.Q.lod || this.lodT === undefined || (this.lodT -= dt) <= 0)) {
        if (camD >= SA.Q.lod) this.lodT = 0.1;
        let mode = this.curSpd > 5 ? 'sprint' : this.curSpd > 2.6 ? 'run' : this.curSpd > 0.2 ? 'walk' : 'idle';
        let p = 0;
        if (this.stagT > 0) mode = 'hurt';
        else if (this.windT > 0) mode = 'windup';
        else if (this.atkAnimT > 0) mode = this.type === 'archer' ? 'throw' : 'strike', p = 1 - this.atkAnimT / 0.3;
        else if (this.state === 'sit' && this.curSpd < 0.2) mode = 'sit';
        const stepped = R.animate(ch, camD < SA.Q.lod ? dt : 0.1, {
          mode, p, speed: this.curSpd, fwd: this.curSpd, panic: this.panicT > 0, carry: ch.look.jar,
          combat: this.state === 'combat' && this.type !== 'archer', gesture: this.gesture, guardIdle: this.type === 'guard' && this.state === 'post',
          look: this.lookYaw || 0,
        });
        if (stepped && camD < 9 && this.curSpd > 0.5) A.play('step', 0.5 * (1 - camD / 9) * (this.curSpd > 3 ? 1.3 : 0.8));
      }
      if (P.eagle) R.setGlow(ch, this.type === 'target' ? 'gold' : this.hostile ? 'red' : camD < 30 ? 'blue' : null);
      else if (ch.glow.visible) R.setGlow(ch, null);
      if (this.ind) {
        const m = this.ind.material;
        if (this.windT > 0) { this.ind.visible = true; m.map = TEX.excl; m.opacity = 1; }
        else if (this.state === 'combat') { this.ind.visible = true; m.map = TEX.red; m.opacity = 1; }
        else if (this.aw > 0.05) { this.ind.visible = true; m.map = TEX.yellow; m.opacity = 0.3 + this.aw * 0.7; }
        else this.ind.visible = false;
        if (this.ind.visible) { const s = 0.3 + Math.min(1, camD / 25) * 0.35; this.ind.scale.set(s, s, 1); }
      }
      this.curSpd = 0;
    }
    updateCiv(dt) {
      if (this.panicT > 0) {
        this.panicT -= dt;
        const dx = this.pos.x - P.pos.x, dz = this.pos.z - P.pos.z, d = Math.hypot(dx, dz) || 1;
        this.moveTo(this.pos.x + (dx / d) * 3, this.pos.z + (dz / d) * 3, 3.8, dt, true);
        if (this.panicT <= 0) { this.node = -1; if (this.state !== 'patrol') this.state = 'patrol'; }
        return;
      }
      // реакция на толчки: если игрок бежит сквозь толпу
      const dx = this.pos.x - P.pos.x, dz = this.pos.z - P.pos.z;
      if (Math.abs(P.pos.y - this.pos.y) < 1 && dx * dx + dz * dz < 0.5 && P.moveSpd > 3) {
        const d = Math.hypot(dx, dz) || 1;
        this.pos.x += (dx / d) * 0.4; this.pos.z += (dz / d) * 0.4;
        this.stumbleT = 0.4;
      }
      if (this.state === 'idle' || this.state === 'sit') {
        if (this.o.face) this.yaw = U.angLerp(this.yaw, Math.atan2(this.o.face.x - this.pos.x, this.o.face.z - this.pos.z), dt * 3);
        this.gestT = (this.gestT || rnd() * 4) - dt;
        if (this.gestT <= 0) { this.gesture = !this.gesture && this.o.talk; this.gestT = 2 + rnd() * 4; }
        return;
      }
      this.walkGraph(dt, this.speed, 'outer');
    }
    updateHostile(dt) {
      if (this.atkAnimT > 0) this.atkAnimT -= dt;
      if (this.stagT > 0) { this.stagT -= dt; this.windT = 0; return; }
      this.cool -= dt;
      const seen = this.sense(dt);
      const restricted = W.inRestricted(P.pos.x, P.pos.z);
      this.lookYaw = 0;
      if (this.state !== 'combat' && this.state !== 'flee') {
        if (seen) {
          let r = (1.35 - this.dist / 24) * 0.85;
          const moving = P.moveSpd > 3 || P.state === 'climb' || P.state === 'air' || P.state === 'mantle';
          if (moving) r *= 2.4;
          if (P.violentT > 0) r = 50;
          if (P.blend && !restricted && !moving) r *= P.inCrowd ? 0 : 0.35;
          if (restricted) r *= 2.5;
          if (P.pos.y > this.pos.y + 3 && this.type !== 'archer') r *= 0.55;
          if (this.o.vigilance) r *= this.o.vigilance;
          this.aw = Math.min(1, this.aw + Math.max(0, r) * dt);
          this.lastKnown.copy(P.pos);
          this.lookYaw = U.angDiff(this.yaw, Math.atan2(P.pos.x - this.pos.x, P.pos.z - this.pos.z)) * Math.min(1, this.aw * 2);
          if (this.aw >= 1) { this.alarm(); if (!this.fight && G.alertCD <= 0) { A.play('alert'); G.alertCD = 3; } return; }
          if (this.aw > 0.35 && this.state !== 'suspicious') { this.prevState = this.state; this.state = 'suspicious'; }
        } else this.aw = Math.max(0, this.aw - 0.15 * dt);
      }
      switch (this.state) {
        case 'post': this.yaw = U.angLerp(this.yaw, this.homeYaw + Math.sin(performance.now() / 2500 + this.lane) * 0.6, dt * 2); break;
        case 'idle': break;
        case 'patrol':
          if (this.type === 'archer') { this.yaw += dt * 0.35; break; }
          this.walkGraph(dt, this.speed, this.o.inner ? 'inner' : 'outer');
          break;
        case 'route': {
          const r = this.o.route, t = r[this.routeI];
          if (this.moveTo(t.x, t.z, this.o.speed || 1.25, dt, true) < 0.6) this.routeI = (this.routeI + 1) % r.length;
          break;
        }
        case 'follow': {
          const L = this.o.leader;
          if (!L.alive) { this.state = 'patrol'; break; }
          const bx = L.pos.x - L.fx * 2.2 + Math.cos(L.yaw) * 0.8, bz = L.pos.z - L.fz * 2.2 - Math.sin(L.yaw) * 0.8;
          if (U.dist2(bx, bz, this.pos.x, this.pos.z) > 0.5) this.moveTo(bx, bz, 1.6, dt, true); else this.yaw = U.angLerp(this.yaw, L.yaw, dt * 3);
          break;
        }
        case 'suspicious': {
          this.yaw = U.angLerp(this.yaw, Math.atan2(this.lastKnown.x - this.pos.x, this.lastKnown.z - this.pos.z), dt * 4);
          if (this.aw > 0.6 && this.type !== 'archer' && !this.o.post && this.o.leader === undefined) this.navTo(this.lastKnown.x, this.lastKnown.z, 1.0, dt);
          if (this.aw < 0.15) this.state = this.prevState === 'suspicious' || !this.prevState ? this.baseState() : this.prevState;
          break;
        }
        case 'search': {
          this.searchT -= dt;
          if (this.type === 'archer' || this.navTo(this.lastKnown.x, this.lastKnown.z, 2.4, dt) < 1) this.yaw += dt * 1.5;
          if (seen) { this.alarm(); break; }
          if (this.searchT <= 0) { this.state = 'return'; this.aw = 0.4; R.setSword(this.ch, false); }
          break;
        }
        case 'return': {
          if (seen && this.aw > 0.8) { this.alarm(); break; }
          if (this.o.post || this.o.idle || this.type === 'archer') {
            if (this.type === 'archer' || this.navTo(this.home.x, this.home.z, 1.4, dt) < 0.5) { this.state = this.baseState(); this.yaw = this.homeYaw; }
          } else if (this.o.route) this.state = 'route';
          else { this.node = -1; this.state = this.o.leader ? 'follow' : 'patrol'; }
          break;
        }
        case 'flee': {
          const dest = this.o.fleeTo;
          if (dest) { if (this.navTo(dest.x, dest.z, 4.0, dt) < 2) { const M = G.mission; if (M && M.def.onEscape) M.def.onEscape(M, this); } }
          else {
            const dx = this.pos.x - P.pos.x, dz = this.pos.z - P.pos.z, d = Math.hypot(dx, dz) || 1;
            this.navTo(this.pos.x + (dx / d) * 6, this.pos.z + (dz / d) * 6, 3.8, dt);
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
      if (seen) { this.lastSeenT = 0; this.lastKnown.copy(P.pos); } else this.lastSeenT += dt;
      if (P.dead) { this.state = 'return'; R.setSword(this.ch, false); return; }
      if (this.lastSeenT > 6) { this.state = 'search'; this.searchT = 7; this.windT = 0; return; }
      const dx = P.pos.x - this.pos.x, dz = P.pos.z - this.pos.z, hd = Math.hypot(dx, dz);
      const reach = Math.abs(P.pos.y - this.pos.y) < 1.4;
      if (this.windT > 0) {
        this.yaw = U.angLerp(this.yaw, Math.atan2(dx, dz), dt * 8);
        this.windT -= dt;
        if (this.windT <= 0) {
          this.atkAnimT = 0.3; this.cool = 1.3 + rnd() * 1.2;
          A.play('swing', 0.7);
          if (hd < 2.4 && reach && !P.dead) {
            if (P.blockT > 0) { A.play('clang'); this.stagT = 0.5; SA.vibrate(30); }
            else P.hurt(this.o.dmg || 1, this);
          }
        }
        return;
      }
      if (this.type === 'archer' || (!reach && hd < 8)) {
        if (this.type !== 'archer' && hd > 5) this.navTo(P.pos.x, P.pos.z, 3.6, dt);
        this.yaw = U.angLerp(this.yaw, Math.atan2(dx, dz), dt * 6);
        if (hd < 2 && reach && this.cool <= 0) { this.windT = 0.75; return; }
        if (seen && this.cool <= 0) {
          this.cool = this.type === 'archer' ? 2.4 : 3;
          this.atkAnimT = 0.3;
          throwProjectile(this, this.type === 'archer' ? 'arrow' : 'stone');
        }
        return;
      }
      if (hd > 1.7) this.navTo(P.pos.x, P.pos.z, hd > 6 ? 4.3 : 2.4, dt);
      else {
        this.yaw = U.angLerp(this.yaw, Math.atan2(dx, dz), dt * 8);
        if (this.cool <= 0 && reach) {
          let busy = 0;
          for (const a of agents) if (a.windT > 0) busy++;
          if (busy < 2) this.windT = 0.8; else this.cool = 0.5;
        }
      }
    }
  }
  G.Agent = Agent;

  // ================= Снаряды =================
  const PGEO = {};
  function projMesh(kind) {
    const g = new THREE.Group();
    const mt = (c, m) => new THREE.MeshStandardMaterial({ color: c, roughness: m ? 0.3 : 0.8, metalness: m ? 0.9 : 0 });
    if (kind === 'stone') g.add(new THREE.Mesh(PGEO.stone || (PGEO.stone = new THREE.IcosahedronGeometry(0.08, 0)), mt('#7a7266')));
    else if (kind === 'arrow') {
      const s = new THREE.Mesh(PGEO.shaft || (PGEO.shaft = new THREE.CylinderGeometry(0.008, 0.008, 0.75, 5)), mt('#6b4a2f')); s.rotation.x = Math.PI / 2; g.add(s);
      const h = new THREE.Mesh(PGEO.head || (PGEO.head = new THREE.ConeGeometry(0.02, 0.07, 4)), mt('#888', true)); h.rotation.x = Math.PI / 2; h.position.z = 0.4; g.add(h);
      const f = new THREE.Mesh(PGEO.fl || (PGEO.fl = new THREE.BoxGeometry(0.06, 0.002, 0.12)), mt('#e8e2d4')); f.position.z = -0.33; g.add(f);
    } else {
      const b = new THREE.Mesh(PGEO.knife || (PGEO.knife = new THREE.BoxGeometry(0.025, 0.006, 0.3)), mt('#d8dde3', true)); g.add(b);
    }
    g.traverse((o) => (o.castShadow = true));
    return g;
  }
  function throwProjectile(from, kind, target) {
    const sx = from.pos.x + from.fx * 0.4, sy = from.pos.y + 1.6, sz = from.pos.z + from.fz * 0.4;
    let tx, ty, tz;
    if (target) { tx = target.pos.x; ty = target.pos.y + 1.2; tz = target.pos.z; } else { tx = P.pos.x; ty = P.pos.y + 1.1; tz = P.pos.z; }
    const speed = kind === 'knife' ? 34 : kind === 'arrow' ? 26 : 16, g = kind === 'stone' ? 14 : 4;
    const dx = tx - sx, dy = ty - sy, dz = tz - sz, d = Math.hypot(dx, dy, dz) || 1, t = d / speed;
    const vel = new V3((dx / d) * speed, (dy / d) * speed + 0.5 * g * t, (dz / d) * speed);
    if (kind !== 'knife') { vel.x += (rnd() - 0.5) * 1.6; vel.z += (rnd() - 0.5) * 1.6; }
    const m = projMesh(kind);
    m.position.set(sx, sy, sz);
    SA.scene.add(m);
    projectiles.push({ kind, pos: m.position, vel, g, m, life: 3, spin: kind === 'knife' });
    A.play(kind === 'arrow' ? 'arrow' : 'throw');
  }
  function updateProjectiles(dt) {
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const p = projectiles[i];
      p.life -= dt; p.vel.y -= p.g * dt;
      p.pos.addScaledVector(p.vel, dt);
      p.m.lookAt(p.pos.x + p.vel.x, p.pos.y + p.vel.y, p.pos.z + p.vel.z);
      if (p.kind === 'stone') p.m.rotation.x += dt * 10;
      let hit = false;
      if (p.kind === 'knife') {
        for (const a of agents) {
          if (!a.alive || a.type === 'civ') continue;
          const dx = a.pos.x - p.pos.x, dy = a.pos.y + 1.1 - p.pos.y, dz = a.pos.z - p.pos.z;
          if (dx * dx + dy * dy + dz * dz < 0.7) { a.die('knife', -1); A.play('kill', 0.7); hit = true; break; }
        }
      } else if (!P.dead && !P.hidden) {
        const dx = P.pos.x - p.pos.x, dy = P.pos.y + 1.1 - p.pos.y, dz = P.pos.z - p.pos.z;
        if (dx * dx + dy * dy + dz * dz < 0.6) { hit = true; if (P.blockT > 0 && p.kind === 'stone') A.play('clang'); else P.hurt(1); }
      }
      if (hit || p.life <= 0 || p.pos.y < 0 || W.pointInSolid(p.pos.x, p.pos.y, p.pos.z)) { SA.scene.remove(p.m); projectiles.splice(i, 1); }
    }
  }

  // ================= Игрок =================
  function makePlayer() {
    P = G.player = {
      pos: new V3(), vel: new V3(), yaw: 0, state: 'ground', hp: 12, maxHp: 12, knives: 5,
      blend: false, eagle: false, hidden: false, dead: false, climbC: null, cn: { x: 0, z: 0 },
      airMaxY: 0, leap: false, leapY0: 0, action: null, actT: 0, actDur: 0, actTarget: null, blockT: 0, violentT: 0, syncT: 0, syncTower: null,
      noGrabT: 0, mantle: null, rollT: 0, landT: 0, hurtT: 9, hurtAnim: 0, regenT: 0, inCrowd: false, moveSpd: 0, letter: false, eagleUsed: false, hideT: 0,
      climbSpd: 0, climbSide: 0, deadT: 0,
      ch: R.create('assassin'),
    };
    SA.scene.add(P.ch.root);
    P.hurt = function (n) {
      if (this.dead || this.state === 'sync') return;
      this.hp -= n; this.hurtT = 0; this.hurtAnim = 0.25;
      A.play('hurt'); SA.vibrate(50);
      cam.shake = Math.max(cam.shake, 0.25);
      ui().damage();
      if (this.hp <= 0) { this.hp = 0; this.die(); }
    };
    P.die = function () {
      this.dead = true; this.state = 'dead'; this.deadT = 0;
      A.play('fail'); SA.vibrate([80, 60, 120]);
      const run = G.runId;
      setTimeout(() => { if (G.runId === run) failMission('Ты погиб. Так не было в воспоминаниях предка.', 'ДЕСИНХРОНИЗАЦИЯ'); }, 1800);
    };
  }
  function moveDir() {
    const mag = Math.min(1, input.mag);
    if (mag < 0.1) return { x: 0, z: 0, mag: 0 };
    const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw), rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw);
    const x = fx * input.my + rx * input.mx, z = fz * input.my + rz * input.mx, l = Math.hypot(x, z) || 1;
    return { x: x / l, z: z / l, mag };
  }
  G.isFree = () => (input.free || input.sprintLock || input.mag > 0.93) && !P.blend;
  function towerAtTop() {
    for (const t of W.towers) if (Math.abs(P.pos.y - t.h) < 0.5 && U.dist2(P.pos.x, P.pos.z, t.x, t.z) < 2.6) return t;
    return null;
  }
  function leapSpot() {
    if (P.state !== 'ground') return null;
    for (const t of W.towers) if (Math.abs(P.pos.y - t.h) < 0.4 && U.dist2(P.pos.x, P.pos.z, t.beam.x, t.beam.z) < 1.6) return t;
    return null;
  }
  G.leapSpot = () => (P ? leapSpot() : null);
  function startClimb(hit) {
    const n = Math.abs(hit.nx) > Math.abs(hit.nz) ? { x: Math.sign(hit.nx), z: 0 } : { x: 0, z: Math.sign(hit.nz) };
    P.state = 'climb'; P.climbC = hit.c; P.cn = n; P.vel.set(0, 0, 0); P.leap = false;
    P.yaw = Math.atan2(-n.x, -n.z);
    A.play('grab');
  }
  function snapToWall() {
    const c = P.climbC, n = P.cn;
    if (n.x > 0) P.pos.x = c.x1 + 0.34; else if (n.x < 0) P.pos.x = c.x0 - 0.34;
    if (n.z > 0) P.pos.z = c.z1 + 0.34; else if (n.z < 0) P.pos.z = c.z0 - 0.34;
  }
  function wallAt(x, y, z, n) {
    const px = x - n.x * 0.5, pz = z - n.z * 0.5;
    for (const c of W.bucket(px, pz)) if (c.climb && px >= c.x0 && px <= c.x1 && pz >= c.z0 && pz <= c.z1 && c.y1 > y + 0.4 && c.y0 <= y + 1.2) return c;
    return null;
  }
  function jump(vx, vz, vy) { P.state = 'air'; P.vel.set(vx, vy, vz); P.airMaxY = P.pos.y; A.play('cloth', 0.7); }
  function startMantle(tx, ty, tz, dur) {
    P.state = 'mantle';
    P.mantle = { from: P.pos.clone(), to: new V3(tx, ty, tz), t: 0, dur: dur || 0.42 };
    A.play('grab');
  }
  function land(g) {
    const fall = P.airMaxY - g;
    P.pos.y = g; P.state = 'ground';
    const hide = W.hideAt(P.pos.x, P.pos.z, g, 0.25);
    const hs = Math.hypot(P.vel.x, P.vel.z);
    if (hide && hide.type === 'hay') {
      P.state = 'hidden'; P.hidden = true; P.hideT = 0; P.hideType = 'hay'; P.pos.x = hide.x; P.pos.z = hide.z;
      A.play('hay'); SA.vibrate(40);
      if (P.leap) ui().toast('ПРЫЖОК ВЕРЫ', 1.4);
      const M = G.mission; if (M && M.def.onEvent) M.def.onEvent(M, 'hay');
    } else {
      const canRoll = fall > 3.2 && (hs > 2 || input.mag > 0.3);
      const safe = canRoll ? 10 : 7.5;
      if (fall > safe) P.hurt(Math.ceil((fall - safe) / 1.6));
      if (canRoll && !P.dead) { P.state = 'roll'; P.rollT = 0; P.rollDir = hs > 0.5 ? Math.atan2(P.vel.x, P.vel.z) : P.yaw; A.play('roll'); }
      else if (fall > 2.2) { P.landT = 0.22; A.play('land'); }
      else if (fall > 0.6) A.play('step', 0.8);
      if (fall > 4) { cam.shake = Math.max(cam.shake, Math.min(0.35, fall * 0.03)); SA.vibrate(25); }
    }
    P.vel.set(0, 0, 0);
    P.leap = false;
  }
  function hostileCandidates(maxD, filterFn) {
    const res = [];
    for (const a of agents) {
      if (!a.alive || !a.hostile) continue;
      const dx = a.pos.x - P.pos.x, dz = a.pos.z - P.pos.z, dy = a.pos.y - P.pos.y, hd = Math.hypot(dx, dz);
      if (hd > maxD || (filterFn && !filterFn(a, hd, dy))) continue;
      res.push({ a, hd, dy, dx, dz });
    }
    return res;
  }
  function meleeTarget() {
    const fx = Math.sin(P.yaw), fz = Math.cos(P.yaw);
    let best = null, bs = 1e9;
    for (const c of hostileCandidates(2.4, (a, hd, dy) => Math.abs(dy) < 1.3)) {
      const s = c.hd - ((c.dx * fx + c.dz * fz) / (c.hd || 1)) * 0.8;
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
    const dx = P.pos.x - a.pos.x, dz = P.pos.z - a.pos.z, d = Math.hypot(dx, dz) || 1;
    return (dx * a.fx + dz * a.fz) / d < -0.4 && a.windT <= 0;
  }
  G.killTarget = function () {
    if (!P || P.dead) return null;
    if (P.state === 'air') return airTarget();
    if (P.state === 'ground') { const a = meleeTarget(); return a && canAssassinate(a) ? a : null; }
    return null;
  };
  G.knifeTarget = function () {
    if (!P || P.knives <= 0 || P.dead || P.state === 'hidden' || P.state === 'climb') return null;
    const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw);
    let best = null, bs = 1e9;
    for (const c of hostileCandidates(28)) {
      const front = (c.dx * fx + c.dz * fz) / (c.hd || 1);
      if (front < 0.75) continue;
      if (c.a.knifeLosT === undefined || (c.a.knifeLosT -= 0.016) <= 0) { c.a.knifeLosT = 0.25; c.a.knifeLos = W.losClear(P.pos.x, P.pos.y + 1.5, P.pos.z, c.a.pos.x, c.a.pos.y + 1.2, c.a.pos.z); }
      if (!c.a.knifeLos) continue;
      const s = c.hd * (2 - front);
      if (s < bs) { bs = s; best = c.a; }
    }
    return best;
  };
  function startAction(name, dur, target) { P.action = name; P.actT = 0; P.actDur = dur; P.actTarget = target; P.state = 'action'; }
  function assassinate(a, how) {
    const dx = P.pos.x - a.pos.x, dz = P.pos.z - a.pos.z, d = Math.hypot(dx, dz) || 1;
    const behind = (dx * a.fx + dz * a.fz) / d < 0;
    if (how === 'air') { P.pos.set(a.pos.x + (dx / d) * 0.55, a.pos.y, a.pos.z + (dz / d) * 0.55); P.airMaxY = P.pos.y; }
    else { P.pos.x = a.pos.x + (dx / d) * 0.72; P.pos.z = a.pos.z + (dz / d) * 0.72; }
    P.yaw = Math.atan2(-dx, -dz);
    a.yaw = how === 'counter' ? Math.atan2(dx, dz) : a.yaw;
    a.windT = 0; a.stagT = 2;
    startAction(how === 'air' ? 'airkill' : how === 'counter' ? 'counter' : 'assassinate', how === 'counter' ? 0.55 : 0.75, a);
    P.killDir = how === 'air' ? -1 : behind ? 1 : -1;
    P.violentT = 1.2; P.vel.set(0, 0, 0);
    R.setBlade(P.ch, true);
    A.play('blade');
    G.slowT = 0.75;
    cam.killCam = { t: 0.95, a, side: rnd() < 0.5 ? 1 : -1 };
    if (how === 'air') ui().toast('УБИЙСТВО С ВОЗДУХА', 1.2);
  }
  function bladeAction() {
    if (P.dead) return;
    if (P.state === 'air') { const a = airTarget(); if (a) assassinate(a, 'air'); return; }
    if (P.state !== 'ground') return;
    const a = meleeTarget();
    if (a && canAssassinate(a)) { assassinate(a, 'stealth'); return; }
    startAction('attack', 0.42, a);
    P.violentT = 0.8;
    R.setBlade(P.ch, true);
    A.play('swing');
    if (a) P.yaw = Math.atan2(a.pos.x - P.pos.x, a.pos.z - P.pos.z);
  }
  function resolveAttack(a) {
    if (!a || !a.alive || a.pos.distanceTo(P.pos) > 2.6) return;
    if (a.windT <= 0 && rnd() < 0.3) { A.play('clang'); a.cool = Math.min(a.cool, 0.3); SA.vibrate(20); return; }
    a.hp -= 1; a.stagT = 0.45; a.windT = 0;
    const dx = a.pos.x - P.pos.x, dz = a.pos.z - P.pos.z, d = Math.hypot(dx, dz) || 1;
    a.pos.x += (dx / d) * 0.35; a.pos.z += (dz / d) * 0.35;
    A.play('hit'); SA.vibrate(25);
    cam.shake = Math.max(cam.shake, 0.12);
    a.alarm();
    if (a.hp <= 0) { a.die('combat', -1); A.play('kill'); G.slowT = 0.3; }
  }
  function blockAction() {
    if (P.state !== 'ground' || P.dead) return;
    let best = null, bd = 3;
    for (const a of agents) if (a.alive && a.windT > 0 && a.windT < 0.7) { const d = a.pos.distanceTo(P.pos); if (d < bd) { bd = d; best = a; } }
    if (best) { A.play('clang'); SA.vibrate(40); ui().toast('КОНТРАТАКА', 0.8); assassinate(best, 'counter'); return; }
    P.blockT = 0.6;
  }
  function knifeAction() {
    const t = G.knifeTarget();
    if (!t) { if (P.knives > 0) ui().hint2('Нет цели — наведи камеру на врага'); return; }
    if (P.state !== 'ground' && P.state !== 'air') return;
    P.knives--; P.violentT = 0.6;
    P.yaw = Math.atan2(t.pos.x - P.pos.x, t.pos.z - P.pos.z);
    if (P.state === 'ground') startAction('throw', 0.35, null);
    throwProjectile({ pos: P.pos, fx: Math.sin(P.yaw), fz: Math.cos(P.yaw) }, 'knife', t);
  }
  function enterHide(h) {
    P.state = 'hidden'; P.hidden = true; P.hideT = 0; P.hideType = h.type; P.pos.x = h.x; P.pos.z = h.z; P.pos.y = h.y;
    A.play(h.type === 'hay' ? 'hay' : 'cloth');
  }
  G.contextAction = function () {
    if (!P || P.dead || P.state === 'sync' || P.state === 'action') return null;
    const M = G.mission;
    if (M && M.def.context) { const c = M.def.context(M); if (c) return c; }
    if (P.state === 'hidden') return { label: 'Выйти', icon: 'exit', fn: () => { P.state = 'ground'; P.hidden = false; }, pos: P.pos };
    if (P.state !== 'ground') return null;
    const t = towerAtTop();
    if (t && !t.synced) return { label: 'Синхронизация', icon: 'eye', fn: () => { P.state = 'sync'; P.syncT = 3.4; P.syncTower = t; A.play('sync'); SA.vibrate(30); }, pos: new V3(t.x, t.h + 1.2, t.z) };
    const h = W.hideAt(P.pos.x, P.pos.z, P.pos.y, 0.7);
    if (h) return { label: h.type === 'hay' ? 'Спрятаться в сене' : 'Укрыться в саду', icon: 'hide', fn: () => enterHide(h), pos: new V3(h.x, h.y + 1.3, h.z) };
    return null;
  };

  function updatePlayer(dt) {
    const ch = P.ch;
    P.blockT -= dt; P.violentT -= dt; P.noGrabT -= dt; P.landT -= dt; P.hurtT += dt; P.hurtAnim -= dt;
    const md = moveDir(), free = G.isFree();
    let anim = { mode: 'idle', speed: 0, fwd: 0, vy: 0, p: 0, blend: P.blend };
    P.moveSpd = 0;
    if (P.dead) {
      P.deadT += dt;
      anim = { mode: 'dead', p: P.deadT / 1.2, dir: -1 };
    } else if (P.state === 'sync') {
      P.syncT -= dt;
      anim.mode = 'sync';
      if (P.syncT <= 0) {
        P.state = 'ground'; P.syncTower.synced = true; P.hp = P.maxHp;
        ui().toast('СИНХРОНИЗИРОВАНО', 1.8, 'Город открылся с высоты');
        const M = G.mission; if (M && M.def.onEvent) M.def.onEvent(M, 'sync');
      }
    } else if (P.state === 'hidden') {
      P.hideT += dt;
      anim.mode = 'hidden';
      if (P.hideT > 0.6 && (md.mag > 0.6 || took('jump'))) {
        P.state = 'ground'; P.hidden = false;
        if (md.mag > 0.1) { P.pos.x += md.x * 1.6; P.pos.z += md.z * 1.6; P.yaw = Math.atan2(md.x, md.z); }
      }
    } else if (P.state === 'action') {
      P.actT += dt;
      const p = P.actT / P.actDur, a = P.actTarget;
      anim = { mode: P.action, p };
      if (a && (P.action === 'assassinate' || P.action === 'airkill' || P.action === 'counter') && a.alive && p > 0.4) {
        a.die('stealth', P.killDir); A.play('kill'); SA.vibrate(60); cam.shake = Math.max(cam.shake, 0.15);
      }
      if (P.action === 'attack' && !P.hitDone && p > 0.38) { P.hitDone = true; resolveAttack(a); }
      if (p >= 1) {
        P.hitDone = false; R.setBlade(P.ch, false);
        P.state = P.pos.y > W.groundAt(P.pos.x, P.pos.z, P.pos.y) + 0.1 ? 'air' : 'ground';
        if (P.state === 'air') { P.vel.set(0, 0, 0); P.airMaxY = P.pos.y; }
      }
    } else if (P.state === 'mantle') {
      const m = P.mantle;
      m.t += dt / m.dur;
      const t = Math.min(1, m.t), ty = U.smooth(0, 0.6, t), th = U.smooth(0.35, 1, t);
      P.pos.set(U.lerp(m.from.x, m.to.x, th), U.lerp(m.from.y, m.to.y, ty), U.lerp(m.from.z, m.to.z, th));
      anim = { mode: 'mantle', p: t };
      if (t >= 1) { P.state = 'ground'; P.pos.copy(m.to); }
    } else if (P.state === 'roll') {
      P.rollT += dt / 0.55;
      const sp = 4.5 * (1 - P.rollT * 0.5);
      P.pos.x += Math.sin(P.rollDir) * sp * dt; P.pos.z += Math.cos(P.rollDir) * sp * dt;
      W.pushOut(P.pos, 0.35, P.pos.y, 1.0);
      P.yaw = P.rollDir;
      const g = W.groundAt(P.pos.x, P.pos.z, P.pos.y);
      if (P.pos.y > g + 0.3) { P.state = 'air'; P.vel.set(Math.sin(P.rollDir) * sp, 0, Math.cos(P.rollDir) * sp); P.airMaxY = P.pos.y; }
      else P.pos.y = g;
      anim = { mode: 'roll', p: P.rollT, fwd: 4 };
      if (P.rollT >= 1) P.state = 'ground';
      P.moveSpd = sp;
    } else if (P.state === 'ground') {
      let spd = md.mag < 0.1 ? 0 : P.blend ? 1.4 : free ? 7.2 : md.mag > 0.55 ? 4.4 : 1.6;
      if (P.blockT > 0 || P.landT > 0) spd *= 0.2;
      const vx = md.x * spd, vz = md.z * spd;
      if (spd > 0) P.yaw = U.angLerp(P.yaw, Math.atan2(md.x, md.z), U.damp(free ? 10 : 14, dt));
      // автопрыжок с края крыши в режиме паркура
      if (free && spd > 5) {
        const g2 = W.groundAt(P.pos.x + md.x * 0.75, P.pos.z + md.z * 0.75, P.pos.y);
        if (g2 < P.pos.y - 1.4) jump(vx * 1.05, vz * 1.05, 6.6);
      }
      if (P.state === 'ground') {
        P.pos.x += vx * dt; P.pos.z += vz * dt;
        const hit = W.pushOut(P.pos, 0.35, P.pos.y, 1.75);
        if (hit && spd > 0 && md.x * hit.nx + md.z * hit.nz < -0.5 && hit.c.climb && (free || input.jumpHeld)) {
          const top = hit.c.y1;
          if (top - P.pos.y <= 1.9 && hit.c.y0 <= P.pos.y + 0.5) startMantle(P.pos.x - hit.nx * 0.6, top, P.pos.z - hit.nz * 0.6, 0.26);
          else if (hit.c.y0 <= P.pos.y + 1.5) startClimb(hit);
        }
        if (P.state === 'ground' && took('jump')) {
          const t = leapSpot();
          if (t) {
            P.leap = true; P.leapY0 = P.pos.y;
            const ft = Math.sqrt((2 * t.h) / 20) + 0.15;
            jump((t.hay.x - P.pos.x) / ft, (t.hay.z - P.pos.z) / ft, 2.2);
            A.play('cloth'); SA.vibrate(20);
          } else jump(vx * 1.05, vz * 1.05, 6.2);
        }
        if (P.state === 'ground') {
          const g = W.groundAt(P.pos.x, P.pos.z, P.pos.y);
          if (P.pos.y > g + 0.05) {
            if (P.pos.y - g < 0.7) P.pos.y = g;
            else { P.state = 'air'; P.vel.set(vx, 0, vz); P.airMaxY = P.pos.y; }
          } else P.pos.y = g;
        }
      }
      P.moveSpd = spd;
      const mode = spd > 5 ? 'sprint' : spd > 2.6 ? 'run' : spd > 0 ? (P.blend ? 'sneak' : 'walk') : 'idle';
      anim = { mode: P.landT > 0 ? 'land' : P.blockT > 0 ? 'block' : P.hurtAnim > 0 ? 'hurt' : mode, speed: spd, fwd: spd, blend: P.blend };
    } else if (P.state === 'air') {
      P.vel.y -= 20 * dt;
      if (md.mag > 0.1 && !P.leap) {
        P.vel.x += md.x * 5 * dt; P.vel.z += md.z * 5 * dt;
        const hs = Math.hypot(P.vel.x, P.vel.z);
        if (hs > 8) { P.vel.x *= 8 / hs; P.vel.z *= 8 / hs; }
      }
      P.pos.addScaledVector(P.vel, dt);
      P.airMaxY = Math.max(P.airMaxY, P.pos.y);
      const hit = W.pushOut(P.pos, 0.35, P.pos.y, 1.75);
      if (hit) {
        const into = P.vel.x * hit.nx + P.vel.z * hit.nz;
        const toward = (md.mag > 0.1 ? md.x * hit.nx + md.z * hit.nz : into) < -0.3;
        if (hit.c.climb && !P.leap && toward && P.noGrabT <= 0 && hit.c.y1 - P.pos.y > 0.4 && hit.c.y0 <= P.pos.y + 1.5 && (free || input.jumpHeld || md.mag > 0.4)) {
          if (hit.c.y1 - P.pos.y < 1.6) startMantle(P.pos.x - hit.nx * 0.6, hit.c.y1, P.pos.z - hit.nz * 0.6, 0.3);
          else startClimb(hit);
        } else if (into < 0) { P.vel.x -= into * hit.nx; P.vel.z -= into * hit.nz; }
      }
      if (P.state === 'air') {
        const g = W.groundAt(P.pos.x, P.pos.z, P.pos.y, P.leap);
        if (P.pos.y <= g) land(g);
        else if (Math.abs(P.vel.x) + Math.abs(P.vel.z) > 0.5 && !P.leap) P.yaw = U.angLerp(P.yaw, Math.atan2(P.vel.x, P.vel.z), dt * 6);
      }
      anim = P.leap ? { mode: 'leap', p: (P.leapY0 - P.pos.y) / Math.max(1, P.leapY0 - 1) } : { mode: 'air', vy: P.vel.y, fwd: Math.hypot(P.vel.x, P.vel.z) };
      if (P.leap) anim.vy = P.vel.y;
    } else if (P.state === 'climb') {
      const c = P.climbC, n = P.cn, t = { x: -n.z, z: n.x };
      let vert = md.mag > 0.1 ? -(md.x * n.x + md.z * n.z) * md.mag : 0;
      let side = md.mag > 0.1 ? (md.x * t.x + md.z * t.z) * md.mag : 0;
      if (free) vert = Math.max(vert, 0.9);
      if (Math.abs(side) < 0.35) side = 0;
      const vs = vert * (vert > 0 ? (free ? 4.4 : 3.2) : 3.0);
      P.pos.y += vs * dt;
      if (side) {
        const ox = P.pos.x, oz = P.pos.z;
        P.pos.x += t.x * side * 2.4 * dt; P.pos.z += t.z * side * 2.4 * dt;
        const inside = n.x !== 0 ? P.pos.z >= c.z0 + 0.1 && P.pos.z <= c.z1 - 0.1 : P.pos.x >= c.x0 + 0.1 && P.pos.x <= c.x1 - 0.1;
        if (!inside) { const nc = wallAt(P.pos.x, P.pos.y, P.pos.z, n); if (nc) P.climbC = nc; else { P.pos.x = ox; P.pos.z = oz; side = 0; } }
      }
      snapToWall();
      const cc = P.climbC;
      if (vert > 0 && P.pos.y + 1.05 >= cc.y1) {
        let nx = P.pos.x - n.x * 0.75, nz = P.pos.z - n.z * 0.75;
        if (n.x !== 0) nx = cc.x1 - cc.x0 < 1.2 ? (cc.x0 + cc.x1) / 2 : U.clamp(nx, cc.x0 + 0.4, cc.x1 - 0.4);
        if (n.z !== 0) nz = cc.z1 - cc.z0 < 1.2 ? (cc.z0 + cc.z1) / 2 : U.clamp(nz, cc.z0 + 0.4, cc.z1 - 0.4);
        startMantle(nx, cc.y1, nz, 0.45);
      } else {
        const g = W.groundAt(P.pos.x + n.x * 0.2, P.pos.z + n.z * 0.2, P.pos.y);
        if (P.pos.y <= g) { P.pos.y = g; P.state = 'ground'; }
        else if (P.pos.y < cc.y0 - 0.5) { P.state = 'air'; P.airMaxY = P.pos.y; P.vel.set(0, 0, 0); P.noGrabT = 0.3; }
        if (took('jump')) { P.state = 'air'; P.vel.set(n.x * 5.5, 6, n.z * 5.5); P.yaw = Math.atan2(n.x, n.z); P.airMaxY = P.pos.y; P.noGrabT = 0.35; A.play('cloth'); }
      }
      const moving = Math.abs(vs) > 0.05 || side;
      anim = { mode: moving ? 'climb' : 'hang', speed: Math.max(Math.abs(vs), Math.abs(side) * 2), side: side ? Math.sign(side) : 0 };
    }
    if (P.pos.y < -5) P.pos.copy(W.bureau.spawn);
    let near = 0;
    for (const a of agents) if (a.alive && a.type === 'civ' && a.panicT <= 0 && a.pos.distanceToSquared(P.pos) < 12) near++;
    P.inCrowd = near >= 2;
    if (!anyCombat() && P.hurtT > 5 && P.hp < P.maxHp && !P.dead) { P.regenT += dt; if (P.regenT > 2.5) { P.regenT = 0; P.hp++; } }
    // поворот к цели взглядом
    const kt = G.killTarget();
    anim.look = kt ? U.angDiff(P.yaw, Math.atan2(kt.pos.x - P.pos.x, kt.pos.z - P.pos.z)) : 0;
    ch.root.position.copy(P.pos);
    ch.root.rotation.y = P.yaw;
    ch.root.visible = !(P.hidden && P.hideType === 'hay');
    const stepped = R.animate(ch, dt, anim);
    if (stepped) {
      if (anim.mode === 'climb' || anim.mode === 'hang') A.play('grab', 0.5);
      else if (P.moveSpd > 0.5) A.play(P.pos.y > 2 ? 'stepRoof' : 'step', P.blend ? 0.4 : P.moveSpd > 5 ? 1.2 : 0.8);
    }
  }
  function anyCombat() { for (const a of agents) if (a.alive && a.state === 'combat') return true; return false; }
  function anyFlee() { for (const a of agents) if (a.alive && a.state === 'flee') return true; return false; }
  G.anyCombat = anyCombat;

  // ================= Камера =================
  const _tgt = new V3(), _cp = new V3();
  function updateCamera(dt) {
    const sens = SA.settings.sens;
    cam.yaw -= input.camDX * 0.0055 * sens;
    cam.pitch = U.clamp(cam.pitch + input.camDY * 0.0045 * sens * (SA.settings.invertY ? -1 : 1), -0.45, 1.25);
    if (input.camDX || input.camDY) input.camIdle = 0; else input.camIdle += dt;
    input.camDX = 0; input.camDY = 0;
    // автоследование за спиной при беге
    if (SA.settings.autoCam && input.camIdle > 1.4 && P.moveSpd > 3 && (P.state === 'ground' || P.state === 'roll')) {
      cam.yaw = U.angLerp(cam.yaw, P.yaw + Math.PI, U.damp(0.9, dt));
      cam.pitch = U.lerp(cam.pitch, 0.28, U.damp(0.6, dt));
    }
    let dist = P.state === 'climb' ? 5.0 : P.moveSpd > 5 ? 4.9 : 4.3, pitch = cam.pitch, yaw = cam.yaw, fov = P.moveSpd > 5 ? 67 : 60;
    if (P.state === 'sync') { cam.orbit = (cam.orbit || 0) + dt * 0.9; yaw = cam.yaw + cam.orbit; dist = 9; pitch = 0.3; fov = 66; }
    else if (P.leap) { dist = 6.5; pitch = 0.85; fov = 72; }
    else cam.orbit = 0;
    if (P.hidden) dist = 3.6;
    _tgt.set(P.pos.x, P.pos.y + 1.55, P.pos.z);
    if (P.state === 'hidden') _tgt.y = P.pos.y + 1.0;
    // боковое смещение камеры через плечо
    const sh = 0.35;
    _tgt.x += Math.cos(yaw) * sh; _tgt.z -= Math.sin(yaw) * sh;
    cam.target.lerp(_tgt, U.damp(14, dt));
    if (cam.target.distanceTo(_tgt) > 6) cam.target.copy(_tgt);
    let cx = cam.target.x + Math.sin(yaw) * Math.cos(pitch) * dist, cy = cam.target.y + Math.sin(pitch) * dist, cz = cam.target.z + Math.cos(yaw) * Math.cos(pitch) * dist;
    let look = cam.target;
    const kc = cam.killCam;
    if (kc && kc.t > 0) {
      kc.t -= dt / Math.max(0.3, G.timeScale);
      const a = kc.a, mx = (P.pos.x + a.pos.x) / 2, mz = (P.pos.z + a.pos.z) / 2, my = P.pos.y + 1.1;
      const dx = a.pos.x - P.pos.x, dz = a.pos.z - P.pos.z, l = Math.hypot(dx, dz) || 1;
      cx = mx + (-dz / l) * 2.6 * kc.side + (dx / l) * -0.6; cz = mz + (dx / l) * 2.6 * kc.side + (dz / l) * -0.6; cy = my + 0.5;
      _cp.set(mx, my, mz); look = _cp; fov = 52;
    }
    const f = W.segHit(look.x, look.y, look.z, cx, cy, cz);
    const k = f < 1 ? Math.max(0.12, f - 0.06) : 1;
    SA.camera.position.set(U.lerp(look.x, cx, k), Math.max(0.3, U.lerp(look.y, cy, k)), U.lerp(look.z, cz, k));
    if (cam.shake > 0) {
      cam.shake = Math.max(0, cam.shake - dt * 1.2);
      const s = cam.shake * 0.4;
      SA.camera.position.x += (Math.random() - 0.5) * s; SA.camera.position.y += (Math.random() - 0.5) * s;
    }
    SA.camera.lookAt(look);
    cam.fov = U.lerp(cam.fov, fov, U.damp(4, dt));
    if (Math.abs(SA.camera.fov - cam.fov) > 0.05) { SA.camera.fov = cam.fov; SA.camera.updateProjectionMatrix(); }
  }

  G.setEagle = function (on) {
    P.eagle = on;
    if (on) { P.eagleUsed = true; A.play('eagle'); }
    W.setEagle(on);
    ui().eagle(on);
  };

  // ================= Миссии =================
  function clearWorld() {
    for (const a of agents) a.remove();
    agents.length = 0;
    for (const p of projectiles) SA.scene.remove(p.m);
    projectiles.length = 0;
    for (const t of W.towers) t.synced = false;
    cam.killCam = null;
  }
  function spawnAmbient(o) {
    o = o || {};
    const outer = W.nodes.map((n, i) => i).filter((i) => !W.nodes[i].inner);
    const civs = Math.round((o.civs || 26) * (SA.settings.quality === 'low' ? 0.7 : 1));
    for (let k = 0; k < civs; k++) {
      const n = W.nodes[outer[Math.floor(rnd() * outer.length)]];
      new Agent('civ', n.x + (rnd() - 0.5) * 6, n.z + (rnd() - 0.5) * 6);
    }
    // сидящие на скамьях и беседующие группы
    const benches = W.benches.slice().sort(() => rnd() - 0.5).slice(0, Math.round(civs * 0.35));
    for (const b of benches) new Agent('civ', b.x, b.z, { sit: true, yaw: b.yaw, talk: true });
    for (let k = 0; k < Math.round(civs * 0.15); k++) {
      const n = W.nodes[outer[Math.floor(rnd() * outer.length)]], cx = n.x + (rnd() - 0.5) * 3, cz = n.z + (rnd() - 0.5) * 3;
      const face = new V3(cx, 0, cz);
      for (let j = 0; j < 2 + Math.floor(rnd() * 2); j++) {
        const a = (j / 3) * 6.28 + rnd() * 0.5;
        new Agent('civ', cx + Math.cos(a) * 0.9, cz + Math.sin(a) * 0.9, { idle: true, face, talk: true });
      }
    }
    for (let k = 0; k < (o.patrols !== undefined ? o.patrols : 8); k++) {
      const n = W.nodes[outer[Math.floor(rnd() * outer.length)]];
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
    P.pos.copy(p); P.vel.set(0, 0, 0); P.yaw = yaw || 0; P.state = 'ground'; P.dead = false; P.hidden = false;
    P.hp = P.maxHp; P.knives = 5; P.blend = false; P.leap = false; P.letter = false; P.eagleUsed = false;
    P.ch.bones.hips.rotation.set(0, 0, 0); P.ch.bones.hips.position.y = 0.98;
    G.setEagle(false);
    cam.yaw = P.yaw + Math.PI; cam.pitch = 0.3;
    cam.target.set(P.pos.x, P.pos.y + 1.5, P.pos.z);
  }
  function setObj(text, target) { const M = G.mission; if (M) { M.obj = text; M.target = target || null; } }
  function setHint(text) { const M = G.mission; if (M) M.hint = text; }
  const nodeAt = W.nodeAt;
  G.MISSIONS = [
    {
      title: 'Орлиный взгляд', tag: 'Обучение',
      desc: 'Взберись на башню обзора, синхронизируйся, соверши прыжок веры и устрани предателя Братства.',
      start(m) { spawnAmbient({ civs: 22, patrols: 4 }); placePlayer(W.bureau.spawn, Math.PI / 2); m.tower = W.towers[0]; },
      update(m) {
        const T = m.tower;
        switch (m.step) {
          case 0:
            setObj('Доберись до башни обзора', new V3(T.x + 2.5, 0, T.z + 3));
            setHint('Джойстик — движение. Отведи его до упора — герой перейдёт на бег паркура.');
            if (U.dist2(P.pos.x, P.pos.z, T.x, T.z) < 12 || P.pos.y > 3) m.step = 1;
            break;
          case 1:
            setObj('Взберись на вершину башни', new V3(T.x, T.h, T.z));
            setHint('Беги на стену с джойстиком до упора — ассасин полезет сам. Двигай стик, чтобы лезть.');
            if (towerAtTop()) m.step = 2;
            break;
          case 2: setObj('Синхронизируйся с городом', null); setHint('Нажми подсвеченную кнопку «Синхронизация».'); if (T.synced) m.step = 3; break;
          case 3: setObj('Соверши прыжок веры', T.beam); setHint('Пройди на край балки и нажми ПРЫЖОК. Внизу ждёт стог сена.'); break;
          case 4: setObj('Найди предателя Харуна', null); setHint('Нажми кнопку с глазом — орлиное зрение подсветит цель золотым сквозь стены.'); if (P.eagle) m.step = 5; break;
          case 5: setObj('Устрани предателя Харуна', m.traitor); setHint('Подкрадись сзади. Когда над целью появится красная метка — жми КЛИНОК.'); break;
        }
      },
      onEvent(m, ev) {
        if (ev === 'hay' && m.step === 3) {
          m.step = 4;
          const n = nodeAt(3, 2);
          m.traitor = new Agent('target', n.x + 2, n.z + 1, { idle: true, name: 'Харун', yaw: 0.3, fight: true, hp: 2, look: 'traitor' });
        }
      },
      onKill(m, a) { if (a === m.traitor) completeMission('Предатель мёртв. Братство гордится тобой, новичок.'); },
    },
    {
      title: 'Сборщик налогов', tag: 'Убийство',
      desc: 'Жестокий сборщик Абдулла грабит торговцев на рыночной площади. Устрани его и скройся от стражи.',
      start(m) {
        spawnAmbient({ civs: 22, patrols: 6 });
        const c = W.marketCenter;
        m.collector = new Agent('target', c.x, c.z, { y: 0.6, idle: true, name: 'Абдулла', fight: false, hp: 2, look: 'collector' });
        m.collector.gesture = true;
        for (const [dx, dz, y] of [[-3, -3, Math.PI * 1.25], [3, -3, Math.PI * 0.75], [3, 3, Math.PI * 0.25], [-3, 3, -Math.PI * 0.25]]) new Agent('guard', c.x + dx, c.z + dz, { post: true, yaw: y });
        for (let k = 0; k < 12; k++) {
          const ang = (k / 12) * Math.PI * 2 + 0.2, r = 4 + (k % 3) * 0.9;
          new Agent('civ', c.x + Math.cos(ang) * r, c.z + Math.sin(ang) * r, { idle: true, face: c });
        }
        placePlayer(new V3(-52, 0, -26), Math.PI * 0.75);
      },
      update(m, dt) {
        switch (m.step) {
          case 0: setObj('Доберись до рыночной площади', W.marketCenter); setHint('Иди по крышам — сверху тебя видят хуже. Следи за метками над стражей.'); if (P.pos.distanceTo(W.marketCenter) < 28) m.step = 1; break;
          case 1: setObj('Устрани сборщика налогов Абдуллу', m.collector); setHint('Смешайся с толпой зевак (кнопка капюшона) или спрыгни с навеса и ударь в полёте.'); break;
          case 2:
            setObj('Скройся от стражи', null);
            setHint('Разорви прямую видимость: крыши, повороты, стог сена или сад на крыше.');
            if (!anyCombat() && !anyFlee()) { m.anon = (m.anon || 0) + dt; if (m.anon > 1.5) completeMission('Абдулла больше никого не ограбит. Торговцы свободны.'); } else m.anon = 0;
            break;
        }
      },
      onKill(m, a) { if (a === m.collector) { m.step = 2; for (const g of agents) if (g.alive && g.hostile && g.pos.distanceTo(a.pos) < 30) g.alarm(); } },
    },
    {
      title: 'Письмо тамплиера', tag: 'Кража',
      desc: 'Курьер ордена несёт письмо Великому Магистру. Укради его незаметно и доставь в бюро ассасинов.',
      start(m) {
        spawnAmbient({ civs: 26, patrols: 6 });
        const route = [[2, 3], [3, 3], [4, 3], [5, 3], [5, 4], [5, 5], [4, 5], [3, 5], [2, 5], [2, 4]].map(([k, l]) => new V3(nodeAt(k, l).x + 1.5, 0, nodeAt(k, l).z + 1.5));
        m.courier = new Agent('target', route[0].x, route[0].z, { route, speed: 1.2, fight: false, hp: 1, name: 'Курьер', fleeTo: new V3(78, 0, 50), vigilance: 0.8, look: 'courier' });
        m.escort = new Agent('guard', route[0].x - 2, route[0].z, { leader: m.courier });
        m.escort.state = 'follow';
        placePlayer(new V3(-52, 0, -52), Math.PI * 0.75);
      },
      update(m) {
        const c = m.courier;
        switch (m.step) {
          case 0:
            setObj('Найди курьера тамплиеров в центре города', P.eagleUsed ? c : new V3(0, 0, 0));
            setHint('Включи орлиное зрение: курьер подсвечен золотым.');
            if ((P.eagle && P.pos.distanceTo(c.pos) < 70) || P.pos.distanceTo(c.pos) < 18) m.step = 1;
            break;
          case 1:
            setObj('Укради письмо у курьера', c);
            setHint(c.state === 'flee' ? 'Курьер бежит к крепости! Догони и останови его!' : 'Подойди вплотную в режиме скрытности и нажми «Украсть». Не попадайся ему на глаза!');
            break;
          case 2:
            if (anyCombat()) { setObj('Оторвись от погони', null); setHint('В бюро нельзя привести хвост.'); }
            else { setObj('Доставь письмо в бюро ассасинов', W.bureau.door); setHint(''); if (P.pos.distanceTo(W.bureau.door) < 3) completeMission('Письмо раскрывает место встречи ордена. Великий Магистр будет в крепости…'); }
            break;
        }
      },
      context(m) {
        const c = m.courier;
        if (m.step !== 1 || !c.alive || P.state !== 'ground') return null;
        if (P.pos.distanceTo(c.pos) < 1.9) return { label: 'Украсть', icon: 'hand', pos: new V3(c.pos.x, c.pos.y + 2.1, c.pos.z), fn: () => {
          P.letter = true; m.step = 2; A.play('steal'); SA.vibrate(30); ui().toast('ПИСЬМО У ТЕБЯ', 1.4);
          if (c.state !== 'flee') c.aw = Math.min(c.aw + 0.4, 0.9);
        } };
        return null;
      },
      onKill(m, a) { if (a === m.courier && m.step < 2) { P.letter = true; m.step = 2; ui().toast('ПИСЬМО ДОБЫТО', 1.4); } },
      onEscape(m, a) { if (a === m.courier && m.step < 2) failMission('Курьер укрылся в крепости. Письмо потеряно.'); },
    },
    {
      title: 'Тени на крышах', tag: 'Зачистка',
      desc: 'Лучники ордена держат крыши восточного квартала. Убери их и устрани капитана стражи Рашида у фонтана.',
      start(m) {
        spawnAmbient({ civs: 22, patrols: 6 });
        m.archers = [];
        for (const [i, j] of [[4, 2], [5, 2], [5, 3], [6, 3]]) {
          let best = null;
          for (const r of W.roofParts[i + ',' + j] || []) if (!best || r.h > best.h) best = r;
          if (best) m.archers.push(new Agent('archer', best.x, best.z, { y: best.h, post: true, yaw: rnd() * 6.28 }));
        }
        m.total = m.archers.length;
        const f = W.fountainCenter;
        m.captain = new Agent('target', f.x + 4.2, f.z, { post: true, yaw: Math.PI / 2, fight: true, hp: 5, dmg: 2, name: 'Рашид', look: 'captain' });
        new Agent('guard', f.x + 5.5, f.z - 2, { post: true, yaw: 0.5 });
        new Agent('guard', f.x + 5.5, f.z + 2, { post: true, yaw: 2.6 });
        placePlayer(new V3(-26, 0, -78), Math.PI / 4);
      },
      update(m) {
        switch (m.step) {
          case 0: {
            const left = m.archers.filter((a) => a.alive);
            let near = null, nd = 1e9;
            for (const a of left) { const d = a.pos.distanceTo(P.pos); if (d < nd) { nd = d; near = a; } }
            setObj(`Устрани лучников на крышах · ${m.total - left.length}/${m.total}`, near);
            setHint('Лучники видят крыши. Подкрадись сзади, спрыгни сверху или метни нож (наведи камеру).');
            if (!left.length) m.step = m.captain.alive ? 1 : 2;
            break;
          }
          case 1: setObj('Убей капитана стражи Рашида', m.captain); setHint('Рашид бьёт по 2 деления. Убей скрытно — или жди «!» и жми КОНТР.'); break;
          case 2: setObj('Скройся от стражи', null); setHint(''); if (!anyCombat()) completeMission('Крыши снова принадлежат Братству.'); break;
        }
      },
      onKill(m, a) { if (a === m.captain && m.step === 1) m.step = 2; },
    },
    {
      title: 'Великий Магистр', tag: 'Финал',
      desc: 'Проникни в крепость тамплиеров, убей Великого Магистра и уйди живым. Запретная зона — стража бдительна вдвойне.',
      start(m) {
        spawnAmbient({ civs: 20, patrols: 6 });
        for (const [x, z] of [[66, 56.8], [90, 56.8], [56.8, 66], [56.8, 90], [99.2, 70], [78, 99.2]]) new Agent('archer', x, z, { y: 9, post: true, yaw: rnd() * 6.28 });
        new Agent('guard', 78, 62, { inner: true }); new Agent('guard', 62, 78, { inner: true }); new Agent('guard', 94, 78, { inner: true });
        m.master = new Agent('target', 78, 91, { post: true, yaw: 0, fight: true, hp: 6, dmg: 2, name: 'Великий Магистр', look: 'master' });
        new Agent('guard', 76, 92.5, { post: true, yaw: -0.4, hp: 4, look: 'elite' });
        new Agent('guard', 80, 92.5, { post: true, yaw: 0.4, hp: 4, look: 'elite' });
        placePlayer(new V3(nodeAt(6, 5).x, 0, nodeAt(6, 5).z), Math.PI / 2);
      },
      update(m) {
        const inside = W.inRestricted(P.pos.x, P.pos.z);
        switch (m.step) {
          case 0: setObj('Проникни в крепость тамплиеров', new V3(78, 9, 56.8)); setHint('Ворота охраняют. Перелезь через стену — но там лучники. Внутри тебя замечают быстрее!'); if (inside) m.step = 1; break;
          case 1: setObj('Убей Великого Магистра', m.master); setHint('Магистр у южной стены цитадели. Удар сверху со стены — лучший способ.'); break;
          case 2: setObj('Покинь крепость', null); setHint('Беги к стенам и перелезай наружу!'); if (!inside) m.step = 3; break;
          case 3: setObj('Скройся от погони', null); setHint(''); if (!anyCombat()) completeMission('Великий Магистр мёртв. Ничто не истинно — всё дозволено.'); break;
        }
      },
      onKill(m, a) { if (a === m.master) { m.step = 2; ui().toast('ЦЕЛЬ УСТРАНЕНА', 1.5); A.play('bell'); for (const g of agents) if (g.alive && g.hostile && W.inRestricted(g.pos.x, g.pos.z)) g.alarm(); } },
    },
  ];
  const FREE = {
    title: 'Свободный город',
    start() { spawnAmbient({ civs: 30, patrols: 10 }); placePlayer(W.bureau.spawn, Math.PI / 2); },
    update() {
      const n = W.towers.filter((t) => t.synced).length;
      let near = null, nd = 1e9;
      for (const t of W.towers) if (!t.synced) { const d = U.dist2(t.x, t.z, P.pos.x, P.pos.z); if (d < nd) { nd = d; near = t; } }
      setObj(`Синхронизируй башни обзора · ${n}/${W.towers.length}`, near ? new V3(near.x, near.h, near.z) : null);
      setHint('');
      if (!near) completeMission('Весь город как на ладони. Ты — истинный мастер паркура.');
    },
  };
  G.loadProgress = () => { try { return parseInt(localStorage.getItem('sa_progress') || '0', 10) || 0; } catch (e) { return 0; } };
  const saveProgress = (v) => { try { localStorage.setItem('sa_progress', String(v)); } catch (e) { /* нет хранилища */ } };

  G.startMission = function (idx) {
    A.init(); A.startAmbient();
    clearWorld();
    G.missionIndex = idx;
    G.runId++;
    const def = idx < 0 ? FREE : G.MISSIONS[idx];
    G.mission = { def, step: 0, obj: '', hint: '', target: null };
    G.stats = { kills: 0, alarms: 0, time: 0 };
    def.start(G.mission);
    G.mode = 'play'; G.paused = false; G.timeScale = 1; G.slowT = 0;
    ui().enterGame(def.title, idx < 0 ? 'Свободная игра' : 'Задание ' + (idx + 1));
  };
  function completeMission(text) {
    if (G.mode !== 'play') return;
    G.mode = 'end';
    A.play('win');
    if (G.missionIndex >= 0) saveProgress(Math.max(G.loadProgress(), G.missionIndex + 1));
    const run = G.runId;
    setTimeout(() => { if (G.runId === run && G.mode === 'end') ui().showEnd(true, 'ПАМЯТЬ СИНХРОНИЗИРОВАНА', text, G.stats, G.missionIndex >= 0 && G.missionIndex < G.MISSIONS.length - 1); }, 900);
  }
  function failMission(text, title) {
    if (G.mode !== 'play') return;
    G.mode = 'end';
    if (!P.dead) A.play('fail');
    const run = G.runId;
    setTimeout(() => { if (G.runId === run && G.mode === 'end') ui().showEnd(false, title || 'ДЕСИНХРОНИЗАЦИЯ', text, G.stats, false); }, 600);
  }
  G.goMenu = function () {
    G.runId++;
    G.mode = 'menu'; G.mission = null; G.paused = false;
    clearWorld();
    spawnAmbient({ civs: 30, patrols: 8 });
    placePlayer(W.bureau.spawn, 0);
    P.hidden = true;
    P.ch.root.visible = false;
  };
  G.pause = function (on) {
    if (G.mode !== 'play') return;
    G.paused = on;
    ui().pause(on);
  };

  // ================= Главный цикл =================
  function update(dt) {
    G.alertCD -= dt;
    G.stats.time += dt;
    if (took('pause')) { G.pause(true); return; }
    if (took('eagle')) G.setEagle(!P.eagle);
    if (took('blend')) { P.blend = !P.blend; A.play('cloth', 0.5); }
    if (took('knife')) knifeAction();
    if (took('blade')) bladeAction();
    if (took('block')) blockAction();
    if (took('act')) { const c = G.contextAction(); if (c) c.fn(); }
    updatePlayer(dt);
    for (let i = 0; i < agents.length; i++) agents[i].update(dt);
    for (let i = agents.length - 1; i >= 0; i--) { const a = agents[i]; if (!a.alive && a.deadT > 40) { a.remove(); agents.splice(i, 1); } }
    updateProjectiles(dt);
    const M = G.mission;
    if (M && G.mode === 'play') M.def.update(M, dt);
  }
  G.init = function () {
    TEX = { yellow: chevronTex('#ffd54a'), red: chevronTex('#ff3b30'), excl: chevronTex('#ffffff', '!') };
    makePlayer();
  };
  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const rdt = Math.min(0.05, (now - last) / 1000);
    last = now;
    G.time += rdt;
    if (G.mode === 'loading') return;
    if (G.mode === 'play' && !G.paused) {
      if (G.slowT > 0) { G.slowT -= rdt; G.timeScale = U.lerp(G.timeScale, 0.25, U.damp(20, rdt)); } else G.timeScale = U.lerp(G.timeScale, 1, U.damp(8, rdt));
      const dt = rdt * G.timeScale;
      update(dt);
      updateCamera(rdt);
      ui().update(rdt);
      input.pressed.clear();
    } else if (G.mode === 'end') {
      for (const a of agents) a.update(rdt * 0.5);
      input.mag = 0; input.mx = input.my = 0; input.pressed.clear();
      updatePlayer(rdt);
      updateCamera(rdt);
    } else if (G.mode === 'menu') {
      for (const a of agents) a.update(rdt);
      const t = G.time * 0.035;
      SA.camera.position.set(Math.sin(t) * 62, 30 + Math.sin(t * 2.3) * 5, Math.cos(t) * 62);
      SA.camera.lookAt(Math.sin(t + 0.9) * 22, 6, Math.cos(t + 0.9) * 22);
      if (SA.camera.fov !== 55) { SA.camera.fov = 55; SA.camera.updateProjectionMatrix(); }
    } else if (G.mode === 'play' && G.paused) {
      // пауза: медленно облетаем героя
    }
    const c = SA.camera.position;
    W.update(rdt, G.time, c);
    W.updateSun(G.mode === 'menu' ? c : P.pos);
    A.setAmbient(G.mode === 'play' ? P.pos.y : 25, P && P.eagle);
    SA.renderer.render(SA.scene, SA.camera);
  }
  G.run = () => requestAnimationFrame(frame);
  // Отладка: прогон симуляции без рендера (только с ?debug)
  G.simulate = function (sec) {
    const dt = 1 / 30;
    for (let t = 0; t < sec; t += dt) {
      if (G.mode !== 'play' || G.paused) break;
      if (G.slowT > 0) G.slowT -= dt;
      update(dt);
      updateCamera(dt);
      ui().update(dt);
      input.pressed.clear();
    }
  };
})(window.SA);
