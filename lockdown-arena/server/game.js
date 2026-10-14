'use strict';
// Authoritative match simulation: movement, combat, class abilities, control points, scoring.
const LD = require('../shared/shared.js');
const { CONFIG, CLASSES, WEAPONS, ABILITY } = LD;
const { BotBrain } = require('./bot.js');

const BOT_NAMES = ['Rivet', 'Cinder', 'Bolt', 'Ember', 'Gale', 'Flint', 'Talon', 'Quill',
  'Sprocket', 'Thistle', 'Brass', 'Moss', 'Pike', 'Wren', 'Slate', 'Nimbus'];

let nextId = 1;

class Game {
  constructor(opts = {}) {
    this.cfg = Object.assign({}, CONFIG, opts.config || {});
    this.map = LD.buildMap();
    this.players = new Map();
    this.projectiles = [];
    this.bombs = [];
    this.events = [];
    this.time = 0;
    this.botFill = opts.botFill != null ? opts.botFill : 3; // keep each team topped up to this size
    this.pickups = this.map.pickups.map((p, i) => ({ id: i, x: p.x, y: p.y, readyAt: 0 }));
    this.feed = [];
    this.resetMatch();
    this.balanceBots();
  }

  // ------------------------------------------------------------ lifecycle
  resetMatch() {
    this.state = 'playing';
    this.matchStart = this.time;
    this.endAt = 0;
    this.winner = -1;
    this.score = [0, 0];
    this.points = this.map.points.map((p) => ({ id: p.id, x: p.x, y: p.y, owner: -1, progress: 0, contested: false, capturing: -1 }));
    this.projectiles = [];
    this.bombs = [];
    for (const pk of this.pickups) pk.readyAt = 0;
    for (const p of this.players.values()) {
      p.kills = p.deaths = p.caps = 0;
      this.spawn(p);
    }
    this.event({ e: 'start' });
  }

  event(ev) { this.events.push(ev); }

  teamCounts() {
    const c = [0, 0];
    for (const p of this.players.values()) c[p.team]++;
    return c;
  }

  addPlayer({ name, cls, team, isBot = false }) {
    if (team !== 0 && team !== 1) {
      // put humans on the team with fewer humans, then fewer knights overall
      const h = [0, 0], all = this.teamCounts();
      for (const o of this.players.values()) if (!o.isBot) h[o.team]++;
      if (isBot || h[0] === h[1]) team = all[0] <= all[1] ? 0 : 1;
      else team = h[0] < h[1] ? 0 : 1;
    }
    if (!CLASSES[cls]) cls = LD.CLASS_IDS[Math.floor(Math.random() * 3)];
    const p = {
      id: nextId++, name: String(name || 'Knight').slice(0, 16), team, cls, nextCls: cls, isBot,
      x: 0, y: 0, aim: 0, hp: 1, maxHp: 1, energy: 0, alive: false, respawnAt: 0, protectUntil: 0,
      wep: 0, inputs: [], input: { mx: 0, my: 0, aim: 0, atk: false, abil: false, wep: 0, reload: false },
      ack: 0, atkHeld: false, abilHeld: false, chargeT: 0, atkCd: 0, combo: 0, lastSwing: -9,
      clip: WEAPONS[1].clip, reloadUntil: 0, swing: null, swingUntil: 0,
      dashUntil: 0, dvx: 0, dvy: 0, bubble: false, bubbleBroken: false, cloak: false, ambush: false,
      energyUsedAt: -9, kx: 0, ky: 0, kills: 0, deaths: 0, caps: 0, lastHitBy: 0, lastHitAt: -9,
      revealUntil: 0,
    };
    if (isBot) p.brain = new BotBrain(this, p);
    this.players.set(p.id, p);
    this.spawn(p);
    if (!isBot) { this.event({ e: 'join', n: p.name, t: p.team }); this.balanceBots(); }
    return p;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    if (!p.isBot) { this.event({ e: 'leave', n: p.name, t: p.team }); this.balanceBots(); }
  }

  setBotFill(n) {
    this.botFill = Math.max(0, Math.min(this.cfg.maxPerTeam, n | 0));
    this.balanceBots();
  }

