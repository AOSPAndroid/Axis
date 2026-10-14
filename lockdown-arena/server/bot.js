'use strict';
// Simple AI knights so the arena is playable with any number of humans.
const LD = require('../shared/shared.js');
const { CONFIG, WEAPONS, ABILITY } = LD;

const fieldCache = new Map(); // "map|tx,ty" -> distance field

// Breadth-first distance field toward a target tile (8-way, no corner cutting).
function distanceField(map, tx, ty) {
  const key = tx + ',' + ty;
  let f = fieldCache.get(key);
  if (f) return f;
  f = new Int32Array(map.W * map.H).fill(-1);
  const q = new Int32Array(map.W * map.H);
  let h = 0, t = 0;
  if (LD.isWall(map, tx, ty)) return f;
  f[ty * map.W + tx] = 0; q[t++] = ty * map.W + tx;
  while (h < t) {
    const c = q[h++];
    const x = c % map.W, y = (c / map.W) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const X = x + dx, Y = y + dy;
      if (LD.isWall(map, X, Y)) continue;
      if (dx && dy && (LD.isWall(map, x + dx, y) || LD.isWall(map, x, y + dy))) continue;
      const n = Y * map.W + X;
      if (f[n] !== -1) continue;
      f[n] = f[c] + 1;
      q[t++] = n;
    }
  }
  if (fieldCache.size > 400) fieldCache.clear();
  fieldCache.set(key, f);
  return f;
}

class BotBrain {
  constructor(game, p) {
    this.game = game;
    this.p = p;
    this.goal = null;
    this.goalTimer = 0;
    this.atkTimer = 0;
    this.atk = false;
    this.strafe = Math.random() < 0.5 ? 1 : -1;
    this.strafeTimer = 0;
    this.wander = { x: 0, y: 0, t: 0 };
    this.skill = 0.6 + Math.random() * 0.4;
    this.react = 0;
    this.chargeGoal = 0;
  }

