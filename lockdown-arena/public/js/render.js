// Canvas renderer: arena, knights, effects and HUD. All art is drawn procedurally.
(function () {
  'use strict';
  const { TEAMS, CLASSES, WEAPONS, ABILITY } = LD;
  const TAU = Math.PI * 2;
  const WALL_H = 18;

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    if (amt >= 0) { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
    else { r *= 1 + amt; g *= 1 + amt; b *= 1 + amt; }
    return `rgb(${r | 0},${g | 0},${b | 0})`;
  }
  function rgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  function rand(seed) { // deterministic per-tile noise
    const x = Math.sin(seed * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  }
  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }

  // ------------------------------------------------------------------ map prerender
  function prerenderMap(map) {
    const T = map.TILE;
    const cv = document.createElement('canvas');
    cv.width = map.W * T; cv.height = map.H * T;
    const c = cv.getContext('2d');
    const wall = (x, y) => LD.isWall(map, x, y);

    // floor
    for (let y = 0; y < map.H; y++) for (let x = 0; x < map.W; x++) {
      if (wall(x, y)) continue;
      const r = rand(x * 131 + y * 17);
      const base = (x + y) % 2 ? 58 : 54;
      const v = base + Math.floor(r * 6);
      c.fillStyle = `rgb(${v - 8},${v - 2},${v + 12})`;
      c.fillRect(x * T, y * T, T, T);
      c.fillStyle = 'rgba(255,255,255,0.035)';
      c.fillRect(x * T + 2, y * T + 2, T - 4, 2);
      c.fillStyle = 'rgba(0,0,0,0.18)';
      c.fillRect(x * T, y * T + T - 2, T, 2);
      c.fillRect(x * T + T - 2, y * T, 2, T);
      if (r > 0.9) { // floor vents
        c.fillStyle = 'rgba(0,0,0,0.25)';
        for (let i = 0; i < 4; i++) c.fillRect(x * T + 12, y * T + 14 + i * 6, T - 24, 3);
      } else if (r > 0.82) { // rivets
        c.fillStyle = 'rgba(255,255,255,0.08)';
        for (const [ox, oy] of [[8, 8], [T - 10, 8], [8, T - 10], [T - 10, T - 10]]) {
          c.beginPath(); c.arc(x * T + ox, y * T + oy, 2, 0, TAU); c.fill();
        }
      }
    }
    // spawn rooms tinted with team colour
    map.spawnRooms.forEach((r, i) => {
      c.fillStyle = rgba(TEAMS[i].color, 0.14);
      c.fillRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
      c.strokeStyle = rgba(TEAMS[i].color, 0.35);
      c.setLineDash([10, 8]); c.lineWidth = 3;
      c.strokeRect(r.x0 + 4, r.y0 + 4, r.x1 - r.x0 - 8, r.y1 - r.y0 - 8);
      c.setLineDash([]);
    });
    // wall shadows on the floor
    c.fillStyle = 'rgba(0,0,0,0.28)';
    for (let y = 0; y < map.H; y++) for (let x = 0; x < map.W; x++) {
      if (!wall(x, y)) continue;
      if (!wall(x, y + 1)) c.fillRect(x * T + 6, (y + 1) * T, T, 10);
      if (!wall(x + 1, y)) c.fillRect((x + 1) * T, y * T + 6, 8, T);
    }
    // walls: front face then raised top face, row by row so tops overlap correctly
    for (let y = 0; y < map.H; y++) for (let x = 0; x < map.W; x++) {
      if (!wall(x, y)) continue;
      const px = x * T, py = y * T;
      const r = rand(x * 7 + y * 311);
      if (!wall(x, y + 1)) {
        c.fillStyle = '#3d4559';
        c.fillRect(px, py + T - WALL_H, T, WALL_H);
        c.fillStyle = 'rgba(0,0,0,0.25)';
        c.fillRect(px, py + T - 3, T, 3);
        c.fillStyle = 'rgba(255,255,255,0.06)';
        c.fillRect(px + T / 2 - 1, py + T - WALL_H, 2, WALL_H);
      }
      const top = 112 + Math.floor(r * 10);
      c.fillStyle = `rgb(${top - 20},${top - 10},${top + 12})`;
      c.fillRect(px, py - WALL_H, T, T);
      c.fillStyle = 'rgba(255,255,255,0.12)';
      if (!wall(x, y - 1)) c.fillRect(px, py - WALL_H, T, 3);
      if (!wall(x - 1, y)) c.fillRect(px, py - WALL_H, 3, T);
      c.fillStyle = 'rgba(0,0,0,0.18)';
      if (!wall(x + 1, y)) c.fillRect(px + T - 3, py - WALL_H, 3, T);
      if (r > 0.75) { c.fillStyle = 'rgba(255,255,255,0.06)'; c.fillRect(px + 10, py - WALL_H + 10, T - 20, T - 20); }
    }
    return cv;
  }

  // ------------------------------------------------------------------ icons
  function drawWeaponIcon(c, id, x, y, s, color) {
    c.save();
    c.translate(x, y);
    c.scale(s / 32, s / 32);
    c.lineCap = 'round'; c.lineJoin = 'round';
    if (id === 0) {
      c.rotate(-Math.PI / 4);
      c.fillStyle = color || '#dfe6f2';
      c.beginPath(); c.moveTo(-3, -2); c.lineTo(3, -2); c.lineTo(3, -22); c.lineTo(0, -27); c.lineTo(-3, -22); c.closePath(); c.fill();
      c.fillStyle = '#c9a24a'; c.fillRect(-9, -2, 18, 4);
      c.fillStyle = '#6b4b2a'; c.fillRect(-2, 2, 4, 10);
    } else if (id === 1) {
      c.fillStyle = color || '#dfe6f2';
      roundRect(c, -14, -6, 26, 10, 3); c.fill();
      c.fillStyle = '#7a8499'; c.fillRect(8, -4, 8, 6);
      c.fillStyle = '#6b4b2a'; c.beginPath(); c.moveTo(-10, 2); c.lineTo(-4, 2); c.lineTo(-7, 13); c.lineTo(-13, 13); c.closePath(); c.fill();
      c.fillStyle = '#58e0ff'; c.fillRect(-6, -3, 8, 3);
    } else {
      c.fillStyle = '#2a2f3d';
      c.beginPath(); c.arc(0, 3, 11, 0, TAU); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.25)'; c.beginPath(); c.arc(-4, -1, 4, 0, TAU); c.fill();
      c.fillStyle = '#9aa3b8'; c.fillRect(-3, -11, 6, 5);
      c.strokeStyle = '#ffb347'; c.lineWidth = 2; c.beginPath(); c.moveTo(0, -11); c.quadraticCurveTo(5, -16, 8, -13); c.stroke();
    }
    c.restore();
  }

  // ------------------------------------------------------------------ knight
  // An original chunky armoured figure: round tunic body, pauldrons, dome helm with a visor bar
  // and a class-coloured crest. `o` = {x,y,aim,team,cls,wep,charge,swing,alpha,walk}
  function drawKnight(c, o, now) {
    const team = TEAMS[o.team];
    const cls = CLASSES[o.cls];
    const a = o.aim;
    const ca = Math.cos(a), sa = Math.sin(a);
    const bob = Math.sin(o.walk * 12) * (o.moving ? 1.6 : 0);
    c.save();
    c.globalAlpha = o.alpha;
    c.translate(o.x, o.y);

    // shadow
    c.fillStyle = 'rgba(0,0,0,0.35)';
    c.beginPath(); c.ellipse(0, 14, 18, 7, 0, 0, TAU); c.fill();

    // feet
    const step = Math.sin(o.walk * 12) * (o.moving ? 5 : 0);
    c.fillStyle = '#2b2f3a';
    c.beginPath(); c.ellipse(-sa * 7 + ca * step, 10 + ca * 7 * 0.3, 5, 4, 0, 0, TAU); c.fill();
    c.beginPath(); c.ellipse(sa * 7 - ca * step, 10 - ca * 7 * 0.3, 5, 4, 0, 0, TAU); c.fill();

    c.translate(0, bob - 4);

    // weapon behind body when aiming upward
    const drawWeapon = () => {
      c.save();
      let wa = a;
      const sw = o.swing;
      if (o.wep === 0 && sw) {
        const t = Math.min(1, sw.age / (sw.k === 3 ? 0.35 : 0.22));
        if (sw.k === 3) wa = sw.a + t * TAU;
        else {
          const dir = sw.k === 1 ? -1 : 1;
          wa = sw.a + dir * (-1 + 2 * t) * 1.1;
        }
      }
      c.rotate(wa);
      if (o.wep === 0) {
        c.translate(14, 6);
        c.fillStyle = '#c9a24a'; c.fillRect(-2, -6, 4, 12);
        c.fillStyle = '#e9eef7';
        c.beginPath(); c.moveTo(2, -3); c.lineTo(30, -2.5); c.lineTo(36, 0); c.lineTo(30, 2.5); c.lineTo(2, 3); c.closePath(); c.fill();
        c.fillStyle = 'rgba(0,0,0,0.15)'; c.fillRect(4, 0, 26, 2.5);
      } else if (o.wep === 1) {
        c.translate(12, 7);
        c.fillStyle = '#5a6378'; roundRect(c, 0, -5, 24, 10, 3); c.fill();
        c.fillStyle = '#8f9ab1'; c.fillRect(20, -3.5, 8, 7);
        c.fillStyle = '#58e0ff'; c.fillRect(5, -2, 10, 3);
      } else {
        c.translate(16, 8);
        c.fillStyle = '#262a35'; c.beginPath(); c.arc(0, 0, 8, 0, TAU); c.fill();
        c.fillStyle = 'rgba(255,255,255,0.3)'; c.beginPath(); c.arc(-3, -3, 3, 0, TAU); c.fill();
        c.fillStyle = (now * 8) % 1 > 0.5 ? '#ffd166' : '#ff7a3d';
        c.beginPath(); c.arc(3, -8, 2.2, 0, TAU); c.fill();
      }
      c.restore();
    };
    if (sa < -0.2) drawWeapon();

    // body
    c.fillStyle = team.dark;
    c.beginPath(); c.arc(0, 0, 17, 0, TAU); c.fill();
    c.fillStyle = team.color;
    c.beginPath(); c.arc(0, -1, 15, 0, TAU); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.18)';
    c.beginPath(); c.arc(-5, -6, 7, 0, TAU); c.fill();
    // belt
    c.fillStyle = '#3a2e22'; c.fillRect(-14, 4, 28, 4);
    c.fillStyle = '#d9b45a'; c.fillRect(-3, 3.5, 6, 5);
    // pauldrons (perpendicular to aim)
    for (const s of [-1, 1]) {
      const px = -sa * 14 * s, py = ca * 14 * s * 0.6 - 3;
      c.fillStyle = '#8d97ab';
      c.beginPath(); c.arc(px, py, 7, 0, TAU); c.fill();
      c.fillStyle = '#c3cbda';
      c.beginPath(); c.arc(px - 1.5, py - 1.5, 4, 0, TAU); c.fill();
    }

    // helm
    const hy = -16;
    c.fillStyle = '#6f798d';
    c.beginPath(); c.arc(0, hy, 13, 0, TAU); c.fill();
    c.fillStyle = '#c8d0de';
    c.beginPath(); c.arc(0, hy - 1, 12, 0, TAU); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.45)';
    c.beginPath(); c.arc(-4, hy - 5, 4, 0, TAU); c.fill();
    // crest along the aim axis
    c.strokeStyle = cls.color; c.lineWidth = 4; c.lineCap = 'round';
    c.beginPath(); c.moveTo(-ca * 9, hy - 1 - sa * 9 * 0.6 - 3); c.lineTo(ca * 4, hy - 1 + sa * 4 * 0.6 - 9); c.stroke();
    // visor: a glowing bar on the side of the helm facing the aim
    if (sa > -0.75) {
      const vx = ca * 7, vy = hy + 1 + Math.max(0, sa) * 4;
      c.save();
      c.translate(vx, vy);
      c.scale(1, 0.55);
      c.fillStyle = '#1b1f2a';
      c.beginPath(); c.ellipse(0, 0, 9 - Math.abs(ca) * 3, 5, 0, 0, TAU); c.fill();
      c.fillStyle = cls.color;
      c.globalAlpha *= 0.9;
      c.fillRect(-6 + Math.abs(ca) * 2, -1.2, 12 - Math.abs(ca) * 4, 2.4);
      c.restore();
    }

    if (sa >= -0.2) drawWeapon();

    // charge glow
    if (o.charge > 0) {
      const full = o.charge >= 1;
      c.strokeStyle = full ? '#fff6c2' : rgba('#ffd166', 0.4 + o.charge * 0.4);
      c.lineWidth = full ? 3 : 2;
      c.beginPath(); c.arc(0, -6, 26, -Math.PI / 2, -Math.PI / 2 + TAU * o.charge); c.stroke();
      if (full && (now * 10) % 1 > 0.5) {
        c.fillStyle = '#fff6c2';
        c.beginPath(); c.arc(Math.cos(now * 9) * 24, -6 + Math.sin(now * 9) * 24, 3, 0, TAU); c.fill();
      }
    }
    c.restore();
  }

  // ------------------------------------------------------------------ renderer
  class Renderer {
    constructor(canvas) {
      this.cv = canvas;
      this.c = canvas.getContext('2d');
      this.mapCanvas = null;
      this.particles = [];
      this.texts = [];
      this.rings = [];
      this.slashes = [];
      this.cam = { x: 0, y: 0, scale: 1 };
      this.shake = 0;
      this.hurtFlash = 0;
      this.walk = new Map();
    }

    setMap(map) { this.map = map; this.mapCanvas = prerenderMap(map); }

    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.cv.width = Math.floor(window.innerWidth * dpr);
      this.cv.height = Math.floor(window.innerHeight * dpr);
      this.dpr = dpr;
    }

    // world units visible vertically ≈ 820 regardless of window size
    viewScale() {
      const h = this.cv.height / this.dpr, w = this.cv.width / this.dpr;
      return Math.max(0.45, Math.min(h / 820, w / 1100)) * this.dpr;
    }

    worldToScreen(x, y) {
      return { x: (x - this.cam.x) * this.cam.scale + this.cv.width / 2, y: (y - this.cam.y) * this.cam.scale + this.cv.height / 2 };
    }
    screenToWorld(sx, sy) {
      return { x: (sx * this.dpr - this.cv.width / 2) / this.cam.scale + this.cam.x, y: (sy * this.dpr - this.cv.height / 2) / this.cam.scale + this.cam.y };
    }

    // --------------------------------------------------------------- effects
    burst(x, y, color, n, speed, life, size) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU, s = speed * (0.3 + Math.random() * 0.7);
        this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: life * (0.6 + Math.random() * 0.4), max: life, color, size: size * (0.6 + Math.random() * 0.6) });
      }
    }
    ring(x, y, r0, r1, life, color, width) { this.rings.push({ x, y, r0, r1, life, max: life, color, width: width || 4 }); }
    text(x, y, s, color, big) { this.texts.push({ x, y, s, color, life: 0.9, max: 0.9, big }); }

    stepEffects(dt) {
      for (const p of this.particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.92; p.vy *= 0.92; p.life -= dt; }
      this.particles = this.particles.filter((p) => p.life > 0);
      for (const r of this.rings) r.life -= dt;
      this.rings = this.rings.filter((r) => r.life > 0);
      for (const t of this.texts) { t.life -= dt; t.y -= 40 * dt; }
      this.texts = this.texts.filter((t) => t.life > 0);
      this.shake = Math.max(0, this.shake - dt * 30);
      this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2);
    }

    // --------------------------------------------------------------- frame
    draw(s, dt) {
      const c = this.c, cv = this.cv;
      const now = performance.now() / 1000;
      this.stepEffects(dt);
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.fillStyle = '#0c0e13';
      c.fillRect(0, 0, cv.width, cv.height);
      if (!this.map) return;

      // camera
      this.cam.scale = this.viewScale();
      if (s.focus) {
        const look = 0.18;
        const tx = s.focus.x + (s.mouseWorld ? (s.mouseWorld.x - s.focus.x) * look : 0);
        const ty = s.focus.y + (s.mouseWorld ? (s.mouseWorld.y - s.focus.y) * look : 0);
        const k = 1 - Math.pow(0.0001, dt);
        this.cam.x += (tx - this.cam.x) * k;
        this.cam.y += (ty - this.cam.y) * k;
        if (s.snapCam) { this.cam.x = tx; this.cam.y = ty; }
      }
      const sk = this.shake;
      const sx = (Math.random() - 0.5) * sk, sy = (Math.random() - 0.5) * sk;
      c.setTransform(this.cam.scale, 0, 0, this.cam.scale,
        cv.width / 2 - (this.cam.x + sx) * this.cam.scale, cv.height / 2 - (this.cam.y + sy) * this.cam.scale);

      c.drawImage(this.mapCanvas, 0, 0);
      this.drawPoints(c, s, now);
      this.drawPickups(c, s, now);
      this.drawBombs(c, s, now);

      // knights sorted by y for overlap
      const list = s.players.filter((p) => p.al).sort((a, b) => a.y - b.y);
      for (const p of list) this.drawBubble(c, p, now);
      for (const p of list) this.drawPlayer(c, p, s, now, dt);
      this.drawProjectiles(c, s);
      this.drawSlashes(c, s, now);
      this.drawFx(c);
      for (const p of list) this.drawTag(c, p, s);

      c.setTransform(1, 0, 0, 1, 0, 0);
      this.drawHud(c, s, now);
    }

    drawPoints(c, s, now) {
      const R = s.config.captureRadius;
      s.map.points.forEach((pt, i) => {
        const st = s.points[i] || [-1, 0, 0, -1];
        const [owner, prog, contested] = st;
        const col = owner === -1 ? '#c9cfdb' : TEAMS[owner].color;
        c.save();
        c.translate(pt.x, pt.y);
        c.fillStyle = owner === -1 ? 'rgba(200,207,219,0.08)' : rgba(TEAMS[owner].color, 0.13);
        c.beginPath(); c.arc(0, 0, R, 0, TAU); c.fill();
        c.strokeStyle = owner === -1 ? 'rgba(200,207,219,0.35)' : rgba(TEAMS[owner].color, 0.6);
        c.lineWidth = 3; c.setLineDash([14, 10]); c.lineDashOffset = -now * 20;
        c.beginPath(); c.arc(0, 0, R, 0, TAU); c.stroke();
        c.setLineDash([]);
        // pedestal
        c.fillStyle = '#2a2f3b'; c.beginPath(); c.arc(0, 0, 34, 0, TAU); c.fill();
        c.fillStyle = '#454d60'; c.beginPath(); c.arc(0, -2, 30, 0, TAU); c.fill();
        // progress ring
        if (prog !== 0) {
          const t = prog < 0 ? 0 : 1;
          c.strokeStyle = TEAMS[t].color; c.lineWidth = 7;
          c.beginPath(); c.arc(0, -2, 30, -Math.PI / 2, -Math.PI / 2 + TAU * Math.abs(prog) / 100, prog < 0); c.stroke();
        }
        // core crystal
        const pulse = 0.85 + Math.sin(now * 3 + i) * 0.15;
        c.fillStyle = col;
        c.shadowColor = col; c.shadowBlur = 20 * pulse;
        c.beginPath(); c.moveTo(0, -24); c.lineTo(13, -6); c.lineTo(0, 10); c.lineTo(-13, -6); c.closePath(); c.fill();
        c.shadowBlur = 0;
        c.fillStyle = 'rgba(255,255,255,0.4)';
        c.beginPath(); c.moveTo(0, -24); c.lineTo(5, -8); c.lineTo(0, 4); c.lineTo(-5, -8); c.closePath(); c.fill();
        c.fillStyle = '#fff'; c.font = 'bold 22px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.strokeStyle = 'rgba(0,0,0,0.6)'; c.lineWidth = 4;
        c.strokeText(pt.id, 0, -44); c.fillText(pt.id, 0, -44);
        if (contested && (now * 4) % 1 > 0.5) {
          c.strokeStyle = '#ffd166'; c.lineWidth = 4;
          c.beginPath(); c.arc(0, 0, R - 6, 0, TAU); c.stroke();
        }
        c.restore();
      });
    }

    drawPickups(c, s, now) {
      s.map.pickups.forEach((pk, i) => {
        c.save(); c.translate(pk.x, pk.y);
        c.fillStyle = 'rgba(0,0,0,0.3)'; c.beginPath(); c.ellipse(0, 12, 12, 5, 0, 0, TAU); c.fill();
        c.fillStyle = '#3a4152'; c.beginPath(); c.arc(0, 4, 14, 0, TAU); c.fill();
        if (s.pickups[i]) {
          const b = Math.sin(now * 4 + i) * 3 - 8;
          c.translate(0, b);
          c.fillStyle = '#ff5d73'; c.shadowColor = '#ff5d73'; c.shadowBlur = 14;
          c.beginPath();
          c.moveTo(0, 8); c.bezierCurveTo(-14, -2, -8, -14, 0, -6); c.bezierCurveTo(8, -14, 14, -2, 0, 8); c.fill();
          c.shadowBlur = 0;
          c.fillStyle = 'rgba(255,255,255,0.5)'; c.beginPath(); c.arc(-4, -5, 2.5, 0, TAU); c.fill();
        }
        c.restore();
      });
    }

    drawBombs(c, s, now) {
      const R = WEAPONS[2].radius;
      for (const b of s.bombs) {
        const [, x, y, team, left] = b;
        const t = Math.max(0, Math.min(1, left / WEAPONS[2].fuse));
        c.save(); c.translate(x, y);
        c.fillStyle = rgba(TEAMS[team].color, 0.08 + (1 - t) * 0.12);
        c.beginPath(); c.arc(0, 0, R, 0, TAU); c.fill();
        c.strokeStyle = rgba(TEAMS[team].color, 0.5); c.lineWidth = 2;
        c.beginPath(); c.arc(0, 0, R * (1 - t), 0, TAU); c.stroke();
        const s2 = 1 + Math.sin(now * (10 + (1 - t) * 30)) * 0.08;
        c.scale(s2, s2);
        c.fillStyle = 'rgba(0,0,0,0.35)'; c.beginPath(); c.ellipse(0, 10, 13, 5, 0, 0, TAU); c.fill();
        c.fillStyle = '#23262f'; c.beginPath(); c.arc(0, 0, 13, 0, TAU); c.fill();
        c.fillStyle = TEAMS[team].color; c.fillRect(-13, -2, 26, 4);
        c.fillStyle = 'rgba(255,255,255,0.3)'; c.beginPath(); c.arc(-4, -5, 4, 0, TAU); c.fill();
        c.fillStyle = (now * (6 + (1 - t) * 20)) % 1 > 0.5 ? '#fff3b0' : '#ff7a3d';
        c.beginPath(); c.arc(0, -15, 3.5, 0, TAU); c.fill();
        c.restore();
      }
    }

    drawBubble(c, p, now) {
      if (!p.bu) return;
      const R = ABILITY.bubbleRadius;
      const col = CLASSES.guardian.color;
      c.save(); c.translate(p.x, p.y);
      const g = c.createRadialGradient(0, 0, R * 0.5, 0, 0, R);
      g.addColorStop(0, rgba(col, 0.03)); g.addColorStop(0.85, rgba(col, 0.14)); g.addColorStop(1, rgba(col, 0.32));
      c.fillStyle = g;
      c.beginPath(); c.arc(0, 0, R, 0, TAU); c.fill();
      c.strokeStyle = rgba(TEAMS[p.t].light, 0.8); c.lineWidth = 2.5;
      c.beginPath(); c.arc(0, 0, R, 0, TAU); c.stroke();
      c.strokeStyle = rgba('#ffffff', 0.35); c.lineWidth = 2;
      c.beginPath(); c.arc(0, 0, R - 5, now * 1.5, now * 1.5 + 0.8); c.stroke();
      c.beginPath(); c.arc(0, 0, R - 5, now * 1.5 + Math.PI, now * 1.5 + Math.PI + 0.8); c.stroke();
      c.restore();
    }

    drawPlayer(c, p, s, now, dt) {
      let w = this.walk.get(p.i);
      if (!w) { w = { x: p.x, y: p.y, t: 0, moving: false }; this.walk.set(p.i, w); }
      const moved = Math.hypot(p.x - w.x, p.y - w.y);
      w.moving = moved > 0.3;
      if (w.moving) w.t += dt;
      w.x = p.x; w.y = p.y;
      let alpha = 1;
      if (p.ck) alpha = p.t === s.myTeam ? 0.38 + Math.sin(now * 6) * 0.08 : 0.22;
      if (p.pr) alpha *= (now * 8) % 1 > 0.5 ? 0.55 : 1;
      if (p.da) {
        this.particles.push({ x: p.x, y: p.y - 6, vx: 0, vy: 0, life: 0.18, max: 0.18, color: rgba(CLASSES[p.c].color, 0.6), size: 16 });
      }
      let swing = null;
      if (p.sw) swing = { k: p.sw[0], a: p.sw[1], age: p.sw[2] / 1000 + (s.renderTime - p.swAt) };
      drawKnight(c, { x: p.x, y: p.y, aim: p.a, team: p.t, cls: p.c, wep: p.w, charge: p.ch, swing, alpha, walk: w.t, moving: w.moving }, now);
      if (p.i === s.myId) {
        // ring under self
        c.strokeStyle = rgba('#ffffff', 0.5); c.lineWidth = 2;
        c.beginPath(); c.ellipse(p.x, p.y + 12, 22, 9, 0, 0, TAU); c.stroke();
      }
    }

    drawTag(c, p, s) {
      if (p.ck && p.t !== s.myTeam) return;
      const y = p.y - 52;
      c.textAlign = 'center'; c.textBaseline = 'alphabetic';
      if (p.i !== s.myId) {
        c.font = 'bold 13px system-ui, sans-serif';
        c.lineWidth = 3; c.strokeStyle = 'rgba(0,0,0,0.7)';
        c.strokeText(p.n, p.x, y - 6);
        c.fillStyle = TEAMS[p.t].light;
        c.fillText(p.n, p.x, y - 6);
      }
      const bw = 40, f = Math.max(0, p.hp / p.mh);
      c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(p.x - bw / 2 - 1, y - 1, bw + 2, 7);
      c.fillStyle = f > 0.5 ? '#5ee07a' : f > 0.25 ? '#ffd166' : '#ff5d5d';
      if (p.t !== s.myTeam) c.fillStyle = f > 0.25 ? '#ff7272' : '#ff3d3d';
      c.fillRect(p.x - bw / 2, y, bw * f, 5);
    }

    drawProjectiles(c, s) {
      for (const pr of s.projectiles) {
        const [, x, y, vx, vy, team, big] = pr;
        const l = Math.hypot(vx, vy) || 1;
        const col = TEAMS[team].light;
        const r = big ? 10 : 5;
        c.strokeStyle = rgba(TEAMS[team].color, 0.5); c.lineWidth = r * 1.4; c.lineCap = 'round';
        c.beginPath(); c.moveTo(x - vx / l * r * 3.5, y - vy / l * r * 3.5); c.lineTo(x, y); c.stroke();
        c.fillStyle = '#fff'; c.shadowColor = col; c.shadowBlur = 16;
        c.beginPath(); c.arc(x, y, r * 0.75, 0, TAU); c.fill();
        c.shadowBlur = 0;
      }
    }

    drawSlashes(c, s) {
      for (const p of s.players) {
        if (!p.al || !p.sw || (p.ck && p.t !== s.myTeam)) continue;
        const k = p.sw[0], a0 = p.sw[1];
        const age = p.sw[2] / 1000 + (s.renderTime - p.swAt);
        const dur = k === 3 ? 0.35 : 0.22;
        if (age < 0 || age > dur) continue;
        const t = age / dur;
        const w = WEAPONS[0];
        const range = k === 3 ? w.chargeRange : w.range;
        c.save(); c.translate(p.x, p.y - 4);
        c.globalAlpha = 1 - t;
        c.strokeStyle = k === 3 ? '#fff6c2' : '#ffffff';
        c.lineWidth = k === 3 ? 10 : 7; c.lineCap = 'round';
        c.beginPath();
        if (k === 3) c.arc(0, 0, range - 8, a0 + t * TAU - 2.2, a0 + t * TAU);
        else {
          const dir = k === 1 ? -1 : 1;
          const start = a0 - dir * w.arc / 2, end = a0 - dir * w.arc / 2 + dir * w.arc * Math.min(1, t * 1.6);
          c.arc(0, 0, range - 10, Math.min(start, end), Math.max(start, end));
        }
        c.stroke();
        c.strokeStyle = rgba(TEAMS[p.t].light, 0.6); c.lineWidth = 3;
        c.stroke();
        c.restore();
      }
    }

    drawFx(c) {
      for (const r of this.rings) {
        const t = 1 - r.life / r.max;
        c.strokeStyle = r.color; c.globalAlpha = 1 - t; c.lineWidth = r.width;
        c.beginPath(); c.arc(r.x, r.y, r.r0 + (r.r1 - r.r0) * t, 0, TAU); c.stroke();
      }
      c.globalAlpha = 1;
      for (const p of this.particles) {
        c.globalAlpha = Math.max(0, p.life / p.max);
        c.fillStyle = p.color;
        c.beginPath(); c.arc(p.x, p.y, p.size * (0.4 + 0.6 * p.life / p.max), 0, TAU); c.fill();
      }
      c.globalAlpha = 1;
      c.textAlign = 'center';
      for (const t of this.texts) {
        c.globalAlpha = Math.min(1, t.life / t.max * 2);
        c.font = `900 ${t.big ? 22 : 16}px system-ui, sans-serif`;
        c.lineWidth = 4; c.strokeStyle = 'rgba(0,0,0,0.7)';
        c.strokeText(t.s, t.x, t.y); c.fillStyle = t.color; c.fillText(t.s, t.x, t.y);
      }
      c.globalAlpha = 1;
    }

    // --------------------------------------------------------------- HUD
    drawHud(c, s, now) {
      const cv = this.cv, d = this.dpr;
      const W = cv.width / d, H = cv.height / d;
      c.save();
      c.scale(d, d);
      const me = s.me;

      if (this.hurtFlash > 0) {
        const g = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.7);
        g.addColorStop(0, 'rgba(255,0,0,0)'); g.addColorStop(1, `rgba(200,0,0,${this.hurtFlash * 0.5})`);
        c.fillStyle = g; c.fillRect(0, 0, W, H);
      }

      this.drawOffscreenPoints(c, s, W, H);
      this.drawScorebar(c, s, W, now);
      this.drawFeed(c, s, W);
      if (me) this.drawSelf(c, s, me, W, H, now);
      this.drawMinimap(c, s, W, H);

      if (s.gs === 'ended') this.drawEnd(c, s, W, H);
      else if (s.showScores) this.drawScoreboard(c, s, W, H);

      // crosshair
      if (s.mouse && !s.menuOpen) {
        const { x, y } = s.mouse;
        c.strokeStyle = '#fff'; c.lineWidth = 2;
        c.beginPath(); c.arc(x, y, 9, 0, TAU); c.stroke();
        c.beginPath();
        c.moveTo(x - 15, y); c.lineTo(x - 5, y); c.moveTo(x + 5, y); c.lineTo(x + 15, y);
        c.moveTo(x, y - 15); c.lineTo(x, y - 5); c.moveTo(x, y + 5); c.lineTo(x, y + 15);
        c.stroke();
        if (me && me.ch > 0) {
          c.strokeStyle = me.ch >= 1 ? '#fff6c2' : '#ffd166'; c.lineWidth = 3;
          c.beginPath(); c.arc(x, y, 14, -Math.PI / 2, -Math.PI / 2 + TAU * me.ch); c.stroke();
        }
      }
      c.restore();
    }

    drawScorebar(c, s, W, now) {
      const cfg = s.config;
      const bw = Math.min(260, W * 0.28), cx = W / 2, y = 14;
      // timer
      const tl = s.tl || 0;
      const mm = Math.floor(tl / 60), ss = String(tl % 60).padStart(2, '0');
      c.fillStyle = 'rgba(12,14,19,0.85)';
      roundRect(c, cx - 48, y, 96, 34, 8); c.fill();
      c.fillStyle = tl <= 30 ? '#ff7272' : '#fff';
      c.font = '800 20px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(`${mm}:${ss}`, cx, y + 17);
      // team bars
      for (let t = 0; t < 2; t++) {
        const dir = t === 0 ? -1 : 1;
        const x0 = t === 0 ? cx - 56 - bw : cx + 56;
        c.fillStyle = 'rgba(12,14,19,0.85)';
        roundRect(c, x0, y, bw, 34, 8); c.fill();
        const f = Math.min(1, s.score[t] / cfg.scoreToWin);
        c.fillStyle = TEAMS[t].color;
        if (dir < 0) roundRect(c, x0 + bw - (bw - 6) * f - 3, y + 3, (bw - 6) * f, 28, 6);
        else roundRect(c, x0 + 3, y + 3, (bw - 6) * f, 28, 6);
        if (f > 0.02) c.fill();
        c.fillStyle = '#fff'; c.font = '900 18px system-ui, sans-serif';
        c.textAlign = dir < 0 ? 'left' : 'right';
        c.fillText(String(s.score[t]), dir < 0 ? x0 + 10 : x0 + bw - 10, y + 17);
        c.font = '600 12px system-ui, sans-serif';
        c.textAlign = dir < 0 ? 'right' : 'left';
        c.fillStyle = 'rgba(255,255,255,0.85)';
        c.fillText(TEAMS[t].name.toUpperCase() + (t === s.myTeam ? ' (YOU)' : ''), dir < 0 ? x0 + bw - 10 : x0 + 10, y + 17);
      }
      // control point icons
      s.map.points.forEach((pt, i) => {
        const [owner, prog, contested, capturing] = s.points[i] || [-1, 0, 0, -1];
        const x = cx + (i - 1) * 46, yy = y + 62;
        c.fillStyle = 'rgba(12,14,19,0.85)';
        c.beginPath(); c.arc(x, yy, 19, 0, TAU); c.fill();
        c.fillStyle = owner === -1 ? '#4a5163' : TEAMS[owner].color;
        c.beginPath(); c.arc(x, yy, 14, 0, TAU); c.fill();
        if (prog) {
          c.strokeStyle = TEAMS[prog < 0 ? 0 : 1].light; c.lineWidth = 4;
          c.beginPath(); c.arc(x, yy, 17, -Math.PI / 2, -Math.PI / 2 + TAU * Math.abs(prog) / 100, prog < 0); c.stroke();
        }
        if ((contested || capturing !== -1) && (now * 4) % 1 > 0.5) {
          c.strokeStyle = contested ? '#ffd166' : '#fff'; c.lineWidth = 2;
          c.beginPath(); c.arc(x, yy, 21, 0, TAU); c.stroke();
        }
        c.fillStyle = '#fff'; c.font = '900 15px system-ui, sans-serif'; c.textAlign = 'center';
        c.fillText(pt.id, x, yy + 1);
      });
      c.textBaseline = 'alphabetic';
    }

    drawFeed(c, s, W) {
      let y = 22;
      c.font = '600 13px system-ui, sans-serif'; c.textBaseline = 'middle';
      const now = performance.now() / 1000;
      for (const f of s.feed) {
        const age = now - f.at;
        if (age > 7) continue;
        c.globalAlpha = Math.min(1, (7 - age) * 2);
        const parts = f.parts;
        let w = 16;
        for (const p of parts) w += p.icon != null ? 26 : c.measureText(p.s).width + 6;
        const x0 = W - w - 12;
        c.fillStyle = f.mine ? 'rgba(255,209,102,0.25)' : 'rgba(12,14,19,0.75)';
        roundRect(c, x0, y - 12, w, 24, 6); c.fill();
        let x = x0 + 8;
        for (const p of parts) {
          if (p.icon != null) { drawWeaponIcon(c, p.icon, x + 10, y, 18); x += 26; }
          else { c.fillStyle = p.c || '#fff'; c.textAlign = 'left'; c.fillText(p.s, x, y); x += c.measureText(p.s).width + 6; }
        }
        y += 28;
      }
      c.globalAlpha = 1;
      c.textBaseline = 'alphabetic';
    }

    drawSelf(c, s, me, W, H, now) {
      const cls = CLASSES[me.c];
      // status panel
      const x = 16, y = H - 92;
      c.fillStyle = 'rgba(12,14,19,0.85)';
      roundRect(c, x, y, 250, 76, 10); c.fill();
      c.fillStyle = cls.color; c.font = '800 14px system-ui, sans-serif'; c.textAlign = 'left';
      c.fillText(cls.name.toUpperCase(), x + 12, y + 20);
      if (me.nc && me.nc !== me.c) {
        c.fillStyle = '#9aa3b8'; c.font = '600 11px system-ui, sans-serif';
        c.fillText('→ ' + CLASSES[me.nc].name + ' next life', x + 100, y + 20);
      }
      // hp
      const hf = Math.max(0, me.hp / me.mh);
      c.fillStyle = '#2a2f3b'; roundRect(c, x + 12, y + 28, 226, 16, 5); c.fill();
      c.fillStyle = hf > 0.5 ? '#5ee07a' : hf > 0.25 ? '#ffd166' : '#ff5d5d';
      if (hf > 0) { roundRect(c, x + 12, y + 28, 226 * hf, 16, 5); c.fill(); }
      c.fillStyle = '#fff'; c.font = '700 11px system-ui, sans-serif';
      c.fillText(`${me.hp} / ${me.mh}`, x + 18, y + 40);
      // energy
      const ef = Math.max(0, (me.en || 0) / cls.energyMax);
      c.fillStyle = '#2a2f3b'; roundRect(c, x + 12, y + 50, 226, 14, 5); c.fill();
      c.fillStyle = me.bb ? '#a04848' : cls.color;
      if (ef > 0) { roundRect(c, x + 12, y + 50, 226 * ef, 14, 5); c.fill(); }
      c.fillStyle = '#10131a'; c.font = '800 10px system-ui, sans-serif';
      let label = cls.abilityName.toUpperCase() + ' [RMB / SPACE]';
      if (me.bb) label = 'SHIELD BROKEN: RECHARGING';
      if (me.ck) label = 'CLOAKED' + (me.am ? ': AMBUSH READY' : '');
      c.fillStyle = ef > 0.45 ? '#10131a' : '#fff';
      c.fillText(label, x + 18, y + 61);
      if (me.c === 'striker') { // dash pips
        for (let i = 1; i < 3; i++) {
          const px = x + 12 + 226 * (ABILITY.dashCost * i / cls.energyMax);
          c.fillStyle = 'rgba(0,0,0,0.5)'; c.fillRect(px, y + 50, 2, 14);
        }
      }

      // weapons
      const sw = 64, gap = 10, total = sw * 3 + gap * 2;
      const wx = W / 2 - total / 2, wy = H - sw - 18;
      for (let i = 0; i < 3; i++) {
        const bx = wx + i * (sw + gap);
        const sel = me.w === i;
        c.fillStyle = sel ? 'rgba(255,209,102,0.18)' : 'rgba(12,14,19,0.85)';
        roundRect(c, bx, wy, sw, sw, 10); c.fill();
        c.strokeStyle = sel ? '#ffd166' : 'rgba(255,255,255,0.12)'; c.lineWidth = sel ? 2.5 : 1;
        roundRect(c, bx, wy, sw, sw, 10); c.stroke();
        drawWeaponIcon(c, i, bx + sw / 2, wy + sw / 2 - 2, 36);
        c.fillStyle = '#9aa3b8'; c.font = '700 11px system-ui, sans-serif'; c.textAlign = 'left';
        c.fillText(String(i + 1), bx + 6, wy + 14);
        if (i === 1) {
          if (me.rl) {
            c.fillStyle = '#ffd166'; c.font = '800 10px system-ui, sans-serif'; c.textAlign = 'center';
            c.fillText('RELOAD', bx + sw / 2, wy + sw - 6);
          } else {
            for (let k = 0; k < WEAPONS[1].clip; k++) {
              c.fillStyle = k < me.cl ? '#58e0ff' : '#2a2f3b';
              c.fillRect(bx + sw / 2 - 20 + k * 10.5, wy + sw - 10, 8, 5);
            }
          }
        }
        if (sel) {
          c.fillStyle = '#fff'; c.font = '700 11px system-ui, sans-serif'; c.textAlign = 'center';
          c.fillText(WEAPONS[i].name, bx + sw / 2, wy - 8);
        }
      }

      // capture progress when standing on a point
      const R = s.config.captureRadius;
      s.map.points.forEach((pt, i) => {
        if (!me.al || Math.hypot(me.x - pt.x, me.y - pt.y) > R) return;
        const [owner, prog, contested] = s.points[i] || [-1, 0, 0, -1];
        const bw2 = 300, bx = W / 2 - bw2 / 2, by = H - 150;
        c.fillStyle = 'rgba(12,14,19,0.85)'; roundRect(c, bx, by, bw2, 26, 8); c.fill();
        const f = (prog + 100) / 200; // 0 = crimson, 1 = azure
        c.fillStyle = TEAMS[0].color; c.fillRect(bx + 4, by + 4, (bw2 - 8) * (1 - f), 18);
        c.fillStyle = TEAMS[1].color; c.fillRect(bx + 4 + (bw2 - 8) * (1 - f), by + 4, (bw2 - 8) * f, 18);
        c.fillStyle = '#fff'; c.fillRect(bx + bw2 / 2 - 1, by + 2, 2, 22);
        let msg = `POINT ${pt.id}`;
        if (contested) msg += ': CONTESTED';
        else if (owner === me.t && Math.abs(prog) >= 99) msg += ': SECURED';
        else msg += ': CAPTURING';
        c.font = '800 12px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.lineWidth = 3; c.strokeStyle = 'rgba(0,0,0,0.7)';
        c.strokeText(msg, W / 2, by + 13); c.fillStyle = '#fff'; c.fillText(msg, W / 2, by + 13);
        c.textBaseline = 'alphabetic';
      });

      // death screen
      if (!me.al && s.gs === 'playing') {
        c.fillStyle = 'rgba(0,0,0,0.45)'; c.fillRect(0, H / 2 - 70, W, 120);
        c.textAlign = 'center';
        c.fillStyle = '#ff7272'; c.font = '900 30px system-ui, sans-serif';
        c.fillText('DEFEATED', W / 2, H / 2 - 30);
        c.fillStyle = '#fff'; c.font = '600 16px system-ui, sans-serif';
        c.fillText((s.killedBy ? `by ${s.killedBy}. ` : '') + `Respawning in ${me.rs || 0}…`, W / 2, H / 2);
        c.fillStyle = '#9aa3b8'; c.font = '500 13px system-ui, sans-serif';
        c.fillText('Press C to change class', W / 2, H / 2 + 26);
      } else if (me.pr && s.gs === 'playing') {
        c.textAlign = 'center'; c.fillStyle = 'rgba(255,255,255,0.7)'; c.font = '700 13px system-ui, sans-serif';
        c.fillText('SPAWN PROTECTION', W / 2, H - 170);
      }
    }

    drawOffscreenPoints(c, s, W, H) {
      if (!s.focus) return;
      const d = this.dpr;
      s.map.points.forEach((pt, i) => {
        const p = this.worldToScreen(pt.x, pt.y);
        const x = p.x / d, y = p.y / d;
        const m = 40;
        if (x > m && x < W - m && y > m + 70 && y < H - m) return;
        const cx = W / 2, cy = H / 2;
        const ang = Math.atan2(y - cy, x - cx);
        const ex = Math.max(m, Math.min(W - m, cx + Math.cos(ang) * W));
        const ey = Math.max(m + 90, Math.min(H - m - 90, cy + Math.sin(ang) * H));
        const [owner] = s.points[i] || [-1];
        c.save(); c.translate(ex, ey);
        c.fillStyle = owner === -1 ? 'rgba(200,207,219,0.85)' : TEAMS[owner].color;
        c.rotate(ang);
        c.beginPath(); c.moveTo(18, 0); c.lineTo(4, -9); c.lineTo(4, 9); c.closePath(); c.fill();
        c.rotate(-ang);
        c.beginPath(); c.arc(0, 0, 12, 0, TAU); c.fill();
        c.fillStyle = '#10131a'; c.font = '900 13px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText(pt.id, 0, 1);
        c.restore();
      });
      c.textBaseline = 'alphabetic';
    }

    drawMinimap(c, s, W, H) {
      const map = s.map;
      const mw = Math.min(228, W * 0.24), sc = mw / (map.W * map.TILE), mh = map.H * map.TILE * sc;
      const x0 = W - mw - 14, y0 = H - mh - 14;
      if (!this.miniCanvas || this.miniW !== mw) {
        this.miniW = mw;
        const cv = document.createElement('canvas');
        cv.width = Math.ceil(mw * 2); cv.height = Math.ceil(mh * 2);
        const mc = cv.getContext('2d');
        mc.fillStyle = 'rgba(30,34,44,0.9)'; mc.fillRect(0, 0, cv.width, cv.height);
        const ts = cv.width / map.W;
        mc.fillStyle = '#7d879c';
        for (let y = 0; y < map.H; y++) for (let x = 0; x < map.W; x++) if (LD.isWall(map, x, y)) mc.fillRect(x * ts, y * ts, ts + 0.5, ts + 0.5);
        map.spawnRooms.forEach((r, i) => { mc.fillStyle = rgba(TEAMS[i].color, 0.3); mc.fillRect(r.x0 / map.TILE * ts, r.y0 / map.TILE * ts, (r.x1 - r.x0) / map.TILE * ts, (r.y1 - r.y0) / map.TILE * ts); });
        this.miniCanvas = cv;
      }
      c.globalAlpha = 0.92;
      c.drawImage(this.miniCanvas, x0, y0, mw, mh);
      c.globalAlpha = 1;
      c.strokeStyle = 'rgba(255,255,255,0.2)'; c.lineWidth = 1; c.strokeRect(x0, y0, mw, mh);
      map.points.forEach((pt, i) => {
        const [owner] = s.points[i] || [-1];
        c.fillStyle = owner === -1 ? '#c9cfdb' : TEAMS[owner].color;
        c.beginPath(); c.arc(x0 + pt.x * sc, y0 + pt.y * sc, 6, 0, TAU); c.fill();
        c.fillStyle = '#10131a'; c.font = '900 8px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText(pt.id, x0 + pt.x * sc, y0 + pt.y * sc + 0.5);
      });
      for (const p of s.players) {
        if (!p.al || (p.ck && p.t !== s.myTeam)) continue;
        c.fillStyle = p.i === s.myId ? '#fff' : TEAMS[p.t].light;
        c.beginPath(); c.arc(x0 + p.x * sc, y0 + p.y * sc, p.i === s.myId ? 3.5 : 2.5, 0, TAU); c.fill();
      }
      // view rectangle
      const vw = this.cv.width / this.cam.scale * sc, vh = this.cv.height / this.cam.scale * sc;
      c.strokeStyle = 'rgba(255,255,255,0.35)';
      c.strokeRect(x0 + this.cam.x * sc - vw / 2, y0 + this.cam.y * sc - vh / 2, vw, vh);
      c.textBaseline = 'alphabetic';
    }

    drawScoreboard(c, s, W, H, title) {
      const rows = [0, 1].map((t) => s.players.filter((p) => p.t === t).sort((a, b) => (b.cp * 3 + b.k) - (a.cp * 3 + a.k)));
      const bw = Math.min(720, W - 32), rowH = 26;
      const n = Math.max(rows[0].length, rows[1].length);
      const bh = 96 + n * rowH;
      const x0 = W / 2 - bw / 2, y0 = Math.max(110, H / 2 - bh / 2);
      c.fillStyle = 'rgba(12,14,19,0.92)'; roundRect(c, x0, y0, bw, bh, 12); c.fill();
      c.textAlign = 'center'; c.fillStyle = '#fff'; c.font = '900 18px system-ui, sans-serif';
      c.fillText(title || 'SCOREBOARD', W / 2, y0 + 28);
      const colW = bw / 2;
      for (let t = 0; t < 2; t++) {
        const cx = x0 + t * colW;
        c.fillStyle = TEAMS[t].color; c.font = '800 14px system-ui, sans-serif'; c.textAlign = 'left';
        c.fillText(`${TEAMS[t].name.toUpperCase()}: ${s.score[t]}`, cx + 16, y0 + 56);
        c.fillStyle = '#9aa3b8'; c.font = '700 11px system-ui, sans-serif'; c.textAlign = 'right';
        c.fillText('CAPS', cx + colW - 110, y0 + 76); c.fillText('KOs', cx + colW - 64, y0 + 76); c.fillText('DOWNS', cx + colW - 16, y0 + 76);
        rows[t].forEach((p, i) => {
          const y = y0 + 98 + i * rowH;
          if (p.i === s.myId) { c.fillStyle = 'rgba(255,209,102,0.15)'; c.fillRect(cx + 8, y - 17, colW - 16, rowH - 2); }
          c.fillStyle = CLASSES[p.c].color; c.beginPath(); c.arc(cx + 22, y - 5, 5, 0, TAU); c.fill();
          c.fillStyle = '#fff'; c.font = '600 13px system-ui, sans-serif'; c.textAlign = 'left';
          c.fillText(p.n + (p.b ? ' (bot)' : ''), cx + 34, y);
          c.textAlign = 'right';
          c.fillText(String(p.cp), cx + colW - 110, y); c.fillText(String(p.k), cx + colW - 64, y); c.fillText(String(p.d), cx + colW - 16, y);
        });
      }
    }

    drawEnd(c, s, W, H) {
      const w = s.win;
      const title = w === 2 ? 'DRAW' : `${TEAMS[w].name.toUpperCase()} WINS`;
      c.fillStyle = 'rgba(0,0,0,0.5)'; c.fillRect(0, 0, W, H);
      c.textAlign = 'center';
      c.font = '900 46px system-ui, sans-serif';
      c.lineWidth = 6; c.strokeStyle = 'rgba(0,0,0,0.8)';
      c.strokeText(title, W / 2, 140);
      c.fillStyle = w === 2 ? '#fff' : TEAMS[w].light; c.fillText(title, W / 2, 140);
      this.drawScoreboard(c, s, W, H, `Next match in ${s.ne}s`);
    }
  }

  window.Renderer = Renderer;
  window.drawKnightPreview = function (canvas, cls, team) {
    const c = canvas.getContext('2d');
    c.clearRect(0, 0, canvas.width, canvas.height);
    c.save();
    c.translate(canvas.width / 2, canvas.height / 2 + 10);
    c.scale(1.4, 1.4);
    drawKnight(c, { x: 0, y: 0, aim: 0.5, team, cls, wep: 0, charge: 0, swing: null, alpha: 1, walk: 0, moving: false }, 0);
    c.restore();
  };
})();
