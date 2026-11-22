// SyossetStalk — floor plan geometry, traced from the Syosset HS blueprint (Rev. 10/14).
// Shared verbatim between the Worker (authoritative sim) and the browser (render + prediction).
// Everything is tile based: 1 tile = TILE world units. Rect helpers use inclusive coords.
//
// Orientation matches the printed plan: north is up, FRONT (main entrance) is the south
// centre. The long MAIN HALL spine runs west-east with the wings hanging off it, the 2F
// E-Hall is a separate inset in the south-east, and the two stairwells are the only links.

export const TILE = 32;
export const MAP_W = 104;
export const MAP_H = 92;

// Areas are painted as floor. Anything adjacent to floor that is not floor becomes wall.
// Rooms that touch each other are open to each other; DOORS carve the narrow openings.
export const AREAS = [
  // ── north-west: D wing (English), C wing (social studies) ──────────────────
  { id: 'dwing',   label: 'D-WING',              sub: 'ENGLISH · D01–D12',    x: 4,  y: 7,  w: 14, h: 8,  kind: 'room', tone: '#152e46' },
  { id: 'cwing',   label: 'C-WING',              sub: 'SOCIAL STUDIES · C01–C16', x: 20, y: 7, w: 14, h: 8, kind: 'room', tone: '#152e46' },
  { id: 'cdhall',  label: 'C/D HALL',            sub: '1F',                   x: 4,  y: 16, w: 30, h: 3,  kind: 'hall', tone: '#0f2a40' },
  { id: 'little',  label: 'LITTLE THEATER',      sub: '1F',                   x: 4,  y: 21, w: 12, h: 10, kind: 'room', tone: '#22304f' },
  { id: 'pubs',    label: 'STUDENT PUBS',        sub: 'GOV · PUBLICATIONS',   x: 22, y: 21, w: 12, h: 10, kind: 'room', tone: '#1b3149' },
  { id: 'westhall',label: 'WEST HALL',           sub: '1F',                   x: 17, y: 16, w: 4,  h: 16, kind: 'hall', tone: '#0f2a40' },

  // ── north-centre: B wing (guidance) and reading room ───────────────────────
  { id: 'reading', label: 'READING ROOM',        sub: '1F',                   x: 34, y: 4,  w: 19, h: 4,  kind: 'room', tone: '#183450' },
  { id: 'bhall',   label: 'B HALL',              sub: 'GUIDANCE · 1F',        x: 42, y: 8,  w: 4,  h: 24, kind: 'hall', tone: '#0f2a40' },
  { id: 'bwest',   label: 'B-WING',              sub: 'B02–B10',              x: 34, y: 9,  w: 7,  h: 22, kind: 'room', tone: '#152e46' },
  { id: 'beast',   label: 'B-WING EAST',         sub: 'B01–B09',              x: 47, y: 9,  w: 6,  h: 22, kind: 'room', tone: '#152e46' },

  // ── north-east: science, E-hall, business/weight room, A wing ─────────────
  { id: 'science', label: 'SCIENCE DEPT',        sub: 'E96–E109',             x: 55, y: 5,  w: 18, h: 10, kind: 'room', tone: '#183450' },
  { id: 'ehall',   label: 'E-HALL',              sub: '1F · STAIRS ⇅',        x: 55, y: 17, w: 34, h: 4,  kind: 'hall', tone: '#0f2a40' },
  { id: 'eworks',  label: 'SCIENCE WORKROOMS',   sub: 'T01–T07',              x: 55, y: 22, w: 16, h: 9,  kind: 'room', tone: '#1b3149' },
  { id: 'ehallS',  label: 'E HALL SOUTH',        sub: '1F',                   x: 71, y: 21, w: 3,  h: 11, kind: 'hall', tone: '#0f2a40' },
  { id: 'bus',     label: 'BUSINESS ED',         sub: 'WEIGHT ROOM · TO1',    x: 74, y: 5,  w: 14, h: 10, kind: 'room', tone: '#183450' },
  { id: 'awing',   label: 'A-WING',              sub: 'A01–A07 · BUSINESS',   x: 74, y: 22, w: 14, h: 9,  kind: 'room', tone: '#152e46' },

  // ── the spine ──────────────────────────────────────────────────────────────
  { id: 'main',    label: 'MAIN HALL',           sub: '1F · FRONT',           x: 8,  y: 32, w: 81, h: 5,  kind: 'hall', tone: '#123049' },

  // ── east: gym block ────────────────────────────────────────────────────────
  { id: 'lockers', label: 'LOCKERS',             sub: '1F',                   x: 90, y: 17, w: 7,  h: 6,  kind: 'room', tone: '#1a3550' },
  { id: 'gym',     label: 'MAIN GYM',            sub: '1F',                   x: 90, y: 24, w: 14, h: 19, kind: 'room', tone: '#16324a' },
  { id: 'auxgym',  label: 'AUX. GYM',            sub: '1F',                   x: 90, y: 45, w: 12, h: 12, kind: 'room', tone: '#16324a' },
  { id: 'pool',    label: 'POOL',                sub: '1F',                   x: 90, y: 59, w: 14, h: 11, kind: 'room', tone: '#153a52' },

  // ── south-west: cafeterias, choral, auditorium, band ──────────────────────
  { id: 'wcaf',    label: 'WEST CAFETERIA',      sub: 'SERVING · KITCHEN',    x: 8,  y: 39, w: 18, h: 12, kind: 'room', tone: '#1a3550' },
  { id: 'ecaf',    label: 'EAST CAFETERIA',      sub: 'SERVING AREA',         x: 8,  y: 54, w: 18, h: 12, kind: 'room', tone: '#1a3550' },
  { id: 'choral',  label: 'CHORAL ROOM',         sub: 'MUSIC WORKROOM',       x: 8,  y: 68, w: 12, h: 10, kind: 'room', tone: '#22304f' },
  { id: 'aud',     label: 'AUDITORIUM',          sub: '1F',                   x: 22, y: 68, w: 24, h: 16, kind: 'room', tone: '#1e3459' },
  { id: 'band',    label: 'BAND ROOM',           sub: 'RADIO STATION ↓',      x: 48, y: 68, w: 12, h: 14, kind: 'room', tone: '#22304f' },

  // ── south-centre: library, patio, lobby, art gallery, main office ─────────
  { id: 'library', label: 'LIBRARY',             sub: 'LIB 02 · COMPUTERS',   x: 28, y: 39, w: 16, h: 14, kind: 'room', tone: '#17314c' },
  { id: 'patio',   label: 'STUDENT PATIO',       sub: 'OUTDOOR',              x: 28, y: 55, w: 16, h: 12, kind: 'yard', tone: '#12352d' },
  { id: 'art',     label: 'ART GALLERY',         sub: 'AR01–AR03',            x: 46, y: 39, w: 12, h: 13, kind: 'room', tone: '#1b3149' },
  { id: 'lobby',   label: 'STUDENT LOBBY',       sub: 'FINE & PERFORMING ARTS', x: 46, y: 55, w: 12, h: 12, kind: 'room', tone: '#1c3a52' },
  { id: 'office',  label: 'MAIN OFFICE',         sub: 'ATTENDANCE · PRINCIPAL', x: 60, y: 39, w: 14, h: 16, kind: 'room', tone: '#1b3149' },

  // ── 2F E-Hall inset (south-east) ──────────────────────────────────────────
  { id: 'physics', label: 'PHYSICS',             sub: '2F · E-HALL',          x: 62, y: 70, w: 12, h: 6,  kind: 'upper', tone: '#2a2745' },
  { id: 'math',    label: 'MATH OFFICE',         sub: 'COORDINATOR · 2F',     x: 75, y: 70, w: 13, h: 6,  kind: 'upper', tone: '#2a2745' },
  { id: 'hall2f',  label: 'E-HALL',              sub: '2F',                   x: 62, y: 77, w: 26, h: 4,  kind: 'upper', tone: '#2a2745' },
  { id: 'e2a',     label: 'E17–E25',             sub: 'ADMIN · MATH',         x: 62, y: 82, w: 12, h: 5,  kind: 'upper', tone: '#251f3b' },
  { id: 'e2b',     label: 'E11–E16',             sub: '2F · PHYSICS',         x: 75, y: 82, w: 13, h: 5,  kind: 'upper', tone: '#251f3b' },
];

