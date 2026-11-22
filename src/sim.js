// SyossetStalk — authoritative game simulation.
// Pure-ish: mutate a plain room object. No timers, no I/O. The Worker advances it on every
// request from wall-clock time, so a sleeping Chromebook cannot pause the match.
import {
  buildMap, tileCenter, TILE, MAP_W, MAP_H, SPAWNS, DROP_SPOTS,
  moveCircle, findPath, circleBlocked, solidAtWorld,
} from '../public/shared/map.js';
import * as R from '../public/shared/rules.js';

export const MAP = buildMap();
const ZONE_CX = 52 * TILE;
const ZONE_CY = 33.5 * TILE;
const STEP_MS = 100;
const MAX_STEPS = 240;

const uid = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12);
const hex = (n) => Array.from({ length: n }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
const tileOf = (p) => [Math.floor(p.x / TILE), Math.floor(p.y / TILE)];

export function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join('');
}

export function newRoom(code) {
  return {
    v: 1,
    code,
    createdAt: Date.now(),
    tickAt: Date.now(),
    phase: 'lobby',
    startAt: 0,
    startedAt: 0,
    endsAt: 0,
    seq: 0,
    log: [],
    order: [],
    players: {},
    drops: DROP_SPOTS.map((s, i) => ({
      i, tx: s[0], ty: s[1],
      x: (s[0] + 0.5) * TILE, y: (s[1] + 0.5) * TILE,
      readyAt: 0,
    })),
    crates: [],
    zone: { x: ZONE_CX, y: ZONE_CY, r: R.ZONE_R0 },
    winnerId: null,
    botSeq: 0,
  };
}

function emit(state, now, ev) {
  ev.s = ++state.seq;
  ev.t = now;
  state.log.push(ev);
  if (state.log.length > 300) state.log.splice(0, state.log.length - 300);
  return ev;
}

function feed(state, now, msg, tone = 'info') {
  emit(state, now, { k: 'feed', msg, tone });
}

function normalizeRing(state) {
  state.order = state.order.filter((id) => state.players[id]);
  const n = state.order.length;
  for (let i = 0; i < n; i++) {
    const p = state.players[state.order[i]];
    p.targetId = n > 1 ? state.order[(i + 1) % n] : null;
    p.hunterId = n > 1 ? state.order[(i - 1 + n) % n] : null;
  }
}

function makePlayer(state, { name, bot = false, token = null }) {
  const taken = new Set(Object.values(state.players).map((p) => p.color));
  const color = R.COLORS.find((c) => !taken.has(c)) || R.COLORS[Object.keys(state.players).length % R.COLORS.length];
  const p = {
    id: uid(),
    token: token || hex(16),
    name: (name || 'RUNNER').toUpperCase().slice(0, 12),
    color,
    bot,
    joinedAt: Date.now(),
    x: ZONE_CX,
    y: ZONE_CY,
    dirX: 0,
    dirY: 1,
    input: { x: 0, y: 0, sneak: false, sprint: false, grab: false, at: 0 },
    hp: R.MAX_HP,
    stamina: R.STAMINA_MAX,
    coins: 0,
    bounty: R.BASE_BOUNTY,
    code: R.randomCode(),
    inv: [],
    noise: 0,
    dormant: false,
    outside: false,
    nextPingAt: 0,
    pingGhosts: 0,
    pingJam: 0,
    sonarUntil: 0,
    boostUntil: 0,
    inter: { prog: 0, digits: 0, armedUntil: 0, lockUntil: 0, leakUntil: 0, tid: null },
    ghostUntil: 0,
    invulnUntil: 0,
    lastHurtAt: 0,
    catches: 0,
    deaths: 0,
    lastSeenAt: Date.now(),
    lastPingAt: 0,
    lastPing: null,
    trail: [],
    trailAt: 0,
    path: [],
    pathI: 0,
    pathAt: 0,
    thinkAt: 0,
    wander: null,
    wanderUntil: 0,
    lastInfo: null,
    botConfirmAt: 0,
    ready: false,
  };
  return p;
}

export function addPlayer(state, opts) {
  if (state.order.length >= R.MAX_PLAYERS) return { error: 'Room is full' };
  const p = makePlayer(state, opts);
  state.players[p.id] = p;
  state.order.push(p.id);
  normalizeRing(state);

  if (state.phase === 'lobby') {
    const s = SPAWNS[state.order.length % SPAWNS.length];
    p.x = (s[0] + 0.5) * TILE;
    p.y = (s[1] + 0.5) * TILE;
    p.nextPingAt = 0;
  } else if (state.phase === 'hunt') {
    const spot = pickSpawn(state, p.id, false);
    p.x = spot.x;
    p.y = spot.y;
    p.bounty = R.BASE_BOUNTY;
    p.nextPingAt = Date.now() + 5000;
    p.invulnUntil = Date.now() + R.RESPAWN_INVULN_MS;
    emit(state, Date.now(), { k: 'feed', msg: `${p.name} dropped into the hunt`, tone: 'join' });
  }
  return { player: p };
}

