// SyossetStalk — HTTP API on a Cloudflare Worker (D1 backed, no timers, no websockets).
import {
  newRoom, addPlayer, addBot, removePlayer, startMatch, advance, view,
  setInput, confirmCode, usePowerup, newCode, scoreboard, resetToLobby, MAP,
} from './sim.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

const SCHEMA = `CREATE TABLE IF NOT EXISTS rooms (
  code TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  state TEXT NOT NULL,
  updated_at INTEGER NOT NULL
)`;

let schemaPromise = null;
function ensureSchema(db) {
  if (!schemaPromise) {
    schemaPromise = db.prepare(SCHEMA).run().catch((err) => {
      schemaPromise = null;
      throw err;
    });
  }
  return schemaPromise;
}

const changesOf = (r) => Number(r?.meta?.changes ?? r?.changes ?? 0);

async function loadRoom(db, code) {
  const row = await db.prepare('SELECT version, state FROM rooms WHERE code = ?').bind(code).first();
  if (!row) return null;
  try {
    return { version: Number(row.version), game: JSON.parse(row.state) };
  } catch {
    return null;
  }
}

async function insertRoom(db, code, game, now) {
  try {
    await db.prepare('INSERT INTO rooms (code, version, state, updated_at) VALUES (?, 0, ?, ?)')
      .bind(code, JSON.stringify(game), now).run();
    return true;
  } catch {
    return false;
  }
}

async function saveRoom(db, code, version, game, now) {
  const res = await db.prepare('UPDATE rooms SET version = ?, state = ?, updated_at = ? WHERE code = ? AND version = ?')
    .bind(version + 1, JSON.stringify(game), now, code, version).run();
  return changesOf(res) > 0;
}

// Read-modify-write with optimistic concurrency; retries when another player won the race.
async function mutate(db, code, fn) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const rec = await loadRoom(db, code);
    if (!rec) return { status: 404, body: { error: 'No room with that code' } };
    const now = Date.now();
    const { game } = rec;
    const out = fn(game, now) || {};
    if (out.status && out.status >= 400) return out;
    const ok = await saveRoom(db, code, rec.version, game, now);
    if (ok) return { ...out, game, now, saved: true };
  }
  return { status: 409, body: { error: 'Room is busy — retry' } };
}

function auth(game, pid, token) {
  const p = pid && game.players[pid];
  if (!p || !token || p.token !== token) return null;
  return p;
}

async function readBody(request) {
  try {
    const text = await request.text();
    if (!text) return {};
    if (text.length > 20000) return null;
    const v = JSON.parse(text);
    return typeof v === 'object' && v ? v : {};
  } catch {
    return null;
  }
}

