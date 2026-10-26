'use strict';
/* Интерфейс: ввод, HUD, меню, загрузка. */
(function (SA) {
  const THREE = window.THREE, U = SA.U, $ = U.$, A = SA.audio;
  const G = SA.game, W = SA.world, input = SA.input;
  const ui = (SA.ui = {});
  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

  // ================= Экраны =================
  const SCREENS = ['loading', 'mainMenu', 'missionMenu', 'helpMenu', 'settingsMenu', 'pauseMenu', 'endMenu'];
  let settingsBack = 'mainMenu';
  let current = 'loading';
  function show(id) {
    current = id;
    for (const s of SCREENS) {
      const el = $(s);
      if (s === id) {
        el.classList.remove('hidden');
        setTimeout(() => { if (current === s) el.classList.remove('fade'); }, 20);
      } else if (!el.classList.contains('hidden')) {
        el.classList.add('fade');
        setTimeout(() => { if (current !== s) el.classList.add('hidden'); }, 360);
      }
    }
    const inGame = !id || id === 'pauseMenu' || id === 'endMenu' || (id === 'settingsMenu' && settingsBack === 'pauseMenu');
    $('hud').classList.toggle('hidden', !inGame);
    $('controls').classList.toggle('hidden', !!id || !inGame);
    if (id === 'missionMenu') buildMissions();
    if (id === 'settingsMenu') syncSettings();
  }
  ui.show = show;

  // ================= Тексты HUD =================
  let toastT = 0, hint2T = 0;
  ui.toast = function (t, dur, sub) {
    const el = $('toast');
    el.querySelector('.t').textContent = t;
    el.querySelector('.s').textContent = sub || '';
    el.classList.add('show');
    toastT = dur || 1.8;
  };
  ui.hint2 = function (t) { $('hint').textContent = t; $('hint').style.opacity = 1; hint2T = 2.2; };
  let dmgT = 0;
  ui.damage = function () { dmgT = 0.35; $('dmg').style.opacity = 1; $('health').classList.add('hit'); setTimeout(() => $('health').classList.remove('hit'), 160); };
  ui.eagle = (on) => { $('eagleTint').style.opacity = on ? 1 : 0; $('bEagle').classList.toggle('on', on); };
  ui.enterGame = function (title, sub) {
    show(null);
    lastHp = -1; lastObj = ''; lastStatus = '';
    ui.toast(title.toUpperCase(), 2.6, sub);
  };
  ui.pause = function (on) {
    if (on) {
      $('pauseTitle').textContent = G.mission ? G.mission.def.title : '';
      $('pauseObj').textContent = G.mission ? G.mission.obj : '';
      if (document.exitPointerLock) document.exitPointerLock();
      show('pauseMenu');
    } else show(null);
  };
  ui.showEnd = function (win, title, text, st, next) {
    $('endTitle').textContent = title;
    $('endTitle').style.color = win ? 'var(--ink)' : '#ff6a5e';
    $('endText').textContent = text;
    const t = Math.round(st.time);
    $('endStats').innerHTML = win ? `<div><b>${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}</b>ВРЕМЯ</div><div><b>${st.kills}</b>УСТРАНЕНО</div><div><b>${st.alarms}</b>ТРЕВОГ</div>` : '';
    $('btnEndNext').classList.toggle('hidden', !next);
    show('endMenu');
  };

  // ================= Меню заданий и настройки =================
  function buildMissions() {
    const prog = G.loadProgress(), el = $('missionList');
    el.innerHTML = '';
    G.MISSIONS.forEach((m, i) => {
      const locked = i > prog, done = i < prog;
      const d = document.createElement('div');
      d.className = 'card' + (locked ? ' locked' : '');
      d.innerHTML = `<div class="num">${i + 1}</div><div class="tag">${m.tag.toUpperCase()}</div><h3>${m.title}</h3><p>${m.desc}</p>
        <div class="st ${done ? 'ok' : ''}">${done ? '<svg class="i" style="width:14px;height:14px"><use href="#i-check"/></svg> ВЫПОЛНЕНО' : locked ? '<svg class="i" style="width:14px;height:14px"><use href="#i-lock"/></svg> ЗАКРЫТО' : 'ДОСТУПНО'}</div>`;
      const b = document.createElement('button');
      b.className = 'cta'; b.textContent = locked ? 'ЗАКРЫТО' : done ? 'ПОВТОРИТЬ' : 'НАЧАТЬ'; b.disabled = locked;
      b.onclick = () => { A.play('ui'); G.startMission(i); };
      d.appendChild(b);
      el.appendChild(d);
    });
  }
  function syncSettings() {
    const s = SA.settings;
    for (const b of $('setQuality').children) b.classList.toggle('on', b.dataset.v === s.quality);
    $('setSens').value = s.sens; $('setVol').value = s.volume;
    $('setInv').classList.toggle('on', s.invertY); $('setAuto').classList.toggle('on', s.autoCam); $('setVib').classList.toggle('on', s.vibro);
  }
  let qualityChanged = false;
  for (const b of $('setQuality').children) b.onclick = () => { SA.settings.quality = b.dataset.v; SA.saveSettings(); qualityChanged = true; syncSettings(); A.play('ui'); };
  $('setSens').oninput = (e) => { SA.settings.sens = +e.target.value; SA.saveSettings(); };
  $('setVol').oninput = (e) => { SA.settings.volume = +e.target.value; A.setVolume(SA.settings.volume); SA.saveSettings(); };
  const tog = (id, key) => ($(id).onclick = () => { SA.settings[key] = !SA.settings[key]; SA.saveSettings(); syncSettings(); A.play('ui'); if (key === 'vibro') SA.vibrate(20); });
  tog('setInv', 'invertY'); tog('setAuto', 'autoCam'); tog('setVib', 'vibro');

  document.querySelectorAll('[data-go]').forEach((el) => (el.onclick = () => {
    A.init(); A.play('ui');
    const g = el.dataset.go;
    if (g === 'main' && el.closest('#settingsMenu')) {
      if (qualityChanged) { location.reload(); return; }
      show(settingsBack); if (settingsBack === 'pauseMenu') return; return;
    }
    if (g === 'main') show('mainMenu');
    else if (g === 'missions') show('missionMenu');
    else if (g === 'help') show('helpMenu');
    else if (g === 'settings') { settingsBack = 'mainMenu'; show('settingsMenu'); }
    else if (g === 'free') G.startMission(-1);
  }));
  $('btnResume').onclick = () => G.pause(false);
  $('btnRestart').onclick = () => G.startMission(G.missionIndex);
  $('btnPauseSet').onclick = () => { settingsBack = 'pauseMenu'; show('settingsMenu'); };
  $('btnQuit').onclick = () => { G.goMenu(); show('mainMenu'); };
  $('btnEndNext').onclick = () => G.startMission(G.missionIndex + 1);
  $('btnEndRetry').onclick = () => G.startMission(G.missionIndex);
  $('btnEndMenu').onclick = () => { G.goMenu(); show('mainMenu'); };
  window.onAppPause = () => { if (G.mode === 'play' && !G.paused) G.pause(true); };
  window.onBackButton = () => {
    if (G.mode === 'play') { G.pause(!G.paused); return true; }
    for (const s of ['missionMenu', 'helpMenu', 'settingsMenu']) if (!$(s).classList.contains('hidden') && !$(s).classList.contains('fade')) { show(s === 'settingsMenu' ? settingsBack : 'mainMenu'); return true; }
    if (G.mode === 'end') { G.goMenu(); show('mainMenu'); return true; }
    return false;
  };

  // ================= Сенсорное управление =================
  const ctrl = $('controls'), stick = $('stick'), knob = $('knob'), lockZone = $('lockZone');
  const R = 58;
  let stickId = null, sx = 0, sy = 0;
  const camPtrs = new Map(), btnPtrs = new Map();
  function setStick(dx, dy) {
    const l = Math.hypot(dx, dy), k = l > R ? R / l : 1;
    input.mx = (dx * k) / R; input.my = (-dy * k) / R; input.mag = Math.min(1, l / R);
    knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    const hot = dy < -R * 1.9 && Math.abs(dx) < R * 0.8;
    lockZone.classList.toggle('hot', hot);
    stick.classList.toggle('free', input.mag > 0.93 || input.sprintLock);
    return hot;
  }
  function releaseStick(e) {
    const hot = lockZone.classList.contains('hot');
    stickId = null;
    lockZone.classList.remove('show', 'hot');
    if (hot) {
      input.sprintLock = true; input.mx = 0; input.my = 1; input.mag = 1;
      lockZone.classList.add('locked');
      SA.vibrate(25);
    } else {
      input.mx = input.my = input.mag = 0; stick.classList.remove('on', 'free');
    }
  }
  function pressBtn(el, pid) {
    const a = el.dataset.act;
    btnPtrs.set(pid, { a, el });
    el.classList.add('press');
    SA.vibrate(8);
    if (a === 'jump') { input.jumpHeld = true; input.pressed.add('jump'); }
    else input.pressed.add(a);
  }
  ctrl.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    A.init();
    const b = e.target.closest('[data-act]');
    if (b) { pressBtn(b, e.pointerId); return; }
    if (e.pointerType === 'mouse') {
      if (!document.pointerLockElement && ctrl.requestPointerLock) { ctrl.requestPointerLock(); return; }
      if (e.button === 0) input.pressed.add('blade');
      if (e.button === 2) input.pressed.add('block');
      return;
    }
    if (e.clientX < window.innerWidth * 0.45 && stickId === null) {
      if (input.sprintLock) { input.sprintLock = false; lockZone.classList.remove('locked'); }
      stickId = e.pointerId; sx = e.clientX; sy = e.clientY;
      stick.style.left = sx + 'px'; stick.style.top = sy + 'px';
      stick.classList.add('on');
      lockZone.style.left = sx + 'px'; lockZone.style.top = sy - R * 2.3 + 'px';
      lockZone.classList.add('show');
      input.stickActive = true;
      setStick(0, 0);
    } else camPtrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  }, { passive: false });
  ctrl.addEventListener('pointermove', (e) => {
    if (e.pointerId === stickId) setStick(e.clientX - sx, e.clientY - sy);
    else if (camPtrs.has(e.pointerId)) {
      const p = camPtrs.get(e.pointerId);
      input.camDX += (e.clientX - p.x) * 1.15; input.camDY += (e.clientY - p.y) * 1.15;
      p.x = e.clientX; p.y = e.clientY;
    }
  });
  function ptrEnd(e) {
    if (e.pointerId === stickId) { releaseStick(e); input.stickActive = false; }
    camPtrs.delete(e.pointerId);
    const b = btnPtrs.get(e.pointerId);
    if (b) {
      btnPtrs.delete(e.pointerId);
      b.el.classList.remove('press');
      if (b.a === 'jump' && ![...btnPtrs.values()].some((v) => v.a === 'jump')) input.jumpHeld = !!input.keys.Space;
    }
  }
  ctrl.addEventListener('pointerup', ptrEnd);
  ctrl.addEventListener('pointercancel', ptrEnd);
  ctrl.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('mousemove', (e) => { if (document.pointerLockElement === ctrl) { input.camDX += e.movementX; input.camDY += e.movementY; } });
  if (!isTouch) $('stickHintL').classList.add('hidden');

  // ================= Клавиатура =================
  const KEYACT = { KeyJ: 'blade', KeyK: 'block', KeyF: 'knife', KeyQ: 'eagle', KeyC: 'blend', KeyE: 'act' };
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    input.keys[e.code] = true;
    if (e.code === 'Escape') { if (G.mode === 'play') G.pause(!G.paused); return; }
    if (e.code === 'Space') { input.jumpHeld = true; input.pressed.add('jump'); e.preventDefault(); }
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') input.free = true;
    if (KEYACT[e.code]) input.pressed.add(KEYACT[e.code]);
  });
  window.addEventListener('keyup', (e) => {
    input.keys[e.code] = false;
    if (e.code === 'Space') input.jumpHeld = false;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') input.free = false;
  });
  function keyboardMove() {
    if (input.stickActive || input.sprintLock) return;
    const k = input.keys, x = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0), y = (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0);
    if (x || y) { const l = Math.hypot(x, y); input.mx = x / l; input.my = y / l; input.mag = k.AltLeft ? 0.4 : 0.8; input.kb = true; }
    else if (input.kb) { input.mx = input.my = input.mag = 0; input.kb = false; }
  }

  // ================= HUD: кадр =================
  let lastHp = -1, lastObj = '', lastStatus = '', lastJump = '', lastKnives = -1, promptLabel = '';
  const mm = $('minimap'), mg = mm.getContext('2d');
  const det = $('detect'), dg = det.getContext('2d');
  const _v = new THREE.Vector3();
  function project(p, yOff) {
    _v.set(p.x, p.y + (yOff || 0), p.z).project(SA.camera);
    const behind = _v.z > 1;
    return { x: (_v.x * 0.5 + 0.5) * window.innerWidth, y: (-_v.y * 0.5 + 0.5) * window.innerHeight, behind, nx: _v.x, ny: _v.y };
  }
  function placeAt(el, x, y) { el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`; }
  const STATUS_ICON = { alert: 'i-eye', susp: 'i-eye', hidden: 'i-hide', crowd: 'i-hood', blend: 'i-hood', anon: 'i-hood' };

  ui.update = function (dt) {
    keyboardMove();
    const P = G.player, M = G.mission;
    // здоровье
    if (P.hp !== lastHp) {
      lastHp = P.hp;
      let s = '';
      for (let i = 0; i < P.maxHp; i++) s += `<i class="${i < P.hp ? '' : 'e'}"></i>`;
      $('health').innerHTML = s;
      $('lowhp').style.opacity = P.hp <= 3 && !P.dead ? 1 : 0;
    }
    // статус
    let st = 'anon', label = 'АНОНИМЕН';
    if (G.anyCombat()) { st = 'alert'; label = 'ОБНАРУЖЕН'; }
    else if (G.agents.some((a) => a.alive && a.hostile && (a.aw > 0.3 || a.state === 'search' || a.state === 'flee'))) { st = 'susp'; label = 'ПОДОЗРЕНИЕ'; }
    else if (P.hidden) { st = 'hidden'; label = 'УКРЫТ'; }
    else if (P.blend && P.inCrowd) { st = 'crowd'; label = 'В ТОЛПЕ'; }
    else if (P.blend) { st = 'blend'; label = 'СКРЫТНОСТЬ'; }
    if (st + label !== lastStatus) {
      lastStatus = st + label;
      const el = $('status');
      el.className = st === 'alert' ? 'alert' : st === 'susp' ? 'susp' : st === 'anon' ? '' : 'good';
      el.innerHTML = `<svg class="i"><use href="#${STATUS_ICON[st]}"/></svg>${label}`;
    }
    if (P.knives !== lastKnives) { lastKnives = P.knives; $('knifeBadge').textContent = P.knives; $('bKnife').classList.toggle('off', P.knives <= 0); }
    // цель миссии
    if (M) {
      if (M.obj !== lastObj) { lastObj = M.obj; $('objective').querySelector('.txt').textContent = M.obj; }
      if (hint2T <= 0) { const h = $('hint'); if (h.textContent !== (M.hint || '')) h.textContent = M.hint || ''; h.style.opacity = M.hint ? 1 : 0; }
    }
    hint2T -= dt;
    toastT -= dt;
    if (toastT <= 0) $('toast').classList.remove('show');
    if (dmgT > 0) { dmgT -= dt; if (dmgT <= 0) $('dmg').style.opacity = 0; }
    $('hud').classList.toggle('on', !!(G.cam.killCam && G.cam.killCam.t > 0));
    // путевая метка
    const wp = $('waypoint');
    const tgt = M && M.target ? (M.target.pos || M.target) : null;
    if (tgt && M.target.alive !== false) {
      const pr = project(tgt, M.target.pos ? 2.4 : 0.8);
      const w = window.innerWidth, h = window.innerHeight, pad = 46;
      let x = pr.x, y = pr.y, off = pr.behind || x < pad || x > w - pad || y < pad || y > h - pad;
      if (pr.behind) { x = w - x; y = h - y; }
      if (off) {
        const cx = w / 2, cy = h / 2;
        let dx = x - cx, dy = y - cy;
        if (pr.behind && Math.abs(dy) < 1) dy = 1;
        const k = Math.min((w / 2 - pad) / Math.abs(dx || 1e-3), (h / 2 - pad) / Math.abs(dy || 1e-3));
        x = cx + dx * k; y = cy + dy * k;
        wp.querySelector('.arr').style.display = 'block';
        wp.querySelector('.arr').style.transform = `rotate(${Math.atan2(dx, -dy)}rad)`;
      } else wp.querySelector('.arr').style.display = 'none';
      wp.classList.remove('hidden');
      placeAt(wp, x, y);
      wp.querySelector('.d').textContent = Math.round(P.pos.distanceTo(tgt)) + ' м';
    } else wp.classList.add('hidden');
    // метки убийства и ножа
    const kt = G.killTarget(), km = $('killMark');
    if (kt) { const pr = project(kt.pos, 2.3); km.classList.toggle('hidden', pr.behind); placeAt(km, pr.x, pr.y); } else km.classList.add('hidden');
    const nt = !kt ? G.knifeTarget() : null, nm = $('knifeMark');
    if (nt) { const pr = project(nt.pos, 1.2); nm.classList.toggle('hidden', pr.behind); placeAt(nm, pr.x, pr.y); } else nm.classList.add('hidden');
    $('bBlade').classList.toggle('kill', !!kt);
    $('bBlade').querySelector('use').setAttribute('href', kt ? '#i-kill' : '#i-blade');
    $('bBlock').classList.toggle('warn', G.agents.some((a) => a.alive && a.windT > 0 && a.windT < 0.7 && a.pos.distanceTo(P.pos) < 3));
    const leap = G.leapSpot();
    const jl = leap ? 'ВЕРА' : P.state === 'climb' ? 'ОТСКОК' : 'ПРЫЖОК';
    if (jl !== lastJump) {
      lastJump = jl;
      $('bJump').querySelector('.lb').textContent = jl;
      $('bJump').querySelector('use').setAttribute('href', leap ? '#i-leap' : '#i-jump');
      $('bJump').classList.toggle('on', !!leap);
    }
    $('bBlend').classList.toggle('on', P.blend);
    // контекстное действие в мире
    const c = G.contextAction(), pe = $('prompt');
    if (c) {
      const pr = project(c.pos || P.pos, c.pos ? 0 : 2.1);
      if (!pr.behind) {
        pe.classList.remove('hidden');
        if (promptLabel !== c.label) { promptLabel = c.label; pe.querySelector('span').textContent = c.label; pe.querySelector('use').setAttribute('href', '#i-' + (c.icon || 'hand')); }
        const x = U.clamp(pr.x, 90, window.innerWidth - 90), y = U.clamp(pr.y, 80, window.innerHeight - 140);
        pe.style.left = x + 'px'; pe.style.top = y + 'px';
      } else pe.classList.add('hidden');
    } else pe.classList.add('hidden');
    const free = G.isFree();
    stick.classList.toggle('free', free && (input.stickActive || input.sprintLock));
    drawMinimap(P);
    drawDetection(P);
  };

  function drawMinimap(P) {
    const S = 256, g = mg, sc = 2.1, cam = G.cam;
    g.clearRect(0, 0, S, S);
    g.save();
    g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2); g.clip();
    g.translate(S / 2, S / 2); g.rotate(cam.yaw); g.scale(sc / W.MAP_S, sc / W.MAP_S);
    g.drawImage(W.mapBase, -(P.pos.x + 120) * W.MAP_S, -(P.pos.z + 120) * W.MAP_S);
    g.restore();
    const grd = g.createRadialGradient(S / 2, S / 2, S * 0.3, S / 2, S / 2, S / 2);
    grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(1, 'rgba(0,0,0,0.55)');
    g.fillStyle = grd; g.beginPath(); g.arc(S / 2, S / 2, S / 2, 0, 7); g.fill();
    g.save(); g.translate(S / 2, S / 2); g.rotate(cam.yaw);
    const Rr = S / 2 - 12;
    const dot = (x, z, col, r, clampIt) => {
      let dx = (x - P.pos.x) * sc, dz = (z - P.pos.z) * sc;
      const l = Math.hypot(dx, dz);
      if (l > Rr) { if (!clampIt) return; dx *= Rr / l; dz *= Rr / l; }
      g.fillStyle = col; g.beginPath(); g.arc(dx, dz, r, 0, 7); g.fill();
    };
    for (const t of W.towers) {
      let dx = (t.x - P.pos.x) * sc, dz = (t.z - P.pos.z) * sc; const l = Math.hypot(dx, dz);
      if (l > Rr) { dx *= Rr / l; dz *= Rr / l; }
      g.save(); g.translate(dx, dz); g.rotate(-cam.yaw);
      g.fillStyle = t.synced ? '#7fb6ff' : '#f3ede1'; g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(0, -8); g.lineTo(6, 6); g.lineTo(-6, 6); g.closePath(); g.fill(); g.stroke();
      g.restore();
    }
    for (const a of G.agents) {
      if (!a.alive || !a.hostile) continue;
      if (a.state === 'combat') dot(a.pos.x, a.pos.z, '#ff3b30', 5, true);
      else if (P.eagle || a.aw > 0.3) dot(a.pos.x, a.pos.z, a.type === 'target' ? '#ffc83a' : '#ff8a80', 4.5, a.type === 'target');
    }
    const M = G.mission;
    if (M && M.target && M.target.alive !== false) {
      const tp = M.target.pos || M.target;
      let dx = (tp.x - P.pos.x) * sc, dz = (tp.z - P.pos.z) * sc; const l = Math.hypot(dx, dz);
      if (l > Rr) { dx *= Rr / l; dz *= Rr / l; }
      g.save(); g.translate(dx, dz); g.rotate(-cam.yaw);
      g.fillStyle = '#d8b56c'; g.strokeStyle = '#000'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(0, -9); g.lineTo(7, 0); g.lineTo(0, 9); g.lineTo(-7, 0); g.closePath(); g.fill(); g.stroke();
      g.restore();
    }
    const fx = Math.sin(P.yaw), fz = Math.cos(P.yaw);
    g.fillStyle = '#fff'; g.strokeStyle = 'rgba(0,0,0,.7)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(fx * 13, fz * 13); g.lineTo(-fz * 7 - fx * 6, fx * 7 - fz * 6); g.lineTo(-fx * 2, -fz * 2); g.lineTo(fz * 7 - fx * 6, -fx * 7 - fz * 6); g.closePath(); g.fill(); g.stroke();
    g.restore();
    // север на кольце
    $('mapN').style.transform = `translate(${Math.sin(cam.yaw) * 70}px, ${-Math.cos(cam.yaw) * 70}px)`;
  }

  function drawDetection(P) {
    const w = window.innerWidth, h = window.innerHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
    if (det.width !== Math.round(w * dpr)) { det.width = Math.round(w * dpr); det.height = Math.round(h * dpr); }
    const g = dg;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2, rad = Math.min(w, h) * 0.3;
    for (const a of G.agents) {
      if (!a.alive || !a.hostile || (a.aw < 0.05 && a.state !== 'combat')) continue;
      if (a.state !== 'combat' && a.state !== 'suspicious' && a.aw < 0.1) continue;
      const dx = a.pos.x - P.pos.x, dz = a.pos.z - P.pos.z;
      const ang = Math.atan2(dx, dz) - (G.cam.yaw + Math.PI);
      const sa = -ang - Math.PI / 2;
      const combat = a.state === 'combat', k = combat ? 1 : a.aw;
      const span = 0.18 + 0.22 * k;
      g.lineCap = 'round';
      g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 7;
      g.beginPath(); g.arc(cx, cy, rad, sa - span, sa + span); g.stroke();
      g.strokeStyle = combat ? 'rgba(255,59,48,.95)' : `rgba(255,${Math.round(213 - k * 80)},74,${0.45 + k * 0.5})`;
      g.lineWidth = 4;
      g.beginPath(); g.arc(cx, cy, rad, sa - span * (combat ? 1 : k), sa + span * (combat ? 1 : k)); g.stroke();
    }
  }

  // ================= Загрузка =================
  const TIPS = ['Удерживай стик до упора — герой сам побежит по стенам.', 'Стог сена и сад на крыше — лучшие укрытия.', 'Удар сверху в прыжке убивает мгновенно.', 'Среди горожан в режиме скрытности тебя не видят.', 'Синхронизация на башне полностью лечит.'];
  $('loadTip').textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
  const bar = $('loadBar');
  const step = (fn, p) => new Promise((res) => setTimeout(() => { fn(); bar.style.width = p * 100 + '%'; res(); }, 30));
  (async function boot() {
    try {
      await step(() => SA.tex.build(), 0.25);
      await step(() => W.build((p) => (bar.style.width = (25 + p * 65) + '%')), 0.9);
      await step(() => { G.init(); G.goMenu(); }, 1);
      G.run();
      setTimeout(() => show('mainMenu'), 250);
    } catch (e) {
      $('loadTip').textContent = 'Ошибка загрузки: ' + e.message;
      throw e;
    }
  })();
  if (/[?&]debug/.test(location.search)) window.__dbg = SA;
})(window.SA);