export function addBot(state) {
  if (state.order.length >= R.MAX_PLAYERS) return { error: 'Room is full' };
  const used = new Set(Object.values(state.players).map((p) => p.name));
  const name = R.BOT_NAMES.find((n) => !used.has(n)) || `BOT${++state.botSeq}`;
  const res = addPlayer(state, { name, bot: true });
  if (res.player) emit(state, Date.now(), { k: 'feed', msg: `${res.player.name} (AI) is in the lobby`, tone: 'join' });
  return res;
}

export function removePlayer(state, id) {
  const p = state.players[id];
  if (!p) return;
  delete state.players[id];
  state.order = state.order.filter((x) => x !== id);
  normalizeRing(state);
  if (state.hostId === id) state.hostId = state.order[0] || null;
  if (state.phase !== 'lobby') emit(state, Date.now(), { k: 'feed', msg: `${p.name} left the building`, tone: 'out' });
}

function pickSpawn(state, forId, inZone) {
  const pos = Object.values(state.players).filter((p) => p.id !== forId && p.ghostUntil <= Date.now());
  let best = null;
  let bestScore = -1;
  for (const s of SPAWNS) {
    const x = (s[0] + 0.5) * TILE;
    const y = (s[1] + 0.5) * TILE;
    if (inZone && R.dist(x, y, state.zone.x, state.zone.y) > state.zone.r * 0.7) continue;
    let m = 1e9;
    for (const p of pos) m = Math.min(m, R.dist(x, y, p.x, p.y));
    const score = m + Math.random() * 120;
    if (score > bestScore) { bestScore = score; best = { x, y }; }
  }
  return best || { x: (SPAWNS[0][0] + 0.5) * TILE, y: (SPAWNS[0][1] + 0.5) * TILE };
}

export function startMatch(state, now = Date.now()) {
  if (state.order.length < R.MIN_PLAYERS) return { error: `Need at least ${R.MIN_PLAYERS} players` };
  state.phase = 'countdown';
  state.startAt = now + R.COUNTDOWN_MS;
  state.tickAt = now;
  state.seq = state.seq; // keep log
  Object.values(state.players).forEach((p, i) => {
    p.hp = 100;
    p.stamina = R.STAMINA_MAX;
    p.coins = 0;
    p.bounty = R.BASE_BOUNTY;
    p.code = R.randomCode();
    p.inv = [];
    p.ghostUntil = 0;
    p.catches = 0;
    p.deaths = 0;
    p.inter = { prog: 0, digits: 0, armedUntil: 0, lockUntil: 0, leakUntil: 0, tid: null };
  });
  normalizeRing(state);
  emit(state, now, { k: 'feed', msg: `Hunt starts in ${Math.round(R.COUNTDOWN_MS / 1000)}…`, tone: 'start' });
  return { ok: true };
}

function beginHunt(state, now) {
  state.phase = 'hunt';
  state.startedAt = state.startAt;
  state.endsAt = state.startAt + R.MATCH_MS;
  state.tickAt = state.startedAt;
  normalizeRing(state);
  const ids = [...state.order];
  ids.forEach((id, i) => {
    const p = state.players[id];
    const s = SPAWNS[(i * 7 + 3) % SPAWNS.length];
    p.x = (s[0] + 0.5) * TILE;
    p.y = (s[1] + 0.5) * TILE;
    p.hp = 100;
    p.stamina = R.STAMINA_MAX;
    p.ghostUntil = 0;
    p.invulnUntil = now + 2500;
    p.nextPingAt = now + 3500 + i * 1400;
    p.trail = [];
    p.lastInfo = null;
    p.path = [];
  });
  state.zone = { x: ZONE_CX, y: ZONE_CY, r: R.ZONE_R0 };
  feed(state, now, 'THE HUNT IS LIVE — everyone is somebody\'s target', 'start');
}

