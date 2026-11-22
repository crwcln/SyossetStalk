// Local dev server: serves ./public and runs the real Worker + a node:sqlite stand-in for D1.
// `node scripts/dev-server.mjs` (PORT=3000 by default)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 3000);
const DB_PATH = process.env.DB_PATH || path.join(ROOT, '.data', 'stoss.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');

// Minimal D1 surface: prepare().bind().first()/run()/all()
function d1Shim(database) {
  const wrap = (sql, params) => ({
    bind: (...p) => wrap(sql, p),
    first: async () => {
      const row = database.prepare(sql).get(...params);
      return row === undefined ? null : row;
    },
    all: async () => ({ results: database.prepare(sql).all(...params) }),
    run: async () => {
      const r = database.prepare(sql).run(...params);
      return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
    },
  });
  return { prepare: (sql) => wrap(sql, []) };
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const { default: worker } = await import('../src/index.js');
const env = { DB: d1Shim(db) };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      const chunks = [];
      let size = 0;
      for await (const c of req) {
        size += c.length;
        if (size > 2e6) { res.writeHead(413).end('too large'); return; }
        chunks.push(c);
      }
      const bodyBuf = Buffer.concat(chunks);
      const request = new Request(url, {
        method: req.method,
        headers: req.headers,
        body: req.method === 'GET' || req.method === 'HEAD' ? undefined : bodyBuf,
      });
      const response = await worker.fetch(request, env);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }

    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.join(PUBLIC, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(PUBLIC)) { res.writeHead(403).end('forbidden'); return; }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      return;
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    });
    fs.createReadStream(file).pipe(res);
  } catch (err) {
    console.error('dev-server error', err);
    res.writeHead(500, { 'content-type': 'text/plain' }).end('dev server error: ' + (err?.stack || err));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`SyossetStalk dev server on http://0.0.0.0:${PORT}`);
  console.log(`db: ${DB_PATH}`);
});
