// SyossetStalk client: screens, poll loop, prediction, HUD, interrogation keypad.
import { createRenderer } from './render.js';
import { createInput } from './input.js';
import { createApi, loadSession, saveSession } from './net.js';
import { buildMap, moveCircle, TILE } from '../shared/map.js';
import * as R from '../shared/rules.js';

const MAP = buildMap();
const $ = (id) => document.getElementById(id);
const now = () => performance.now();

const app = {
  api: null,
  snap: null,
  since: 0,
  mode: null,
  self: { x: 52 * TILE, y: 33.5 * TILE, dirX: 0, dirY: 1, init: false, stairTile: null, stairCd: 0 },
  pings: [],
  digits: [null, null, null, null],
  leakAt: 0,
  leakCount: 0,
  armedUntil: 0,
  invSig: '',
  feedIds: 0,
  errCount: 0,
  pollTimer: null,
  pollBusy: false,
  lastSnapAt: 0,
  snapAt: 0,
  keypad: { open: false, entered: '', locked: false },
  seenSeq: 0,
};

const renderer = createRenderer($('game'), $('minimap'));
const input = createInput();

// ─────────────────────────────── toasts / feed ───────────────────────────────
function toast(text, cls = '') {
  const wrap = $('toasts');
  if (!wrap) return;
  const d = document.createElement('div');
  d.className = 'toast ' + cls;
  d.textContent = text;
  wrap.appendChild(d);
  while (wrap.children.length > 3) wrap.removeChild(wrap.firstChild);
  setTimeout(() => d.remove(), 3400);
}

function feed(text, tone = '') {
  const wrap = $('feed');
  if (!wrap) return;
  const d = document.createElement('div');
  d.className = 'feed-item ' + tone;
  d.textContent = text;
  wrap.appendChild(d);
  while (wrap.children.length > 4) wrap.removeChild(wrap.firstChild);
  setTimeout(() => d.remove(), 9000);
}

// ─────────────────────────────── screens ───────────────────────────────
function setMode(mode) {
  if (app.mode === mode) return;
  app.mode = mode;
  document.body.className = 'mode-' + mode;
  for (const s of document.querySelectorAll('.screen')) s.classList.remove('active');
  const id = { title: 'screen-title', lobby: 'screen-lobby', over: 'screen-over' }[mode];
  if (id) $(id).classList.add('active');
  $('hud').classList.toggle('hidden', mode !== 'game');
  if (mode === 'over') renderOver(app.snap);
  if (mode === 'lobby') renderLobby(app.snap);
  if (mode === 'title') {
    input.reset();
    requestAnimationFrame(() => renderer.drawOverview($('titlePreview')));
  }
  if (mode === 'lobby') requestAnimationFrame(() => renderer.drawOverview($('lobbyPreview')));
}

function showFatal(msg) {
  $('fatalMsg').textContent = String(msg);
  $('fatal').classList.remove('hidden');
}

// ─────────────────────────────── polling ───────────────────────────────
async function pollLoop() {
  clearTimeout(app.pollTimer);
  if (!app.api) return;
  const started = now();
  let snap = null;
  try {
    snap = await app.api.poll(input.read(), app.since);
    app.errCount = 0;
    $('connWarn').classList.add('hidden');
  } catch (err) {
    app.errCount++;
    if (err.status === 403 || err.status === 404) {
      saveSession(null);
      app.api = null;
      setMode('title');
      $('titleMsg').textContent = err.message || 'That room is gone.';
      $('titleMsg').className = 'msg err';
      return;
    }
    $('connWarn').classList.remove('hidden');
    if (app.errCount > 8) {
      $('titleMsg').textContent = 'Lost the server. Try again.';
      $('titleMsg').className = 'msg err';
    }
  }
  if (snap) onSnap(snap);
  const phase = app.snap?.phase;
  const interval = phase === 'hunt' || phase === 'countdown' ? 820 : phase === 'over' ? 2400 : 1100;
  const waited = now() - started;
  app.pollTimer = setTimeout(pollLoop, Math.max(120, interval - waited));
}

