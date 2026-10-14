'use strict';
// Headless check: run bot-only matches and make sure the core loop behaves.
const assert = require('assert');
const LD = require('../shared/shared.js');
const { Game } = require('../server/game.js');

function run(seconds, opts) {
  const g = new Game(opts);
  const dt = 1 / g.cfg.tickRate;
  const stats = { kills: 0, captures: 0, booms: 0, shots: 0, swings: 0, blocks: 0, ends: 0, heals: 0, dashes: 0, cloaks: 0 };
  for (let i = 0; i < seconds / dt; i++) {
    g.update(dt);
    for (const e of g.takeEvents()) {
      if (e.e === 'kill') stats.kills++;
      if (e.e === 'capture') stats.captures++;
      if (e.e === 'boom') stats.booms++;
      if (e.e === 'shot') stats.shots++;
      if (e.e === 'swing') stats.swings++;
      if (e.e === 'block') stats.blocks++;
      if (e.e === 'end') stats.ends++;
      if (e.e === 'heal') stats.heals++;
      if (e.e === 'dash') stats.dashes++;
      if (e.e === 'cloak') stats.cloaks++;
    }
    for (const p of g.players.values()) {
      assert(Number.isFinite(p.x) && Number.isFinite(p.y), 'position is finite');
      if (p.alive) {
        const T = g.map.TILE;
        assert(!LD.isWall(g.map, Math.floor(p.x / T), Math.floor(p.y / T)), `${p.name} stuck in a wall`);
      }
    }
  }
  return { g, stats };
}

// physics: a circle pushed into a wall stays out of it
{
  const map = LD.buildMap();
  const p = { x: 3 * 48, y: 3 * 48 };
  LD.moveCircle(map, p, -500, 0, 18);
  assert(p.x >= 48 + 18 - 0.01, 'wall collision on x');
  LD.moveCircle(map, p, 0, -500, 18);
  assert(p.y >= 48 + 18 - 0.01, 'wall collision on y');
}

// capture: a lone knight takes a neutral point in about captureTime seconds
{
  const g = new Game({ botFill: 0 });
  const p = g.addPlayer({ name: 'Solo', cls: 'striker', team: 0 });
  const pt = g.points[0];
  p.x = pt.x; p.y = pt.y; p.protectUntil = 0;
  const dt = 1 / g.cfg.tickRate;
  for (let i = 0; i < (g.cfg.captureTime + 0.2) / dt; i++) g.update(dt);
  assert.strictEqual(pt.owner, 0, 'point captured by Crimson');
  const before = g.score[0];
  for (let i = 0; i < 10 / dt; i++) g.update(dt);
  assert(Math.abs(g.score[0] - before - 10) < 0.5, 'one point scores 1/s');
}

// guardian bubble absorbs damage for allies inside it
{
  const g = new Game({ botFill: 0 });
  const guard = g.addPlayer({ name: 'G', cls: 'guardian', team: 0 });
  const ally = g.addPlayer({ name: 'A', cls: 'recon', team: 0 });
  const foe = g.addPlayer({ name: 'F', cls: 'striker', team: 1 });
  for (const p of [guard, ally, foe]) p.protectUntil = 0;
  guard.x = 600; guard.y = 450; ally.x = 640; ally.y = 450; foe.x = 900; foe.y = 450;
  guard.bubble = true;
  const hp = ally.hp;
  g.damage(ally, 20, foe, 0, 0, foe.x, foe.y);
  assert.strictEqual(ally.hp, hp, 'bubble blocked the hit');
  assert(guard.energy < 100, 'bubble drained');
  guard.bubble = false;
  g.damage(ally, 20, foe, 0, 0, foe.x, foe.y);
  assert.strictEqual(ally.hp, hp - 20, 'no bubble, damage taken');
}

// full bot match
{
  const { g, stats } = run(240, { botFill: 4, config: { scoreToWin: 200 } });
  console.log('bot match stats:', stats, 'score:', g.score.map(Math.floor), 'state:', g.state);
  assert(stats.captures >= 3, 'bots capture points');
  assert(stats.kills >= 5, 'bots fight');
  assert(stats.shots > 20 && stats.swings > 10, 'bots use weapons');
  assert(stats.ends >= 1, 'match finishes');
  const snap = g.snapshotFor([...g.players.values()][0], []);
  assert(JSON.stringify(snap).length < 20000, 'snapshot stays small');
}

console.log('all tests passed');
