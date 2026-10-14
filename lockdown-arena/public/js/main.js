// Client: networking, input, prediction/interpolation, menu and event effects.
(function () {
  'use strict';
  const { CLASSES, CLASS_IDS, TEAMS, WEAPONS } = LD;
  const INTERP = 0.085; // seconds of interpolation delay for remote entities

  const $ = (id) => document.getElementById(id);
  const canvas = $('game');
  const R = new Renderer(canvas);
  R.resize();
  window.addEventListener('resize', () => R.resize());

  // ------------------------------------------------------------ settings
  const store = {
    get(k, d) { try { const v = localStorage.getItem('lda.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('lda.' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  };
  const settings = {
    name: store.get('name', 'Knight' + Math.floor(Math.random() * 900 + 100)),
    cls: store.get('cls', 'striker'),
    team: store.get('team', -1),
  };

  // ------------------------------------------------------------ state
  let ws = null, map = null, config = null;
  let myId = 0, myTeam = -1, joined = false, wantJoin = false;
  let snaps = [], offset = null, latest = null;
  let pending = [], seq = 0;
  let me = null, smooth = { x: 0, y: 0 }, lastMe = null, wasAlive = false, snapCam = true;
  const keys = new Set();
  const mouse = { x: innerWidth / 2, y: innerHeight / 2, left: false, right: false };
  let wep = 0, reloadReq = false;
  let menuOpen = true, chatOpen = false, showScores = false;
  const feed = [];
  let evq = [];
  let killedBy = '';
  let interp = { players: [], projectiles: [], bombs: [] };

  // ------------------------------------------------------------ network
  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}`);
    ws.onopen = () => setStatus('');
    ws.onclose = () => {
      joined = false; myId = 0; snaps = []; latest = null; offset = null;
      setStatus('Disconnected from server. Reconnecting…');
      setTimeout(connect, 1500);
    };
    ws.onmessage = (m) => {
      let msg;
      try { msg = JSON.parse(m.data); } catch (e) { return; }
      if (msg.t === 'welcome') {
        map = msg.map; map.grid = Uint8Array.from(map.grid);
        config = msg.config;
        R.setMap(map);
        if (msg.urls && msg.urls.length) $('addr').textContent = msg.urls.join('  ·  ');
        if (wantJoin) sendJoin();
      } else if (msg.t === 'joined') {
        myId = msg.id; myTeam = msg.team; joined = true;
      } else if (msg.t === 'snap') {
        onSnap(msg);
      }
    };
  }
  function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }
  function sendJoin() { send({ t: 'join', name: settings.name, cls: settings.cls, team: settings.team }); }
  function setStatus(s) { const el = $('status'); el.textContent = s; el.classList.toggle('hidden', !s); }

  function onSnap(s) {
    const now = performance.now() / 1000;
    const sample = s.st - now;
    if (offset == null || Math.abs(sample - offset) > 0.5) offset = sample;
    else offset += (sample - offset) * 0.08;
    s.byId = new Map(s.players.map((p) => [p.i, p]));
    snaps.push(s);
    while (snaps.length > 2 && snaps[1].st < s.st - 1) snaps.shift();
    latest = s;
    $('botsN').textContent = s.fill;
    for (const ev of s.ev) evq.push({ at: s.st, ev });

    const p = s.byId.get(myId);
    if (!p) return;
    myTeam = p.t;
    lastMe = p;
    if (p.al) {
      if (!me || !wasAlive || p.da) {
        if (!wasAlive) snapCam = true;
        me = { x: p.x, y: p.y };
        smooth.x = smooth.y = 0;
        pending = pending.filter((i) => i.seq > p.ack);
      } else {
        // reconcile: start from the authoritative position and replay unacknowledged input
        const ox = me.x + smooth.x, oy = me.y + smooth.y;
        me.x = p.x; me.y = p.y;
        pending = pending.filter((i) => i.seq > p.ack);
        const speed = CLASSES[p.c].speed * p.sm;
        for (const i of pending) LD.stepMove(map, me, i, speed, i.dt);
        smooth.x = ox - me.x; smooth.y = oy - me.y;
        if (Math.hypot(smooth.x, smooth.y) > 80) smooth.x = smooth.y = 0;
      }
    } else {
      pending = [];
    }
    wasAlive = !!p.al;
  }

  // ------------------------------------------------------------ interpolation
  function lerpAngle(a, b, t) { return a + LD.angleDiff(b, a) * t; }

  function buildInterp(rt) {
    if (!snaps.length) return;
    let a = snaps[0], b = snaps[snaps.length - 1];
    for (let i = snaps.length - 1; i > 0; i--) {
      if (snaps[i - 1].st <= rt) { a = snaps[i - 1]; b = snaps[i]; break; }
    }
    const span = b.st - a.st;
    const t = span > 0 ? Math.max(0, Math.min(1, (rt - a.st) / span)) : 1;
    const players = [];
    for (const pb of b.players) {
      const pa = a.byId.get(pb.i);
      const o = Object.assign({}, pb, { swAt: b.st });
      if (pa && pa.al && pb.al && Math.hypot(pb.x - pa.x, pb.y - pa.y) < 200) {
        o.x = pa.x + (pb.x - pa.x) * t;
        o.y = pa.y + (pb.y - pa.y) * t;
        o.a = lerpAngle(pa.a, pb.a, t);
      }
      if (!o.sw && pa && pa.sw) { o.sw = pa.sw; o.swAt = a.st; }
      players.push(o);
    }
    const pa = new Map(a.pr.map((p) => [p[0], p]));
    const projectiles = b.pr.map((p) => {
      const q = pa.get(p[0]);
      const o = p.slice();
      if (q) { o[1] = q[1] + (p[1] - q[1]) * t; o[2] = q[2] + (p[2] - q[2]) * t; }
      else { const back = Math.max(0, b.st - rt); o[1] = p[1] - p[3] * back; o[2] = p[2] - p[4] * back; }
      return o;
    });
    const bombs = b.bo.map((x) => { const o = x.slice(); o[4] = x[4] + (b.st - rt); return o; });
    interp = { players, projectiles, bombs };
  }

  // ------------------------------------------------------------ events → effects
  function posOf(id) {
    const p = interp.players.find((q) => q.i === id);
    return p ? (p.i === myId && me ? { x: me.x, y: me.y } : p) : null;
  }
  function listener() { return me && lastMe && lastMe.al ? me : R.cam; }
  function sfx(name, x, y, extra) { const l = listener(); Sound.play(name, x, y, l.x, l.y, extra); }
  function pushFeed(parts, mine) {
    feed.unshift({ at: performance.now() / 1000, parts, mine });
    if (feed.length > 6) feed.pop();
  }
  const teamName = (t) => ({ s: TEAMS[t].name, c: TEAMS[t].light });

  function handleEvent(e) {
    const p = e.id ? posOf(e.id) : null;
    switch (e.e) {
      case 'swing': if (p) sfx('swing', p.x, p.y, e.k); break;
      case 'shot':
        sfx(e.big ? 'bigshot' : 'shot', e.x, e.y);
        R.burst(e.x, e.y, e.big ? '#fff6c2' : '#bfefff', e.big ? 10 : 4, 120, 0.2, 3);
        break;
      case 'spark': R.burst(e.x, e.y, '#ffe9a8', 5, 140, 0.25, 2.5); sfx('spark', e.x, e.y); break;
      case 'bombDrop': sfx('bombDrop', e.x, e.y); break;
      case 'boom': {
        R.ring(e.x, e.y, 10, e.r, 0.45, '#ffb347', 8);
        R.ring(e.x, e.y, 5, e.r * 0.7, 0.3, '#fff3b0', 5);
        R.burst(e.x, e.y, '#ff9a3d', 26, 380, 0.5, 7);
        R.burst(e.x, e.y, '#5a5f6e', 14, 160, 0.9, 9);
        const l = listener();
        if (Math.hypot(e.x - l.x, e.y - l.y) < 500) R.shake = 12;
        sfx('boom', e.x, e.y);
        break;
      }
      case 'hit': {
        const mine = e.id === myId, byMe = e.by === myId;
        R.text(e.x + (Math.random() - 0.5) * 16, e.y - 34, String(e.d), mine ? '#ff7272' : byMe ? '#ffd166' : '#ffffff', byMe && e.d >= 30);
        R.burst(e.x, e.y - 6, '#ff5d5d', 6, 160, 0.3, 3);
        sfx('hit', e.x, e.y);
        if (mine) { R.hurtFlash = 1; R.shake = Math.max(R.shake, 6); sfx('hurt'); }
        break;
      }
      case 'kill': {
        R.burst(e.x, e.y, TEAMS[e.vt].light, 22, 260, 0.7, 5);
        R.ring(e.x, e.y, 10, 60, 0.4, '#ffffff', 4);
        sfx('kill', e.x, e.y);
        const parts = [];
        if (e.kn) parts.push({ s: e.kn, c: TEAMS[e.kt].light }, { icon: e.w });
        else parts.push({ s: '✖' });
        parts.push({ s: e.vn, c: TEAMS[e.vt].light });
        pushFeed(parts, e.id === myId || e.by === myId);
        if (e.id === myId) killedBy = e.kn || '';
        if (e.by === myId && e.id !== myId) R.text(e.x, e.y - 60, 'KO!', '#ffd166', true);
        break;
      }
      case 'capture': {
        const pt = map.points.find((q) => q.id === e.p);
        if (pt) { R.ring(pt.x, pt.y, 20, config.captureRadius, 0.7, TEAMS[e.t].light, 6); R.burst(pt.x, pt.y - 10, TEAMS[e.t].light, 30, 300, 0.8, 5); }
        pushFeed([teamName(e.t), { s: 'captured point ' + e.p }], e.t === myTeam);
        sfx(e.t === myTeam ? 'capGood' : 'capBad');
        break;
      }
      case 'neutral':
        pushFeed([{ s: `Point ${e.p} lost by` }, teamName(e.t)], e.t === myTeam);
        sfx('neutral');
        break;
      case 'dash': if (p) { R.burst(e.x, e.y, CLASSES.striker.color, 10, 200, 0.3, 4); sfx('dash', e.x, e.y); } break;
      case 'cloak': R.burst(e.x, e.y, CLASSES.recon.color, 14, 120, 0.5, 4); sfx('cloak', e.x, e.y); break;
      case 'uncloak': R.burst(e.x, e.y, CLASSES.recon.color, 14, 160, 0.4, 4); sfx('uncloak', e.x, e.y); break;
      case 'bubbleUp': if (p) sfx('bubbleUp', p.x, p.y); break;
      case 'bubbleBreak': R.ring(e.x, e.y, 60, 160, 0.4, CLASSES.guardian.color, 5); R.burst(e.x, e.y, CLASSES.guardian.color, 24, 300, 0.5, 4); sfx('bubbleBreak', e.x, e.y); break;
      case 'block': R.burst(e.x, e.y, CLASSES.guardian.color, 6, 140, 0.3, 3); sfx('block', e.x, e.y); break;
      case 'heal': R.burst(e.x, e.y, '#ff8fa0', 16, 140, 0.6, 4); sfx('heal', e.x, e.y); if (e.id === myId) R.text(e.x, e.y - 40, '+HP', '#7dff9a', true); break;
      case 'reload': if (e.id === myId) sfx('reload'); break;
      case 'fizzle': if (e.id === myId) sfx('fizzle'); break;
      case 'start': pushFeed([{ s: 'Match started: capture the points!', c: '#ffd166' }]); sfx('start'); break;
      case 'end': sfx(e.w === myTeam ? 'win' : e.w === 2 ? 'neutral' : 'lose'); break;
      case 'join': pushFeed([{ s: e.n, c: TEAMS[e.t].light }, { s: 'joined' }, teamName(e.t)]); break;
      case 'leave': pushFeed([{ s: e.n, c: TEAMS[e.t].light }, { s: 'left' }]); break;
      case 'chat': pushFeed([{ s: e.n + ':', c: TEAMS[e.tm].light }, { s: e.s }]); sfx('chat'); break;
    }
  }

  // ------------------------------------------------------------ input
  function moveVec() {
    let mx = 0, my = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp') || keys.has('KeyZ')) my -= 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) my += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) mx -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) mx += 1;
    const l = Math.hypot(mx, my);
    return l ? [mx / l, my / l] : [0, 0];
  }
  function cycleWeapon(d) { wep = (wep + d + 3) % 3; Sound.play('click'); }

  window.addEventListener('keydown', (e) => {
    if (chatOpen) return;
    if (e.target && e.target.tagName === 'INPUT') return;
    if (e.code === 'Escape') { setMenu(!menuOpen); e.preventDefault(); return; }
    if (menuOpen) return;
    keys.add(e.code);
    switch (e.code) {
      case 'Tab': showScores = true; e.preventDefault(); break;
      case 'Digit1': wep = 0; break;
      case 'Digit2': wep = 1; break;
      case 'Digit3': wep = 2; break;
      case 'KeyQ': cycleWeapon(1); break;
      case 'KeyR': reloadReq = true; break;
      case 'KeyC': setMenu(true); break;
      case 'KeyM': Sound.toggleMute(); break;
      case 'Enter': openChat(); e.preventDefault(); break;
      case 'Space': e.preventDefault(); break;
    }
  });
  window.addEventListener('keyup', (e) => {
    keys.delete(e.code);
    if (e.code === 'Tab') showScores = false;
  });
  window.addEventListener('blur', () => { keys.clear(); mouse.left = mouse.right = false; showScores = false; });
  canvas.addEventListener('mousemove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; });
  canvas.addEventListener('mousedown', (e) => {
    Sound.init();
    if (e.button === 0) mouse.left = true;
    if (e.button === 2) mouse.right = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) mouse.left = false;
    if (e.button === 2) mouse.right = false;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => { if (!menuOpen) cycleWeapon(e.deltaY > 0 ? 1 : -1); e.preventDefault(); }, { passive: false });

  // chat
  const chat = $('chat');
  function openChat() { chatOpen = true; keys.clear(); mouse.left = mouse.right = false; chat.classList.add('open'); chat.value = ''; chat.focus(); }
  function closeChat() { chatOpen = false; chat.classList.remove('open'); chat.blur(); }
  chat.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.code === 'Enter') { if (chat.value.trim()) send({ t: 'chat', text: chat.value }); closeChat(); }
    else if (e.code === 'Escape') closeChat();
  });

  // ------------------------------------------------------------ menu
  const nameEl = $('name');
  nameEl.value = settings.name;
  const classesEl = $('classes');
  for (const id of CLASS_IDS) {
    const c = CLASSES[id];
    const b = document.createElement('button');
    b.className = 'cls';
    b.dataset.cls = id;
    b.style.setProperty('--c', c.color);
    b.innerHTML = `<canvas width="90" height="90"></canvas><b>${c.name}</b>
      <div class="stats">${c.hp} HP · speed ${c.speed} · ${c.abilityName}</div><p>${c.blurb}</p>`;
    b.addEventListener('click', () => { settings.cls = id; refreshMenu(); });
    classesEl.appendChild(b);
  }
  document.querySelectorAll('#teams .team').forEach((b) => {
    b.addEventListener('click', () => { settings.team = Number(b.dataset.team); refreshMenu(); });
  });
  function refreshMenu() {
    const previewTeam = settings.team === -1 ? (myTeam === -1 ? 1 : myTeam) : settings.team;
    classesEl.querySelectorAll('.cls').forEach((b) => {
      b.classList.toggle('sel', b.dataset.cls === settings.cls);
      drawKnightPreview(b.querySelector('canvas'), b.dataset.cls, previewTeam);
    });
    document.querySelectorAll('#teams .team').forEach((b) => b.classList.toggle('sel', Number(b.dataset.team) === settings.team));
    $('play').textContent = joined ? 'Resume' : 'Join match';
  }
  function setMenu(open) {
    menuOpen = open;
    $('menu').classList.toggle('hidden', !open);
    if (open) { keys.clear(); mouse.left = mouse.right = false; refreshMenu(); }
  }
  $('play').addEventListener('click', () => {
    Sound.init();
    settings.name = nameEl.value.trim().slice(0, 16) || settings.name;
    store.set('name', settings.name); store.set('cls', settings.cls); store.set('team', settings.team);
    if (!joined) { wantJoin = true; sendJoin(); }
    else {
      if (lastMe && settings.cls !== lastMe.nc) send({ t: 'class', cls: settings.cls });
      if (settings.team !== -1 && settings.team !== myTeam) send({ t: 'team', team: settings.team });
    }
    setMenu(false);
  });
  nameEl.addEventListener('keydown', (e) => { if (e.code === 'Enter') $('play').click(); });
  $('botsMinus').addEventListener('click', () => send({ t: 'bots', n: (latest ? latest.fill : 3) - 1 }));
  $('botsPlus').addEventListener('click', () => send({ t: 'bots', n: (latest ? latest.fill : 3) + 1 }));
  $('restart').addEventListener('click', () => { if (confirm('Restart the match for everyone?')) send({ t: 'restart' }); });
  $('addr').textContent = location.host;
  refreshMenu();

  // ------------------------------------------------------------ main loop
  let last = performance.now();
  function frame(tNow) {
    const dt = Math.min(0.05, (tNow - last) / 1000);
    last = tNow;
    const now = tNow / 1000;

    if (joined && map) {
      const active = !menuOpen && !chatOpen;
      const [mx, my] = active ? moveVec() : [0, 0];
      const alive = lastMe && lastMe.al;
      const drawX = me ? me.x + smooth.x : 0, drawY = me ? me.y + smooth.y : 0;
      const mw = R.screenToWorld(mouse.x, mouse.y);
      const aim = me ? Math.atan2(mw.y - (drawY - 4), mw.x - drawX) : 0;
      const inp = {
        t: 'input', seq: ++seq, dt, mx, my, aim,
        atk: active && mouse.left, abil: active && (mouse.right || keys.has('Space') || keys.has('ShiftLeft')),
        wep, reload: reloadReq,
      };
      reloadReq = false;
      if (alive && me && !lastMe.da) {
        LD.stepMove(map, me, inp, CLASSES[lastMe.c].speed * (lastMe.sm || 1), dt);
        pending.push({ seq: inp.seq, dt, mx, my });
        if (pending.length > 240) pending.shift();
      }
      send(inp);
      const k = Math.pow(0.001, dt);
      smooth.x *= k; smooth.y *= k;
    }

    const rt = offset != null ? now + offset - INTERP : 0;
    buildInterp(rt);
    evq.sort((a, b) => a.at - b.at);
    while (evq.length && evq[0].at <= rt) handleEvent(evq.shift().ev);
    if (evq.length > 500) evq = evq.slice(-200);

    // local player is drawn at its predicted position with the local aim
    const players = interp.players.map((p) => {
      if (p.i === myId && p.al && me) {
        const mw = R.screenToWorld(mouse.x, mouse.y);
        const x = me.x + smooth.x, y = me.y + smooth.y;
        return Object.assign({}, p, { x, y, a: Math.atan2(mw.y - (y - 4), mw.x - x) });
      }
      return p;
    });
    const self = players.find((p) => p.i === myId);
    const focus = self && self.al ? self : (self ? { x: self.x, y: self.y } : (map ? { x: map.W * map.TILE / 2, y: map.H * map.TILE / 2 } : null));
    if (self && lastMe) Object.assign(self, { en: lastMe.en, cl: lastMe.cl, rl: lastMe.rl, nc: lastMe.nc, bb: lastMe.bb, am: lastMe.am, rs: lastMe.rs });

    R.draw({
      map, config, myId, myTeam,
      players, projectiles: interp.projectiles, bombs: interp.bombs,
      points: latest ? latest.pts : [], pickups: latest ? latest.pk : [], score: latest ? latest.sc : [0, 0],
      tl: latest ? latest.tl : 0, gs: latest ? latest.gs : 'playing', win: latest ? latest.win : -1, ne: latest ? latest.ne : 0,
      me: self, focus, mouse: menuOpen ? null : mouse, mouseWorld: self && self.al && !menuOpen ? R.screenToWorld(mouse.x, mouse.y) : null,
      renderTime: rt, feed, killedBy, showScores, menuOpen, snapCam,
    }, dt);
    snapCam = false;
    requestAnimationFrame(frame);
  }

  connect();
  requestAnimationFrame(frame);
})();