// [x, y, w, h] openings that bridge the gaps between areas.
export const DOORS = [
  // D/C wings -> C/D hall
  [6, 15, 3, 1], [12, 15, 3, 1], [23, 15, 3, 1], [29, 15, 3, 1],
  // C/D hall -> little theater + student pubs (off the west spine)
  [15, 24, 2, 3], [20, 24, 2, 3],
  // B-wing rooms -> B hall
  [40, 14, 2, 3], [40, 24, 2, 3], [45, 14, 2, 3], [45, 24, 2, 3],
  // science / business -> E-hall
  [58, 15, 3, 2], [67, 15, 3, 2], [77, 15, 3, 2], [84, 15, 3, 2],
  // E-hall -> science workrooms + A-wing
  [57, 21, 3, 1], [65, 21, 3, 1], [77, 21, 3, 1], [84, 21, 3, 1],
  // science workrooms / A-wing -> main hall
  [58, 31, 3, 1], [66, 31, 3, 1], [78, 31, 3, 1], [84, 31, 3, 1],
  // main hall -> gym, west cafeteria, library, art gallery, main office
  [88, 33, 2, 3],
  [11, 37, 3, 2], [19, 37, 3, 2],
  [31, 37, 3, 2], [39, 37, 3, 2],
  [48, 37, 3, 2], [54, 37, 3, 2],
  [63, 37, 3, 2], [70, 37, 3, 2],
  // west cafeteria <-> east cafeteria, east cafeteria <-> choral
  [12, 51, 3, 3], [20, 51, 3, 3], [11, 66, 3, 2],
  // choral <-> auditorium <-> band
  [19, 72, 3, 3], [45, 74, 3, 3],
  // library <-> patio, patio <-> lobby, art gallery <-> lobby
  [32, 53, 3, 2], [40, 53, 3, 2], [43, 58, 3, 3], [48, 52, 3, 3],
  // gym block
  [92, 23, 3, 1], [94, 43, 3, 2], [95, 57, 3, 2],
  // 2F E-Hall
  [64, 76, 3, 1], [70, 76, 2, 1], [78, 76, 3, 1], [84, 76, 2, 1],
  [65, 81, 3, 1], [71, 81, 2, 1], [78, 81, 3, 1], [84, 81, 2, 1],
];