function onSnap(snap) {
  const prev = app.snap;
  app.snap = snap;
  app.since = snap.seq;
  app.snapAt = now();
  app.lastSnapAt = Date.now();

  if (snap.me) {
    const s = app.self;
    const d = R.dist(s.x, s.y, snap.me.x, snap.me.y);
    if (!s.init || d > 150 || snap.me.ghost || snap.phase !== 'hunt') {
      s.x = snap.me.x;
      s.y = snap.me.y;
      s.init = true;
    } else if (d > 2) {
      s.x += (snap.me.x - s.x) * 0.3;
      s.y += (snap.me.y - s.y) * 0.3;
    }
  }

  processEvents(snap);

  if (snap.phase === 'over') setMode('over');
  else if (snap.phase === 'hunt' || snap.phase === 'countdown') setMode('game');
  else setMode('lobby');

  updateHud(snap);
  if (snap.phase === 'lobby') renderLobby(snap);
}

function handleApiError(err) {
  if (err.status === 403 || err.status === 404) {
    saveSession(null);
    app.api = null;
    setMode('title');
    $('titleMsg').textContent = err.message || 'Session ended';
    $('titleMsg').className = 'msg err';
    return;
  }
  toast(err.message || 'Something went wrong', 'bad');
}

// ─────────────────────────────── events ───────────────────────────────
function processEvents(snap) {
  if (!snap.log) return;
  for (const e of snap.log) {
    switch (e.k) {
      case 'ping': {
        app.pings.push({
          x: e.x, y: e.y, r: e.r, t: now(),
          color: e.color || '#ff4d6d', name: e.name, fake: e.fake,
        });
        if (app.pings.length > 40) app.pings.shift();
        toast(`PING · ${e.name}${e.fake ? ' ?' : ''}`, 'gold');
        break;
      }
      case 'pingmiss':
        toast(`${e.name} went dark`, '');
        break;
      case 'digit': {
        app.digits[e.n - 1] = { d: e.d, at: now() };
        $('leakWarn').classList.add('hidden');
        break;
      }
      case 'leak': {
        app.leakCount = e.n;
        app.leakAt = now();
        $('leakWarn').classList.remove('hidden');
        $('leakCount').textContent = `${e.n}/4`;
        toast(`${e.by} is pulling your code ${e.n}/4`, 'bad');
        break;
      }
      case 'armed':
        app.armedUntil = now() + R.ARM_WINDOW_MS;
        openKeypad();
        break;
      case 'wrong':
        app.keypad.locked = true;
        break;
      case 'wronged':
        toast(`${e.by} punched in the wrong code`, 'good');
        break;
      case 'caught':
        toast(`CATCH CONFIRMED · ${e.name} +${e.reward}`, 'gold');
        app.pings.length = 0;
        break;
      case 'tagged':
        toast(`TAGGED by ${e.name}`, 'bad');
        closeKeypad();
        app.digits = [null, null, null, null];
        break;
      case 'respawn':
        toast('Back in the halls', 'good');
        break;
      case 'loot':
        toast(e.kind ? `Picked up ${R.POWERUPS[e.kind]?.name || e.kind}` : `+${e.coins} coins`, 'good');
        break;
      case 'used':
        toast(`${R.POWERUPS[e.kind]?.name || e.kind} used`, '');
        break;
      case 'feed':
        feed(e.msg, e.tone);
        break;
      case 'zoneout':
        $('zoneWarn').classList.toggle('hidden', !e.on);
        $('zoneVignette').classList.toggle('on', !!e.on);
        if (e.on) toast('You are outside the zone — you are bleeding', 'bad');
        break;
      case 'stairs':
        app.self.x = e.x;
        app.self.y = e.y;
        app.self.stairTile = null;
        break;
      case 'collapsed':
        toast('You collapsed outside the zone', 'bad');
        break;
      default:
        break;
    }
  }
  app.pings = app.pings.filter((p) => now() - p.t < R.PING_LIFE_MS + 500);
}