  // Keep each team at `botFill` knights by adding/removing bots.
  balanceBots() {
    for (let team = 0; team < 2; team++) {
      const members = [...this.players.values()].filter((p) => p.team === team);
      const humans = members.filter((p) => !p.isBot).length;
      const bots = members.filter((p) => p.isBot);
      const want = Math.max(0, this.botFill - humans);
      for (let i = bots.length; i < want; i++) {
        const used = new Set([...this.players.values()].map((p) => p.name));
        const name = BOT_NAMES.find((n) => !used.has(n)) || 'Bot' + nextId;
        this.addPlayer({ name, team, isBot: true });
      }
      for (let i = bots.length - 1; i >= want; i--) this.removePlayer(bots[i].id);
    }
  }

  spawn(p) {
    const c = CLASSES[p.nextCls] ? p.nextCls : p.cls;
    p.cls = c;
    const def = CLASSES[c];
    const spots = this.map.spawns[p.team];
    const s = spots[Math.floor(Math.random() * spots.length)];
    p.x = s.x + (Math.random() - 0.5) * 10;
    p.y = s.y + (Math.random() - 0.5) * 10;
    p.aim = p.team === 0 ? 0 : Math.PI;
    p.maxHp = def.hp; p.hp = def.hp;
    p.energy = def.energyMax;
    p.alive = true;
    p.protectUntil = this.time + this.cfg.spawnProtect;
    p.clip = WEAPONS[1].clip; p.reloadUntil = 0;
    p.chargeT = 0; p.atkCd = 0; p.combo = 0;
    p.bubble = false; p.bubbleBroken = false; p.cloak = false; p.ambush = false;
    p.dashUntil = 0; p.kx = p.ky = 0; p.swing = null; p.inputs.length = 0;
  }