function endMatch(state, now) {
  state.phase = 'over';
  state.tickAt = now;
  const ranked = [...state.order].map((id) => state.players[id]).filter(Boolean)
    .sort((a, b) => b.coins - a.coins || b.catches - a.catches);
  state.winnerId = ranked[0]?.id || null;
  if (state.winnerId) {
    feed(state, now, `${state.players[state.winnerId].name} walks out with the bag`, 'end');
  }
}

// --- movement ---------------------------------------------------------------

function stepMovement(state, p, dt, now) {
  if (p.ghostUntil > now) return;
  const inp = p.input;
  const fresh = inp && now - inp.at < R.INPUT_TTL;
  let dx = fresh ? inp.x : 0;
  let dy = fresh ? inp.y : 0;
  const mag = Math.hypot(dx, dy);
  if (mag > 0.001) { dx /= Math.max(1, mag); dy /= Math.max(1, mag); }
  const moving = mag > 0.12;

  const sneaking = fresh && inp.sneak;
  const sprinting = fresh && !inp.sneak && inp.sprint && p.stamina > 0.5 && moving;
  let speed = R.WALK;
  if (sneaking) speed *= R.SNEAK_MULT;
  else if (sprinting) speed *= R.SPRINT_MULT;
  if (p.boostUntil > now) speed *= R.BOOST_MULT;

  if (sprinting) p.stamina = Math.max(0, p.stamina - R.STAMINA_DRAIN * dt);
  else p.stamina = Math.min(R.STAMINA_MAX, p.stamina + R.STAMINA_REGEN * dt * (sneaking ? 0.7 : 1));

  p.noise = !moving ? 0 : sneaking ? 0.5 : sprinting ? 1.35 : 1;
  if (moving) {
    p.dirX = dx;
    p.dirY = dy;
    const res = moveCircle(MAP, p.x, p.y, dx * speed * dt, dy * speed * dt, R.PLAYER_R);
    p.x = res.x;
    p.y = res.y;
  }

  // stairwells: stepping onto a stair tile moves you to its pair once
  const t = tileOf(p);
  const key = `${t[0]},${t[1]}`;
  const st = MAP.stairAtTile(t[0], t[1]);
  if (st && p.stairTile !== key && now > (p.stairCd || 0)) {
    p.x = (st.toX + 0.5) * TILE;
    p.y = (st.toY + 0.5) * TILE;
    p.stairCd = now + R.STAIR_CD;
    p.stairTile = `${st.toX},${st.toY}`;
    p.path = [];
    emit(state, now, { k: 'stairs', to: p.id, x: p.x, y: p.y });
  } else if (!st) {
    p.stairTile = null;
  }

  if (now - p.trailAt > 900) {
    p.trailAt = now;
    p.trail.push({ x: p.x, y: p.y, t: now });
    if (p.trail.length > 14) p.trail.shift();
  }
}

// --- zone -------------------------------------------------------------------

function stepZone(state, p, dt, now) {
  const z = state.zone;
  const d = R.dist(p.x, p.y, z.x, z.y);
  const wasOutside = p.outside;
  p.outside = d > z.r;
  if (p.ghostUntil > now) return;
  if (p.outside) {
    p.hp -= R.ZONE_DPS * dt;
    p.coins = Math.max(0, p.coins - R.ZONE_COIN_DRAIN * dt);
    if (p.hp <= 0) collapse(state, p, now);
    if (!wasOutside) emit(state, now, { k: 'zoneout', to: p.id, on: true });
  } else {
    if (wasOutside) emit(state, now, { k: 'zoneout', to: p.id, on: false });
    if (now - p.lastHurtAt > 2500) p.hp = Math.min(100, p.hp + R.HP_REGEN * dt);
  }
}

function collapse(state, p, now) {
  p.hp = 0;
  p.ghostUntil = now + R.GHOST_MS * 0.8;
  p.coins = Math.round(p.coins * 0.8);
  p.deaths++;
  p.bounty = Math.max(R.BASE_BOUNTY, Math.round(p.bounty * 0.9));
  emit(state, now, { k: 'collapsed', to: p.id });
  feed(state, now, `${p.name} collapsed in the cold zone`, 'warn');
  addCrate(state, p.x, p.y, now);
}

// --- pings ------------------------------------------------------------------

