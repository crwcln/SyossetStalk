// Headless tests of the authoritative simulation: ring, movement, collision, stairs,
// pings, interrogation + code catch, zone, bots, wake-from-sleep, match end.
import assert from 'node:assert/strict';
import * as S from '../src/sim.js';
import * as R from '../public/shared/rules.js';
import { TILE, tileCenter, SPAWNS, STAIR_LINKS, MAP_W, MAP_H } from '../public/shared/map.js';

const MAP = S.MAP;
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, `FAIL: ${msg}`); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, `FAIL: ${msg} (${a} !== ${b})`); checks++; };
const near = (a, b, eps, msg) => ok(Math.abs(a - b) <= eps, `${msg} (${Math.round(a)} vs ${Math.round(b)})`);
const inWall = (p) => !MAP.isFloor(Math.floor(p.x / TILE), Math.floor(p.y / TILE));

function drive(g, start, ms, each) {
  let t = start;
  for (let i = 0; i < ms / 100; i++) {
    t += 100;
    if (each) each(t);
    S.advance(g, t);
  }
  return t;
}

// ---------------------------------------------------------------- ring + start
let t = Date.now();
const g = S.newRoom('TEST');
const a = S.addPlayer(g, { name: 'ALPHA' }).player;
const b = S.addPlayer(g, { name: 'BRAVO' }).player;
g.hostId = a.id;
eq(g.phase, 'lobby', 'room starts in lobby');
eq(a.targetId, b.id, 'a targets b');
eq(b.targetId, a.id, 'b targets a in a duel');

// a third player makes it a real ring
const c = S.addPlayer(g, { name: 'CHARLIE' }).player;
eq(a.targetId, b.id, 'ring order a->b');
eq(b.targetId, c.id, 'ring order b->c');
eq(c.targetId, a.id, 'ring closes c->a');

S.startMatch(g, t);
eq(g.phase, 'countdown', 'countdown started');
t += R.COUNTDOWN_MS + 60;
S.advance(g, t);
eq(g.phase, 'hunt', 'hunt begins after countdown');
eq(g.players[a.id].hp, 100, 'players enter at full hp');

// ---------------------------------------------------------------- movement
for (const p of [a, b, c]) { p.x = 20 * TILE; p.y = 33.5 * TILE; }
const x0 = a.x;
t = drive(g, t, 1000, (now) => S.setInput(g, a, { x: 1, y: 0 }, now));
ok(a.x - x0 > 100, `walked east about ${Math.round(a.x - x0)}px`);
near(a.x - x0, R.WALK, 20, 'roughly walk speed over 1s');
ok(!inWall(a), 'player is on floor after moving');

// sneak is slower, sprint is faster
const sneaking = { x: 0, y: 0 };
a.x = 20 * TILE; a.y = 33.5 * TILE;
const sx0 = a.x;
t = drive(g, t, 1000, (now) => S.setInput(g, a, { x: 1, y: 0, sneak: true }, now));
const sneakDist = a.x - sx0;
a.x = 20 * TILE;
const sprintStart = t;
t = drive(g, t, 1000, (now) => { a.stamina = 100; S.setInput(g, a, { x: 1, y: 0, sprint: true }, now); });
const sprintDist = a.x - 20 * TILE;
ok(sneakDist < sprintDist, `sneak (${Math.round(sneakDist)}) slower than sprint (${Math.round(sprintDist)})`);
ok(a.stamina < 100, 'sprinting drains stamina');

// ---------------------------------------------------------------- collision
a.x = 24 * TILE;   // a stretch of hall with solid wall above it
  a.y = 33.5 * TILE;
const yStart = a.y;
t = drive(g, t, 1200, (now) => S.setInput(g, a, { x: 0, y: -1 }, now));
ok(a.y < yStart, 'pushed north');
ok(a.y >= 32 * TILE + R.PLAYER_R - 1, `stopped by the hall wall (y=${Math.round(a.y)})`);
ok(!inWall(a), 'never inside a wall');

// ---------------------------------------------------------------- stairs
const st = STAIR_LINKS[0];
const nearStair = tileCenter(st.a[0] - 1, st.a[1]);
a.x = nearStair.x;
a.y = nearStair.y;
t = drive(g, t, 600, (now) => S.setInput(g, a, { x: 1, y: 0 }, now));
eq(MAP.areaAtWorld(a.x, a.y)?.sub, '2F', 'stairwell carried the player up to the 2F E-hall inset');
ok(R.dist(a.x, a.y, (st.b[0] + 0.5) * TILE, (st.b[1] + 0.5) * TILE) < 220, 'landed at the linked stair');