  // ------------------------------------------------------------ input
  queueInput(p, msg) {
    if (p.inputs.length > 120) p.inputs.shift();
    const num = (v, lo, hi, d) => (typeof v === 'number' && isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
    p.inputs.push({
      seq: num(msg.seq, 0, 1e12, 0) | 0,
      dt: num(msg.dt, 0, 0.05, 0),
      mx: num(msg.mx, -1, 1, 0), my: num(msg.my, -1, 1, 0),
      aim: num(msg.aim, -10, 10, 0),
      atk: !!msg.atk, abil: !!msg.abil, wep: num(msg.wep, 0, 2, 0) | 0, reload: !!msg.reload,
    });
  }

  // ------------------------------------------------------------ tick
  update(dt) {
    this.time += dt;
    const now = this.time;

    // bots think and produce inputs like a human client would
    for (const p of this.players.values()) if (p.isBot) p.brain.think(dt);

    for (const p of this.players.values()) this.updatePlayer(p, dt, now);
    this.updateProjectiles(dt);
    this.updateBombs(dt);
    this.updatePickups(now);

    if (this.state === 'playing') {
      this.updatePoints(dt);
      this.updateScore(dt);
    } else if (now >= this.endAt) {
      this.resetMatch();
    }
  }

  stateFlags(p) {
    return {
      swinging: this.time < p.swingUntil,
      charging: p.atkHeld && p.chargeT > 0.12,
      bubble: p.bubble,
    };
  }

  updatePlayer(p, dt, now) {
    if (!p.alive) {
      p.inputs.length = 0;
      if (now >= p.respawnAt && this.state === 'playing') this.spawn(p);
      return;
    }
    const def = CLASSES[p.cls];

    // movement: replay each queued input with its own dt so client prediction matches
    const sm = LD.speedMul(this.stateFlags(p));
    let budget = 0.25;
    for (const inp of p.inputs) {
      p.input = inp;
      p.ack = inp.seq;
      const d = Math.min(inp.dt, budget);
      budget -= d;
      if (d > 0 && now >= p.dashUntil) LD.stepMove(this.map, p, inp, def.speed * sm, d);
    }
    p.inputs.length = 0;
    const inp = p.input;
    p.aim = inp.aim;

    // dash / knockback velocities
    if (now < p.dashUntil) LD.moveCircle(this.map, p, p.dvx * dt, p.dvy * dt, CONFIG.playerRadius);
    if (p.kx || p.ky) {
      LD.moveCircle(this.map, p, p.kx * dt, p.ky * dt, CONFIG.playerRadius);
      const f = Math.pow(0.0005, dt);
      p.kx *= f; p.ky *= f;
      if (Math.abs(p.kx) + Math.abs(p.ky) < 5) p.kx = p.ky = 0;
    }

    // weapon switch cancels any charge
    if (inp.wep !== p.wep) {
      p.wep = inp.wep;
      p.chargeT = 0;
      p.atkHeld = false;
      p.atkCd = Math.max(p.atkCd, 0.12);
    }
    p.atkCd -= dt;

    // reload
    if (p.reloadUntil && now >= p.reloadUntil) { p.reloadUntil = 0; p.clip = WEAPONS[1].clip; }
    if (inp.reload && !p.reloadUntil && p.clip < WEAPONS[1].clip) this.startReload(p);

    this.updateAbility(p, inp, dt, now, def);
    this.updateAttack(p, inp, dt, now);
  }

  startReload(p) {
    p.reloadUntil = this.time + WEAPONS[1].reload;
    this.event({ e: 'reload', id: p.id });
  }

  updateAbility(p, inp, dt, now, def) {
    const pressed = inp.abil && !p.abilHeld;
    p.abilHeld = inp.abil;
    let using = false;

    if (def.ability === 'dash') {
      if (pressed && p.energy >= ABILITY.dashCost && now >= p.dashUntil) {
        let dx = inp.mx, dy = inp.my;
        if (!dx && !dy) { dx = Math.cos(p.aim); dy = Math.sin(p.aim); }
        const l = Math.hypot(dx, dy);
        const v = def.speed * ABILITY.dashSpeedMul;
        p.dvx = (dx / l) * v; p.dvy = (dy / l) * v;
        p.dashUntil = now + ABILITY.dashTime;
        p.energy -= ABILITY.dashCost;
        p.energyUsedAt = now;
        this.event({ e: 'dash', id: p.id, x: p.x, y: p.y });
      }
    } else if (def.ability === 'bubble') {
      if (p.bubbleBroken && p.energy >= ABILITY.bubbleRearm) p.bubbleBroken = false;
      const want = inp.abil && !p.bubbleBroken && p.energy > 0;
      if (want && !p.bubble) this.event({ e: 'bubbleUp', id: p.id });
      p.bubble = want;
      if (p.bubble) {
        using = true;
        p.energy -= ABILITY.bubbleDrain * dt;
        if (p.energy <= 0) this.breakBubble(p);
      }
    } else if (def.ability === 'cloak') {
      if (pressed) {
        if (p.cloak) this.uncloak(p, false);
        else if (p.energy >= ABILITY.cloakMin) {
          p.cloak = true; p.ambush = true;
          this.event({ e: 'cloak', id: p.id, x: p.x, y: p.y });
        }
      }
      if (p.cloak) {
        using = true;
        p.energy -= ABILITY.cloakDrain * dt;
        if (p.energy <= 0) this.uncloak(p, false);
      }
    }

    if (using) p.energyUsedAt = now;
    if (!using && now - p.energyUsedAt > ABILITY.regenDelay) {
      p.energy = Math.min(def.energyMax, p.energy + def.regen * dt);
    }
    p.energy = Math.max(0, p.energy);
  }

  breakBubble(g) {
    g.bubble = false;
    g.bubbleBroken = true;
    g.energy = 0;
    g.energyUsedAt = this.time;
    this.event({ e: 'bubbleBreak', id: g.id, x: g.x, y: g.y });
  }

  uncloak(p, keepAmbush) {
    if (!p.cloak) return;
    p.cloak = false;
    if (!keepAmbush) p.ambush = false;
    p.revealUntil = this.time + 0.6;
    this.event({ e: 'uncloak', id: p.id, x: p.x, y: p.y });
  }

  // Damage multiplier for an attack; consumes the recon ambush bonus.
  attackMul(p) {
    let m = CLASSES[p.cls].dmgMul;
    if (p.cloak || p.ambush) {
      if (p.ambush) m *= ABILITY.ambushMul;
      p.ambush = false;
      this.uncloak(p, false);
    }
    return m;
  }

  updateAttack(p, inp, dt, now) {
    const w = WEAPONS[p.wep];
    if (p.bubble) { p.atkHeld = false; p.chargeT = 0; return; } // can't fight from inside your own bubble
    const pressed = inp.atk && !p.atkHeld;
    const released = !inp.atk && p.atkHeld;

    if (pressed) {
      p.atkHeld = true;
      p.chargeT = 0;
      if (w.type !== 'bomb' && p.atkCd <= 0) this.basicAttack(p, w, now);
    } else if (p.atkHeld && inp.atk) {
      if (p.atkCd <= 0 && now >= p.swingUntil) p.chargeT += dt;
    }
    if (released) {
      p.atkHeld = false;
      if (p.chargeT >= w.chargeTime) this.chargedAttack(p, w, now);
      else if (w.type === 'bomb' && p.chargeT > 0.1) this.event({ e: 'fizzle', id: p.id });
      p.chargeT = 0;
    }
  }

  basicAttack(p, w, now) {
    if (w.type === 'melee') {
      p.combo = now - p.lastSwing < w.comboWindow ? (p.combo + 1) % w.combo.length : 0;
      p.lastSwing = now;
      const dmg = w.combo[p.combo] * this.attackMul(p);
      p.swing = { k: p.combo, a: p.aim, s: now };
      p.swingUntil = now + w.swingTime;
      p.atkCd = w.cooldown;
      this.event({ e: 'swing', id: p.id, k: p.combo });
      this.meleeHit(p, w.range, w.arc, dmg, 220);
    } else if (w.type === 'gun') {
      if (p.reloadUntil) return;
      if (p.clip <= 0) { this.startReload(p); return; }
      p.clip--;
      p.atkCd = w.cooldown;
      this.fire(p, w.dmg * this.attackMul(p), w.speed, w.radius, false);
      if (p.clip <= 0) this.startReload(p);
    }
  }

  chargedAttack(p, w, now) {
    if (w.type === 'melee') {
      const dmg = w.chargeDmg * this.attackMul(p);
      p.swing = { k: 3, a: p.aim, s: now };
      p.swingUntil = now + 0.35;
      p.atkCd = w.cooldown * 1.5;
      p.kx += Math.cos(p.aim) * w.chargeLunge;
      p.ky += Math.sin(p.aim) * w.chargeLunge;
      this.event({ e: 'swing', id: p.id, k: 3 });
      this.meleeHit(p, w.chargeRange, Math.PI * 2, dmg, 420);
    } else if (w.type === 'gun') {
      if (p.reloadUntil || p.clip <= 0) return;
      p.clip--;
      p.atkCd = w.cooldown * 1.5;
      this.fire(p, w.chargeDmg * this.attackMul(p), w.chargeSpeed, w.chargeRadius, true);
      if (p.clip <= 0) this.startReload(p);
    } else if (w.type === 'bomb') {
      p.atkCd = w.cooldown;
      const mul = this.attackMul(p);
      this.bombs.push({ id: nextId++, x: p.x, y: p.y, team: p.team, owner: p.id, explodeAt: now + w.fuse, dmg: w.dmg * mul });
      this.event({ e: 'bombDrop', x: p.x, y: p.y });
    }
  }

  meleeHit(p, range, arc, dmg, knock) {
    let hit = false;
    for (const t of this.players.values()) {
      if (!t.alive || t.team === p.team) continue;
      const dx = t.x - p.x, dy = t.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d > range + CONFIG.playerRadius) continue;
      if (arc < Math.PI * 2 && Math.abs(LD.angleDiff(Math.atan2(dy, dx), p.aim)) > arc / 2 + 0.25) continue;
      if (!LD.lineOfSight(this.map, p.x, p.y, t.x, t.y)) continue;
      const nx = d ? dx / d : Math.cos(p.aim), ny = d ? dy / d : Math.sin(p.aim);
      if (this.damage(t, dmg, p, nx * knock, ny * knock, p.x, p.y)) hit = true;
    }
    return hit;
  }