  // Direction to walk from (x,y) toward a world position using the distance field.
  pathDir(x, y, gx, gy) {
    const map = this.game.map, T = map.TILE;
    if (LD.lineOfSight(map, x, y, gx, gy) && this.clearPath(x, y, gx, gy)) {
      const d = Math.hypot(gx - x, gy - y) || 1;
      return [(gx - x) / d, (gy - y) / d];
    }
    const f = distanceField(map, Math.floor(gx / T), Math.floor(gy / T));
    const cx = Math.floor(x / T), cy = Math.floor(y / T);
    let best = f[cy * map.W + cx], bx = cx, by = cy;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const X = cx + dx, Y = cy + dy;
      if (LD.isWall(map, X, Y)) continue;
      if (dx && dy && (LD.isWall(map, cx + dx, cy) || LD.isWall(map, cx, cy + dy))) continue;
      const v = f[Y * map.W + X];
      if (v >= 0 && (best < 0 || v < best)) { best = v; bx = X; by = Y; }
    }
    const tx = (bx + 0.5) * T, ty = (by + 0.5) * T;
    const d = Math.hypot(tx - x, ty - y) || 1;
    return [(tx - x) / d, (ty - y) / d];
  }

  // Line of sight that also accounts for the knight's body width.
  clearPath(x, y, gx, gy) {
    const map = this.game.map;
    const d = Math.hypot(gx - x, gy - y) || 1;
    const nx = -(gy - y) / d * (CONFIG.playerRadius - 2), ny = (gx - x) / d * (CONFIG.playerRadius - 2);
    return LD.lineOfSight(map, x + nx, y + ny, gx + nx, gy + ny) && LD.lineOfSight(map, x - nx, y - ny, gx - nx, gy - ny);
  }

  chooseGoal() {
    const g = this.game, p = this.p;
    let best = null, bestScore = -Infinity;
    for (const pt of g.points) {
      const d = Math.hypot(pt.x - p.x, pt.y - p.y);
      let s = -d / 400;
      const mine = pt.owner === p.team && Math.abs(pt.progress) >= 99;
      if (!mine) s += 3;
      if (pt.owner !== -1 && pt.owner !== p.team) s += 0.7;
      if (pt.contested || (pt.capturing !== -1 && pt.capturing !== p.team)) s += 2.5;
      // spread the team out a little
      let allies = 0;
      for (const o of g.players.values()) {
        if (o !== p && o.alive && o.team === p.team && o.brain && o.brain.goal === pt) allies++;
      }
      s -= allies * 0.9;
      s += Math.random() * 1.2;
      if (s > bestScore) { bestScore = s; best = pt; }
    }
    this.goal = best;
    this.goalTimer = 2 + Math.random() * 2;
  }

  findEnemy() {
    const g = this.game, p = this.p;
    let best = null, bd = 520;
    for (const o of g.players.values()) {
      if (!o.alive || o.team === p.team) continue;
      if (!g.visibleTo(o, p.team)) continue;
      const d = Math.hypot(o.x - p.x, o.y - p.y);
      if (d < bd && LD.lineOfSight(g.map, p.x, p.y, o.x, o.y)) { bd = d; best = o; }
    }
    return best ? { o: best, d: bd } : null;
  }

  think(dt) {
    const g = this.game, p = this.p;
    if (!p.alive || g.state !== 'playing') {
      p.inputs.push({ seq: 0, dt: 0, mx: 0, my: 0, aim: p.aim, atk: false, abil: false, wep: p.wep, reload: false });
      return;
    }
    this.goalTimer -= dt;
    if (!this.goal || this.goalTimer <= 0) this.chooseGoal();
    this.strafeTimer -= dt;
    if (this.strafeTimer <= 0) { this.strafe = -this.strafe; this.strafeTimer = 0.6 + Math.random() * 1.2; }

    let mx = 0, my = 0, aim = p.aim, atk = false, abil = false, wep = p.wep, reload = false;
    const en = this.findEnemy();
    const cls = p.cls;

    if (en) {
      this.react += dt;
      const o = en.o;
      // lead the target a little
      const lead = en.d / WEAPONS[1].speed * 0.5;
      const ox = o.x + (o.x - (o.px || o.x)) / dt * lead * 0.5;
      const oy = o.y + (o.y - (o.py || o.y)) / dt * lead * 0.5;
      aim = Math.atan2(oy - p.y, ox - p.x) + (Math.random() - 0.5) * (1 - this.skill) * 0.5;
      let close = 0;
      for (const q of g.players.values()) if (q.alive && q.team !== p.team && Math.hypot(q.x - p.x, q.y - p.y) < 130) close++;

      if (en.d < 95) {
        wep = close >= 2 && p.energy > 10 && Math.random() < 0.02 ? 2 : (p.wep === 2 && this.chargeGoal ? 2 : 0);
      } else if (en.d < 470) {
        wep = 1;
      }
      if (wep === 2) this.chargeGoal = WEAPONS[2].chargeTime + 0.1;

      if (this.react > 0.25 / this.skill) {
        if (wep === 0) {
          this.atkTimer -= dt;
          if (this.atkTimer <= 0) { this.atk = !this.atk; this.atkTimer = this.atk ? 0.05 : 0.3 + Math.random() * 0.15; }
          atk = this.atk;
        } else if (wep === 1) {
          if (p.reloadUntil) atk = false;
          else {
            this.atkTimer -= dt;
            if (this.atkTimer <= 0) { this.atk = !this.atk; this.atkTimer = this.atk ? 0.05 : 0.25 + Math.random() * 0.3; }
            atk = this.atk;
          }
        } else if (wep === 2) {
          this.chargeGoal -= dt;
          atk = this.chargeGoal > 0;
        }
      }
      // movement: close in for melee, strafe at range
      const dx = (o.x - p.x) / en.d, dy = (o.y - p.y) / en.d;
      if (wep === 0) { mx = dx + -dy * this.strafe * 0.3; my = dy + dx * this.strafe * 0.3; }
      else { mx = -dy * this.strafe + dx * (en.d > 300 ? 0.6 : -0.3); my = dx * this.strafe + dy * (en.d > 300 ? 0.6 : -0.3); }
      // keep fighting near the objective
      if (this.goal && Math.hypot(this.goal.x - p.x, this.goal.y - p.y) > 400) {
        const [gx, gy] = this.pathDir(p.x, p.y, this.goal.x, this.goal.y);
        mx = mx * 0.6 + gx * 0.4; my = my * 0.6 + gy * 0.4;
      }

      if (cls === 'guardian') abil = p.hp < p.maxHp * 0.55 && !p.bubbleBroken && p.energy > 15;
      if (cls === 'striker' && p.hp < p.maxHp * 0.35 && p.energy > ABILITY.dashCost && Math.random() < 0.05) {
        abil = true; mx = -dx; my = -dy;
      }
      if (cls === 'recon' && p.cloak && en.d < 80) atk = true;
    } else {
      this.react = 0;
      this.atk = false;
      if (p.clip < WEAPONS[1].clip && !p.reloadUntil) reload = true;
      const goal = this.goal;
      const gd = Math.hypot(goal.x - p.x, goal.y - p.y);
      let tx = goal.x, ty = goal.y;
      if (gd < CONFIG.captureRadius * 0.7) {
        this.wander.t -= dt;
        if (this.wander.t <= 0) {
          const a = Math.random() * Math.PI * 2, r = Math.random() * CONFIG.captureRadius * 0.6;
          this.wander = { x: goal.x + Math.cos(a) * r, y: goal.y + Math.sin(a) * r, t: 1 + Math.random() * 1.5 };
        }
        tx = this.wander.x; ty = this.wander.y;
      }
      const d = Math.hypot(tx - p.x, ty - p.y);
      if (d > 12) [mx, my] = this.pathDir(p.x, p.y, tx, ty);
      if (mx || my) aim = Math.atan2(my, mx);
      if (cls === 'striker' && gd > 350 && p.energy > 80 && Math.random() < 0.02) abil = true;
      if (cls === 'recon' && !p.cloak && gd > 250 && p.energy > 80 && Math.random() < 0.02) abil = true;
      if (cls === 'guardian') abil = false;
    }
    // recon cloak is a toggle; release next frame
    if (cls !== 'guardian' && abil && this.lastAbil) abil = false;
    this.lastAbil = abil;

    p.px = p.x; p.py = p.y;
    p.inputs.push({ seq: 0, dt, mx, my, aim, atk, abil, wep, reload });
  }
}

module.exports = { BotBrain, distanceField };