// ─────────────────────────────── HUD ───────────────────────────────
function updateHud(snap) {
  if (snap.phase === 'lobby' || !snap.me) return;
  const me = snap.me;
  const armed = me.inter.armedIn > 0;

  $('timer').textContent = snap.phase === 'countdown'
    ? '0:0' + Math.max(0, Math.ceil(snap.timeLeft / 1000))
    : R.fmtTime(snap.timeLeft);
  $('myCoins').textContent = Math.round(me.coins);
  $('myBounty').textContent = Math.round(me.bounty);

  const chip = $('phaseChip');
  chip.textContent = snap.phase === 'countdown' ? 'STAND BY' : snap.phase === 'hunt' ? 'HUNT LIVE' : 'COMPLETE';
  chip.classList.toggle('live', snap.phase === 'hunt');

  const meter = $('pingMeter').querySelector('i');
  const pct = R.clamp(1 - (me.nextPingIn || 0) / R.PING_START_MS, 0, 1);
  meter.style.setProperty('--w', `${Math.round(pct * 100)}%`);

  // target card
  const tc = $('targetCard');
  if (me.target) {
    $('tcName').textContent = me.target.ghost ? `${me.target.name} (OUT)` : me.target.name;
    $('tcDot').style.background = me.target.color;
    $('tcBounty').textContent = Math.round(me.target.bounty);
    const ping = me.target.ping;
    if (me.target.x != null) {
      $('tcPing').textContent = 'FIX';
      $('tcPing').style.color = '#8affc1';
      $('tcWhere').textContent = 'sonar lock — exact position';
    } else if (ping) {
      $('tcPing').textContent = 'PING';
      $('tcPing').style.color = '#4dd8ff';
      const where = MAP.areaAtWorld(ping.x, ping.y);
      $('tcWhere').textContent = ping.r > 120
        ? `fuzzy blip · ±${Math.max(1, Math.round(ping.r / TILE))} tiles`
        : where ? `blip in ${where.label}` : 'blip on the map';
    } else {
      $('tcPing').textContent = '—';
      $('tcWhere').textContent = 'no ping yet — stay moving';
    }
    tc.classList.toggle('hot', !!me.inRange);
  } else {
    $('tcName').textContent = 'NO TARGET';
    $('tcBounty').textContent = '—';
    $('tcWhere').textContent = 'ring empty';
  }

  // hunter warning
  const ha = $('hunterAlert');
  const near = me.hunter && me.hunter.near && !me.ghost;
  ha.classList.toggle('hidden', !near);
  if (near) $('hunterName').textContent = me.hunter.name;

  // ghost / respawn
  const go = $('ghostOverlay');
  if (snap.phase === 'countdown') {
    go.classList.remove('hidden');
    $('ghostTitle').textContent = 'GET READY';
    $('ghostSub').textContent = `Hunt starts in ${Math.max(1, Math.ceil(snap.timeLeft / 1000))}s`;
    go.querySelector('.go-hint').textContent = 'Check the ring in the lobby — someone is already hunting you.';
  } else if (me.ghostIn > 0) {
    go.classList.remove('hidden');
    $('ghostTitle').textContent = 'TAGGED';
    $('ghostSub').textContent = `Respawning in ${Math.ceil(me.ghostIn / 1000)}s`;
    go.querySelector('.go-hint').textContent = 'Your ping is dark while you are out. Watch the feed.';
  } else {
    go.classList.add('hidden');
  }

  // code strip
  const hot = app.digits.some(Boolean) || armed;
  $('codeStrip').classList.toggle('hidden', !hot);
  if (hot) {
    const wrap = $('csSlots');
    if (wrap.children.length !== 4) {
      wrap.innerHTML = '';
      for (let i = 0; i < 4; i++) {
        const s = document.createElement('div');
        s.className = 'cs-slot';
        wrap.appendChild(s);
      }
    }
    const t = now();
    for (let i = 0; i < 4; i++) {
      const slot = wrap.children[i];
      const d = app.digits[i];
      slot.classList.remove('hot', 'armed');
      if (armed) {
        slot.textContent = d ? d.d : '·';
        slot.classList.add('armed');
      } else if (d && t - d.at < R.DIGIT_SHOW_MS) {
        slot.textContent = d.d;
        slot.classList.add('hot');
      } else {
        slot.textContent = d ? '•' : '·';
      }
    }
    $('btnCode').textContent = armed ? `ENTER CODE · ${Math.ceil(me.inter.armedIn / 1000)}s` : 'ENTER CODE';
  }

  if (armed && !app.keypad.open) openKeypad();
  if (!armed && app.keypad.open && me.inter.armedIn <= 0 && !app.keypad.locked) {
    // window closed — leave it open; the server enforces range
  }

  // leak warning fades
  if (app.leakAt && now() - app.leakAt > 6000) $('leakWarn').classList.add('hidden');

  // grab button
  const grab = $('btnGrab');
  grab.classList.toggle('hidden', !(me.inRange && !me.ghost));
  grab.firstChild.textContent = app.keypad.open ? 'TYPING ' : 'GRAB';

  // inventory
  const sig = me.inv.join(',');
  if (sig !== app.invSig) {
    app.invSig = sig;
    const wrap = $('invSlots');
    wrap.innerHTML = '';
    for (let i = 0; i < R.INV_SLOTS; i++) {
      const k = me.inv[i];
      const b = document.createElement('button');
      b.className = 'inv-slot' + (k ? ' filled' : '');
      b.textContent = k ? (R.POWERUPS[k]?.name || k).slice(0, 3) : '·';
      if (k) b.style.borderColor = R.POWERUPS[k].hue;
      b.addEventListener('click', () => {
        app.api.use(k).catch(handleApiError);
      });
      wrap.appendChild(b);
    }
  }

  $('zoneVignette').classList.toggle('on', !!me.outside);
  $('zoneWarn').classList.toggle('hidden', !me.outside);

  updateKeypadTimer(me);
}