function doPing(state, p, now) {
  const progress = (now - state.startedAt) / R.MATCH_MS;
  const interval = R.pingInterval(progress);
  p.nextPingAt = now + interval * (p.dormant ? 0.8 : 1) * (p.outside ? 0.7 : 1);
  const hunter = state.players[p.hunterId];
  if (!hunter || hunter.id === p.id) return;
  if (hunter.ghostUntil > now) return;

  if (p.pingGhosts > 0) {
    p.pingGhosts--;
    emit(state, now, { k: 'pingmiss', to: hunter.id, pid: p.id, name: p.name });
    emit(state, now, { k: 'selfping', to: p.id, hidden: true });
    return;
  }

  let px = p.x;
  let py = p.y;
  let r = R.pingRadius(p, now, progress);

  if (p.pingJam > 0) {
    p.pingJam--;
    const old = p.trail.find((t) => now - t.t > 8000) || p.trail[0];
    if (old) { px = old.x; py = old.y; }
    r = 0;
  } else if (r > 2) {
    const a = Math.random() * Math.PI * 2;
    const d = Math.sqrt(Math.random()) * r * 0.9;
    const cx = px + Math.cos(a) * d;
    const cy = py + Math.sin(a) * d;
    if (!solidAtWorld(MAP, cx, cy)) { px = cx; py = cy; }
  }

  p.lastPingAt = now;
  p.lastPing = { x: px, y: py, r, t: now };
  emit(state, now, { k: 'ping', to: hunter.id, x: px, y: py, r, pid: p.id, name: p.name, color: p.color });
  emit(state, now, { k: 'selfping', to: p.id, hidden: false });
  if (hunter.bot) hunter.lastInfo = { x: px, y: py, r, t: now };
}

export function sendDecoy(state, p, now) {
  const hunter = state.players[p.hunterId];
  if (!hunter) return;
  let bx = p.x;
  let by = p.y;
  for (let i = 0; i < 40; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = 500 + Math.random() * 900;
    const cx = p.x + Math.cos(a) * d;
    const cy = p.y + Math.sin(a) * d;
    if (!solidAtWorld(MAP, cx, cy)) { bx = cx; by = cy; break; }
  }
  emit(state, now, { k: 'ping', to: hunter.id, x: bx, y: by, r: 90, pid: p.id, name: p.name, color: p.color, fake: true });
  if (hunter.bot) hunter.lastInfo = { x: bx, y: by, r: 90, t: now, fake: true };
}

// --- interrogation ----------------------------------------------------------

function resetInter(p) {
  p.inter.prog = 0;
  p.inter.digits = 0;
  p.inter.armedUntil = 0;
}

function stepInterrogation(state, p, dt, now) {
  const it = p.inter;
  const target = state.players[p.targetId];
  if (it.leakUntil && now > it.leakUntil && it.digits > 0 && it.digits < R.CODE_LEN) resetInter(p);
  if (!target || p.ghostUntil > now) { resetInter(p); return; }
  if (now < it.lockUntil) return;
  const close = R.dist(p.x, p.y, target.x, target.y) <= R.CATCH_RANGE;
  const inp = p.input;
  const wants = inp && inp.grab && now - inp.at < R.INPUT_TTL;
  if (!close || !wants || target.ghostUntil > now) {
    if (it.digits > 0 && it.digits < R.CODE_LEN) it.leakUntil = now + 5000;
    it.prog = Math.max(0, it.prog - dt * 2.2);
    return;
  }
  if (it.digits >= R.CODE_LEN) return;
  it.prog += dt;
  if (it.prog >= R.INTERROG_STEP_MS / 1000) {
    it.prog = 0;
    it.digits++;
    it.leakUntil = now + 6000;
    const digit = target.code[it.digits - 1];
    emit(state, now, { k: 'digit', to: p.id, d: digit, n: it.digits, tid: target.id });
    emit(state, now, { k: 'leak', to: target.id, n: it.digits, by: p.name });
    if (it.digits >= R.CODE_LEN) {
      it.armedUntil = now + R.ARM_WINDOW_MS;
      emit(state, now, { k: 'armed', to: p.id, name: target.name });
      if (p.bot) p.botConfirmAt = now + 1500 + Math.random() * 2200;
    } else if (p.bot) {
      // bots keep grabbing automatically
    }
  }
}

export function resolveCatch(state, attacker, victim, now, silent = false) {
  const reward = Math.max(30, Math.round(victim.bounty));
  attacker.coins += reward;
  attacker.bounty = Math.min(900, attacker.bounty + 45);
  attacker.catches++;
  victim.coins = Math.round(victim.coins * 0.55);
  victim.bounty = R.BASE_BOUNTY;
  victim.deaths++;
  victim.hp = 0;
  victim.ghostUntil = now + R.GHOST_MS;
  victim.inter = { prog: 0, digits: 0, armedUntil: 0, lockUntil: 0, leakUntil: 0, tid: null };
  victim.botConfirmAt = 0;
  victim.pingGhosts = 0;
  attacker.inter = { prog: 0, digits: 0, armedUntil: 0, lockUntil: 0, leakUntil: 0, tid: null };
  attacker.botConfirmAt = 0;
  emit(state, now, { k: 'caught', to: attacker.id, name: victim.name, reward, vid: victim.id });
  emit(state, now, { k: 'tagged', to: victim.id, name: attacker.name, aid: attacker.id });
  feed(state, now, silent ? `${attacker.name} took ${victim.name}'s code` : `${attacker.name} confirmed ${victim.name}'s code — +${reward}`, 'catch');
  addCrate(state, victim.x, victim.y, now);
  return reward;
}