// Stairwells that link the 1F E-hall to the 2F E-Hall inset.
export const STAIR_LINKS = [
  { id: 'E', a: [87, 19], b: [64, 79], label: 'E-STAIR' },
  { id: 'C', a: [33, 35], b: [86, 79], label: 'C-STAIR' },
];

export const SPAWNS = [
  [10, 25], [27, 25], [9, 10], [25, 10], [37, 18], [49, 18],
  [43, 28], [43, 5], [60, 9], [80, 9], [70, 18], [60, 26],
  [80, 26], [95, 35], [93, 20], [15, 45], [15, 59], [35, 45],
  [35, 60], [51, 60], [66, 46], [34, 75], [53, 75], [13, 72],
  [70, 78], [68, 72],
];

export const DROP_SPOTS = [
  [10, 29], [43, 10], [66, 19], [95, 30], [12, 47], [35, 49],
  [40, 62], [51, 64], [66, 50], [34, 80], [70, 80],
];

// Pillars add cover without cutting rooms in half. [x, y, w, h]
export const PILLARS = [
  [95, 27, 2, 2], [100, 39, 2, 2],                 // main gym
  [33, 44, 2, 2], [40, 49, 2, 2],                  // library
  [28, 73, 2, 2], [40, 79, 2, 2],                  // auditorium
  [12, 42, 2, 2], [20, 47, 2, 2],                  // west cafeteria
  [12, 57, 2, 2], [20, 62, 2, 2],                  // east cafeteria
  [58, 8, 2, 2], [67, 11, 2, 2],                   // science dept
  [36, 20, 2, 2],                                  // B-wing
  [63, 45, 2, 2], [70, 50, 2, 2],                  // main office
  [52, 58, 2, 2],                                  // student lobby
  [95, 64, 2, 2],                                  // pool
];

