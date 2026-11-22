// Map sanity check: connectivity, spawns, drops, labels. `node scripts/check-map.mjs`
import { buildMap, MAP_W, MAP_H, SPAWNS, DROP_SPOTS, STAIR_LINKS, AREAS } from '../public/shared/map.js';

const map = buildMap();
const idx = (x, y) => y * MAP_W + x;

function flood(start) {
  const seen = new Uint8Array(MAP_W * MAP_H);
  const q = [start];
  seen[start] = 1;
  for (let head = 0; head < q.length; head++) {
    const cur = q[head];
    const cx = cur % MAP_W;
    const cy = (cur - cx) / MAP_W;
    const st = map.stairAt.get(cur);
    const cand = [];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
      if (!map.isFloor(nx, ny)) continue;
      cand.push(idx(nx, ny));
    }
    if (st) cand.push(st.toY * MAP_W + st.toX);
    for (const n of cand) {
      if (seen[n]) continue;
      seen[n] = 1;
      q.push(n);
    }
  }
  return seen;
}

let floors = 0;
for (let i = 0; i < map.tiles.length; i++) if (map.tiles[i]) floors++;
console.log(`floor tiles: ${floors}  walls: ${map.wallTiles.length}  stairwells: ${STAIR_LINKS.length}`);

const seen = flood(idx(...SPAWNS[0]));
let unreachable = 0;
const problems = [];

for (const s of SPAWNS) {
  if (!map.isFloor(s[0], s[1])) problems.push(`spawn not floor ${s}`);
  if (!seen[idx(s[0], s[1])]) problems.push(`spawn unreachable ${s}`);
}
for (const d of DROP_SPOTS) {
  if (!map.isFloor(d[0], d[1])) problems.push(`drop not floor ${d}`);
  if (!seen[idx(d[0], d[1])]) problems.push(`drop unreachable ${d}`);
}
for (const a of AREAS) {
  let reach = 0;
  let total = 0;
  for (let ty = a.y; ty < a.y + a.h; ty++) {
    for (let tx = a.x; tx < a.x + a.w; tx++) {
      if (!map.isFloor(tx, ty)) continue;
      total++;
      if (seen[idx(tx, ty)]) reach++;
    }
  }
  if (!total) problems.push(`area ${a.id} has no floor`);
  if (!reach) problems.push(`area ${a.id} unreachable`);
  console.log(`  ${a.sub} ${a.label.padEnd(20)} reach ${String(reach).padStart(3)}/${total}`);
}

// How many disconnected floor regions exist?
const regions = [];
const visited = new Uint8Array(map.tiles.length);
for (let i = 0; i < map.tiles.length; i++) {
  if (!map.tiles[i] || visited[i]) continue;
  const f = flood(i);
  let size = 0;
  for (let j = 0; j < f.length; j++) if (f[j]) { size++; visited[j] = 1; }
  regions.push(size);
}
console.log(`floor regions: ${regions.length} (sizes ${regions.join(', ')})`);

// Coarse ASCII overview for eyeballing the plan.
const step = 2;
let art = '';
for (let y = 0; y < MAP_H; y += step) {
  let line = '';
  for (let x = 0; x < MAP_W; x += step) {
    const t = map.tiles[idx(x, y)];
    const id = map.owner[idx(x, y)];
    if (map.stairAt.get(idx(x, y))) line += 'S';
    else if (t) line += id ? (map.areaById.get(id).kind === 'yard' ? ',' : '.') : '-';
    else line += ' ';
  }
  art += line.trimEnd() + '\n';
}
console.log(art);

if (problems.length) {
  console.error('PROBLEMS:');
  for (const p of problems) console.error(' - ' + p);
  process.exit(1);
}
console.log('MAP OK');