// ─────────────────────────────── keypad ───────────────────────────────
function buildKeypad() {
  const grid = $('kpGrid');
  if (!grid) return;
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'CLR', '0', 'DEL'];
  for (const k of keys) {
    const b = document.createElement('button');
    b.className = 'kp-key';
    b.textContent = k;
    b.addEventListener('click', () => keypadPress(k));
    grid.appendChild(b);
  }
}

function keypadPress(k) {
  if (k === 'CLR') app.keypad.entered = '';
  else if (k === 'DEL') app.keypad.entered = app.keypad.entered.slice(0, -1);
  else if (app.keypad.entered.length < 4) app.keypad.entered += k;
  renderKeypad();
}

function renderKeypad() {
  const disp = $('kpDisplay');
  for (let i = 0; i < 4; i++) {
    disp.children[i].textContent = app.keypad.entered[i] || '';
    disp.children[i].classList.toggle('filled', !!app.keypad.entered[i]);
  }
  $('kpSubmit').disabled = app.keypad.entered.length !== 4;
}

function openKeypad() {
  if (app.keypad.open) return;
  app.keypad.open = true;
  app.keypad.entered = '';
  $('keypad').classList.remove('hidden');
  $('kpMsg').textContent = '';
  $('kpMsg').className = 'msg';
  renderKeypad();
  input.reset();
}

function closeKeypad() {
  app.keypad.open = false;
  $('keypad').classList.add('hidden');
}

function updateKeypadTimer(me) {
  if (!app.keypad.open) return;
  const armedIn = me ? me.inter.armedIn : 0;
  const lockedIn = me ? me.inter.lockedIn : 0;
  if (lockedIn > 0) {
    $('kpTimer').textContent = `${(lockedIn / 1000).toFixed(1)}s LOCK`;
    $('kpTimer').style.color = '#ff4d6d';
    $('kpSubmit').disabled = true;
    $('kpSub').textContent = 'Keypad locked. Get close and grab again.';
  } else {
    $('kpTimer').textContent = armedIn > 0 ? `${(armedIn / 1000).toFixed(1)}s` : 'CLOSE RANGE';
    $('kpTimer').style.color = '';
    $('kpSubmit').disabled = app.keypad.entered.length !== 4;
    $('kpSub').textContent = armedIn > 0
      ? 'You have the leak. Punch in the 4 digits before the window closes.'
      : 'Hold GRAB next to your target until all four digits leak.';
  }
}

