// Shared rules, data and physics used by both the Node server and the browser client.
// Loaded with require() on the server and as a plain <script> (global `LD`) in the browser.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LD = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TILE = 48;

  const CONFIG = {
    tickRate: 30,
    scoreToWin: 500,
    matchTime: 600,          // seconds
    endScreenTime: 12,       // seconds between matches
    respawnTime: 6,
    spawnProtect: 2.5,
    playerRadius: 18,
    captureRadius: 130,
    captureTime: 6,          // seconds for one player to take a neutral point
    captureBonusPerExtra: 0.5,
    decayRate: 8,            // progress/sec back toward resting value when nobody stands on a point
    pointRates: [0, 1, 2, 4],// score per second when holding 0/1/2/3 points
    pickupHeal: 40,
    pickupRespawn: 20,
    maxPerTeam: 8,
  };

  const TEAMS = [
    { name: 'Crimson', color: '#e0474c', light: '#ff8a8d', dark: '#7a1d22' },
    { name: 'Azure', color: '#3c8de0', light: '#8cc4ff', dark: '#173f6e' },
  ];

  // Class modules: each class swaps the defensive button for its own ability.
  const CLASSES = {
    striker: {
      name: 'Striker', hp: 100, speed: 235, dmgMul: 1.15, ability: 'dash',
      abilityName: 'Dash', energyMax: 100, regen: 26, color: '#ffc23d',
      blurb: 'Fast and hard-hitting. No shield; dashes out of trouble instead.',
    },
    guardian: {
      name: 'Guardian', hp: 140, speed: 195, dmgMul: 1.0, ability: 'bubble',
      abilityName: 'Bubble Shield', energyMax: 100, regen: 16, color: '#4fe0d2',
      blurb: 'Tough. Projects a shield bubble that protects every ally inside it.',
    },
    recon: {
      name: 'Recon', hp: 90, speed: 220, dmgMul: 1.0, ability: 'cloak',
      abilityName: 'Cloak', energyMax: 100, regen: 14, color: '#b07cff',
      blurb: 'Turns invisible. The first attack out of cloak deals bonus damage.',
    },
  };
  const CLASS_IDS = Object.keys(CLASSES);

  const ABILITY = {
    dashCost: 34, dashTime: 0.18, dashSpeedMul: 3.3,
    bubbleRadius: 115, bubbleDrain: 5, bubbleAbsorb: 0.8, bubbleRearm: 45,
    cloakDrain: 9, cloakMin: 20, cloakRevealDist: 80, ambushMul: 1.5,
    regenDelay: 0.8,
  };

  // Every knight carries the same three weapon types: blade, blaster, bomb.
  const WEAPONS = [
    {
      id: 'sword', name: 'Blade', type: 'melee', key: '1',
      cooldown: 0.36, comboWindow: 0.55, combo: [18, 18, 26],
      range: 72, arc: 2.0,
      chargeTime: 0.9, chargeDmg: 34, chargeRange: 92, chargeLunge: 260,
      moveMul: 0.5, swingTime: 0.22,
    },
    {
      id: 'gun', name: 'Blaster', type: 'gun', key: '2',
      cooldown: 0.27, clip: 4, reload: 1.4,
      dmg: 14, speed: 720, life: 0.85, radius: 6,
      chargeTime: 1.0, chargeDmg: 30, chargeSpeed: 640, chargeRadius: 11, chargePierce: true,
      moveMul: 0.85,
    },
    {
      id: 'bomb', name: 'Bomb', type: 'bomb', key: '3',
      cooldown: 0.5, chargeTime: 0.95, fuse: 1.1, radius: 115, dmg: 46, minFalloff: 0.5,
      moveMul: 0.85,
    },
  ];
  const CHARGE_MOVE_MUL = 0.65;

  // ---------------------------------------------------------------- map
  // The arena is mirrored left/right so both teams get the same layout.
  function buildMap() {
    const W = 57, H = 33;
    const grid = new Uint8Array(W * H);
    const mx = (x) => W - 1 - x;
    const put = (x, y, v) => {
      if (x < 0 || y < 0 || x >= W || y >= H) return;
      grid[y * W + x] = v;
      grid[y * W + mx(x)] = v;
    };
    const rect = (x, y, w, h, v = 1) => {
      for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) put(i, j, v);
    };

    // outer walls
    rect(0, 0, W, 1); rect(0, H - 1, W, 1); rect(0, 0, 1, H);
    // spawn rooms with two exits each
    rect(1, 10, 6, 1); rect(1, 22, 6, 1); rect(6, 10, 1, 13);
    rect(6, 13, 1, 2, 0); rect(6, 18, 1, 2, 0);
    // cover around the near point (A / C)
    rect(10, 4, 2, 1); rect(15, 4, 2, 1); rect(10, 10, 2, 1); rect(15, 10, 2, 1);
    // lanes
    rect(19, 2, 1, 7);
    rect(9, 15, 4, 3);
    rect(16, 13, 3, 2);
    rect(22, 10, 2, 4);
    rect(26, 14, 5, 1);
    rect(8, 24, 1, 5);
    rect(13, 27, 5, 1);
    rect(18, 19, 1, 5);
    // cover around the middle point (B)
    rect(24, 19, 2, 1); rect(24, 25, 2, 1); rect(27, 28, 3, 1);

    const c = (tx, ty) => ({ x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE });
    const points = [
      Object.assign({ id: 'A' }, c(13, 7)),
      Object.assign({ id: 'B' }, c(28, 22)),
      Object.assign({ id: 'C' }, c(mx(13), 7)),
    ];
    const spawns = [[], []];
    for (let y = 12; y <= 20; y += 2) for (let x = 2; x <= 4; x++) {
      spawns[0].push(c(x, y));
      spawns[1].push(c(mx(x), y));
    }
    const pickupTiles = [[4, 3], [4, 29], [28, 8], [21, 30]];
    const pickups = [];
    for (const [x, y] of pickupTiles) {
      pickups.push(c(x, y));
      if (mx(x) !== x) pickups.push(c(mx(x), y));
    }
    const spawnRooms = [
      { x0: 1 * TILE, y0: 11 * TILE, x1: 6 * TILE, y1: 22 * TILE },
      { x0: (W - 6) * TILE, y0: 11 * TILE, x1: (W - 1) * TILE, y1: 22 * TILE },
    ];
    return { W, H, TILE, grid, points, spawns, pickups, spawnRooms };
  }

  // ---------------------------------------------------------------- physics
  function isWall(map, tx, ty) {
    if (tx < 0 || ty < 0 || tx >= map.W || ty >= map.H) return true;
    return map.grid[ty * map.W + tx] === 1;
  }
  function isWallAt(map, x, y) {
    return isWall(map, Math.floor(x / map.TILE), Math.floor(y / map.TILE));
  }

  function resolveCircle(map, p, r) {
    const T = map.TILE;
    const x0 = Math.floor((p.x - r) / T), x1 = Math.floor((p.x + r) / T);
    const y0 = Math.floor((p.y - r) / T), y1 = Math.floor((p.y + r) / T);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (!isWall(map, tx, ty)) continue;
        const bx = tx * T, by = ty * T;
        const cx = Math.max(bx, Math.min(p.x, bx + T));
        const cy = Math.max(by, Math.min(p.y, by + T));
        const dx = p.x - cx, dy = p.y - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 >= r * r) continue;
        if (d2 > 1e-6) {
          const d = Math.sqrt(d2);
          p.x += (dx / d) * (r - d);
          p.y += (dy / d) * (r - d);
        } else {
          // centre is inside the tile: push out along the shortest axis
          const left = p.x - bx, right = bx + T - p.x, up = p.y - by, down = by + T - p.y;
          const m = Math.min(left, right, up, down);
          if (m === left) p.x = bx - r; else if (m === right) p.x = bx + T + r;
          else if (m === up) p.y = by - r; else p.y = by + T + r;
        }
      }
    }
  }

  function moveCircle(map, p, dx, dy, r) {
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / (r * 0.5)));
    for (let i = 0; i < steps; i++) {
      p.x += dx / steps;
      resolveCircle(map, p, r);
      p.y += dy / steps;
      resolveCircle(map, p, r);
    }
  }

  function lineOfSight(map, x0, y0, x1, y1) {
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const step = map.TILE / 4;
    const n = Math.ceil(dist / step);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (isWallAt(map, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return false;
    }
    return true;
  }

  // Movement speed multiplier from what the knight is doing right now.
  // Used identically by the server simulation and client-side prediction.
  function speedMul(state) {
    let m = 1;
    if (state.swinging) m *= WEAPONS[0].moveMul;
    else if (state.charging) m *= CHARGE_MOVE_MUL;
    if (state.bubble) m *= 0.55;
    return m;
  }

  function stepMove(map, p, input, speed, dt) {
    let mx = input.mx || 0, my = input.my || 0;
    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }
    moveCircle(map, p, mx * speed * dt, my * speed * dt, CONFIG.playerRadius);
  }

  function angleDiff(a, b) {
    let d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  return {
    TILE, CONFIG, TEAMS, CLASSES, CLASS_IDS, ABILITY, WEAPONS, CHARGE_MOVE_MUL,
    buildMap, isWall, isWallAt, moveCircle, resolveCircle, lineOfSight, speedMul, stepMove, angleDiff,
  };
});