// ---------------------------------------------------------------- pings
const g2 = S.newRoom('PING');
const a2 = S.addPlayer(g2, { name: 'A2' }).player;
const b2 = S.addPlayer(g2, { name: 'B2' }).player;
g2.hostId = a2.id;
let t2 = Date.now();
S.startMatch(g2, t2);
t2 += R.COUNTDOWN_MS + 60;
S.advance(g2, t2);
a2.x = 20 * TILE; a2.y = 33.5 * TILE;
b2.x = 60 * TILE; b2.y = 33.5 * TILE;
t2 = drive(g2, t2, 40000, (now) => {
  a2.lastSeenAt = now; b2.lastSeenAt = now;
  S.setInput(g2, a2, { x: 0, y: 0 }, now);
  S.setInput(g2, b2, { x: 0, y: 0 }, now);
});
const pingsToB = g2.log.filter((e) => e.k === 'ping' && e.to === b2.id);
const pingsToA = g2.log.filter((e) => e.k === 'ping' && e.to === a2.id);
ok(pingsToB.length >= 2, `b received ${pingsToB.length} pings about a`);
ok(pingsToA.length >= 2, `a received ${pingsToA.length} pings about b`);
const sample = pingsToB[pingsToB.length - 1];
ok(Number.isFinite(sample.x) && Number.isFinite(sample.y), 'ping carries a position');
ok(a2.lastPing && a2.lastPing.r >= 0, 'ping records uncertainty radius');
ok(pingsToB.every((e) => Math.abs(e.x - 20 * TILE) < 400), 'ping lands near the player');

// ---------------------------------------------------------------- interrogation + catch
const g3 = S.newRoom('CATCH');
const atk = S.addPlayer(g3, { name: 'ATK' }).player;
const vic = S.addPlayer(g3, { name: 'VIC' }).player;
g3.hostId = atk.id;
let t3 = Date.now();
S.startMatch(g3, t3);
t3 += R.COUNTDOWN_MS + 60;
S.advance(g3, t3);
atk.x = 20 * TILE; atk.y = 33.5 * TILE;
vic.x = atk.x + 26; vic.y = atk.y;

const hold = (now) => {
  atk.lastSeenAt = now; vic.lastSeenAt = now;
  S.setInput(g3, atk, { x: 0, y: 0, grab: true }, now);
  S.setInput(g3, vic, { x: 0, y: 0 }, now);
  vic.x = atk.x + 26; vic.y = atk.y;
};
t3 = drive(g3, t3, 5000, hold);
eq(atk.inter.digits, R.CODE_LEN, 'all four digits leaked while grabbing');
eq(g3.log.filter((e) => e.k === 'digit' && e.to === atk.id).length, 4, 'four digit events');
eq(g3.log.filter((e) => e.k === 'leak' && e.to === vic.id).length, 4, 'victim is warned of each leaked digit');

// wrong code locks the keypad
const wrong = String((Number(vic.code) + 1111) % 10000).padStart(4, '0');
const bad = S.confirmCode(g3, atk, wrong === vic.code ? '0000' : wrong, t3);
ok(bad.error, 'wrong code rejected');
ok(atk.inter.lockUntil > t3, 'wrong code locks the keypad');
eq(atk.inter.digits, 0, 'wrong code resets leaked digits');

// re-interrogate after the lock, then confirm with the real code
t3 = drive(g3, t3, R.WRONG_CODE_LOCK_MS + 200, hold);
t3 = drive(g3, t3, 5200, hold);
eq(atk.inter.digits, R.CODE_LEN, 'digits leak again after lockout');
const coinsBefore = atk.coins;
const good = S.confirmCode(g3, atk, vic.code, t3);
ok(good.ok, `correct code catches the target (${good.error || ''})`);
ok(atk.coins > coinsBefore, `attacker banked the bounty (+${Math.round(atk.coins - coinsBefore)})`);
ok(vic.ghostUntil > t3, 'victim is ghosted');
ok(atk.catches === 1 && vic.deaths === 1, 'catch statistics recorded');
const tagged = g3.log.find((e) => e.k === 'tagged' && e.to === vic.id);
ok(!!tagged, 'victim receives a tagged event');

// victim respawns after the ghost window, away from the attacker
let t4 = drive(g3, t3, R.GHOST_MS + 400, (now) => { atk.lastSeenAt = now; vic.lastSeenAt = now; });
ok(vic.ghostUntil === 0, 'victim respawned');
ok(vic.hp === 100, 'respawn restores hp');
ok(R.dist(vic.x, vic.y, atk.x, atk.y) > 200, 'respawn is far from the attacker');
ok(!inWall(vic), 'respawn is on floor');

