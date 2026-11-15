import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const [html, manifestText, worker, deploy, generator] = await Promise.all([
  read('index.html'), read('manifest.webmanifest'), read('service-worker.js'),
  read('.github/workflows/deploy-fizira-frontend.yml'), read('ops/pwa/generate-icons.py')
]);
const manifest = JSON.parse(manifestText);

test('PWA metadata supports iPhone standalone launch', () => {
  assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/);
  assert.match(html, /rel="apple-touch-icon" sizes="180x180" href="\/icons\/icon-180\.png"/);
  assert.match(html, /serviceWorker\.register\('\/service-worker\.js'\)/);
  assert.equal(manifest.id, '/');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');
  assert.deepEqual(manifest.icons.map(i => i.sizes), ['192x192','512x512']);
});
test('offline service worker never caches protected application data', () => {
  assert.match(worker, /cache\.add\(OFFLINE_PAGE\)/);
  assert.match(worker, /event\.request\.mode !== 'navigate'/);
  assert.doesNotMatch(worker, /cache\.put\(|addAll\(|app\.js|patient-media/);
});
test('manual deploy generates and publishes all PWA assets', () => {
  for (const asset of ['manifest.webmanifest','service-worker.js','offline.html','icons/icon-180.png','icons/icon-192.png','icons/icon-512.png']) {
    assert.ok(deploy.includes(asset), asset);
  }
  assert.match(deploy, /python ops\/pwa\/generate-icons\.py/);
  assert.match(generator, /fizira-symbol\.png/);
  assert.match(deploy, /workflow_dispatch:/);
});