async function submitCode() {
  if (app.keypad.entered.length !== 4) return;
  try {
    const res = await app.api.confirm(app.keypad.entered);
    if (res.ok) {
      closeKeypad();
      app.digits = [null, null, null, null];
      toast(`CATCH CONFIRMED +${res.reward}`, 'gold');
    } else {
      keypadFail(res.error || 'Wrong code');
    }
  } catch (err) {
    if (err.status === 403) return handleApiError(err);
    keypadFail(err.message);
  }
}

function keypadFail(msg) {
  $('kpMsg').textContent = msg;
  $('kpMsg').className = 'msg err';
  app.keypad.entered = '';
  renderKeypad();
  const kp = document.querySelector('.kp');
  kp.classList.remove('shake');
  void kp.offsetWidth;
  kp.classList.add('shake');
}

// ─────────────────────────────── lobby ───────────────────────────────
function renderLobby(snap) {
  if (!snap || snap.phase !== 'lobby') return;
  $('lobbyCode').textContent = snap.code;
  $('lobbyCount').textContent = `${snap.order.length}/8`;
  const isHost = snap.hostId === snap.me?.id;

  const list = $('lobbyPlayers');
  list.innerHTML = '';
  for (const id of snap.order) {
    const p = snap.players.find((x) => x.id === id);
    if (!p) continue;
    const li = document.createElement('li');
    const dot = document.createElement('i');
    dot.className = 'dot';
    dot.style.background = p.color;
    li.appendChild(dot);
    const nm = document.createElement('span');
    nm.textContent = p.name + (p.id === snap.me?.id ? ' (you)' : '');
    li.appendChild(nm);
    const tag = document.createElement('span');
    tag.className = 'tag' + (p.id === snap.hostId ? ' host' : p.bot ? ' bot' : '');
    tag.textContent = p.id === snap.hostId ? 'HOST' : p.bot ? 'AI' : 'READY';
    li.appendChild(tag);
    if (isHost && p.bot) {
      const k = document.createElement('button');
      k.className = 'kick';
      k.textContent = 'REMOVE';
      k.addEventListener('click', () => app.api.removeBot(p.id).catch(handleApiError));
      li.appendChild(k);
    }
    list.appendChild(li);
  }

  $('btnStart').disabled = !isHost || snap.order.length < 2;
  $('btnBot').disabled = !isHost || snap.order.length >= 8;
  $('lobbyHint').textContent = !isHost
    ? 'Waiting for the host to start the hunt.'
    : snap.order.length < 2
      ? 'Need one more player — or add an AI stalker.'
      : 'Ready. Everyone gets a target and a hunter.';

  const ring = $('ringLine');
  ring.innerHTML = '';
  if (snap.order.length < 2) {
    ring.textContent = 'The ring needs at least two people.';
  } else {
    for (const id of snap.order) {
      const p = snap.players.find((x) => x.id === id);
      if (!p) continue;
      const chip = document.createElement('span');
      chip.className = 'chain';
      const dot = document.createElement('i');
      dot.className = 'dot';
      dot.style.background = p.color;
      chip.appendChild(dot);
      chip.appendChild(document.createTextNode(p.name));
      ring.appendChild(chip);
      const arrow = document.createElement('span');
      arrow.className = 'arrow';
      arrow.textContent = '→';
      ring.appendChild(arrow);
    }
    const first = snap.players.find((x) => x.id === snap.order[0]);
    const chip = document.createElement('span');
    chip.className = 'chain';
    const dot = document.createElement('i');
    dot.className = 'dot';
    dot.style.background = first?.color || '#fff';
    chip.appendChild(dot);
    chip.appendChild(document.createTextNode(first?.name || ''));
    ring.appendChild(chip);
  }
}

// ─────────────────────────────── game over ───────────────────────────────
function renderOver(snap) {
  if (!snap || !snap.board) return;
  const winner = snap.board[0];
  $('overTitle').textContent = winner ? `${winner.name} OWNS THE SCHOOL` : 'MATCH OVER';
  const board = $('board');
  board.innerHTML = '';
  snap.board.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'board-row' + (i === 0 ? ' win' : '');
    row.innerHTML = `
      <span class="rk">${String(i + 1).padStart(2, '0')}</span>
      <span class="nm"><i class="dot" style="background:${p.color}"></i>${p.name}${p.id === snap.me?.id ? '<span class="me">YOU</span>' : ''}</span>
      <span class="catches">${p.catches}× caught</span>
      <span class="coins">${p.coins}</span>`;
    board.appendChild(row);
  });
  const isHost = snap.hostId === snap.me?.id;
  $('btnRematch').disabled = !isHost;
  $('overHint').textContent = isHost ? 'Run it back — same room, fresh ring.' : 'Waiting for the host to run it back.';
}