  fire(p, dmg, speed, radius, pierce) {
    const w = WEAPONS[1];
    const ox = p.x + Math.cos(p.aim) * 22, oy = p.y + Math.sin(p.aim) * 22;
    this.projectiles.push({
      id: nextId++, x: ox, y: oy, vx: Math.cos(p.aim) * speed, vy: Math.sin(p.aim) * speed,
      team: p.team, owner: p.id, dmg, r: radius, pierce, dieAt: this.time + w.life, hit: new Set(),
    });
    this.event({ e: 'shot', id: p.id, big: pierce ? 1 : 0, x: ox, y: oy });
  }

  // Find an active ally bubble of `team` that covers (x,y).
  bubbleCovering(team, x, y) {
    for (const g of this.players.values()) {
      if (!g.alive || !g.bubble || g.team !== team) continue;
      if (Math.hypot(x - g.x, y - g.y) <= ABILITY.bubbleRadius) return g;
    }
    return null;
  }

  // Returns true if damage was dealt (or absorbed by a shield).
  damage(t, amount, attacker, kx, ky, srcX, srcY) {
    if (!t.alive || this.time < t.protectUntil) return false;
    const g = this.bubbleCovering(t.team, t.x, t.y);
    if (g && Math.hypot(srcX - g.x, srcY - g.y) > ABILITY.bubbleRadius) {
      g.energy -= amount * ABILITY.bubbleAbsorb;
      g.energyUsedAt = this.time;
      this.event({ e: 'block', x: t.x, y: t.y, id: g.id });
      if (g.energy <= 0) this.breakBubble(g);
      return true;
    }
    t.hp -= amount;
    t.kx += kx; t.ky += ky;
    t.lastHitBy = attacker.id; t.lastHitAt = this.time;
    if (t.cloak) this.uncloak(t, false);
    this.event({ e: 'hit', id: t.id, by: attacker.id, d: Math.round(amount), x: t.x, y: t.y });
    if (t.hp <= 0) this.kill(t, attacker);
    return true;
  }