const inRect = (x, y, r) => x >= r[0] && y >= r[1] && x < r[0] + r[2] && y < r[1] + r[3];

export function buildMap() {
  const n = MAP_W * MAP_H;
  const tiles = new Uint8Array(n);   // 0 void/wall, 1 floor, 2 stair
  const owner = new Array(n).fill(null);
  const idx = (x, y) => y * MAP_W + x;

  const paint = (x, y, w, h, area) => {
    for (let ty = y; ty < y + h; ty++) {
      for (let tx = x; tx < x + w; tx++) {
        if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) continue;
        tiles[idx(tx, ty)] = 1;
        if (area) owner[idx(tx, ty)] = area.id;
      }
    }
  };

  for (const a of AREAS) paint(a.x, a.y, a.w, a.h, a);

  const areaById = new Map(AREAS.map((a) => [a.id, a]));
  for (const d of DOORS) {
    // Door tiles inherit the nearest area's id so location labels stay sane.
    paint(d[0], d[1], d[2], d[3], null);
    for (let ty = d[1]; ty < d[1] + d[3]; ty++) {
      for (let tx = d[0]; tx < d[0] + d[2]; tx++) {
        let best = null;
        let bestD = 1e9;
        for (const a of AREAS) {
          const cx = a.x + a.w / 2;
          const cy = a.y + a.h / 2;
          const dd = (cx - tx) ** 2 + (cy - ty) ** 2;
          if (dd < bestD) { bestD = dd; best = a.id; }
        }
        owner[idx(tx, ty)] = best;
      }
    }
  }

  // Pillars (solid blocks inside areas).
  const pillarTiles = [];
  for (const p of PILLARS) {
    for (let ty = p[1]; ty < p[1] + p[3]; ty++) {
      for (let tx = p[0]; tx < p[0] + p[2]; tx++) {
        if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) continue;
        tiles[idx(tx, ty)] = 0;
        pillarTiles.push([tx, ty]);
      }
    }
  }

  // Stairs.
  const stairAt = new Map();
  for (const s of STAIR_LINKS) {
    for (const [t, o] of [[s.a, s.b], [s.b, s.a]]) {
      tiles[idx(t[0], t[1])] = 2;
      owner[idx(t[0], t[1])] = owner[idx(t[0], t[1])] || 'main';
      stairAt.set(idx(t[0], t[1]), { id: s.id, toX: o[0], toY: o[1] });
    }
  }

  // Wall tiles = solid tiles touching floor (8-neighbourhood), for rendering + collision skin.
  const wallTiles = [];
  const wallSet = new Uint8Array(n);
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      if (tiles[idx(x, y)] !== 0) continue;
      let touches = false;
      for (let dy = -1; dy <= 1 && !touches; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
          if (tiles[idx(nx, ny)] !== 0) { touches = true; break; }
        }
      }
      if (touches) { wallTiles.push([x, y]); wallSet[idx(x, y)] = 1; }
    }
  }

  const areas = AREAS.map((a) => ({ ...a }));
  const map = {
    tiles, owner, areas, wallTiles, wallSet, pillarTiles, stairAt,
    w: MAP_W, h: MAP_H, tile: TILE,
    areaById,
    isFloor(tx, ty) {
      if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return false;
      return tiles[ty * MAP_W + tx] !== 0;
    },
    stairAtTile(tx, ty) {
      return stairAt.get(ty * MAP_W + tx) || null;
    },
    areaAtTile(tx, ty) {
      if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return null;
      const id = owner[ty * MAP_W + tx];
      return id ? areaById.get(id) : null;
    },
    areaAtWorld(wx, wy) {
      return map.areaAtTile(Math.floor(wx / TILE), Math.floor(wy / TILE));
    },
  };
  return map;
}