export function confirmCode(state, p, code, now) {
  const target = state.players[p.targetId];
  if (!target) return { error: 'You have no target' };
  if (p.ghostUntil > now) return { error: 'You are out of play' };
  if (now < p.inter.lockUntil) return { error: 'Keypad locked — try again' };
  if (target.ghostUntil > now) return { error: 'Target already tagged' };
  const close = R.dist(p.x, p.y, target.x, target.y) <= R.CATCH_RANGE;
  const armed = p.inter.digits >= R.CODE_LEN && now < p.inter.armedUntil;
  if (!armed && !close) return { error: 'Too far away — get close first' };
  if (String(code) !== target.code) {
    p.inter.lockUntil = now + R.WRONG_CODE_LOCK_MS;
    resetInter(p);
    emit(state, now, { k: 'wrong', to: p.id });
    emit(state, now, { k: 'wronged', to: target.id, by: p.name });
    return { error: 'Wrong code' };
  }
  const reward = resolveCatch(state, p, target, now);
  return { ok: true, reward };
}

// --- loot -------------------------------------------------------------------

function addCrate(state, x, y, now) {
  state.crates.push({
    id: uid(),
    x, y,
    kind: R.POWERUP_KEYS[Math.floor(Math.random() * R.POWERUP_KEYS.length)],
    expiresAt: now + 22000,
  });
  if (state.crates.length > 12) state.crates.shift();
}

function grantPower(state, p, now, kind) {
  if (p.inv.length >= R.INV_SLOTS) {
    p.coins += R.DROP_COIN_VALUE;
    emit(state, now, { k: 'loot', to: p.id, coins: R.DROP_COIN_VALUE });
  } else {
    p.inv.push(kind);
    emit(state, now, { k: 'loot', to: p.id, kind });
  }
}

function stepLoot(state, p, dt, now) {
  if (p.ghostUntil > now) return;
  for (const d of state.drops) {
    if (d.readyAt > now) continue;
    if (R.dist2(p.x, p.y, d.x, d.y) < R.DROP_PICK_R ** 2) {
      d.readyAt = now + R.DROP_RESPAWN_MS;
      const kind = R.POWERUP_KEYS[Math.floor(Math.random() * R.POWERUP_KEYS.length)];
      grantPower(state, p, now, kind);
      feed(state, now, `${p.name} hit a dead drop`, 'loot');
    }
  }
  for (let i = state.crates.length - 1; i >= 0; i--) {
    const c = state.crates[i];
    if (c.expiresAt < now) { state.crates.splice(i, 1); continue; }
    if (R.dist2(p.x, p.y, c.x, c.y) < (R.DROP_PICK_R + 6) ** 2) {
      state.crates.splice(i, 1);
      grantPower(state, p, now, c.kind);
      feed(state, now, `${p.name} scooped a crate`, 'loot');
    }
  }
}

export function usePowerup(state, p, kind, now) {
  const i = p.inv.indexOf(kind);
  if (i < 0) return { error: 'Not in inventory' };
  if (p.ghostUntil > now) return { error: 'You are out of play' };
  p.inv.splice(i, 1);
  switch (kind) {
    case 'sonar':
      p.sonarUntil = now + 6000;
      break;
    case 'ghost':
      p.pingGhosts += 2;
      break;
    case 'decoy':
      sendDecoy(state, p, now);
      break;
    case 'stim':
      p.stamina = R.STAMINA_MAX;
      p.boostUntil = now + 7000;
      break;
    case 'jam':
      p.pingJam += 1;
      break;
    default:
      return { error: 'Unknown pickup' };
  }
  emit(state, now, { k: 'used', to: p.id, kind });
  return { ok: true };
}

// --- bots -------------------------------------------------------------------

