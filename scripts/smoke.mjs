// HTTP smoke test against a running dev server: room lifecycle, hunt start, movement,
// pings, bad-session rejection, wrong-code handling. `node scripts/smoke.mjs`
const BASE = process.env.BASE || 'http://127.0.0.1:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let checks = 0;
const ok = (cond, msg) => {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  checks++;
  console.log(`  ok  ${msg}`);
};

async function post(path, body) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, body: data };
}

const health = await fetch(BASE + '/api/health').then((r) => r.json());
ok(health.ok === true, 'health endpoint responds');
ok(health.map.w === 104 && health.map.h === 92, 'map dimensions reported');

const created = await post('/api/create', { name: 'Smoke Test' });
ok(created.status === 200 && /^[A-Z0-9]{4}$/.test(created.body.code), `created room ${created.body.code}`);
const { code, pid, token } = created.body;
const sess = { code, pid, token };

let snap = created.body.state;
ok(snap.phase === 'lobby', 'fresh room is in the lobby');
ok(snap.me && snap.me.code && snap.me.code.length === 4, 'player got a 4-digit code');
ok(snap.me.target === null, 'no target until the ring is formed');

const bot = await post('/api/bot', sess);
ok(bot.status === 200, 'host can add an AI stalker');

const started = await post('/api/start', sess);
ok(started.status === 200, 'host can start the hunt');

const t0 = Date.now();
let sawHunt = false;
while (Date.now() - t0 < 12000) {
  const r = await post('/api/poll', { ...sess, input: {}, since: snap.seq });
  snap = r.body;
  if (snap.phase === 'hunt') { sawHunt = true; break; }
  await sleep(700);
}
ok(sawHunt, 'countdown rolls into a live hunt');
ok(snap.me.target && snap.me.target.id, 'target assigned');
ok(snap.me.hunter && snap.me.hunter.id, 'hunter assigned');
ok(snap.zone && snap.zone.r > 0, 'safe zone active');

// movement
const x0 = snap.me.x;
for (let i = 0; i < 4; i++) {
  await sleep(500);
  const r = await post('/api/poll', { ...sess, input: { x: 1, y: 0 }, since: snap.seq });
  snap = r.body;
}
ok(Math.abs(snap.me.x - x0) > 20, `server-authoritative movement (Δx ${Math.round(snap.me.x - x0)})`);

// ping eventually arrives from the AI (mutual ring: bot is target and hunter)
let ping = null;
const tp = Date.now();
while (Date.now() - tp < 30000) {
  const r = await post('/api/poll', { ...sess, input: { x: 0, y: 0 }, since: snap.seq });
  snap = r.body;
  const ev = (snap.log || []).find((e) => e.k === 'ping');
  if (ev) { ping = ev; break; }
  for (const p of snap.players) if (p.id !== snap.me.id && p.x != null) ping = { x: p.x, y: p.y, name: p.name };
  if (ping) break;
  await sleep(900);
}
ok(!!ping, 'radar blips arrive for the target');

// wrong code is rejected
const wrong = await post('/api/confirm', { ...sess, digits: '0000' });
ok(wrong.status === 200 && wrong.body.ok === false, `wrong/missing code rejected (${wrong.body.error})`);

// using an item you do not have fails cleanly
const missing = ['sonar', 'ghost', 'decoy', 'stim', 'jam'].find((k) => !snap.me.inv.includes(k));
const use = await post('/api/use', { ...sess, kind: missing });
ok(use.status === 200 && use.body.ok === false, 'using an unheld power-up is refused');

// a bad session cannot read the room
const bad = await post('/api/poll', { code, pid, token: 'deadbeef', input: {}, since: 0 });
ok(bad.status === 403, 'stale token is rejected');

// a second human can join mid-hunt and is given a target
const joined = await post('/api/join', { code, name: 'Latecomer' });
ok(joined.status === 200 && joined.body.pid, 'second player joined');
const ring = await post('/api/poll', { ...sess, input: {}, since: snap.seq });
const targets = ring.body.players.map((p) => p.targetId);
ok(new Set(targets).size === ring.body.players.length, 'ring is a permutation (nobody tagged twice)');
ok(ring.body.order.length === 3, 'ring holds all three players');

// rematch is refused while the match is live
const early = await post('/api/rematch', sess);
ok(early.status === 400, 'rematch refused mid-match');

// bad room code
const nowhere = await post('/api/join', { code: 'ZZZZ', name: 'Nobody' });
ok(nowhere.status === 404, 'joining a missing room 404s');

console.log(`\nAll ${checks} HTTP checks passed against ${BASE}`);
