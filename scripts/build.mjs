// Bundles src/index.js (plus the shared modules) into dist/worker.js for hosting.
// Uses esbuild through npx so nothing is vendored into the repo.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist');
fs.mkdirSync(OUT, { recursive: true });

try {
  execFileSync('npx', ['--yes', 'esbuild@0.24.0', 'src/index.js', '--bundle', '--format=esm',
    '--platform=neutral', '--target=es2022', '--outfile=dist/worker.js'], {
    cwd: ROOT,
    stdio: 'inherit',
  });
} catch (err) {
  console.error('\nBuild needs esbuild (npx downloads it once). If you are offline, run the game locally with `npm run dev`.\n');
  process.exit(1);
}

const bytes = fs.statSync(path.join(OUT, 'worker.js')).size;
const manifest = {
  entrypoint: 'worker.js',
  compatibilityDate: '2026-01-01',
  modules: [{ name: 'worker.js', type: 'esm', path: './worker.js' }],
  assetsDirectory: '../public',
  spa: false,
};
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`dist/worker.js  ${(bytes / 1024).toFixed(1)} KiB`);
console.log('dist/manifest.json  (assets from public/, needs a D1 binding named DB)');