function botThink(state, b, now) {
  const target = state.players[b.targetId];
  const z = state.zone;
  const outside = R.dist(b.x, b.y, z.x, z.y) > z.r * 0.88;
  let goal = null;

  if (outside) {
    goal = [Math.floor(z.x / TILE), Math.floor(z.y / TILE)];
  } else if (target && R.dist(b.x, b.y, target.x, target.y) < R.SEE_RANGE && target.ghostUntil <= now) {
    goal = tileOf(target);
    b.lastInfo = { x: target.x, y: target.y, t: now };
  } else if (b.lastInfo && now - b.lastInfo.t < 14000) {
    goal = [Math.floor(b.lastInfo.x / TILE), Math.floor(b.lastInfo.y / TILE)];
  }

  if (!goal) {
    if (!b.wander || now > b.wanderUntil) {
      const s = SPAWNS[Math.floor(Math.random() * SPAWNS.length)];
      b.wander = s;
      b.wanderUntil = now + 6000 + Math.random() * 6000;
    }
    goal = b.wander;
  }

  const goalChanged = !b.pathGoal || b.pathGoal[0] !== goal[0] || b.pathGoal[1] !== goal[1];
  if (!b.path.length || now > b.pathAt + 2200 || (goalChanged && now > b.pathAt + 700)) {
    const found = findPath(MAP, tileOf(b), goal);
    if (found.length || !b.path.length) b.path = found;
    b.pathI = 0;
    b.pathAt = now;
    b.pathGoal = goal;
  }

  // drop waypoints we already reached
  while (b.path.length && b.pathI < b.path.length) {
    const wp = b.path[b.pathI];
    const c = tileCenter(wp[0], wp[1]);
    if (R.dist(b.x, b.y, c.x, c.y) < TILE * 0.7) b.pathI++;
    else break;
  }

  let tx = 0;
  let ty = 0;
  if (target && R.dist(b.x, b.y, target.x, target.y) < R.SEE_RANGE * 0.9) {
    tx = target.x;
    ty = target.y;
  } else if (b.path.length && b.pathI < b.path.length) {
    const wp = b.path[b.pathI];
    const c = tileCenter(wp[0], wp[1]);
    tx = c.x;
    ty = c.y;
  } else if (goal) {
    const c = tileCenter(goal[0], goal[1]);
    tx = c.x;
    ty = c.y;
  }

  let dx = tx - b.x;
  let dy = ty - b.y;
  const m = Math.hypot(dx, dy) || 1;
  dx /= m;
  dy /= m;

  // look ahead; if blocked, fan out
  const probe = 26;
  if (circleBlocked(MAP, b.x + dx * probe, b.y + dy * probe, R.PLAYER_R)) {
    const angles = [0.6, -0.6, 1.1, -1.1, 1.7, -1.7];
    let found = false;
    for (const a of angles) {
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const nx = dx * ca - dy * sa;
      const ny = dx * sa + dy * ca;
      if (!circleBlocked(MAP, b.x + nx * probe, b.y + ny * probe, R.PLAYER_R)) {
        dx = nx; dy = ny; found = true; break;
      }
    }
    if (!found) { dx = -dx; dy = -dy; }
  }

  b.input = {
    x: dx, y: dy, sneak: false,
    sprint: b.stamina > 30 && !outside && Math.random() > 0.35,
    grab: false,
    at: now,
  };

  const close = target && R.dist(b.x, b.y, target.x, target.y) <= R.CATCH_RANGE * 0.9;
  if (close && target.ghostUntil <= now) {
    b.input.grab = true;
    b.input.sprint = false;
    b.input.x = 0;
    b.input.y = 0;
  }

  if (b.inv.length && Math.random() < 0.01) {
    usePowerup(state, b, b.inv[0], now);
  }
}

// --- tick -------------------------------------------------------------------

function tick(state, dt, now) {
  const progress = (now - state.startedAt) / R.MATCH_MS;
  const z = R.zoneAt(progress);
  state.zone = { x: ZONE_CX, y: ZONE_CY, r: z.r };

  for (const id of state.order) {
    const p = state.players[id];
    if (!p) continue;
    p.dormant = !p.bot && now - p.lastSeenAt > R.DORMANT_MS;
    if (p.ghostUntil && now >= p.ghostUntil) respawn(state, p, now);
    if (p.bot && now >= p.thinkAt) {
      p.thinkAt = now + 180 + Math.random() * 120;
      botThink(state, p, now);
    }
    stepMovement(state, p, dt, now);
    stepZone(state, p, dt, now);
    stepLoot(state, p, dt, now);
    stepInterrogation(state, p, dt, now);
    if (p.bot && p.botConfirmAt && now >= p.botConfirmAt) {
      p.botConfirmAt = 0;
      const t = state.players[p.targetId];
      if (t && t.ghostUntil <= now && p.inter.digits >= R.CODE_LEN) {
        resolveCatch(state, p, t, now, true);
      }
    }
    if (state.phase === 'hunt' && p.nextPingAt && now >= p.nextPingAt && p.ghostUntil <= now) {
      doPing(state, p, now);
    }
  }
}

