// Canvas renderer: blueprint floor plan, radar pings, players, lockdown zone, minimap.
import { buildMap, AREAS, TILE, MAP_W, MAP_H, tileCenter } from '../shared/map.js';
import { CATCH_RANGE, clamp, dist, PING_LIFE_MS } from '../shared/rules.js';

const MAP = buildMap();
const WALLS = MAP.wallTiles;

const COL = {
  void: '#050a10',
  wall: '#0a1521',
  wallTop: 'rgba(96, 146, 198, .16)',
  floorEdge: 'rgba(120, 180, 255, .09)',
  label: 'rgba(176, 205, 235, .26)',
  labelSub: 'rgba(140, 170, 200, .3)',
  zone: 'rgba(255, 58, 88, .10)',
  zoneLine: 'rgba(255, 92, 118, .55)',
  gold: '#ffd166',
  drop: '#ffd166',
  dropOff: '#2a3446',
};

function hexA(hex, a) {
  const h = hex.replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return `rgba(${parseInt(n.slice(0, 2), 16)},${parseInt(n.slice(2, 4), 16)},${parseInt(n.slice(4, 6), 16)},${a})`;
}

export function createRenderer(canvas, mini) {
  const ctx = canvas.getContext('2d', { alpha: false });
  const mctx = mini ? mini.getContext('2d') : null;
  let dpr = 1;
  let vw = 0;
  let vh = 0;
  let scale = 1;
  const cam = { x: 52 * TILE, y: 33.5 * TILE };
  const smooth = new Map();
  let miniAt = 0;
  let hatch = null;

  function makeHatch() {
    const c = document.createElement('canvas');
    c.width = 12;
    c.height = 12;
    const h = c.getContext('2d');
    h.strokeStyle = 'rgba(140, 255, 210, .07)';
    h.lineWidth = 1;
    h.beginPath();
    h.moveTo(0, 12);
    h.lineTo(12, 0);
    h.stroke();
    hatch = ctx.createPattern(c, 'repeat');
  }

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    vw = canvas.clientWidth || window.innerWidth;
    vh = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.floor(vw * dpr);
    canvas.height = Math.floor(vh * dpr);
    scale = clamp(Math.min(vw / 470, vh / 430), 0.58, 1.45);
    syncMini();
  }

  // The minimap lives inside the HUD, which is hidden until the hunt starts — so its size has
  // to be re-checked on every frame rather than only on resize().
  function syncMini() {
    if (!mini) return;
    const w = Math.max(1, Math.floor(mini.clientWidth * dpr));
    const h = Math.max(1, Math.floor(mini.clientHeight * dpr));
    if (mini.width !== w || mini.height !== h) {
      mini.width = w;
      mini.height = h;
    }
  }

  window.addEventListener('resize', resize);

  function drawZone(c) {
    const z = c.zone;
    if (!z) return;
    const pad = 400;
    const vb = { x: cam.x - vw / 2 / scale - pad, y: cam.y - vh / 2 / scale - pad, w: vw / scale + pad * 2, h: vh / scale + pad * 2 };
    ctx.save();
    ctx.beginPath();
    ctx.rect(vb.x, vb.y, vb.w, vb.h);
    ctx.arc(z.x, z.y, Math.max(1, z.r), 0, Math.PI * 2);
    ctx.fillStyle = COL.zone;
    ctx.fill('evenodd');
    ctx.restore();

    ctx.beginPath();
    ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2);
    ctx.strokeStyle = COL.zoneLine;
    ctx.lineWidth = 2;
    ctx.setLineDash([14, 12]);
    ctx.lineDashOffset = -(performance.now() / 90) % 26;
    ctx.stroke();
    ctx.setLineDash([]);
    const g = ctx.createRadialGradient(z.x, z.y, z.r * 0.82, z.x, z.y, z.r);
    g.addColorStop(0, 'rgba(255, 70, 100, 0)');
    g.addColorStop(1, 'rgba(255, 70, 100, .12)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawAreas(view) {
    const x0 = cam.x - vw / 2 / scale;
    const x1 = cam.x + vw / 2 / scale;
    const y0 = cam.y - vh / 2 / scale;
    const y1 = cam.y + vh / 2 / scale;

    for (const a of AREAS) {
      const x = a.x * TILE;
      const y = a.y * TILE;
      const w = a.w * TILE;
      const h = a.h * TILE;
      if (x + w < x0 || x > x1 || y + h < y0 || y > y1) continue;
      ctx.fillStyle = a.tone;
      ctx.fillRect(x, y, w, h);
      if (a.kind === 'yard' && hatch) {
        ctx.fillStyle = hatch;
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = 'rgba(120, 255, 200, .18)';
        ctx.setLineDash([8, 8]);
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 5, y + 5, w - 10, h - 10);
        ctx.setLineDash([]);
      } else {
        ctx.strokeStyle = COL.floorEdge;
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 3, y + 3, w - 6, h - 6);
      }

      const big = w > 160 && h > 110;
      if (big) {
        ctx.fillStyle = a.kind === 'upper' ? 'rgba(200, 180, 255, .3)' : COL.label;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `700 ${Math.min(15, Math.max(10, w / 12))}px ui-monospace, monospace`;
        ctx.fillText(a.label, x + w / 2, y + h / 2 - 6);
        ctx.fillStyle = COL.labelSub;
        ctx.font = '600 10px ui-monospace, monospace';
        ctx.fillText(a.sub, x + w / 2, y + h / 2 + 11);
      }
    }

    // stairwell markers
    for (const [key] of MAP.stairAt) {
      const tx = key % MAP_W;
      const ty = (key - tx) / MAP_W;
      const cx = (tx + 0.5) * TILE;
      const cy = (ty + 0.5) * TILE;
      if (cx < x0 - 40 || cx > x1 + 40 || cy < y0 - 40 || cy > y1 + 40) continue;
      ctx.strokeStyle = 'rgba(77, 216, 255, .5)';
      ctx.lineWidth = 2;
      ctx.strokeRect(cx - 11, cy - 11, 22, 22);
      ctx.fillStyle = 'rgba(77, 216, 255, .22)';
      ctx.fillRect(cx - 11, cy - 11, 22, 22);
      ctx.fillStyle = 'rgba(180, 240, 255, .9)';
      ctx.font = '700 11px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('⇅', cx, cy + 1);
    }
  }

  function drawWalls() {
    const x0 = cam.x - vw / 2 / scale - TILE;
    const x1 = cam.x + vw / 2 / scale + TILE;
    const y0 = cam.y - vh / 2 / scale - TILE;
    const y1 = cam.y + vh / 2 / scale + TILE;
    ctx.fillStyle = COL.wall;
    for (let i = 0; i < WALLS.length; i++) {
      const [tx, ty] = WALLS[i];
      const x = tx * TILE;
      const y = ty * TILE;
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      ctx.fillRect(x, y, TILE, TILE);
    }
    ctx.fillStyle = COL.wallTop;
    for (let i = 0; i < WALLS.length; i++) {
      const [tx, ty] = WALLS[i];
      const x = tx * TILE;
      const y = ty * TILE;
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      if (!MAP.wallSet[(ty - 1) * MAP_W + tx]) continue;
      ctx.fillRect(x, y, TILE, 1.5);
    }
  }

  function drawDrops(view, now) {
    for (const d of view.drops) {
      const up = d.up;
      ctx.save();
      ctx.translate(d.x, d.y);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = up ? 'rgba(255, 209, 102, .16)' : 'rgba(40, 52, 70, .5)';
      ctx.strokeStyle = up ? 'rgba(255, 209, 102, .85)' : 'rgba(70, 90, 115, .7)';
      ctx.lineWidth = 2;
      ctx.fillRect(-9, -9, 18, 18);
      ctx.strokeRect(-9, -9, 18, 18);
      ctx.restore();
      if (up) {
        const t = (now / 900) % 1;
        ctx.beginPath();
        ctx.arc(d.x, d.y, 12 + t * 14, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255, 209, 102, ${0.4 * (1 - t)})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
    for (const c of view.crates) {
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(now / 900);
      ctx.fillStyle = 'rgba(138, 255, 193, .2)';
      ctx.strokeStyle = 'rgba(138, 255, 193, .9)';
      ctx.lineWidth = 2;
      ctx.fillRect(-10, -10, 20, 20);
      ctx.strokeRect(-10, -10, 20, 20);
      ctx.restore();
      ctx.fillStyle = 'rgba(210, 255, 235, .95)';
      ctx.font = '700 10px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText((c.kind || '?')[0].toUpperCase(), c.x, c.y + 1);
    }
  }

  function drawPings(view, now) {
    for (const p of view.pings) {
      const age = now - p.t;
      if (age > PING_LIFE_MS) continue;
      const a = clamp(1 - age / PING_LIFE_MS, 0, 1);
      const col = p.color || '#ff4d6d';
      if (p.r > 4) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = hexA(col, a * 0.09);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.strokeStyle = hexA(col, a * 0.5);
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 7]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      const ringR = 16 + ((age / 900) % 3) * 26;
      ctx.beginPath();
      ctx.arc(p.x, p.y, ringR, 0, Math.PI * 2);
      ctx.strokeStyle = hexA(col, a * 0.32);
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
      ctx.fillStyle = hexA(col, a);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${a})`;
      ctx.fill();

      ctx.fillStyle = hexA(col, a * 0.9);
      ctx.font = '600 10px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${p.name || ''} ${Math.round(age / 1000)}s`, p.x, p.y - p.r - 10);
    }
  }

  function drawActor(x, y, color, opts, now) {
    const { ghost, sneak, sprint, self, name, invuln, dirX = 0, dirY = 1 } = opts;
    if (ghost) return;
    const r = 11;
    ctx.save();
    ctx.translate(x, y);

    if (self) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 320);
      ctx.beginPath();
      ctx.arc(0, 0, r + 8 + pulse * 3, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,255,255,${0.16 + pulse * 0.14})`;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    const ang = Math.atan2(dirY, dirX);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(r + 9, 0);
    ctx.lineTo(r - 1, -7);
    ctx.lineTo(r - 1, 7);
    ctx.closePath();
    ctx.fillStyle = hexA(color, 0.85);
    ctx.fill();
    ctx.rotate(-ang);

    ctx.shadowColor = color;
    ctx.shadowBlur = self ? 22 : 14;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.beginPath();
    ctx.arc(0, 0, r - 4.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(4, 8, 14, .55)';
    ctx.fill();

    if (invuln) {
      ctx.beginPath();
      ctx.arc(0, 0, r + 5, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,.7)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (sneak) {
      ctx.beginPath();
      ctx.arc(0, 0, r + 3, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(201, 139, 255, .7)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    if (sprint) {
      ctx.beginPath();
      ctx.arc(0, 0, r + 3, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(77, 216, 255, .7)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.restore();

    if (name) {
      ctx.font = '600 10px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = self ? 'rgba(255,255,255,.95)' : hexA(color, 0.95);
      ctx.fillText(name, x, y - 22);
    }
  }

  function draw(view, now) {
    resizeIfNeeded();
    syncMini();
    const self = view.self;
    if (self) {
      cam.x += (self.x - cam.x) * 0.22;
      cam.y += (self.y - cam.y) * 0.22;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = COL.void;
    ctx.fillRect(0, 0, vw, vh);

    ctx.save();
    ctx.translate(vw / 2, vh / 2);
    ctx.scale(scale, scale);
    ctx.translate(-cam.x, -cam.y);

    drawAreas(view);
    drawWalls();
    drawZone(view);
    drawDrops(view, now);

    // amber catch-range ring around the target when you can grab
    if (view.target && view.target.x != null && self) {
      ctx.beginPath();
      ctx.arc(view.target.x, view.target.y, CATCH_RANGE, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 209, 102, .35)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // remote players (smoothed toward their last known position)
    for (const p of view.players) {
      if (p.id === (self && self.id)) continue;
      if (p.x == null) continue;
      let s = smooth.get(p.id);
      if (!s) { s = { x: p.x, y: p.y }; smooth.set(p.id, s); }
      if (dist(s.x, s.y, p.x, p.y) > 260) { s.x = p.x; s.y = p.y; }
      else { s.x += (p.x - s.x) * 0.25; s.y += (p.y - s.y) * 0.25; }
      drawActor(s.x, s.y, p.color, {
        sneak: p.sneak, sprint: p.sprint, name: p.name, ghost: p.ghost,
        dirX: p.dirX, dirY: p.dirY, invuln: false,
      }, now);
    }
    for (const id of smooth.keys()) {
      if (!view.players.some((p) => p.id === id)) smooth.delete(id);
    }

    drawPings(view, now);

    if (self) {
      drawActor(self.x, self.y, self.color, {
        self: true, sneak: self.sneak, sprint: self.sprint,
        name: null, ghost: self.ghost, dirX: self.dirX, dirY: self.dirY,
        invuln: !!self.invuln,
      }, now);
    }

    ctx.restore();

    if (mctx && now - miniAt > 90) {
      miniAt = now;
      drawMinimap(view, now);
    }
  }

  function resizeIfNeeded() {
    if (canvas.clientWidth !== vw || canvas.clientHeight !== vh) resize();
  }

  function drawMinimap(view, now) {
    if (!mctx) return;
    const W = mini.width;
    const H = mini.height;
    const s = Math.min(W / (MAP_W * TILE), H / (MAP_H * TILE));
    mctx.setTransform(1, 0, 0, 1, 0, 0);
    mctx.clearRect(0, 0, W, H);
    mctx.fillStyle = 'rgba(6, 11, 18, .92)';
    mctx.fillRect(0, 0, W, H);
    const ox = (W - MAP_W * TILE * s) / 2;
    const oy = (H - MAP_H * TILE * s) / 2;
    const px = (x) => ox + x * s;
    const py = (y) => oy + y * s;

    for (const a of AREAS) {
      mctx.fillStyle = a.kind === 'upper' ? 'rgba(90, 80, 140, .5)' : 'rgba(30, 56, 84, .75)';
      mctx.fillRect(px(a.x * TILE), py(a.y * TILE), a.w * TILE * s, a.h * TILE * s);
    }
    if (view.zone) {
      mctx.beginPath();
      mctx.arc(px(view.zone.x), py(view.zone.y), view.zone.r * s, 0, Math.PI * 2);
      mctx.strokeStyle = 'rgba(255, 92, 118, .85)';
      mctx.lineWidth = Math.max(1, W / 130);
      mctx.stroke();
    }
    mctx.fillStyle = 'rgba(255, 209, 102, .8)';
    for (const d of view.drops) {
      if (!d.up) continue;
      mctx.fillRect(px(d.x) - 1, py(d.y) - 1, 2.5, 2.5);
    }
    for (const p of view.pings) {
      if (now - p.t > PING_LIFE_MS) continue;
      mctx.beginPath();
      mctx.arc(px(p.x), py(p.y), 2.6, 0, Math.PI * 2);
      mctx.fillStyle = p.color || '#ff4d6d';
      mctx.fill();
    }
    if (view.self) {
      mctx.beginPath();
      mctx.arc(px(view.self.x), py(view.self.y), 3.4, 0, Math.PI * 2);
      mctx.fillStyle = '#fff';
      mctx.fill();
      mctx.beginPath();
      mctx.arc(px(view.self.x), py(view.self.y), 7, 0, Math.PI * 2);
      mctx.strokeStyle = 'rgba(255,255,255,.5)';
      mctx.lineWidth = 1;
      mctx.stroke();
    }
  }

  function drawOverview(target) {
    const c = target.getContext('2d');
    const w = target.clientWidth;
    const h = Math.round(w * (MAP_H / MAP_W));
    const d = Math.min(2, window.devicePixelRatio || 1);
    target.width = Math.floor(w * d);
    target.height = Math.floor(h * d);
    target.style.height = h + 'px';
    const s = Math.min(target.width / (MAP_W * TILE), target.height / (MAP_H * TILE));
    const ox = (target.width - MAP_W * TILE * s) / 2;
    const oy = (target.height - MAP_H * TILE * s) / 2;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, target.width, target.height);
    c.fillStyle = '#050a10';
    c.fillRect(0, 0, target.width, target.height);
    for (const a of AREAS) {
      c.fillStyle = a.tone;
      c.fillRect(ox + a.x * TILE * s, oy + a.y * TILE * s, a.w * TILE * s, a.h * TILE * s);
      c.strokeStyle = 'rgba(120, 180, 255, .18)';
      c.lineWidth = 1;
      c.strokeRect(ox + a.x * TILE * s + 1, oy + a.y * TILE * s + 1, a.w * TILE * s - 2, a.h * TILE * s - 2);
    }
    c.fillStyle = 'rgba(140, 180, 220, .5)';
    c.font = `600 ${Math.max(7, w / 74)}px ui-monospace, monospace`;
    c.textAlign = 'center';
    for (const a of AREAS) {
      if (a.w < 10) continue;
      c.fillText(a.label, ox + (a.x + a.w / 2) * TILE * s, oy + (a.y + a.h / 2) * TILE * s);
    }
    c.fillStyle = 'rgba(255, 92, 118, .8)';
    c.beginPath();
    c.arc(ox + 52 * TILE * s, oy + 33.5 * TILE * s, 250 * s, 0, Math.PI * 2);
    c.strokeStyle = 'rgba(255, 92, 118, .7)';
    c.lineWidth = 1.5;
    c.stroke();
  }

  resize();
  makeHatch();
  return { draw, drawOverview, resize, cam };
}
