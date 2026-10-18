import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Pinned from the 21-asset, hash-audited production source 15b9def, not main.
const protectedBlobs = {
  'auth-domain.mjs': 'af328fa8ae479fe5bef67532b39d4a948e467d4a',
  'favicon.ico': 'cbf0ddaab764c10eef2a58831741f82dfcb4229b',
  'fizira-symbol.png': '4efc94d53c3dbcc61c19419dd831c450e0e56703',
  'media-fallback.css': 'a79ce64510b028ae488c7cedbc351d04d9002773',
  'parent-domain.mjs': 'a7a3111cd05b98ef8a872c7c74ee5e80b98b1988',
  'parent-specialist.js': '35b44bfd6ab45314a8afa2df8993ed0a89b6a0b8',
  'parent.css': 'a44f6e1d3c22cd9a3becb18304a08932e485feda',
  'parent.html': 'aa8e2c4952fa704cdecc1e7a00b44624ee993624',
  'parent.js': '6c6f7af4ce1581fba24b15a6846edd0c66c83b2d',
  'patient-flower.css': '28371d13895e1e5f2c1f6e751859ed6fab3a899d',
  'patient-flower.mjs': '5fd023baa415541890be27c583a9ada8cfb41ea0',
  'patient-overview.mjs': '4bc7155f7e4374a9dcdcb8313fffc78ec7a58f3d',
  'report-pdf-export.mjs': 'd7f07a9daa8d5d2e8388447c7b9163b3cbe203cf',
  'role-gate.mjs': 'eab0c3e5afc4ebdf064561304bdb7b6b505887f4',
  'security-utils.mjs': 'a79559deb980a340916e1605f4515461dab5b181'
};
const read = path => readFile(new URL(`../${path}`, import.meta.url));
const blob = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');

test('all 15 frontend assets outside the six-file specialist schedule delta retain production bytes', async () => {
  for (const [file, hash] of Object.entries(protectedBlobs)) assert.equal(blob(await read(file)), hash, file);
});

test('specialist entrypoint changes only cache references and shared CSS changes only inline-time selectors', async () => {
  const app = (await read('app.js')).toString().replace('./cabinet.js?v=9', './cabinet.js?v=8').replace('./schedule-editor.js?v=9', './schedule-editor.js?v=8');
  assert.equal(blob(Buffer.from(app)), '2250649b39cef060b7cf84b190cc864f094419d7');
  const index = (await read('index.html')).toString().replace('styles.css?v=0.189-schedule-inline-time', 'styles.css?v=0.187-flower-only').replace('app.js?v=0.189-schedule-inline-time', 'app.js?v=0.188-flower-nav');
  assert.equal(blob(Buffer.from(index)), '81b3b62fa34b28b1c80e6052f6dd4affce741170');
  const css = (await read('styles.css')).toString().replace(/^\.calendar-time-label\{.*\n/m, '');
  assert.equal(blob(Buffer.from(css)), 'b8db952feea673dcc840430d6d4d688f44bc9ac2');
});

test('every changed schedule dependency advances from its actual production URL', async () => {
  const dependencies = {
    'app.js': ['./cabinet.js?v=8', './schedule-editor.js?v=8'],
    'cabinet.js': ['./schedule-domain.mjs?v=2', './schedule-editor.js?v=8'],
    'schedule-editor.js': ['./schedule-domain.mjs?v=2'],
    'index.html': ['app.js?v=0.188-flower-nav', 'styles.css?v=0.187-flower-only']
  };
  for (const [file, oldUrls] of Object.entries(dependencies)) {
    const source = (await read(file)).toString();
    for (const old of oldUrls) {
      assert.ok(!source.includes(old), `${file}: stale production cache URL ${old}`);
      assert.ok(source.includes(old.split('?')[0] + '?v='), `${file}: dependency remains versioned`);
    }
  }
});