function respawn(state, p, now) {
  const spot = pickSpawn(state, p.id, state.phase === 'hunt');
  p.x = spot.x;
  p.y = spot.y;
  p.hp = 100;
  p.stamina = R.STAMINA_MAX;
  p.ghostUntil = 0;
  p.invulnUntil = now + R.RESPAWN_INVULN_MS;
  p.code = R.randomCode();
  p.inter = { prog: 0, digits: 0, armedUntil: 0, lockUntil: 0, leakUntil: 0, tid: null };
  p.nextPingAt = now + 2500;
  p.path = [];
  p.trail = [];
  emit(state, now, { k: 'respawn', to: p.id });
}

export function resetToLobby(state, now = Date.now()) {
  state.phase = 'lobby';
  state.startAt = 0;
  state.startedAt = 0;
  state.endsAt = 0;
  state.tickAt = now;
  state.winnerId = null;
  state.crates = [];
  state.zone = { x: ZONE_CX, y: ZONE_CY, r: R.ZONE_R0 };
  state.drops.forEach((d) => { d.readyAt = 0; });
  normalizeRing(state);
  state.order.forEach((id, i) => {
    const p = state.players[id];
    if (!p) return;
    const s = SPAWNS[(i * 5 + 1) % SPAWNS.length];
    p.x = (s[0] + 0.5) * TILE;
    p.y = (s[1] + 0.5) * TILE;
    p.hp = 100;
    p.stamina = R.STAMINA_MAX;
    p.coins = 0;
    p.bounty = R.BASE_BOUNTY;
    p.inv = [];
    p.ghostUntil = 0;
    p.invulnUntil = 0;
    p.catches = 0;
    p.deaths = 0;
    p.outside = false;
    p.nextPingAt = 0;
    p.pingGhosts = 0;
    p.pingJam = 0;
    p.sonarUntil = 0;
    p.boostUntil = 0;
    p.code = R.randomCode();
    p.inter = { prog: 0, digits: 0, armedUntil: 0, lockUntil: 0, leakUntil: 0, tid: null };
    p.botConfirmAt = 0;
    p.path = [];
    p.trail = [];
    p.lastInfo = null;
    p.stairTile = null;
  });
  feed(state, now, 'Lobby reopened — the next hunt is being set up', 'start');
}

export function advance(state, now) {
  if (state.phase === 'lobby') { state.tickAt = now; return state; }
  if (state.phase === 'countdown') {
    if (now < state.startAt) { state.tickAt = now; return state; }
    beginHunt(state, now);
  }
  if (state.phase !== 'hunt') { state.tickAt = now; return state; }

  const stop = Math.min(now, state.endsAt);
  let cursor = Math.max(Math.min(state.tickAt, stop), state.startedAt);
  let steps = 0;
  while (cursor + STEP_MS <= stop && steps < MAX_STEPS) {
    cursor += STEP_MS;
    steps++;
    tick(state, STEP_MS / 1000, cursor);
  }
  if (steps >= MAX_STEPS) cursor = stop;
  state.tickAt = cursor;
  if (now >= state.endsAt) endMatch(state, state.endsAt);
  return state;
}

export function setInput(state, p, input, now) {
  if (!input) return;
  const nx = Number(input.x) || 0;
  const ny = Number(input.y) || 0;
  const m = Math.hypot(nx, ny);
  p.input = {
    x: m > 1 ? nx / m : nx,
    y: m > 1 ? ny / m : ny,
    sneak: !!input.sneak,
    sprint: !!input.sprint,
    grab: !!input.grab,
    at: now,
  };
  p.lastSeenAt = now;
  if (p.ghostUntil > now) p.stamina = R.STAMINA_MAX;
}

// --- view -------------------------------------------------------------------

function pub(p, now, reveal) {
  return {
    id: p.id, name: p.name, color: p.color, bot: p.bot,
    x: reveal ? Math.round(p.x * 10) / 10 : null,
    y: reveal ? Math.round(p.y * 10) / 10 : null,
    hp: Math.round(p.hp), coins: Math.round(p.coins), bounty: Math.round(p.bounty),
    ghost: p.ghostUntil > now,
    sneak: p.noise > 0 && p.noise <= 0.6,
    sprint: p.noise >= 1.2,
    dirX: p.dirX, dirY: p.dirY,
    active: !p.dormant,
    catches: p.catches,
    targetId: p.targetId,
  };
}

