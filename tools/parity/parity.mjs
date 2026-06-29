import { readFileSync, existsSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { hashInV8 } from './run-node.mjs';
import { FIXTURES } from './fixtures.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const bundlePath = resolve(root, 'dist', 'sim-bundle.js');
const runnerDir = resolve(root, 'tools', 'parity', 'goja-runner');

// Ensure the bundle exists (build on demand).
if (!existsSync(bundlePath)) {
  try {
    execFileSync('npm', ['run', 'bundle'], { cwd: root, stdio: 'inherit', shell: true });
  } catch {
    console.error('Bundle build failed.');
    process.exit(1);
  }
}
const bundleSource = readFileSync(bundlePath, 'utf8');

let failed = false;
let gojaRan = false;

// V8 side: the bundle must reproduce each fixture's expected hash.
for (const f of FIXTURES) {
  const v8 = hashInV8(bundleSource, f.bundle);
  if (v8 !== f.expectedHash) {
    console.error(`V8 mismatch [${f.name}]: ${v8} !== ${f.expectedHash}`);
    failed = true;
  }
}

// goja side: skip gracefully when Go is not installed (CI enforces it).
const goProbe = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['go']);
if (goProbe.status !== 0) {
  console.log('Go absent — skipping goja parity (CI enforces it).');
} else {
  for (const f of FIXTURES) {
    const out = execFileSync('go', ['run', '.', bundlePath], {
      cwd: runnerDir,
      input: JSON.stringify(f.bundle),
      encoding: 'utf8',
    });
    const goja = JSON.parse(out).hash;
    if (goja !== f.expectedHash) {
      console.error(`goja mismatch [${f.name}]: ${goja} !== ${f.expectedHash}`);
      failed = true;
    }
  }
  console.log('goja parity checked.');
  gojaRan = true;
}

if (failed) {
  console.error('PARITY FAILED');
  process.exit(1);
}
const okDetail = gojaRan
  ? 'V8 === goja === expected'
  : 'V8 === expected; goja skipped — Go absent';
console.log(`PARITY OK (${okDetail}) for`, FIXTURES.length, 'fixture(s).');