  kill(t, attacker) {
    t.hp = 0;
    t.alive = false;
    t.deaths++;
    t.bubble = false; t.cloak = false;
    t.respawnAt = this.time + this.cfg.respawnTime;
    if (attacker && attacker !== t) attacker.kills++;
    this.event({ e: 'kill', id: t.id, by: attacker ? attacker.id : 0, x: t.x, y: t.y,
      vn: t.name, vt: t.team, kn: attacker ? attacker.name : '', kt: attacker ? attacker.team : -1, w: attacker ? attacker.wep : 0 });
  }

  updateProjectiles(dt) {
    const now = this.time;
    const keep = [];
    for (const pr of this.projectiles) {
      let alive = now < pr.dieAt;
      const steps = Math.max(1, Math.ceil((Math.hypot(pr.vx, pr.vy) * dt) / 10));
      for (let s = 0; s < steps && alive; s++) {
        const px = pr.x, py = pr.y;
        pr.x += (pr.vx * dt) / steps;
        pr.y += (pr.vy * dt) / steps;
        if (LD.isWallAt(this.map, pr.x, pr.y)) { alive = false; this.event({ e: 'spark', x: px, y: py }); break; }
        // enemy bubbles stop shots fired from outside them
        const g = this.bubbleCovering(1 - pr.team, pr.x, pr.y);
        if (g && Math.hypot(px - g.x, py - g.y) > ABILITY.bubbleRadius) {
          g.energy -= pr.dmg * ABILITY.bubbleAbsorb;
          g.energyUsedAt = now;
          this.event({ e: 'block', x: pr.x, y: pr.y, id: g.id });
          if (g.energy <= 0) this.breakBubble(g);
          alive = false; break;
        }
        for (const t of this.players.values()) {
          if (!t.alive || t.team === pr.team || pr.hit.has(t.id)) continue;
          if (Math.hypot(t.x - pr.x, t.y - pr.y) > CONFIG.playerRadius + pr.r) continue;
          const owner = this.players.get(pr.owner) || { id: pr.owner, name: '?', team: pr.team, kills: 0 };
          const l = Math.hypot(pr.vx, pr.vy);
          pr.hit.add(t.id);
          this.damage(t, pr.dmg, owner, (pr.vx / l) * 160, (pr.vy / l) * 160, pr.x - pr.vx * 0.05, pr.y - pr.vy * 0.05);
          if (!pr.pierce) { alive = false; break; }
        }
      }
      if (alive) keep.push(pr);
    }
    this.projectiles = keep;
  }

