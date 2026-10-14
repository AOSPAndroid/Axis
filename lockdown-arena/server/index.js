#!/usr/bin/env node
'use strict';
// HTTP + WebSocket server. Serves the browser client and runs one match for the whole LAN.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WebSocketServer } = require('ws');
const LD = require('../shared/shared.js');
const { Game } = require('./game.js');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(argv[i]);
    if (!m) continue;
    out[m[1]] = m[2] !== undefined ? m[2] : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true');
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const PORT = Number(args.port || process.env.PORT || 3000);
const HOST = args.host || process.env.HOST || '0.0.0.0';
const config = {};
if (args.score) config.scoreToWin = Number(args.score);
if (args.time) config.matchTime = Number(args.time) * 60;
if (args.respawn) config.respawnTime = Number(args.respawn);

const game = new Game({ botFill: args.bots != null ? Number(args.bots) : 3, config });

// ------------------------------------------------------------------ static files
const ROOT = path.join(__dirname, '..');
const STATIC = { '/': 'public/index.html' };
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  let rel = STATIC[url];
  if (!rel) {
    if (url.startsWith('/shared/')) rel = url.slice(1);
    else rel = 'public' + url;
  }
  const file = path.normalize(path.join(ROOT, rel));
  const allowed = [path.join(ROOT, 'public') + path.sep, path.join(ROOT, 'shared') + path.sep];
  if (!allowed.some((a) => file.startsWith(a))) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

// ------------------------------------------------------------------ websocket
const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 });
const clients = new Set();

wss.on('connection', (ws) => {
  const client = { ws, player: null };
  clients.add(client);
  const map = game.map;
  send(ws, {
    t: 'welcome',
    map: { W: map.W, H: map.H, TILE: map.TILE, grid: Array.from(map.grid), points: map.points, pickups: map.pickups, spawnRooms: map.spawnRooms },
    config: game.cfg,
    urls: lanUrls(),
  });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    if (!msg || typeof msg !== 'object') return;
    const p = client.player;
    switch (msg.t) {
      case 'join':
        if (p) return;
        client.player = game.addPlayer({ name: msg.name, cls: msg.cls, team: msg.team });
        send(ws, { t: 'joined', id: client.player.id, team: client.player.team });
        break;
      case 'input':
        if (p) game.queueInput(p, msg);
        break;
      case 'class':
        if (p && LD.CLASSES[msg.cls]) {
          p.nextCls = msg.cls;
          // switching inside your own spawn room takes effect immediately
          const room = game.map.spawnRooms[p.team];
          if (p.alive && p.x > room.x0 && p.x < room.x1 && p.y > room.y0 && p.y < room.y1) game.spawn(p);
        }
        break;
      case 'team':
        if (p && (msg.team === 0 || msg.team === 1) && msg.team !== p.team) {
          const counts = game.teamCounts();
          if (counts[msg.team] >= game.cfg.maxPerTeam) return;
          p.team = msg.team;
          if (p.alive) game.kill(p, null);
          p.deaths = Math.max(0, p.deaths - 1);
          p.respawnAt = game.time + 1;
          game.balanceBots();
          send(ws, { t: 'joined', id: p.id, team: p.team });
        }
        break;
      case 'bots':
        game.setBotFill(Number(msg.n));
        break;
      case 'restart':
        game.resetMatch();
        break;
      case 'chat':
        if (p && typeof msg.text === 'string' && msg.text.trim()) {
          game.event({ e: 'chat', n: p.name, tm: p.team, s: msg.text.trim().slice(0, 120) });
        }
        break;
    }
  });

  ws.on('close', () => {
    clients.delete(client);
    if (client.player) game.removePlayer(client.player.id);
  });
  ws.on('error', () => {});
});

function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}

// ------------------------------------------------------------------ main loop
const dt = 1 / game.cfg.tickRate;
let last = process.hrtime.bigint();
let acc = 0;
setInterval(() => {
  const nowT = process.hrtime.bigint();
  acc += Number(nowT - last) / 1e9;
  last = nowT;
  if (acc > 0.25) acc = 0.25;
  let ticked = false;
  while (acc >= dt) { game.update(dt); acc -= dt; ticked = true; }
  if (!ticked) return;
  const events = game.takeEvents();
  // one snapshot per team (plus spectators) so cloaked enemies stay hidden
  for (const c of clients) {
    if (c.ws.readyState !== 1) continue;
    if (c.ws.bufferedAmount > 256 * 1024) continue; // skip slow clients rather than queue forever
    c.ws.send(JSON.stringify(game.snapshotFor(c.player, events)));
  }
}, 1000 / 60);

function lanUrls() {
  const urls = [`http://${os.hostname()}:${PORT}`];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) urls.push(`http://${ni.address}:${PORT}`);
    }
  }
  return urls;
}

server.listen(PORT, HOST, () => {
  const lines = [`  Local:    http://localhost:${PORT}`];
  lanUrls().forEach((u, i) => lines.push((i === 0 ? '  Hostname: ' : '  LAN:      ') + u));
  console.log('\n  Lockdown Arena server running\n');
  console.log(lines.join('\n'));
  console.log(`\n  Bots fill each team to ${game.botFill}. First to ${game.cfg.scoreToWin} points or ${game.cfg.matchTime / 60} min.\n`);
});