// ─────────────────────────────── prediction ───────────────────────────────
function stepSelf(dt) {
  const snap = app.snap;
  if (!snap || snap.phase !== 'hunt' || !snap.me || snap.me.ghost) return;
  const me = snap.me;
  const inp = input.read();
  const mag = Math.hypot(inp.x, inp.y);
  const s = app.self;
  if (mag < 0.12) return;
  let speed = R.WALK;
  if (inp.sneak) speed *= R.SNEAK_MULT;
  else if (inp.sprint && me.stamina > 1) speed *= R.SPRINT_MULT;
  if (me.boosting) speed *= R.BOOST_MULT;
  const res = moveCircle(MAP, s.x, s.y, inp.x * speed * dt, inp.y * speed * dt, R.PLAYER_R);
  s.x = res.x;
  s.y = res.y;
  s.dirX = inp.x;
  s.dirY = inp.y;

  const tx = Math.floor(s.x / TILE);
  const ty = Math.floor(s.y / TILE);
  const key = `${tx},${ty}`;
  const st = MAP.stairAtTile(tx, ty);
  const t = now();
  if (st && s.stairTile !== key && t > s.stairCd) {
    s.x = (st.toX + 0.5) * TILE;
    s.y = (st.toY + 0.5) * TILE;
    s.stairTile = `${st.toX},${st.toY}`;
    s.stairCd = t + R.STAIR_CD;
  } else if (!st) {
    s.stairTile = null;
  }
}

// ─────────────────────────────── render loop ───────────────────────────────
let lastFrame = now();
function frame() {
  const t = now();
  const dt = Math.min(0.05, (t - lastFrame) / 1000);
  lastFrame = t;
  const snap = app.snap;
  if (snap && snap.me && (snap.phase === 'hunt' || snap.phase === 'countdown')) {
    stepSelf(dt);
    const me = snap.me;
    const inp = input.read();
    const sonar = me.sonar && me.target && me.target.x != null
      ? [{ x: me.target.x, y: me.target.y, r: 0, t: t - 500, color: me.target.color, name: me.target.name }]
      : [];
    renderer.draw({
      self: {
        id: me.id, x: app.self.x, y: app.self.y, color: me.color,
        dirX: app.self.dirX, dirY: app.self.dirY,
        sneak: inp.sneak, sprint: inp.sprint && !inp.sneak,
        ghost: me.ghost, invuln: me.invuln,
      },
      players: snap.players,
      zone: snap.zone,
      drops: snap.drops,
      crates: snap.crates,
      pings: sonar.concat(app.pings),
      target: me.target && me.target.x != null ? { x: me.target.x, y: me.target.y } : null,
    }, t);
    if (app.keypad.open) updateKeypadTimer(me);
  }
  requestAnimationFrame(frame);
}

// ─────────────────────────────── wiring ───────────────────────────────
function startSession(session) {
  saveSession(session);
  app.api = createApi(session);
  app.since = 0;
  app.self.init = false;
  app.pings = [];
  app.digits = [null, null, null, null];
  app.invSig = '';
  closeKeypad();
  clearTimeout(app.pollTimer);
  pollLoop();
}

$('btnCreate').addEventListener('click', async () => {
  const name = $('nameInput').value.trim();
  if (!name) { $('nameInput').focus(); $('titleMsg').textContent = 'Pick a callsign first.'; $('titleMsg').className = 'msg err'; return; }
  localStorage.setItem('stoss.name', name);
  $('btnCreate').disabled = true;
  try {
    const res = await createApi(null).create(name);
    startSession({ code: res.code, pid: res.pid, token: res.token });
    setMode('lobby');
    renderLobby(res.state);
  } catch (err) {
    $('titleMsg').textContent = err.message;
    $('titleMsg').className = 'msg err';
  } finally {
    $('btnCreate').disabled = false;
  }
});