// ---------------------------------------------------------------- zone shrink
const g4 = S.newRoom('ZONE');
const z1 = S.addPlayer(g4, { name: 'Z1' }).player;
const z2 = S.addPlayer(g4, { name: 'Z2' }).player;
g4.hostId = z1.id;
let tz = Date.now();
S.startMatch(g4, tz);
tz += R.COUNTDOWN_MS + 60;
S.advance(g4, tz);
const r0 = g4.zone.r;
z1.x = 20 * TILE; z1.y = 33.5 * TILE;   // near the centre
z2.x = 12 * TILE; z2.y = 12 * TILE;     // main gym corner
tz = drive(g4, tz, 240000, (now) => {
  z1.lastSeenAt = now; z2.lastSeenAt = now;
  S.setInput(g4, z1, { x: 0, y: 0 }, now);
  S.setInput(g4, z2, { x: 0, y: 0 }, now);
});
ok(g4.zone.r < r0 * 0.8, `zone shrinks over time (${Math.round(r0)} -> ${Math.round(g4.zone.r)})`);
eq(g4.phase, 'hunt', 'still hunting at 4 minutes');
ok(z2.hp < 100 || z2.ghostUntil > 0 || z2.deaths > 0, 'player left outside the zone takes damage');
ok(g4.log.some((e) => e.k === 'zoneout' && e.to === z2.id), 'outside-zone warning delivered');

// ---------------------------------------------------------------- wake from sleep
const before = g4.tickAt;
S.advance(g4, tz + 60000);
ok(g4.tickAt >= before, 'a 60s Cinderblock-lid nap does not stall the sim');
ok(g4.tickAt <= tz + 60001, 'sim clock catches up to wall clock');

// ---------------------------------------------------------------- bots
const g5 = S.newRoom('BOTS');
const h = S.addPlayer(g5, { name: 'HUMAN' }).player;
g5.hostId = h.id;
S.addBot(g5);
S.addBot(g5);
eq(g5.order.length, 3, 'two bots joined');
let tb = Date.now();
S.startMatch(g5, tb);
tb += R.COUNTDOWN_MS + 60;
S.advance(g5, tb);
const bots = Object.values(g5.players).filter((p) => p.bot);
const startPos = bots.map((p) => ({ x: p.x, y: p.y }));
tb = drive(g5, tb, 30000, (now) => {
  h.lastSeenAt = now;
  S.setInput(g5, h, { x: 0, y: 0 }, now);
  for (const p of Object.values(g5.players)) p.lastSeenAt = now;
});
const moved = bots.filter((p, i) => R.dist(p.x, p.y, startPos[i].x, startPos[i].y) > 60);
ok(moved.length >= 1, `${moved.length}/2 bots navigated the school`);
for (const p of Object.values(g5.players)) {
  ok(!inWall(p), `${p.name} stayed on walkable floor`);
  ok(p.x >= 0 && p.y >= 0 && p.x < MAP_W * TILE && p.y < MAP_H * TILE, `${p.name} inside map bounds`);
}

// ---------------------------------------------------------------- snapshot
const snap = S.view(g5, h, 0, tb);
ok(Array.isArray(snap.players) && snap.players.length === 3, 'snapshot lists all players');
ok(snap.me && snap.me.code && snap.me.code.length === 4, 'own 4-digit code in snapshot');
ok(snap.me.target && snap.me.target.id, 'target card present');
ok(snap.me.hunter && snap.me.hunter.id, 'hunter card present');
ok(typeof snap.zone.r === 'number', 'zone in snapshot');
const far = snap.players.find((p) => p.id !== h.id);
ok(far && (far.x === null || R.dist(far.x, far.y, h.x, h.y) < R.SEE_RANGE + 1), 'distant players are not located');
ok(!('token' in snap.me), 'session token never leaves the server');
const ev = snap.log.find((e) => e.to !== undefined);
ok(ev === undefined, 'targeted event fields are stripped');

// ---------------------------------------------------------------- match end
let te = Date.now();
const g6 = S.newRoom('END');
S.addPlayer(g6, { name: 'ONE' });
S.addPlayer(g6, { name: 'TWO' });
g6.hostId = g6.order[0];
S.startMatch(g6, te);
te += R.COUNTDOWN_MS + 60;
S.advance(g6, te);
const g6a = g6.players[g6.order[0]];
g6a.coins = 500;
S.advance(g6, te + R.MATCH_MS + 1000);
eq(g6.phase, 'over', 'match ends on the clock');
eq(g6.winnerId, g6a.id, 'highest score wins');
const endSnap = S.view(g6, g6a, 0, te + R.MATCH_MS + 1000);
ok(Array.isArray(endSnap.board) && endSnap.board[0].coins === 500, 'final board sorted by coins');

// ---------------------------------------------------------------- finale: nobody off floor, ever
let tFinal = te + R.MATCH_MS + 2000;
let offFloor = 0;
for (let i = 0; i < 300; i++) {
  tFinal += 100;
  for (const p of Object.values(g6.players)) p.lastSeenAt = tFinal;
  S.advance(g6, tFinal);
  for (const p of Object.values(g6.players)) if (inWall(p)) offFloor++;
}
eq(offFloor, 0, 'no player ever clipped through geometry');

console.log(`\nAll ${checks} simulation checks passed.`);