export const mapCenter = { x: (MAP_W / 2) * TILE, y: 33.5 * TILE };

export function tileCenter(tx, ty) {
  return { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE };
}

// Circle collision against solid tiles.
export function circleBlocked(map, cx, cy, r) {
  const x0 = Math.floor((cx - r) / TILE);
  const x1 = Math.floor((cx + r) / TILE);
  const y0 = Math.floor((cy - r) / TILE);
  const y1 = Math.floor((cy + r) / TILE);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (map.isFloor(tx, ty)) continue;
      const rx = tx * TILE;
      const ry = ty * TILE;
      const nx = Math.max(rx, Math.min(cx, rx + TILE));
      const ny = Math.max(ry, Math.min(cy, ry + TILE));
      const dx = cx - nx;
      const dy = cy - ny;
      if (dx * dx + dy * dy < r * r) return true;
    }
  }
  return false;
}

export function solidAtWorld(map, wx, wy) {
  return !map.isFloor(Math.floor(wx / TILE), Math.floor(wy / TILE));
}

// Axis-separated move with sub-stepping so fast players cannot tunnel through walls.
export function moveCircle(map, x, y, dx, dy, r) {
  const dist = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(dist / 6));
  const sx = dx / steps;
  const sy = dy / steps;
  let px = x;
  let py = y;
  for (let i = 0; i < steps; i++) {
    if (!circleBlocked(map, px + sx, py, r)) px += sx;
    if (!circleBlocked(map, px, py + sy, r)) py += sy;
  }
  return { x: px, y: py };
}

// BFS over walkable tiles; stairwells are edges to their linked tile.
export function findPath(map, from, to) {
  const start = from[1] * MAP_W + from[0];
  const goal = to[1] * MAP_W + to[0];
  if (start === goal) return [];
  const prev = new Int32Array(MAP_W * MAP_H).fill(-1);
  const seen = new Uint8Array(MAP_W * MAP_H);
  const q = [start];
  seen[start] = 1;
  let head = 0;
  const dirs = [1, -1, MAP_W, -MAP_W];
  while (head < q.length) {
    const cur = q[head++];
    if (cur === goal) break;
    const cx = cur % MAP_W;
    const cy = (cur - cx) / MAP_W;
    const st = map.stairAt.get(cur);
    for (let k = 0; k < 5; k++) {
      let nxt;
      if (k === 4) {
        if (!st) continue;
        nxt = st.toY * MAP_W + st.toX;
      } else {
        const nx = cx + (k === 0 ? 1 : k === 1 ? -1 : 0);
        const ny = cy + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
        if (!map.isFloor(nx, ny)) continue;
        nxt = ny * MAP_W + nx;
      }
      if (seen[nxt]) continue;
      seen[nxt] = 1;
      prev[nxt] = cur;
      q.push(nxt);
    }
  }
  if (!seen[goal]) return [];
  const out = [];
  let cur = goal;
  let guard = 0;
  while (cur !== start && guard++ < 4000) {
    const cx = cur % MAP_W;
    const cy = (cur - cx) / MAP_W;
    out.push([cx, cy]);
    cur = prev[cur];
    if (cur < 0) return [];
  }
  out.reverse();
  return out;
}

export function randomFloorTile(map, rand) {
  for (let i = 0; i < 400; i++) {
    const tx = 2 + Math.floor(rand() * (MAP_W - 4));
    const ty = 2 + Math.floor(rand() * (MAP_H - 4));
    if (map.isFloor(tx, ty) && !map.stairAtTile(tx, ty)) return [tx, ty];
  }
  return SPAWNS[0];
}