function sanitizeName(n) {
  return String(n || '').replace(/[^\w \-'.]/g, '').trim().slice(0, 12).toUpperCase() || 'RUNNER';
}

async function api(request, env, url) {
  const path = url.pathname;
  const db = env.DB;
  if (!db) return json({ error: 'No database bound' }, 500);
  try {
    await ensureSchema(db);
    const body = request.method === 'POST' ? await readBody(request) : {};
    if (body === null) return json({ error: 'Bad request body' }, 400);
    const code = String(body.code || '').toUpperCase().slice(0, 6);

    if (path === '/api/health') {
      return json({ ok: true, t: Date.now(), map: { w: MAP.w, h: MAP.h, walls: MAP.wallTiles.length } });
    }

    if (path === '/api/create') {
      const now = Date.now();
      if (Math.random() < 0.2) {
        db.prepare('DELETE FROM rooms WHERE updated_at < ?').bind(now - 6 * 3600 * 1000).run().catch(() => {});
      }
      for (let i = 0; i < 16; i++) {
        const roomCode = newCode();
        const game = newRoom(roomCode);
        const res = addPlayer(game, { name: sanitizeName(body.name) });
        if (res.error) return json({ error: res.error }, 400);
        game.hostId = res.player.id;
        if (await insertRoom(db, roomCode, game, now)) {
          return json({
            code: roomCode,
            pid: res.player.id,
            token: res.player.token,
            state: view(game, res.player, 0, now),
          });
        }
      }
      return json({ error: 'Could not allocate a room, try again' }, 503);
    }

    if (path === '/api/join') {
      if (!code) return json({ error: 'Enter a room code' }, 400);
      const out = await mutate(db, code, (game, now) => {
        if (game.phase === 'over') return { status: 400, body: { error: 'That match has already ended' } };
        if (game.phase !== 'lobby' && game.order.length >= 8) return { status: 400, body: { error: 'Room is full' } };
        const res = addPlayer(game, { name: sanitizeName(body.name) });
        if (res.error) return { status: 400, body: { error: res.error } };
        return { body: { code, pid: res.player.id, token: res.player.token }, p: res.player };
      });
      if (!out.saved) return json(out.body, out.status);
      return json({ ...out.body, state: view(out.game, out.p, 0, out.now) });
    }

    if (path === '/api/poll') {
      if (!code) return json({ error: 'Missing room code' }, 400);
      const since = Math.max(0, Number(body.since) || 0);
      const out = await mutate(db, code, (game, now) => {
        const p = auth(game, body.pid, body.token);
        if (!p) return { status: 403, body: { error: 'Session expired — rejoin' } };
        p.lastSeenAt = now;
        if (game.phase === 'hunt' || game.phase === 'countdown') setInput(game, p, body.input, now);
        advance(game, now);
        return { p };
      });
      if (!out.saved) return json(out.body, out.status);
      return json(view(out.game, out.p, since, out.now));
    }

    if (path === '/api/start') {
      const out = await mutate(db, code, (game, now) => {
        const p = auth(game, body.pid, body.token);
        if (!p) return { status: 403, body: { error: 'Session expired' } };
        if (game.hostId !== p.id) return { status: 403, body: { error: 'Only the host can start' } };
        const res = startMatch(game, now);
        if (res.error) return { status: 400, body: { error: res.error } };
        return { body: { ok: true } };
      });
      return json(out.body || { ok: true }, out.status || 200);
    }

    if (path === '/api/rematch') {
      const out = await mutate(db, code, (game, now) => {
        const p = auth(game, body.pid, body.token);
        if (!p) return { status: 403, body: { error: 'Session expired' } };
        if (game.hostId !== p.id) return { status: 403, body: { error: 'Only the host can restart' } };
        if (game.phase !== 'over') return { status: 400, body: { error: 'Match still running' } };
        resetToLobby(game, now);
        return { body: { ok: true } };
      });
      return json(out.body || { ok: true }, out.status || 200);
    }

    if (path === '/api/bot') {
      const out = await mutate(db, code, (game, now) => {
        const p = auth(game, body.pid, body.token);
        if (!p) return { status: 403, body: { error: 'Session expired' } };
        if (game.hostId !== p.id) return { status: 403, body: { error: 'Only the host can manage bots' } };
        if (body.remove) {
          const b = game.players[String(body.remove)];
          if (b && b.bot) removePlayer(game, b.id);
          return { body: { ok: true } };
        }
        const res = addBot(game);
        if (res.error) return { status: 400, body: { error: res.error } };
        return { body: { ok: true, id: res.player.id } };
      });
      return json(out.body || { ok: true }, out.status || 200);
    }

    if (path === '/api/remove') {
      const out = await mutate(db, code, (game) => {
        const p = auth(game, body.pid, body.token);
        if (!p) return { status: 403, body: { error: 'Session expired' } };
        if (game.hostId !== p.id) return { status: 403, body: { error: 'Only the host can kick' } };
        const target = game.players[String(body.target)];
        if (target && !target.bot) return { status: 400, body: { error: 'Only bots can be removed' } };
        if (target) removePlayer(game, target.id);
        return { body: { ok: true } };
      });
      return json(out.body || { ok: true }, out.status || 200);
    }

    if (path === '/api/leave') {
      const out = await mutate(db, code, (game) => {
        const p = auth(game, body.pid, body.token);
        if (p) removePlayer(game, p.id);
        return { body: { ok: true } };
      });
      return json(out.body || { ok: true }, out.status || 200);
    }

    if (path === '/api/confirm') {
      const digits = String(body.digits || '').replace(/\D/g, '').slice(0, 4);
      const out = await mutate(db, code, (game, now) => {
        const p = auth(game, body.pid, body.token);
        if (!p) return { status: 403, body: { error: 'Session expired' } };
        advance(game, now);
        const res = confirmCode(game, p, digits, now);
        if (res.error) return { body: { ok: false, error: res.error } };
        return { body: { ok: true, reward: res.reward } };
      });
      return json(out.body || { ok: false }, out.status || 200);
    }

    if (path === '/api/use') {
      const kind = String(body.kind || '');
      const out = await mutate(db, code, (game, now) => {
        const p = auth(game, body.pid, body.token);
        if (!p) return { status: 403, body: { error: 'Session expired' } };
        advance(game, now);
        const res = usePowerup(game, p, kind, now);
        if (res.error) return { body: { ok: false, error: res.error } };
        return { body: { ok: true } };
      });
      return json(out.body || { ok: false }, out.status || 200);
    }

    if (path === '/api/scores') {
      const rec = await loadRoom(db, code);
      if (!rec) return json({ error: 'No room' }, 404);
      return json({ board: scoreboard(rec.game, Date.now()) });
    }

    return json({ error: 'Unknown endpoint' }, 404);
  } catch (err) {
    return json({ error: 'Server error', detail: String(err && err.message || err) }, 500);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return api(request, env, url);
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Not found', { status: 404 });
  },
};