  updateBombs() {
    const now = this.time;
    const w = WEAPONS[2];
    const keep = [];
    for (const b of this.bombs) {
      if (now < b.explodeAt) { keep.push(b); continue; }
      this.event({ e: 'boom', x: b.x, y: b.y, r: w.radius });
      const owner = this.players.get(b.owner) || { id: b.owner, name: '?', team: b.team, kills: 0 };
      for (const t of this.players.values()) {
        if (!t.alive || t.team === b.team) continue;
        const d = Math.hypot(t.x - b.x, t.y - b.y);
        if (d > w.radius + CONFIG.playerRadius) continue;
        if (!LD.lineOfSight(this.map, b.x, b.y, t.x, t.y)) continue;
        const fall = 1 - (1 - w.minFalloff) * Math.min(1, d / w.radius);
        const nx = d ? (t.x - b.x) / d : 1, ny = d ? (t.y - b.y) / d : 0;
        this.damage(t, b.dmg * fall, owner, nx * 380, ny * 380, b.x, b.y);
      }
    }
    this.bombs = keep;
  }

  updatePickups(now) {
    for (const pk of this.pickups) {
      if (now < pk.readyAt) continue;
      for (const p of this.players.values()) {
        if (!p.alive || p.hp >= p.maxHp) continue;
        if (Math.hypot(p.x - pk.x, p.y - pk.y) > CONFIG.playerRadius + 16) continue;
        p.hp = Math.min(p.maxHp, p.hp + this.cfg.pickupHeal);
        pk.readyAt = now + this.cfg.pickupRespawn;
        this.event({ e: 'heal', id: p.id, x: pk.x, y: pk.y });
        break;
      }
    }
  }

  // Control point capture. progress runs -100 (Crimson) .. +100 (Azure).
  updatePoints(dt) {
    const cfg = this.cfg;
    const baseRate = 100 / cfg.captureTime;
    for (const pt of this.points) {
      const n = [0, 0];
      for (const p of this.players.values()) {
        if (!p.alive) continue;
        if (Math.hypot(p.x - pt.x, p.y - pt.y) <= cfg.captureRadius) n[p.team]++;
      }
      pt.contested = n[0] > 0 && n[1] > 0;
      pt.capturing = -1;
      const prev = pt.progress;
      if (!pt.contested && (n[0] || n[1])) {
        const team = n[0] ? 0 : 1;
        const sign = team === 0 ? -1 : 1;
        const count = n[team];
        const rate = baseRate * (1 + cfg.captureBonusPerExtra * (count - 1));
        if (pt.progress * sign < 100) {
          pt.capturing = team;
          pt.progress += sign * rate * dt;
        }
      } else if (!pt.contested) {
        // nobody here: drift back to the resting value
        const rest = pt.owner === -1 ? 0 : (pt.owner === 0 ? -100 : 100);
        const d = rest - pt.progress;
        pt.progress += Math.sign(d) * Math.min(Math.abs(d), cfg.decayRate * dt);
      }
      pt.progress = Math.max(-100, Math.min(100, pt.progress));

      // ownership transitions
      if (pt.owner !== -1) {
        const ownSign = pt.owner === 0 ? -1 : 1;
        if (pt.progress * ownSign <= 0 && prev * ownSign > 0) {
          this.event({ e: 'neutral', p: pt.id, t: pt.owner });
          pt.owner = -1;
        }
      }
      if (pt.owner === -1 && Math.abs(pt.progress) >= 100) {
        pt.owner = pt.progress < 0 ? 0 : 1;
        for (const p of this.players.values()) {
          if (p.alive && p.team === pt.owner && Math.hypot(p.x - pt.x, p.y - pt.y) <= cfg.captureRadius) p.caps++;
        }
        this.event({ e: 'capture', p: pt.id, t: pt.owner });
      }
    }
  }