export function view(state, me, since, now) {
  const progress = state.phase === 'hunt' ? R.clamp((now - state.startedAt) / R.MATCH_MS, 0, 1) : 0;
  const target = me && state.players[me.targetId];
  const hunter = me && state.players[me.hunterId];
  const sonar = me && me.sonarUntil > now;

  const visible = [];
  if (me) {
    for (const id of state.order) {
      const p = state.players[id];
      if (!p) continue;
      const isMe = p.id === me.id;
      const ghost = p.ghostUntil > now;
      const d = R.dist(me.x, me.y, p.x, p.y);
      const reveal = isMe || (!ghost && (d < R.SEE_RANGE || (sonar && target && p.id === target.id)));
      const o = pub(p, now, true);
      if (!reveal) { o.x = null; o.y = null; }
      visible.push(o);
    }
  }

  const log = state.log
    .filter((e) => e.s > since && (!e.to || (me && e.to === me.id)))
    .map((e) => {
      const { to, ...rest } = e;
      return rest;
    });

  const out = {
    t: now,
    seq: state.seq,
    code: state.code,
    phase: state.phase,
    startAt: state.startAt,
    endsAt: state.endsAt,
    startedAt: state.startedAt,
    timeLeft: state.phase === 'hunt' ? Math.max(0, state.endsAt - now) : state.phase === 'countdown' ? state.startAt - now : 0,
    progress,
    zone: { x: state.zone.x, y: state.zone.y, r: state.zone.r },
    order: state.order.slice(),
    players: visible,
    drops: state.drops.map((d) => ({ i: d.i, x: d.x, y: d.y, up: d.readyAt <= now })),
    crates: state.crates.map((c) => ({ id: c.id, x: c.x, y: c.y, kind: c.kind, expiresAt: c.expiresAt })),
    hostId: state.hostId,
    log,
    winnerId: state.winnerId,
  };

  if (state.phase === 'over') {
    out.board = state.order.map((id) => state.players[id]).filter(Boolean)
      .map((p) => ({ id: p.id, name: p.name, color: p.color, coins: Math.round(p.coins), catches: p.catches, deaths: p.deaths, bot: p.bot }))
      .sort((a, b) => b.coins - a.coins || b.catches - a.catches);
  }

  if (me) {
    out.me = {
      ...pub(me, now, true),
      code: me.code,
      inv: me.inv.slice(),
      stamina: Math.round(me.stamina),
      outside: me.outside,
      dormant: me.dormant,
      boosting: me.boostUntil > now,
      pingedAt: me.lastPingAt,
      nextPingIn: Math.max(0, (me.nextPingAt || now) - now),
      pingsHidden: me.pingGhosts,
      sonar: sonar,
      ghostIn: Math.max(0, me.ghostUntil - now),
      invuln: me.invulnUntil > now,
      inter: {
        digits: me.inter.digits,
        prog: me.inter.prog,
        armedIn: Math.max(0, me.inter.armedUntil - now),
        lockedIn: Math.max(0, me.inter.lockUntil - now),
        leakIn: Math.max(0, (me.inter.leakUntil || 0) - now),
      },
      inRange: target ? R.dist(me.x, me.y, target.x, target.y) <= R.CATCH_RANGE : false,
      target: target ? {
        id: target.id, name: target.name, color: target.color,
        bounty: Math.round(target.bounty), bot: target.bot,
        ping: target.lastPing,
        x: sonar ? target.x : null,
        y: sonar ? target.y : null,
        ghost: target.ghostUntil > now,
        active: !target.dormant,
      } : null,
      hunter: hunter ? {
        id: hunter.id, name: hunter.name, color: hunter.color,
        near: R.dist(me.x, me.y, hunter.x, hunter.y) < 460,
        dist: Math.round(R.dist(me.x, me.y, hunter.x, hunter.y)),
      } : null,
      respawnIn: me.ghostUntil > now ? me.ghostUntil - now : 0,
    };
  }
  return out;
}

export function scoreboard(state, now) {
  return state.order.map((id) => state.players[id]).filter(Boolean)
    .map((p) => ({ id: p.id, name: p.name, color: p.color, coins: Math.round(p.coins), catches: p.catches, deaths: p.deaths, bot: p.bot }))
    .sort((a, b) => b.coins - a.coins);
}

export { ZONE_CX, ZONE_CY };
