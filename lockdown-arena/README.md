# Lockdown Arena

A team control-point brawler for the browser, played over your LAN. Two teams fight over
three capture points; holding points earns score, and the first team to the target wins.

It recreates the *mechanics* of the classic "Lockdown" PvP mode from MMO action games:
three points, class modules that replace the shield button, a melee/gun/bomb loadout with
charge attacks, and timed respawns. All code, art and sound are original. The art is drawn
procedurally on a canvas and the sound is synthesized with WebAudio, so there are no
third-party assets.

## Run it

```bash
cd lockdown-arena
npm install
npm start
```

The server prints the addresses to share:

```
  Local:    http://localhost:3000
  Hostname: http://my-pc:3000
  LAN:      http://192.168.1.23:3000
```

Anyone on the same network can open the `Hostname` or `LAN` address in a browser to join.
The join menu shows the same addresses. If others can't connect, allow the port through your
OS firewall.

### Options

```bash
npm start -- --port 8080 --bots 4 --score 300 --time 8 --respawn 5
```

| Flag        | Default   | Meaning                                                              |
|-------------|-----------|----------------------------------------------------------------------|
| `--port`    | `3000`    | HTTP/WebSocket port (or the `PORT` env var)                          |
| `--host`    | `0.0.0.0` | Interface to bind                                                    |
| `--bots`    | `3`       | Bots fill each team up to this many players (humans replace bots)    |
| `--score`   | `500`     | Score needed to win                                                  |
| `--time`    | `10`      | Match length in minutes                                              |
| `--respawn` | `6`       | Respawn delay in seconds                                             |

You can also change bot fill and restart the match from the in-game menu (Esc).

## How it plays

**Control points.** A, B and C. Standing on a point alone captures it. More teammates
capture faster (+50% each). An enemy-held point must be neutralized first, then captured. If
both teams are on a point, it's contested and frozen. Score per second depends on how many
points you hold: 1, 2 or 4 for one, two or three points.

**Classes.** Each class replaces the shield button with its own ability, which uses an
energy bar:

| Class    | HP  | Speed | Ability                                                                                                |
|----------|-----|-------|--------------------------------------------------------------------------------------------------------|
| Striker  | 100 | fast  | **Dash**: quick burst in the move direction (3 charges' worth of energy). +15% damage.                  |
| Guardian | 140 | slow  | **Bubble Shield** (hold): blocks all damage and shots from outside for every ally inside. Breaks when drained. |
| Recon    | 90  | mid   | **Cloak** (toggle): invisible to enemies. The first attack out of cloak deals +50%.                     |

Cloaked knights are removed from the enemy team's network snapshots, so cloak can't be
seen through by reading the network traffic.

**Weapons** (everyone carries all three):

- **Blade**: 3-hit combo. Hold and release for a 360° spin with a lunge.
- **Blaster**: 4-round clip with auto-reload. Hold and release for a piercing charged shot.
- **Bomb**: must be charged. Release to drop it; it explodes after a short fuse.

Health capsules spawn around the arena. Spawn rooms give a few seconds of protection, and you
can switch class instantly while standing in your own spawn room.

### Controls

| Input                 | Action                                          |
|-----------------------|-------------------------------------------------|
| WASD / Arrows         | Move                                            |
| Mouse                 | Aim                                             |
| Left click            | Attack. Hold to charge, release for the charged attack |
| Right click / Space   | Class ability                                   |
| 1 2 3 / Q / Wheel     | Switch weapon                                   |
| R                     | Reload                                          |
| Tab                   | Scoreboard                                      |
| C / Esc               | Menu (class, team, bots, restart)               |
| Enter                 | Chat                                            |
| M                     | Mute                                            |

## Architecture

```
lockdown-arena/
  shared/shared.js    rules, class/weapon data, map, collision (used by server AND client)
  server/index.js     HTTP static server + WebSocket, 30 Hz tick, LAN address printout
  server/game.js      authoritative simulation: combat, abilities, capture, scoring
  server/bot.js       AI knights (distance-field pathing, point selection, fighting)
  public/             browser client (canvas renderer, WebAudio SFX, menu)
  test/sim.test.js    headless tests + a full bot-vs-bot match
```

- The server is authoritative. Clients send inputs at about 60 Hz, and the server simulates
  at 30 Hz and sends a snapshot per team.
- The client predicts its own movement with the same `shared.js` physics, then reconciles
  against the acknowledged input sequence. Other knights are interpolated about 85 ms in the
  past.
- The only runtime dependency is `ws`.

Run the tests with `npm test`.