  updateScore(dt) {
    const held = [0, 0];
    for (const pt of this.points) if (pt.owner !== -1) held[pt.owner]++;
    for (let t = 0; t < 2; t++) this.score[t] += this.cfg.pointRates[held[t]] * dt;
    const elapsed = this.time - this.matchStart;
    let winner = -1;
    if (this.score[0] >= this.cfg.scoreToWin || this.score[1] >= this.cfg.scoreToWin) {
      winner = this.score[0] >= this.score[1] ? 0 : 1;
    } else if (elapsed >= this.cfg.matchTime) {
      winner = this.score[0] === this.score[1] ? 2 : (this.score[0] > this.score[1] ? 0 : 1);
    }
    if (winner !== -1) {
      this.score = this.score.map((s) => Math.min(s, this.cfg.scoreToWin));
      this.state = 'ended';
      this.winner = winner;
      this.endAt = this.time + this.cfg.endScreenTime;
      this.event({ e: 'end', w: winner });
    }
  }

  // ------------------------------------------------------------ snapshots
  // Cloaked enemies are left out of a team's snapshot unless they are very close
  // or just revealed themselves, so clients never learn their position.
  visibleTo(p, team) {
    if (p.team === team || !p.cloak) return true;
    if (this.time < p.revealUntil) return true;
    for (const o of this.players.values()) {
      if (o.alive && o.team === team && Math.hypot(o.x - p.x, o.y - p.y) < ABILITY.cloakRevealDist) return true;
    }
    return false;
  }

  snapshotFor(viewer, events) {
    const now = this.time;
    const r1 = (v) => Math.round(v * 10) / 10;
    const team = viewer ? viewer.team : -1;
    const players = [];
    for (const p of this.players.values()) {
      if (team !== -1 && !this.visibleTo(p, team)) continue;
      const w = WEAPONS[p.wep];
      const o = {
        i: p.id, n: p.name, t: p.team, c: p.cls, b: p.isBot ? 1 : 0,
        x: r1(p.x), y: r1(p.y), a: Math.round(p.aim * 100) / 100,
        hp: Math.ceil(p.hp), mh: p.maxHp, al: p.alive ? 1 : 0, w: p.wep,
        ch: p.atkHeld && w.chargeTime ? Math.min(1, Math.round((p.chargeT / w.chargeTime) * 100) / 100) : 0,
        bu: p.bubble ? 1 : 0, ck: p.cloak ? 1 : 0, da: now < p.dashUntil ? 1 : 0,
        pr: now < p.protectUntil ? 1 : 0, k: p.kills, d: p.deaths, cp: p.caps,
      };
      if (p.swing && now - p.swing.s < 0.4) o.sw = [p.swing.k, Math.round(p.swing.a * 100) / 100, Math.round((now - p.swing.s) * 1000)];
      if (!p.alive) o.rs = Math.max(0, Math.ceil(p.respawnAt - now));
      if (viewer && p === viewer) {
        o.en = Math.round(p.energy); o.cl = p.clip; o.rl = p.reloadUntil ? 1 : 0;
        o.ack = p.ack; o.sm = LD.speedMul(this.stateFlags(p)); o.nc = p.nextCls;
        o.bb = p.bubbleBroken ? 1 : 0; o.am = p.ambush ? 1 : 0;
      }
      players.push(o);
    }
    return {
      t: 'snap',
      st: Math.round(now * 1000) / 1000,
      players,
      pr: this.projectiles.map((p) => [p.id, r1(p.x), r1(p.y), Math.round(p.vx), Math.round(p.vy), p.team, p.pierce ? 1 : 0]),
      bo: this.bombs.map((b) => [b.id, r1(b.x), r1(b.y), b.team, Math.round((b.explodeAt - now) * 100) / 100]),
      pts: this.points.map((p) => [p.owner, Math.round(p.progress), p.contested ? 1 : 0, p.capturing]),
      pk: this.pickups.map((p) => (now >= p.readyAt ? 1 : 0)),
      sc: this.score.map((s) => Math.floor(s)),
      gs: this.state, win: this.winner,
      tl: Math.max(0, Math.ceil(this.cfg.matchTime - (now - this.matchStart))),
      ne: this.state === 'ended' ? Math.ceil(this.endAt - now) : 0,
      fill: this.botFill,
      ev: events.filter((e) => team === -1 || !e.id || this.canSeeEvent(e, team)),
    };
  }

  canSeeEvent(e, team) {
    const p = this.players.get(e.id);
    if (!p || e.e === 'kill' || e.e === 'hit') return true;
    return this.visibleTo(p, team);
  }

  takeEvents() {
    const ev = this.events;
    this.events = [];
    return ev;
  }
}

module.exports = { Game };