$('btnJoin').addEventListener('click', joinRoom);
$('codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(); });
$('codeInput').addEventListener('input', () => {
  $('codeInput').value = $('codeInput').value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
});

async function joinRoom() {
  const name = $('nameInput').value.trim();
  const code = $('codeInput').value.trim().toUpperCase();
  if (!name) { $('nameInput').focus(); $('titleMsg').textContent = 'Pick a callsign first.'; $('titleMsg').className = 'msg err'; return; }
  if (code.length !== 4) { $('titleMsg').textContent = 'Room codes are 4 characters.'; $('titleMsg').className = 'msg err'; return; }
  localStorage.setItem('stoss.name', name);
  $('btnJoin').disabled = true;
  try {
    const res = await createApi(null).join(code, name);
    startSession({ code: res.code, pid: res.pid, token: res.token });
    setMode('lobby');
    renderLobby(res.state);
  } catch (err) {
    $('titleMsg').textContent = err.message;
    $('titleMsg').className = 'msg err';
  } finally {
    $('btnJoin').disabled = false;
  }
}

$('btnStart').addEventListener('click', () => app.api?.start().catch(handleApiError));
$('btnBot').addEventListener('click', () => app.api?.addBot().catch(handleApiError));
$('btnRematch').addEventListener('click', () => app.api?.rematch().catch(handleApiError));
$('btnCopy').addEventListener('click', async () => {
  const url = `${location.origin}/?room=${app.snap?.code || ''}`;
  try {
    await navigator.clipboard.writeText(url);
    toast('Invite link copied', 'good');
  } catch {
    $('titleMsg').textContent = url;
    toast(url);
  }
});

async function leaveRoom() {
  try { await app.api?.leave(); } catch { /* leaving anyway */ }
  saveSession(null);
  app.api = null;
  app.snap = null;
  clearTimeout(app.pollTimer);
  setMode('title');
  $('titleMsg').textContent = '';
}
$('btnLeaveLobby').addEventListener('click', leaveRoom);
$('btnQuit').addEventListener('click', leaveRoom);

$('btnCode').addEventListener('click', openKeypad);
$('kpClose').addEventListener('click', closeKeypad);
$('kpSubmit').addEventListener('click', submitCode);
$('btnMinimap').addEventListener('click', () => {
  $('minimap').classList.toggle('hidden');
});

$('btnHelp').addEventListener('click', () => {
  const body = $('helpPanel');
  const on = body.classList.toggle('collapsed');
  $('btnHelp').setAttribute('aria-expanded', String(!on));
  $('btnHelp').textContent = on ? 'HOW IT WORKS' : 'HIDE RULES';
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && app.api) {
    clearTimeout(app.pollTimer);
    pollLoop();
    if (app.snap && Date.now() - app.lastSnapAt > 12000) {
      toast('Re-synced after sleep — the hunt kept moving', 'gold');
    }
  }
});
window.addEventListener('online', () => {
  if (app.api) { clearTimeout(app.pollTimer); pollLoop(); }
});

window.addEventListener('error', (e) => {
  if (!app.mode || app.mode === 'title') showFatal(e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  if (!app.mode || app.mode === 'title') showFatal(e.reason?.message || e.reason);
});

buildKeypad();
renderKeypad();
requestAnimationFrame(frame);

// boot
const params = new URLSearchParams(location.search);
const invite = (params.get('room') || '').toUpperCase().slice(0, 4);
if (invite) $('codeInput').value = invite;
$('nameInput').value = localStorage.getItem('stoss.name') || '';

const saved = loadSession();
if (saved) {
  app.api = createApi(saved);
  pollLoop();
} else {
  setMode('title');
}
requestAnimationFrame(() => renderer.drawOverview($('titlePreview')));
window.addEventListener('resize', () => {
  if (app.mode === 'title') renderer.drawOverview($('titlePreview'));
  if (app.mode === 'lobby') renderer.drawOverview($('lobbyPreview'));
});
